'use strict';

/**
 * src/sync/orchestrator.js
 * ------------------------
 * The brain of the ingestion pipeline. It wires every helper module together
 * and decides WHEN to run in "full" or "incremental" mode.
 *
 * High-level flow:
 *
 *                    runSync({mode})
 *                         │
 *                         ▼
 *           ┌────── acquire Redis lock ──────┐
 *           │            │                    │
 *           │   read previous state          │
 *           │            │                    │
 *           │   compute effective start      │
 *           │            │                    │
 *           │   pick JQL filters (scope      │
 *           │   + updatedSince for delta)    │
 *           │            │                    │
 *           │   for each ticket bundle:      │
 *           │      normalise → chunk →       │
 *           │      embed → replace in Mongo  │
 *           │            │                    │
 *           │   detect deletions (full mode) │
 *           │            │                    │
 *           │   write success state          │
 *           │            │                    │
 *           └── release Redis lock ──────────┘
 *
 * Important behaviour notes (match these to the requirements):
 *   - We ALWAYS capture `runStartedAt` BEFORE contacting Jira so the next
 *     incremental run can start from this point minus the lookback window.
 *   - On any error we call `markRunFailed`; we never advance checkpoints.
 *   - `delete-before-upsert per ticket` handles content changes, additions,
 *     and attachment/Confluence removals safely in one place.
 *   - Full import clears Redis state before running, then rebuilds the
 *     `knownTicketKeys` list from the current scope.
 */

const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} SyncResult
 * @property {"full"|"incremental"} mode
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {number} ticketsProcessed
 * @property {number} chunksInserted
 * @property {number} chunksDeleted
 * @property {number} ticketsDeleted
 * @property {string[]} knownTicketKeys
 */

/**
 * Orchestrates one sync run.
 *
 * @param {Object} deps — Concrete dependencies (already constructed).
 * @param {import('../jira/fetcher').JiraFetcher} deps.fetcher
 * @param {import('../confluence/client').ConfluenceClient|null} deps.confluenceClient
 * @param {import('../embeddings/embedder').Embedder} deps.embedder
 * @param {import('../vectorStore/mongoStore').MongoVectorStore} deps.vectorStore
 * @param {import('../state/redisState').RedisState} deps.redisState
 * @param {import('../../config/appConfig').AppConfig} deps.cfg
 * @param {Object} args
 * @param {"full"|"incremental"} args.mode
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<SyncResult>}
 */
async function runSync(deps, { mode, logger }) {
  const log = (logger || createLogger()).child({ component: 'orchestrator', mode });

  // --- 1. Acquire a run lock so two concurrent Lambda invocations cannot
  //        trample each other. If the lock is already held we bail gracefully.
  const token = await deps.redisState.acquireLock();
  if (!token) {
    log.warn('another sync run appears to be in progress; skipping');
    throw new Error('sync lock is held by another run');
  }

  const startedAt = new Date().toISOString();

  try {
    await deps.redisState.markRunStarted(mode);
    await deps.vectorStore.ensureIndexes();

    // --- 2. Figure out what "updatedSince" filter to pass to Jira.
    //        Full import → undefined (grab everything in scope).
    //        Incremental → previous start minus lookback window.
    let updatedSince;
    const prev = await deps.redisState.readState();

    if (mode === 'incremental') {
      if (!prev.lastIncrementalStartAt && !prev.lastFullImportAt) {
        // No prior successful run — fall back to a full import to guarantee
        // completeness. This handles the "fresh Lambda / cleared state" case.
        log.warn('no prior sync checkpoint; upgrading to full import');
        mode = 'full';
      } else {
        const anchor = prev.lastIncrementalStartAt || prev.lastFullImportAt;
        const anchorMs = new Date(anchor).getTime();
        const lookbackMs = deps.cfg.incrementalLookbackMinutes * 60_000;
        updatedSince = new Date(anchorMs - lookbackMs).toISOString();
        log.info('incremental window computed', {
          previousAnchor: anchor,
          lookbackMinutes: deps.cfg.incrementalLookbackMinutes,
          effectiveUpdatedSince: updatedSince,
        });
      }
    }

    const filters = {
      projectKeys: deps.cfg.jira.projectKeys,
      issueTypes: deps.cfg.jira.issueTypes,
      statuses: deps.cfg.jira.statuses,
      labels: deps.cfg.jira.labels,
      updatedSince,
    };

    // --- 3. Process tickets one at a time. Each ticket is a self-contained
    //        delete-then-insert transaction in Mongo so partial failures
    //        never leave mixed old/new chunks.
    const { ConfluenceClient: ConfluenceClientClass } = require('../confluence/client');
    const { normalizeTicket } = require('../normalization/normalizer');
    const { chunkTicket } = require('../chunking/chunker');

    const processedKeys = new Set();
    let ticketsProcessed = 0;
    let chunksInserted = 0;
    let chunksDeleted = 0;

    for await (const bundle of deps.fetcher.streamTicketBundles(filters)) {
      const issueKey = bundle.issue.key;
      const tLog = log.child({ issueKey });

      try {
        // a) Normalise raw Jira JSON into our unified shape.
        const normalized = await normalizeTicket({
          bundle,
          confluenceClient: deps.confluenceClient,
          includeConfluence: deps.cfg.jira.includeConfluence,
          logger: tLog,
        });

        // b) Chunk the normalised ticket into retrieval-ready units.
        const chunks = chunkTicket({ ticket: normalized, cfg: deps.cfg.chunking });

        // c) Generate embeddings for every chunk (batched inside the embedder).
        const texts = chunks.map((c) => c.text);
        const embeddings = await deps.embedder.embedMany(texts);

        // d) Replace this ticket's chunks in Mongo.
        const { inserted, deleted } = await deps.vectorStore.replaceTicketChunks(
          issueKey,
          chunks,
          embeddings
        );
        chunksInserted += inserted;
        chunksDeleted += deleted;
        ticketsProcessed += 1;
        processedKeys.add(issueKey);
        tLog.info('ticket indexed', { chunks: inserted, replacedOld: deleted });
      } catch (err) {
        // Per-ticket failures are logged but do not abort the whole run.
        // We still advance other tickets. The next run's lookback window
        // will re-pick this ticket for another try.
        tLog.error('ticket processing failed', { error: err });
      }
    }

    // --- 4. Deletion detection.
    //        Full import: anything that was previously known but is NOT in
    //        the current scope is removed.
    //        Incremental: a ticket becomes undetectable if Jira moved it out
    //        of scope or deleted it. We do a cheap cross-check by asking Jira
    //        for the current in-scope keys and comparing against the last
    //        known set.
    let ticketsDeleted = 0;
    /** @type {string[]} */
    let authoritativeKeys = [];

    if (mode === 'full') {
      authoritativeKeys = Array.from(processedKeys);
      // Anything in prev.knownTicketKeys that we did not touch this run is
      // either deleted or out of scope.
      const toDelete = (prev.knownTicketKeys || []).filter((k) => !processedKeys.has(k));
      if (toDelete.length) {
        ticketsDeleted = await deps.vectorStore.deleteTickets(toDelete);
        log.info('removed out-of-scope tickets', { count: toDelete.length });
      }
    } else {
      // Incremental: ask Jira for the full in-scope key list and detect
      // anything that is now missing. This query is fast (skinny fields).
      const currentScope = await deps.fetcher.listTicketKeysInScope({
        projectKeys: filters.projectKeys,
        issueTypes: filters.issueTypes,
        statuses: filters.statuses,
        labels: filters.labels,
      });
      const currentSet = new Set(currentScope);
      const toDelete = (prev.knownTicketKeys || []).filter((k) => !currentSet.has(k));
      if (toDelete.length) {
        ticketsDeleted = await deps.vectorStore.deleteTickets(toDelete);
        log.info('removed tickets no longer in scope', { count: toDelete.length });
      }
      authoritativeKeys = currentScope;
    }

    // --- 5. Persist a successful checkpoint.
    const completedAt = new Date().toISOString();
    if (mode === 'full') {
      await deps.redisState.writeFullImportSuccess({
        startedAt,
        completedAt,
        knownTicketKeys: authoritativeKeys,
      });
    } else {
      await deps.redisState.writeIncrementalSuccess({
        startedAt,
        completedAt,
        knownTicketKeys: authoritativeKeys,
      });
    }

    const result = /** @type {SyncResult} */ ({
      mode,
      startedAt,
      completedAt,
      ticketsProcessed,
      chunksInserted,
      chunksDeleted,
      ticketsDeleted,
      knownTicketKeys: authoritativeKeys,
    });
    log.info('sync completed successfully', result);
    return result;
  } catch (err) {
    // Checkpoint stays unchanged on failure so the next run retries the
    // same window.
    await deps.redisState.markRunFailed(err?.message || 'unknown failure');
    log.error('sync failed', { error: err });
    throw err;
  } finally {
    await deps.redisState.releaseLock(token);
  }
}

module.exports = {
  runSync,
};
