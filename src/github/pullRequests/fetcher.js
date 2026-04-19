'use strict';

/**
 * src/github/pullRequests/fetcher.js
 * ----------------------------------
 * High-level PR fetcher. Orchestrates the four endpoints required to build
 * a fully-hydrated `NormalizedPullRequest`:
 *
 *    1. `GET /repos/:o/:r/pulls?sort=updated&direction=desc` for the list.
 *    2. `GET /repos/:o/:r/issues/:n/comments` for conversation comments.
 *    3. `GET /repos/:o/:r/pulls/:n/reviews` for review events.
 *    4. `GET /repos/:o/:r/pulls/:n/comments` for inline review-comments.
 *    5. `GET /repos/:o/:r/pulls/:n/files` for changed-file metadata.
 *
 * Incremental mode
 * ----------------
 * The list endpoint returns results sorted DESCENDING by `updated_at`. We
 * stop iterating as soon as we see a PR whose `updated_at` predates the
 * `since` argument — this is much cheaper than asking GitHub to filter
 * server-side (the pulls endpoint has no `since` parameter).
 */

const { createLogger } = require('../../utils/logger');

/**
 * @typedef {import('./normalizer').NormalizedPullRequest} NormalizedPullRequest
 */

class GithubPullRequestFetcher {
  /**
   * @param {Object} opts
   * @param {import('../client').GithubClient} opts.client
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ client, logger }) {
    this.client = client;
    this.logger = (logger || createLogger()).child({ component: 'githubPRs' });
  }

  /**
   * Streams normalised PRs. Incremental mode early-stops when PR updated_at
   * predates `since`.
   *
   * @param {Object} args
   * @param {string} [args.since] ISO-8601. Omit for full history.
   * @returns {AsyncGenerator<NormalizedPullRequest, void, unknown>}
   */
  async *streamPullRequests({ since } = {}) {
    const { normalizePullRequest } = require('./normalizer');
    const sinceMs = since ? Date.parse(since) : null;

    let count = 0;
    for await (const raw of this.client.listPullRequests({ state: 'all' })) {
      const updatedAt = raw?.updated_at;
      // Early stop: because the list is updated-desc sorted, once we see a
      // row whose updated_at is older than `since`, every subsequent row is
      // too (GitHub guarantees stable ordering given our explicit direction).
      if (sinceMs != null && updatedAt && Date.parse(updatedAt) < sinceMs) {
        this.logger.info('incremental early-stop at PR', {
          prNumber: raw.number,
          updatedAt,
        });
        break;
      }
      try {
        const normalized = await this._hydrate(raw);
        yield normalized;
        count += 1;
      } catch (err) {
        this.logger.error('PR hydrate failed; skipping', {
          prNumber: raw?.number,
          error: err?.message,
        });
      }
    }
    this.logger.info('PR stream complete', { count });
  }

  /**
   * Hydrates a single raw PR into a fully-normalised pull request.
   * @private
   * @param {any} raw
   * @returns {Promise<NormalizedPullRequest>}
   */
  async _hydrate(raw) {
    const { normalizePullRequest } = require('./normalizer');
    const n = Number(raw.number);

    // Fetch satellite resources in sequence. They are small lists, and
    // sequential calls keep the secondary rate-limiter happy.
    const conversationComments = await this._collect(this.client.listPullRequestIssueComments(n));
    const reviews = await this._collect(this.client.listPullRequestReviews(n));
    const reviewComments = await this._collect(this.client.listPullRequestReviewComments(n));
    const files = await this._collect(this.client.listPullRequestFiles(n));

    return normalizePullRequest({
      raw,
      repoFullName: this.client.repoFullName,
      conversationComments,
      reviews,
      reviewComments,
      files,
    });
  }

  /**
   * Drains an async iterator into a materialised array.
   * @private
   * @template T
   * @param {AsyncIterable<T>} it
   * @returns {Promise<T[]>}
   */
  async _collect(it) {
    /** @type {any[]} */
    const out = [];
    for await (const item of it) out.push(item);
    return out;
  }

  /**
   * Lists the NUMBERS of every PR currently in scope. Used by the
   * orchestrator for deletion detection.
   * @returns {Promise<number[]>}
   */
  async listPullRequestNumbersInScope() {
    const out = [];
    for await (const raw of this.client.listPullRequests({ state: 'all' })) {
      const n = Number(raw?.number);
      if (Number.isFinite(n)) out.push(n);
    }
    return out;
  }
}

module.exports = {
  GithubPullRequestFetcher,
};
