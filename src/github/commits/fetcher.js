'use strict';

/**
 * src/github/commits/fetcher.js
 * -----------------------------
 * Streams unique commits across the set of ACTIVE branches.
 *
 * Design notes
 * ------------
 *  - We iterate one branch at a time. Within each branch we use GitHub's
 *    `?sha=<branch>&since=<ISO>` filter so incremental mode only pulls the
 *    commits made since the last successful sync.
 *  - A run-local `Map<sha, {commit, branches[]}>` deduplicates SHAs that
 *    appear on multiple branches. Instead of yielding the same commit
 *    twice we yield ONCE with a `branches[]` array containing every branch
 *    the commit was visible on — that array ends up in the chunk metadata
 *    so retrieval can filter by branch.
 *  - The list endpoint does not return the `files[]` array. We must follow
 *    up with `GET /repos/:o/:r/commits/:sha` for each unique SHA. We do
 *    this LAZILY inside the generator so callers can stop early and avoid
 *    those extra calls if they want.
 */

const { createLogger } = require('../../utils/logger');

/**
 * @typedef {import('./normalizer').NormalizedCommit} NormalizedCommit
 */

/**
 * @typedef {Object} BranchInfo
 * @property {string} name
 * @property {string} [committedDate]
 */

class GithubCommitFetcher {
  /**
   * @param {Object} opts
   * @param {import('../client').GithubClient} opts.client
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ client, logger }) {
    this.client = client;
    this.logger = (logger || createLogger()).child({ component: 'githubCommits' });
  }

  /**
   * Streams normalised commits from the given branches.
   *
   * @param {Object} args
   * @param {BranchInfo[]} args.branches
   * @param {string} [args.since] ISO-8601. Undefined = full history.
   * @returns {AsyncGenerator<NormalizedCommit, void, unknown>}
   */
  async *streamCommits({ branches, since }) {
    const { normalizeCommit } = require('./normalizer');

    /**
     * In-memory dedupe map keyed by SHA. Value holds:
     *   - `branches[]`: every branch on which we saw the SHA.
     *   - `rawList`  : the raw commit rows from the list endpoint (needed
     *                  because the list endpoint returns a richer top-level
     *                  shape than the detail endpoint's shallow view).
     *
     * We DO NOT emit the commit until we've finished walking every branch
     * because an early emit would produce a shortened `branches[]` list on
     * chunks — bad for retrieval filtering.
     *
     * For very large repos this map could get big; in practice the
     * incremental-mode `since` filter keeps it small.
     */
    /** @type {Map<string, {branches: Set<string>, raw: any}>} */
    const seen = new Map();

    for (const branch of branches) {
      const bLog = this.logger.child({ branch: branch.name });
      bLog.info('listing commits', { since });
      let count = 0;

      for await (const raw of this.client.listCommits({ branch: branch.name, since })) {
        const sha = raw?.sha;
        if (!sha) continue;
        count += 1;
        const existing = seen.get(sha);
        if (existing) {
          existing.branches.add(branch.name);
        } else {
          seen.set(sha, { branches: new Set([branch.name]), raw });
        }
      }
      bLog.info('commits listed', { branchTotal: count, uniqueSoFar: seen.size });
    }

    // Now walk the dedupe map. For each SHA, fetch the commit detail so we
    // can include `files[]` in the normalised output. This is the slow phase
    // of a commit sync — but it's capped by the total number of UNIQUE SHAs
    // (not branches × commits).
    for (const [sha, { branches: branchSet, raw: listRaw }] of seen) {
      try {
        const detail = await this.client.getCommit(sha);
        // The detail endpoint may also report associated pull requests under
        // the `associatedPullRequests` key in the GraphQL world, but via REST
        // that info is only available through a separate endpoint. We fall
        // back to an empty list; callers needing PR-linkage can fill it in
        // later if the feature is enabled.
        const normalized = normalizeCommit({
          raw: detail,
          repoFullName: this.client.repoFullName,
          branches: Array.from(branchSet),
          associatedPullRequestNumbers: extractAssociatedPrNumbers(detail, listRaw),
        });
        yield normalized;
      } catch (err) {
        // Per-commit failures are logged but never abort the stream.
        this.logger.warn('commit detail fetch failed; skipping', {
          sha,
          error: err?.message,
        });
      }
    }
  }

  /**
   * Convenience: returns the list of in-scope SHAs across the given branches,
   * without fetching detail. Used by the orchestrator for deletion detection
   * (commits removed from all active branches should be deleted from the
   * vector store).
   *
   * @param {BranchInfo[]} branches
   * @returns {Promise<string[]>}
   */
  async listShasInScope(branches) {
    /** @type {Set<string>} */
    const shas = new Set();
    for (const branch of branches) {
      for await (const raw of this.client.listCommits({ branch: branch.name })) {
        if (raw?.sha) shas.add(raw.sha);
      }
    }
    return Array.from(shas);
  }
}

/**
 * Extracts PR numbers from the various shapes the REST API may return.
 * The commit-detail endpoint does not populate this by default, but some
 * callers stuff `associated_pulls` on the raw payload themselves.
 * @param {any} detail
 * @param {any} listRaw
 * @returns {number[]}
 */
function extractAssociatedPrNumbers(detail, listRaw) {
  const out = new Set();
  const pushFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const n = Number(item?.number);
      if (Number.isFinite(n)) out.add(n);
    }
  };
  pushFrom(detail?.associated_pulls);
  pushFrom(listRaw?.associated_pulls);
  return Array.from(out).sort((a, b) => a - b);
}

module.exports = {
  GithubCommitFetcher,
};
