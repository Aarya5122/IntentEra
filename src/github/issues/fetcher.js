'use strict';

/**
 * src/github/issues/fetcher.js
 * ----------------------------
 * Fetches repository issues with their comments and filters out pull
 * requests (which GitHub returns through the same endpoint).
 *
 * Incremental mode
 * ----------------
 * The issues endpoint supports a native `since=<ISO>` filter, which we pass
 * through. Results are still returned updated-desc so we can additionally
 * early-stop if GitHub ever gives us a row older than `since`.
 */

const { createLogger } = require('../../utils/logger');

class GithubIssueFetcher {
  /**
   * @param {Object} opts
   * @param {import('../client').GithubClient} opts.client
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ client, logger }) {
    this.client = client;
    this.logger = (logger || createLogger()).child({ component: 'githubIssues' });
  }

  /**
   * Streams normalised issues.
   *
   * @param {Object} [args]
   * @param {string} [args.since] ISO-8601.
   * @returns {AsyncGenerator<import('./normalizer').NormalizedIssue, void, unknown>}
   */
  async *streamIssues({ since } = {}) {
    const { normalizeIssue } = require('./normalizer');

    let count = 0;
    for await (const raw of this.client.listIssues({ state: 'all', since })) {
      // GitHub returns PRs through this endpoint. Skip them — the PR
      // fetcher is responsible for pulling those.
      if (raw?.pull_request) continue;
      try {
        const comments = await this._collect(this.client.listIssueComments(raw.number));
        yield normalizeIssue({
          raw,
          repoFullName: this.client.repoFullName,
          comments,
        });
        count += 1;
      } catch (err) {
        this.logger.warn('issue hydrate failed; skipping', {
          number: raw?.number,
          error: err?.message,
        });
      }
    }
    this.logger.info('issue stream complete', { count });
  }

  /**
   * Returns the numbers of every issue currently in scope (excluding PRs).
   * Used by the orchestrator for deletion detection.
   * @returns {Promise<number[]>}
   */
  async listIssueNumbersInScope() {
    const out = [];
    for await (const raw of this.client.listIssues({ state: 'all' })) {
      if (raw?.pull_request) continue;
      const n = Number(raw?.number);
      if (Number.isFinite(n)) out.push(n);
    }
    return out;
  }

  /**
   * @private
   * @template T
   * @param {AsyncIterable<T>} it
   * @returns {Promise<T[]>}
   */
  async _collect(it) {
    const out = [];
    for await (const item of it) out.push(item);
    return out;
  }
}

module.exports = {
  GithubIssueFetcher,
};
