'use strict';

/**
 * src/github/orchestrator.js
 * --------------------------
 * The GitHub equivalent of `src/sync/orchestrator.js`. Mirrors the same
 * shape (acquire lock → read state → compute since → stream entities →
 * delete-then-insert per entity → deletion sweep → write success state)
 * and touches the same primitives (Redis state, Mongo vector store,
 * embedder) but uses the GitHub fetchers + chunkers.
 *
 * Three entity types feed the same pipeline sequentially:
 *   1. commits       → run-local SHA dedupe across active branches.
 *   2. pull requests → each PR is a "bundle" of body + reviews + comments.
 *   3. issues        → mirrors Jira ticket layout.
 *
 * Any entity type can be skipped per-invocation via the `entityTypes`
 * argument (e.g. ["issues"] during a targeted backfill).
 */

const { createLogger } = require('../utils/logger');
const { listActiveBranches } = require('./branches');
const { chunkCommit } = require('./commits/chunker');
const { chunkPullRequest } = require('./pullRequests/chunker');
const { chunkIssue } = require('./issues/chunker');

/**
 * @typedef {"commits"|"pullRequests"|"issues"} GithubEntityType
 *
 * @typedef {Object} GithubSyncResult
 * @property {"full"|"incremental"} mode
 * @property {string} startedAt
 * @property {string} completedAt
 * @property {string} repoFullName
 * @property {GithubEntityType[]} entityTypes
 * @property {number} commitsProcessed
 * @property {number} pullRequestsProcessed
 * @property {number} issuesProcessed
 * @property {number} chunksInserted
 * @property {number} chunksDeleted
 * @property {number} entitiesDeleted
 * @property {import('../state/redisState').GithubKnownEntityIds} knownEntityIds
 * @property {string[]} activeBranches
 */

/**
 * Entry point for one GitHub sync run.
 *
 * @param {Object} deps
 * @param {import('./client').GithubClient} deps.githubClient
 * @param {import('./commits/fetcher').GithubCommitFetcher} deps.commitFetcher
 * @param {import('./pullRequests/fetcher').GithubPullRequestFetcher} deps.pullRequestFetcher
 * @param {import('./issues/fetcher').GithubIssueFetcher} deps.issueFetcher
 * @param {import('../embeddings/embedder').Embedder} deps.embedder
 * @param {import('../vectorStore/mongoStore').MongoVectorStore} deps.vectorStore
 * @param {import('../state/redisState').RedisState} deps.redisState
 * @param {import('../../config/appConfig').AppConfig} deps.cfg
 * @param {Object} args
 * @param {"full"|"incremental"} args.mode
 * @param {GithubEntityType[]} [args.entityTypes]
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<GithubSyncResult>}
 */
async function runGithubSync(deps, { mode, entityTypes, logger }) {
  const log = (logger || createLogger()).child({
    component: 'githubOrchestrator',
    mode,
    repo: deps.githubClient.repoFullName,
  });

  // Resolve which entity types to ingest. Defaults to every configured type.
  const configured = [];
  if (deps.cfg.github.includeCommits) configured.push('commits');
  if (deps.cfg.github.includePullRequests) configured.push('pullRequests');
  if (deps.cfg.github.includeIssues) configured.push('issues');
  const types = (entityTypes && entityTypes.length ? entityTypes : configured).filter(
    (t) => configured.includes(t)
  );
  if (!types.length) {
    throw new Error('runGithubSync: no entity types selected');
  }

  // --- 1. Distributed lock scoped to the GitHub source.
  const token = await deps.redisState.acquireLock();
  if (!token) {
    log.warn('another github sync run appears to be in progress; skipping');
    throw new Error('github sync lock is held by another run');
  }

  const startedAt = new Date().toISOString();

  try {
    await deps.redisState.markRunStarted(mode);
    await deps.vectorStore.ensureIndexes();

    // --- 2. Compute `since` window for incremental mode.
    const prev = await deps.redisState.readState();
    /** @type {string|undefined} */
    let since;
    if (mode === 'incremental') {
      if (!prev.lastIncrementalStartAt && !prev.lastFullImportAt) {
        log.warn('no prior github sync checkpoint; upgrading to full import');
        mode = 'full';
      } else {
        const anchor = prev.lastIncrementalStartAt || prev.lastFullImportAt;
        const anchorMs = new Date(anchor).getTime();
        const lookbackMs = deps.cfg.incrementalLookbackMinutes * 60_000;
        since = new Date(anchorMs - lookbackMs).toISOString();
        log.info('incremental window computed', {
          previousAnchor: anchor,
          lookbackMinutes: deps.cfg.incrementalLookbackMinutes,
          effectiveSince: since,
        });
      }
    }

    // --- 3. Resolve active branches (always — even when commits are off, we
    //        log them to make debugging easier).
    const activeBranches = await listActiveBranches({
      client: deps.githubClient,
      staleBranchDays: deps.cfg.github.staleBranchDays,
      maxBranches: deps.cfg.github.maxBranches,
      logger: log,
    });

    let commitsProcessed = 0;
    let pullRequestsProcessed = 0;
    let issuesProcessed = 0;
    let chunksInserted = 0;
    let chunksDeleted = 0;

    /** @type {Set<string>} */
    const seenCommits = new Set();
    /** @type {Set<number>} */
    const seenPRs = new Set();
    /** @type {Set<number>} */
    const seenIssues = new Set();
    /** @type {Record<string, import('../state/redisState').GithubBranchCheckpoint>} */
    const branchCheckpoints = { ...(prev.branchCheckpoints || {}) };

    /**
     * Helper that re-indexes a single chunked entity. Centralised so every
     * entity type gets identical "embed → delete-then-insert → tally" logic.
     */
    const processEntity = async (entityKey, chunks, tLog) => {
      const texts = chunks.map((c) => c.text);
      const embeddings = await deps.embedder.embedMany(texts);
      const { inserted, deleted } = await deps.vectorStore.replaceEntityChunks(
        entityKey,
        chunks,
        embeddings
      );
      chunksInserted += inserted;
      chunksDeleted += deleted;
      tLog.info('entity indexed', { chunks: inserted, replacedOld: deleted });
    };

    // --- 4a. Commits.
    if (types.includes('commits')) {
      log.info('ingesting commits', { activeBranches: activeBranches.length });
      try {
        for await (const commit of deps.commitFetcher.streamCommits({
          branches: activeBranches,
          since,
        })) {
          const tLog = log.child({ entityKey: commit.entityKey });
          try {
            const chunks = chunkCommit({ commit, cfg: deps.cfg.github });
            await processEntity(commit.entityKey, chunks, tLog);
            commitsProcessed += 1;
            seenCommits.add(commit.sha);
          } catch (err) {
            tLog.error('commit processing failed', { error: err });
          }
        }
      } catch (err) {
        log.error('commit stream failed', { error: err });
        throw err;
      }
      // Record branch tips so the next incremental run has a baseline. We
      // do not use these for `since` computation (we use the time anchor
      // for that), but they are useful telemetry.
      for (const b of activeBranches) {
        branchCheckpoints[b.name] = { lastSha: b.headSha, lastSeenAt: startedAt };
      }
    }

    // --- 4b. Pull requests.
    if (types.includes('pullRequests')) {
      log.info('ingesting pull requests', { since });
      try {
        for await (const pr of deps.pullRequestFetcher.streamPullRequests({ since })) {
          const tLog = log.child({ entityKey: pr.entityKey });
          try {
            const chunks = chunkPullRequest({ pr, cfg: deps.cfg.github });
            await processEntity(pr.entityKey, chunks, tLog);
            pullRequestsProcessed += 1;
            seenPRs.add(pr.number);
          } catch (err) {
            tLog.error('PR processing failed', { error: err });
          }
        }
      } catch (err) {
        log.error('PR stream failed', { error: err });
        throw err;
      }
    }

    // --- 4c. Issues.
    if (types.includes('issues')) {
      log.info('ingesting issues', { since });
      try {
        for await (const issue of deps.issueFetcher.streamIssues({ since })) {
          const tLog = log.child({ entityKey: issue.entityKey });
          try {
            const chunks = chunkIssue({ issue, cfg: deps.cfg.github });
            await processEntity(issue.entityKey, chunks, tLog);
            issuesProcessed += 1;
            seenIssues.add(issue.number);
          } catch (err) {
            tLog.error('issue processing failed', { error: err });
          }
        }
      } catch (err) {
        log.error('issue stream failed', { error: err });
        throw err;
      }
    }

    // --- 5. Deletion sweep.
    //        For each entity type we pulled in this run we compare the
    //        CURRENT in-scope id set to the known set and delete any
    //        orphans from Mongo. "Current in-scope" lookups are cheap —
    //        they touch only list endpoints, not detail endpoints.
    let entitiesDeleted = 0;
    const nextKnown = {
      commits: [...(prev.knownEntityIds?.commits || [])],
      pullRequests: [...(prev.knownEntityIds?.pullRequests || [])],
      issues: [...(prev.knownEntityIds?.issues || [])],
    };

    if (types.includes('commits')) {
      if (mode === 'full') {
        // Full: authoritative list is what we just processed.
        const stale = (prev.knownEntityIds?.commits || []).filter((sha) => !seenCommits.has(sha));
        if (stale.length) {
          entitiesDeleted += await deps.vectorStore.deleteEntities(
            stale.map((sha) => `commit:${sha}`)
          );
          log.info('removed out-of-scope commits', { count: stale.length });
        }
        nextKnown.commits = Array.from(seenCommits);
      } else {
        // Incremental: look up the full current scope ONCE for cheap diff.
        const currentShas = new Set(await deps.commitFetcher.listShasInScope(activeBranches));
        const stale = (prev.knownEntityIds?.commits || []).filter((sha) => !currentShas.has(sha));
        if (stale.length) {
          entitiesDeleted += await deps.vectorStore.deleteEntities(
            stale.map((sha) => `commit:${sha}`)
          );
          log.info('removed commits no longer on any active branch', { count: stale.length });
        }
        nextKnown.commits = Array.from(currentShas);
      }
    }

    if (types.includes('pullRequests')) {
      const currentPrs = new Set(await deps.pullRequestFetcher.listPullRequestNumbersInScope());
      const stale = (prev.knownEntityIds?.pullRequests || []).filter((n) => !currentPrs.has(n));
      if (stale.length) {
        entitiesDeleted += await deps.vectorStore.deleteEntities(stale.map((n) => `pr:${n}`));
        log.info('removed deleted/out-of-scope PRs', { count: stale.length });
      }
      nextKnown.pullRequests = Array.from(currentPrs).sort((a, b) => a - b);
    }

    if (types.includes('issues')) {
      const currentIssues = new Set(await deps.issueFetcher.listIssueNumbersInScope());
      const stale = (prev.knownEntityIds?.issues || []).filter((n) => !currentIssues.has(n));
      if (stale.length) {
        entitiesDeleted += await deps.vectorStore.deleteEntities(stale.map((n) => `issue:${n}`));
        log.info('removed deleted issues', { count: stale.length });
      }
      nextKnown.issues = Array.from(currentIssues).sort((a, b) => a - b);
    }

    // --- 6. Write success state.
    const completedAt = new Date().toISOString();
    if (mode === 'full') {
      await deps.redisState.writeGithubFullImportSuccess({
        startedAt,
        completedAt,
        knownEntityIds: nextKnown,
        branchCheckpoints,
      });
    } else {
      await deps.redisState.writeGithubIncrementalSuccess({
        startedAt,
        completedAt,
        knownEntityIds: nextKnown,
        branchCheckpoints,
      });
    }

    /** @type {GithubSyncResult} */
    const result = {
      mode,
      startedAt,
      completedAt,
      repoFullName: deps.githubClient.repoFullName,
      entityTypes: types,
      commitsProcessed,
      pullRequestsProcessed,
      issuesProcessed,
      chunksInserted,
      chunksDeleted,
      entitiesDeleted,
      knownEntityIds: nextKnown,
      activeBranches: activeBranches.map((b) => b.name),
    };
    log.info('github sync completed successfully', result);
    return result;
  } catch (err) {
    await deps.redisState.markRunFailed(err?.message || 'unknown failure');
    log.error('github sync failed', { error: err });
    throw err;
  } finally {
    await deps.redisState.releaseLock(token);
  }
}

module.exports = {
  runGithubSync,
};
