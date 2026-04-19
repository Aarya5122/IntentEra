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
 * State schema (JSON stored under `${keyPrefix}state`):
 *   {
 *     "lastFullImportAt":          ISO8601 | null,
 *     "lastIncrementalStartAt":    ISO8601 | null,
 *     "lastIncrementalCompletedAt":ISO8601 | null,
 *     "mode":                      "incremental" | "full" | null,
 *     "status":                    "idle" | "running" | "failed",
 *     "failureReason":             string | null,
 *     "schemaVersion":             1,
 *     "knownTicketKeys":           string[]
 *   }
 *
 * Principles (the "why" behind the design):
 *   1. The state is written ONLY after a run finishes successfully. That way a
 *      crash mid-run cannot advance the checkpoint and miss updates.
 *   2. A simple distributed lock (`${keyPrefix}lock`) prevents two incremental
 *      runs from racing. If a prior run crashed without releasing the lock,
 *      the TTL expires it automatically, so we never wedge forever.
 *   3. Forced full imports clear `knownTicketKeys` before running. On success
 *      we repopulate it with the authoritative list of tickets currently in
 *      scope. This is used later to detect deletions.
 *   4. Missing/corrupted state is not fatal — we return a safe default. The
 *      orchestrator interprets that as "no checkpoint yet, do a full import
 *      to be safe".
 */

const Redis = require('ioredis');
const { createLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const SCHEMA_VERSION = 1;

/**
 * @typedef {"idle"|"running"|"failed"} SyncStatus
 * @typedef {"incremental"|"full"} SyncMode
 *
 * @typedef {Object} SyncState
 * @property {string|null} lastFullImportAt
 * @property {string|null} lastIncrementalStartAt
 * @property {string|null} lastIncrementalCompletedAt
 * @property {SyncMode|null} mode
 * @property {SyncStatus} status
 * @property {string|null} failureReason
 * @property {number} schemaVersion
 * @property {string[]} knownTicketKeys
 */

const DEFAULT_STATE = /** @type {SyncState} */ ({
  lastFullImportAt: null,
  lastIncrementalStartAt: null,
  lastIncrementalCompletedAt: null,
  mode: null,
  status: 'idle',
  failureReason: null,
  schemaVersion: SCHEMA_VERSION,
  knownTicketKeys: [],
});

/**
 * Thin wrapper around an ioredis client that knows the IntentEra schema.
 */
class RedisState {
  /**
   * @param {Object} opts
   * @param {string} opts.url Redis connection URL.
   * @param {string} opts.keyPrefix Prefix for every key this module writes.
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ url, keyPrefix, logger }) {
    this.keyPrefix = keyPrefix;
    this.logger = (logger || createLogger()).child({ component: 'redisState' });
    // ioredis supports lazy connect which matters for Lambda cold starts:
    // the client only opens a TCP connection on the first real command.
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  /**
   * Connect to Redis. Safe to call multiple times.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.client.status === 'ready' || this.client.status === 'connecting') return;
    await withRetry(() => this.client.connect(), { label: 'redis-connect', logger: this.logger });
    this.logger.debug('redis connected');
  }

  /**
   * Close the Redis connection. Lambda code does NOT need to call this
   * between invocations (we reuse the container); it is useful in the CLI
   * runner so that Node can exit cleanly.
   * @returns {Promise<void>}
   */
  async disconnect() {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn('redis quit failed; forcing disconnect', { error: err?.message });
      this.client.disconnect();
    }
  }

  /** Full key for the sync-state JSON. */
  _stateKey() { return `${this.keyPrefix}state`; }

  /** Full key for the distributed run lock. */
  _lockKey() { return `${this.keyPrefix}lock`; }

  /**
   * Reads the current state from Redis. Returns a safe default when no state
   * exists yet OR when the stored payload is not valid JSON. We never throw
   * for missing state because "no checkpoint yet" is a valid startup case.
   * @returns {Promise<SyncState>}
   */
  async readState() {
    await this.connect();
    const raw = await withRetry(() => this.client.get(this._stateKey()), {
      label: 'redis-get-state',
      logger: this.logger,
    });
    if (!raw) {
      this.logger.info('no sync state found; using defaults');
      return { ...DEFAULT_STATE };
    }

    try {
      const parsed = JSON.parse(raw);
      // Fill in any missing fields with defaults so the rest of the code can
      // rely on the full shape even if we add fields across versions.
      return { ...DEFAULT_STATE, ...parsed };
    } catch (err) {
      this.logger.warn('sync state is corrupt JSON; resetting to defaults', {
        error: err.message,
      });
      return { ...DEFAULT_STATE };
    }
  }

  /**
   * Writes the state atomically (single SET). Use only after a successful run.
   * @param {SyncState} state
   * @returns {Promise<void>}
   */
  async writeState(state) {
    await this.connect();
    const payload = JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION });
    await withRetry(() => this.client.set(this._stateKey(), payload), {
      label: 'redis-set-state',
      logger: this.logger,
    });
    this.logger.debug('sync state written', { bytes: payload.length });
  }

  /**
   * Marks the run as started WITHOUT advancing any time-based checkpoints.
   * We update the `status: "running"` flag so that a simultaneously-triggered
   * run can see it. Time checkpoints only advance after success.
   * @param {SyncMode} mode
   * @returns {Promise<void>}
   */
  async markRunStarted(mode) {
    const cur = await this.readState();
    await this.writeState({ ...cur, mode, status: 'running', failureReason: null });
  }

  /**
   * Marks the run as failed so the next invocation can see the prior error.
   * Time checkpoints are intentionally left unchanged.
   * @param {string} reason
   * @returns {Promise<void>}
   */
  async markRunFailed(reason) {
    const cur = await this.readState();
    await this.writeState({ ...cur, status: 'failed', failureReason: String(reason).slice(0, 500) });
  }

  /**
   * Acquires a simple single-owner lock. Returns a unique token on success
   * that must be passed back to `releaseLock`. If another run already holds
   * the lock, resolves to null so the caller can skip gracefully.
   *
   * We use SET NX EX to make this atomic and we attach a TTL so a dead Lambda
   * cannot wedge future invocations.
   *
   * @param {number} [ttlSeconds=900] How long the lock survives if the holder crashes.
   * @returns {Promise<string|null>} Token or null when the lock is held.
   */
  async acquireLock(ttlSeconds = 900) {
    await this.connect();
    // Using a random token rather than a fixed string ensures that a stale
    // owner cannot accidentally release another process's lock later.
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await withRetry(
      () => this.client.set(this._lockKey(), token, 'EX', ttlSeconds, 'NX'),
      { label: 'redis-acquire-lock', logger: this.logger }
    );
    return result === 'OK' ? token : null;
  }

  /**
   * Releases the lock only if WE still own it (token match). Using a tiny
   * Lua script makes the compare-and-delete atomic.
   * @param {string} token Token returned by acquireLock.
   * @returns {Promise<boolean>} True if we owned and released it.
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
   * Convenience: atomically writes a complete "successful incremental" state.
   * Uses the provided `startedAt` (the timestamp we read at the START of the
   * run, so the NEXT incremental covers changes since startedAt minus lookback).
   * @param {Object} args
   * @param {string} args.startedAt ISO8601
   * @param {string} args.completedAt ISO8601
   * @param {string[]} args.knownTicketKeys Updated known ticket set.
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
      knownTicketKeys,
    });
  }

  /**
   * Convenience: atomically writes a complete "successful full import" state.
   * @param {Object} args
   * @param {string} args.startedAt ISO8601
   * @param {string} args.completedAt ISO8601
   * @param {string[]} args.knownTicketKeys Authoritative list of indexed tickets.
   * @returns {Promise<void>}
   */
  async writeFullImportSuccess({ startedAt, completedAt, knownTicketKeys }) {
    await this.writeState({
      ...DEFAULT_STATE,
      lastFullImportAt: completedAt,
      lastIncrementalStartAt: startedAt,
      lastIncrementalCompletedAt: completedAt,
      mode: 'full',
      status: 'idle',
      knownTicketKeys,
    });
  }
}

module.exports = {
  RedisState,
  DEFAULT_STATE,
  SCHEMA_VERSION,
};
