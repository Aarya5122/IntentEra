'use strict';

/**
 * src/state/redisState.js
 * -----------------------
 * Persistent sync state stored in Redis. This module is the ONLY place in
 * the project that talks to Redis directly, so everything related to the
 * checkpoint schema lives here.
 *
 * -----------------------------------------------------------------------------
 * Why Redis?
 *   - Very low latency for small reads/writes, which is what a checkpoint is.
 *   - Works nicely across many Lambda concurrent executions.
 *
 * Per-source keys
 * ---------------
 * Each data source (Jira, GitHub) gets its own state key. This isolates
 * failure modes (a failed GitHub run never stalls Jira incremental progress)
 * and lets each source ship its own state schema.
 *
 *     {keyPrefix}state:jira       → Jira sync state
 *     {keyPrefix}state:github     → GitHub sync state
 *     {keyPrefix}lock:jira        → Jira run lock
 *     {keyPrefix}lock:github      → GitHub run lock
 *
 * Backward compatibility
 * ----------------------
 * Earlier versions wrote Jira state at the legacy key `{keyPrefix}state`.
 * On first read, if the new `:jira` key is missing but the legacy key
 * exists, we transparently migrate (read legacy → write :jira → delete
 * legacy). This keeps existing deployments working without data loss.
 *
 * Shape (common fields for all sources)
 * -------------------------------------
 *   {
 *     "lastFullImportAt":          ISO8601 | null,
 *     "lastIncrementalStartAt":    ISO8601 | null,
 *     "lastIncrementalCompletedAt":ISO8601 | null,
 *     "mode":                      "incremental" | "full" | null,
 *     "status":                    "idle" | "running" | "failed",
 *     "failureReason":             string | null,
 *     "schemaVersion":             2,
 *     "source":                    "jira" | "github"
 *   }
 *
 * Jira-specific extra fields:
 *   "knownTicketKeys":  string[]
 *
 * GitHub-specific extra fields:
 *   "knownEntityIds": {
 *     "commits":      string[]  // full SHAs
 *     "pullRequests": number[]
 *     "issues":       number[]
 *   }
 *   "branchCheckpoints": { [branch]: { lastSha: string, lastSeenAt: string } }
 *
 * Principles (the "why" behind the design):
 *   1. The state is written ONLY after a run finishes successfully. That way a
 *      crash mid-run cannot advance the checkpoint and miss updates.
 *   2. A simple distributed lock (`{keyPrefix}lock:{source}`) prevents two
 *      concurrent incremental runs from racing. If a prior run crashed
 *      without releasing the lock, the TTL expires it automatically, so we
 *      never wedge forever.
 *   3. Forced full imports clear the known-id set before running. On success
 *      we repopulate it with the authoritative list of entities currently
 *      in scope. This is used later to detect deletions.
 *   4. Missing/corrupted state is not fatal — we return a safe default. The
 *      orchestrator interprets that as "no checkpoint yet, do a full import
 *      to be safe".
 */

const Redis = require('ioredis');
const { createLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const SCHEMA_VERSION = 2;

/**
 * @typedef {"idle"|"running"|"failed"} SyncStatus
 * @typedef {"incremental"|"full"} SyncMode
 * @typedef {"jira"|"github"} SyncSource
 */

/**
 * @typedef {Object} GithubKnownEntityIds
 * @property {string[]} commits
 * @property {number[]} pullRequests
 * @property {number[]} issues
 */

/**
 * @typedef {Object} GithubBranchCheckpoint
 * @property {string} lastSha
 * @property {string} lastSeenAt ISO8601
 */

/**
 * @typedef {Object} SyncState
 * @property {SyncSource} source
 * @property {string|null} lastFullImportAt
 * @property {string|null} lastIncrementalStartAt
 * @property {string|null} lastIncrementalCompletedAt
 * @property {SyncMode|null} mode
 * @property {SyncStatus} status
 * @property {string|null} failureReason
 * @property {number} schemaVersion
 * @property {string[]} knownTicketKeys  Jira-only. Empty for GitHub.
 * @property {GithubKnownEntityIds} knownEntityIds  GitHub-only.
 * @property {Record<string, GithubBranchCheckpoint>} branchCheckpoints GitHub-only.
 */

/**
 * Builds a safe default SyncState for a given source.
 * @param {SyncSource} source
 * @returns {SyncState}
 */
function defaultState(source) {
  return {
    source,
    lastFullImportAt: null,
    lastIncrementalStartAt: null,
    lastIncrementalCompletedAt: null,
    mode: null,
    status: 'idle',
    failureReason: null,
    schemaVersion: SCHEMA_VERSION,
    knownTicketKeys: [],
    knownEntityIds: { commits: [], pullRequests: [], issues: [] },
    branchCheckpoints: {},
  };
}

/**
 * Backward compatible default for the legacy Jira-only module. Kept as an
 * EXPORT so existing tests / callers referencing `DEFAULT_STATE` don't break.
 */
const DEFAULT_STATE = defaultState('jira');

/**
 * Thin wrapper around an ioredis client that knows the IntentEra schema.
 */
class RedisState {
  /**
   * @param {Object} opts
   * @param {string} opts.url Redis connection URL.
   * @param {string} opts.keyPrefix Prefix for every key this module writes.
   * @param {SyncSource} [opts.source="jira"] Which data source this instance tracks.
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ url, keyPrefix, source = 'jira', logger }) {
    if (source !== 'jira' && source !== 'github') {
      throw new Error(`RedisState: unsupported source "${source}"`);
    }
    this.keyPrefix = keyPrefix;
    this.source = source;
    this.logger = (logger || createLogger()).child({
      component: 'redisState',
      source,
    });
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  /** @returns {Promise<void>} */
  async connect() {
    if (this.client.status === 'ready' || this.client.status === 'connecting') return;
    await withRetry(() => this.client.connect(), { label: 'redis-connect', logger: this.logger });
    this.logger.debug('redis connected');
  }

  /** @returns {Promise<void>} */
  async disconnect() {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn('redis quit failed; forcing disconnect', { error: err?.message });
      this.client.disconnect();
    }
  }

  /** State key for THIS source. */
  _stateKey() { return `${this.keyPrefix}state:${this.source}`; }

  /** Lock key for THIS source. */
  _lockKey() { return `${this.keyPrefix}lock:${this.source}`; }

  /** Legacy state key (before per-source keys existed). */
  _legacyStateKey() { return `${this.keyPrefix}state`; }

  /** Legacy lock key. */
  _legacyLockKey() { return `${this.keyPrefix}lock`; }

  /**
   * Reads the current state from Redis. Returns a safe default when no state
   * exists yet OR when the stored payload is not valid JSON.
   *
   * Backward-compat migration: for the jira source, if the new `:jira`
   * key is empty but the legacy unsuffixed key exists, read legacy → write
   * to the new key → delete legacy.
   *
   * @returns {Promise<SyncState>}
   */
  async readState() {
    await this.connect();
    const raw = await withRetry(() => this.client.get(this._stateKey()), {
      label: 'redis-get-state',
      logger: this.logger,
    });

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return this._hydrateState(parsed);
      } catch (err) {
        this.logger.warn('sync state is corrupt JSON; resetting to defaults', {
          error: err.message,
        });
        return defaultState(this.source);
      }
    }

    // Legacy migration path, only for jira.
    if (this.source === 'jira') {
      const legacy = await withRetry(() => this.client.get(this._legacyStateKey()), {
        label: 'redis-get-state-legacy',
        logger: this.logger,
      });
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          this.logger.info('migrating legacy jira state to :jira key');
          const migrated = this._hydrateState({ ...parsed, source: 'jira' });
          await this.writeState(migrated);
          await withRetry(() => this.client.del(this._legacyStateKey()), {
            label: 'redis-del-legacy',
            logger: this.logger,
          });
          return migrated;
        } catch (err) {
          this.logger.warn('legacy jira state unreadable; ignoring', { error: err.message });
        }
      }
    }

    this.logger.info('no sync state found; using defaults');
    return defaultState(this.source);
  }

  /**
   * Fills any missing fields so the rest of the code can rely on the full
   * shape even when migrating from an older schema.
   * @private
   * @param {any} parsed
   * @returns {SyncState}
   */
  _hydrateState(parsed) {
    const base = defaultState(this.source);
    const merged = { ...base, ...parsed, source: this.source };
    // Preserve nested defaults when absent.
    merged.knownEntityIds = {
      ...base.knownEntityIds,
      ...(parsed?.knownEntityIds || {}),
    };
    merged.branchCheckpoints = {
      ...(parsed?.branchCheckpoints || {}),
    };
    if (!Array.isArray(merged.knownTicketKeys)) merged.knownTicketKeys = [];
    merged.schemaVersion = SCHEMA_VERSION;
    return merged;
  }

  /**
   * Writes the state atomically (single SET). Use only after a successful run.
   * @param {SyncState} state
   * @returns {Promise<void>}
   */
  async writeState(state) {
    await this.connect();
    const payload = JSON.stringify({
      ...state,
      source: this.source,
      schemaVersion: SCHEMA_VERSION,
    });
    await withRetry(() => this.client.set(this._stateKey(), payload), {
      label: 'redis-set-state',
      logger: this.logger,
    });
    this.logger.debug('sync state written', { bytes: payload.length });
  }

  /**
   * Marks the run as started WITHOUT advancing any time-based checkpoints.
   * @param {SyncMode} mode
   * @returns {Promise<void>}
   */
  async markRunStarted(mode) {
    const cur = await this.readState();
    await this.writeState({ ...cur, mode, status: 'running', failureReason: null });
  }

  /**
   * Marks the run as failed so the next invocation can see the prior error.
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async markRunFailed(reason) {
    const cur = await this.readState();
    await this.writeState({ ...cur, status: 'failed', failureReason: String(reason).slice(0, 500) });
  }

  /**
   * Acquires a single-owner lock (scoped to this source). Returns a token on
   * success that must be passed back to `releaseLock`.
   * @param {number} [ttlSeconds=900]
   * @returns {Promise<string|null>}
   */
  async acquireLock(ttlSeconds = 900) {
    await this.connect();
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await withRetry(
      () => this.client.set(this._lockKey(), token, 'EX', ttlSeconds, 'NX'),
      { label: 'redis-acquire-lock', logger: this.logger }
    );
    return result === 'OK' ? token : null;
  }

  /**
   * Releases the lock iff we still own it (token match), using an atomic
   * compare-and-delete Lua script.
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async releaseLock(token) {
    await this.connect();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await withRetry(
      () => this.client.eval(script, 1, this._lockKey(), token),
      { label: 'redis-release-lock', logger: this.logger }
    );
    return result === 1;
  }

  /**
   * Writes a successful incremental checkpoint for the Jira source.
   * @param {Object} args
   * @param {string} args.startedAt
   * @param {string} args.completedAt
   * @param {string[]} args.knownTicketKeys
   * @returns {Promise<void>}
   */
  async writeIncrementalSuccess({ startedAt, completedAt, knownTicketKeys }) {
    const cur = await this.readState();
    await this.writeState({
      ...cur,
      lastIncrementalStartAt: startedAt,
      lastIncrementalCompletedAt: completedAt,
      mode: 'incremental',
      status: 'idle',
      failureReason: null,
      knownTicketKeys: knownTicketKeys ?? cur.knownTicketKeys,
    });
  }

  /**
   * Writes a successful full-import checkpoint for the Jira source.
   * @param {Object} args
   * @param {string} args.startedAt
   * @param {string} args.completedAt
   * @param {string[]} args.knownTicketKeys
   * @returns {Promise<void>}
   */
  async writeFullImportSuccess({ startedAt, completedAt, knownTicketKeys }) {
    await this.writeState({
      ...defaultState(this.source),
      lastFullImportAt: completedAt,
      lastIncrementalStartAt: startedAt,
      lastIncrementalCompletedAt: completedAt,
      mode: 'full',
      status: 'idle',
      knownTicketKeys,
    });
  }

  /**
   * GitHub-flavoured incremental success write. Updates the knownEntityIds
   * bag in addition to the time checkpoints.
   * @param {Object} args
   * @param {string} args.startedAt
   * @param {string} args.completedAt
   * @param {GithubKnownEntityIds} args.knownEntityIds
   * @param {Record<string, GithubBranchCheckpoint>} [args.branchCheckpoints]
   * @returns {Promise<void>}
   */
  async writeGithubIncrementalSuccess({ startedAt, completedAt, knownEntityIds, branchCheckpoints }) {
    const cur = await this.readState();
    await this.writeState({
      ...cur,
      lastIncrementalStartAt: startedAt,
      lastIncrementalCompletedAt: completedAt,
      mode: 'incremental',
      status: 'idle',
      failureReason: null,
      knownEntityIds: knownEntityIds || cur.knownEntityIds,
      branchCheckpoints: branchCheckpoints || cur.branchCheckpoints,
    });
  }

  /**
   * GitHub-flavoured full-import success write. Replaces knownEntityIds with
   * the authoritative in-scope list discovered during the run.
   * @param {Object} args
   * @param {string} args.startedAt
   * @param {string} args.completedAt
   * @param {GithubKnownEntityIds} args.knownEntityIds
   * @param {Record<string, GithubBranchCheckpoint>} [args.branchCheckpoints]
   * @returns {Promise<void>}
   */
  async writeGithubFullImportSuccess({ startedAt, completedAt, knownEntityIds, branchCheckpoints }) {
    await this.writeState({
      ...defaultState(this.source),
      lastFullImportAt: completedAt,
      lastIncrementalStartAt: startedAt,
      lastIncrementalCompletedAt: completedAt,
      mode: 'full',
      status: 'idle',
      knownEntityIds,
      branchCheckpoints: branchCheckpoints || {},
    });
  }
}

module.exports = {
  RedisState,
  DEFAULT_STATE,
  SCHEMA_VERSION,
  defaultState,
};
