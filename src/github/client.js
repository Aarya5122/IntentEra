'use strict';

/**
 * src/github/client.js
 * --------------------
 * Minimal HTTP wrapper around the GitHub REST API (v3) + a small GraphQL
 * helper (v4). Structured like `src/jira/client.js` so the two source
 * adapters feel symmetric.
 *
 * What this module does
 * ---------------------
 *   - Authenticates with GitHub using a Personal Access Token (PAT) via the
 *     `Authorization: token <pat>` header.
 *   - Runs paginated REST calls using GitHub's `Link` response header
 *     (page-based) AND can also use `since=<ISO>` filters for endpoints that
 *     accept them (commits, issues).
 *   - Exposes a tiny GraphQL helper for the one thing the REST API can't do
 *     cheaply: listing every branch plus its tip commit date in a single
 *     request (used by `src/github/branches.js`).
 *   - Respects BOTH of GitHub's rate-limit mechanisms:
 *       (a) Primary rate limit  → header `x-ratelimit-remaining`.
 *       (b) Secondary rate limit → HTTP 403/429 with a `retry-after` header.
 *
 * What this module does NOT do
 * ----------------------------
 *   - No business logic. Normalisation / chunking live in the per-entity
 *     modules under `src/github/commits`, `src/github/pullRequests`, and
 *     `src/github/issues`.
 *
 * Why a thin client?
 *   - Easier to mock in tests.
 *   - Keeps HTTP details in one place so we can swap to `@octokit/rest` or
 *     GitHub App auth later without touching any callers.
 */

const axios = require('axios');
const { withRetry, sleep, defaultShouldRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * When `x-ratelimit-remaining` drops at or below this number we preemptively
 * pause until the window resets. 100 leaves plenty of headroom for other
 * concurrent Lambda invocations that might be hitting the same PAT.
 */
const SOFT_RATE_LIMIT_FLOOR = 100;

/**
 * Builds the HTTP Authorization header for a GitHub PAT. Classic PATs and
 * fine-grained PATs both use the `token` scheme.
 * @param {string} pat
 * @returns {string}
 */
function patAuthHeader(pat) {
  return `token ${pat}`;
}

/**
 * Parses a single element of a GitHub `Link` header value. Looks like:
 *   <https://api.github.com/repos/o/r/issues?page=3>; rel="next"
 * Returns an object { next, prev, first, last } with the URLs keyed by rel.
 * @param {string|undefined} header
 * @returns {Record<string,string>}
 */
function parseLinkHeader(header) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      out[match[2]] = match[1];
    }
  }
  return out;
}

class GithubClient {
  /**
   * @param {Object} opts
   * @param {string} opts.token PAT value.
   * @param {string} opts.repoOwner
   * @param {string} opts.repoName
   * @param {string} [opts.restEndpoint] Default: https://api.github.com
   * @param {string} [opts.graphqlEndpoint] Default: https://api.github.com/graphql
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ token, repoOwner, repoName, restEndpoint, graphqlEndpoint, logger }) {
    if (!token) throw new Error('GithubClient: token is required');
    if (!repoOwner || !repoName) throw new Error('GithubClient: repoOwner and repoName are required');

    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.restEndpoint = (restEndpoint || 'https://api.github.com').replace(/\/+$/, '');
    this.graphqlEndpoint = graphqlEndpoint || 'https://api.github.com/graphql';
    this.logger = (logger || createLogger()).child({ component: 'github' });

    this.http = axios.create({
      baseURL: this.restEndpoint,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: patAuthHeader(token),
        // Recommended by GitHub so they can tune the response format.
        Accept: 'application/vnd.github+json',
        // Pins the REST API version so responses stay stable.
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'intentera-rag',
      },
      // We want to inspect the raw status code in our own handler so failures
      // from rate limiting can be translated into retryable delays. Axios
      // throws on non-2xx by default; `validateStatus: () => true` flips that.
      validateStatus: () => true,
    });
  }

  /** Convenient "owner/name" string used as a metadata field on chunks. */
  get repoFullName() {
    return `${this.repoOwner}/${this.repoName}`;
  }

  /**
   * Pretty-prints the remaining quota from the most recent response. Called
   * after every REST call so we always have a recent rate-limit picture in
   * logs at debug level.
   * @private
   * @param {any} response
   */
  _noteRateLimit(response) {
    const remaining = Number(response?.headers?.['x-ratelimit-remaining']);
    const reset = Number(response?.headers?.['x-ratelimit-reset']);
    if (Number.isFinite(remaining)) {
      this.logger.debug('github rate limit', { remaining, resetEpoch: reset });
    }
  }

  /**
   * Handles GitHub-specific response conditions that cannot be translated by
   * the generic retry helper:
   *   - Primary rate limit exhaustion (remaining=0 with a reset time).
   *   - Secondary rate limit responses (HTTP 403/429 + `retry-after`).
   *   - Non-2xx responses in general (we promote them to thrown Errors so
   *     `withRetry` can inspect `err.response.status`).
   *
   * @private
   * @param {import('axios').AxiosResponse} response
   * @param {string} label Short label used in logs.
   * @returns {Promise<import('axios').AxiosResponse>} the same response when OK.
   */
  async _checkResponse(response, label) {
    this._noteRateLimit(response);

    // Secondary rate limit: GitHub may return 403 OR 429 with a retry-after.
    const retryAfter = Number(response.headers?.['retry-after']);
    if ((response.status === 403 || response.status === 429) && Number.isFinite(retryAfter) && retryAfter > 0) {
      const waitMs = Math.min(retryAfter, 60) * 1000;
      this.logger.warn('github secondary rate limit; waiting', { label, waitSeconds: retryAfter });
      await sleep(waitMs);
      // Return a synthetic error that the retry helper recognises as retryable.
      const err = new Error(`github secondary rate limit (${response.status})`);
      /** @type {any} */ (err).response = response;
      throw err;
    }

    // Primary rate limit: remaining reached zero. Wait until the reset epoch.
    const remaining = Number(response.headers?.['x-ratelimit-remaining']);
    const reset = Number(response.headers?.['x-ratelimit-reset']);
    if (response.status === 403 && Number.isFinite(remaining) && remaining === 0 && Number.isFinite(reset)) {
      const waitSeconds = Math.max(1, reset - Math.floor(Date.now() / 1000));
      this.logger.warn('github primary rate limit exhausted; waiting for window reset', {
        label,
        waitSeconds,
      });
      await sleep(Math.min(waitSeconds, 900) * 1000);
      const err = new Error('github primary rate limit exhausted');
      /** @type {any} */ (err).response = response;
      throw err;
    }

    // Any other non-2xx: convert into an Error with `response` attached so
    // the retry helper sees the status code and can decide.
    if (response.status < 200 || response.status >= 300) {
      const msg = response.data?.message || `HTTP ${response.status}`;
      const err = new Error(`github ${label} failed: ${msg}`);
      /** @type {any} */ (err).response = response;
      throw err;
    }

    return response;
  }

  /**
   * Soft rate-limit throttle: before making a call, if we know from the
   * previous response that remaining is very low, pause briefly until reset.
   * This is an optimisation to avoid hitting the hard 403 mid-run.
   * @private
   * @param {import('axios').AxiosResponse|null} lastResponse
   */
  async _softThrottle(lastResponse) {
    if (!lastResponse) return;
    const remaining = Number(lastResponse.headers?.['x-ratelimit-remaining']);
    const reset = Number(lastResponse.headers?.['x-ratelimit-reset']);
    if (Number.isFinite(remaining) && remaining <= SOFT_RATE_LIMIT_FLOOR && Number.isFinite(reset)) {
      const waitSeconds = Math.max(0, reset - Math.floor(Date.now() / 1000));
      if (waitSeconds > 0) {
        this.logger.warn('github soft rate limit reached; pausing', { remaining, waitSeconds });
        await sleep(Math.min(waitSeconds, 60) * 1000);
      }
    }
  }

  /**
   * Issues a single REST call with retry + rate-limit handling.
   * @param {Object} args
   * @param {"get"|"post"|"put"|"patch"|"delete"} args.method
   * @param {string} args.path Absolute path (may be full URL, e.g. the next
   *                           page URL from a Link header).
   * @param {Record<string, any>} [args.params] Query parameters.
   * @param {any} [args.body] Request body for POST/PATCH/PUT.
   * @param {string} [args.label] Log label.
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  async request({ method, path, params, body, label = 'github-request' }) {
    // Absolute URLs (like a Link-header next page) are passed straight
    // through; relative paths are resolved against the REST endpoint.
    const url = path.startsWith('http') ? path : path;
    const response = await withRetry(
      async () => {
        const raw = await this.http.request({
          method,
          url,
          params,
          data: body,
        });
        // Promote any retryable status into a thrown Error so `withRetry`
        // triggers its exponential backoff schedule.
        return this._checkResponse(raw, label);
      },
      { label, logger: this.logger, shouldRetry: defaultShouldRetry }
    );
    return response;
  }

  /**
   * Generic page-based REST iterator using the `Link: rel="next"` header.
   * Yields one ITEM per iteration so downstream consumers can process large
   * result sets without holding them all in memory.
   *
   * @param {Object} args
   * @param {string} args.path Relative path, e.g. `/repos/o/r/issues`.
   * @param {Record<string, any>} [args.params]
   * @param {number} [args.perPage=100]
   * @param {string} [args.label]
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  async *paginate({ path, params = {}, perPage = 100, label = 'github-paginate' }) {
    let nextUrl = path;
    let currentParams = { ...params, per_page: perPage };
    /** @type {import('axios').AxiosResponse|null} */
    let lastResponse = null;

    // Loop while GitHub hands us a `next` link.
    while (nextUrl) {
      await this._softThrottle(lastResponse);
      const response = await this.request({ method: 'get', path: nextUrl, params: currentParams, label });
      lastResponse = response;

      const items = Array.isArray(response.data) ? response.data : [];
      for (const item of items) yield item;

      const links = parseLinkHeader(response.headers?.link);
      if (!links.next) break;
      // Subsequent pages: GitHub's next URL already embeds page+per_page, so
      // we must NOT re-apply our own `params` (they'd get merged twice).
      nextUrl = links.next;
      currentParams = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // High-level REST conveniences — beginners can read these to understand the
  // underlying GitHub endpoints.
  // ---------------------------------------------------------------------------

  /**
   * Lists every commit on a given branch (ref), optionally filtered by
   * `since` (ISO-8601). Returns an async generator of raw commit objects.
   * Docs: https://docs.github.com/rest/commits/commits#list-commits
   *
   * @param {Object} args
   * @param {string} args.branch
   * @param {string} [args.since] ISO8601. Omit for full history.
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listCommits({ branch, since }) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/commits`,
      params: { sha: branch, since },
      label: 'github-list-commits',
    });
  }

  /**
   * Fetches the expanded commit detail for a given SHA. This is the only
   * endpoint that returns the `files[]` array (path, additions, deletions).
   * Docs: https://docs.github.com/rest/commits/commits#get-a-commit
   * @param {string} sha
   * @returns {Promise<any>}
   */
  async getCommit(sha) {
    const r = await this.request({
      method: 'get',
      path: `/repos/${this.repoOwner}/${this.repoName}/commits/${sha}`,
      label: 'github-get-commit',
    });
    return r.data;
  }

  /**
   * Lists pull requests for the repo. Sorted descending by `updated` so that
   * incremental mode can early-stop as soon as it sees a PR whose
   * `updated_at` predates the lookback window.
   * Docs: https://docs.github.com/rest/pulls/pulls#list-pull-requests
   * @param {Object} [args]
   * @param {"all"|"open"|"closed"} [args.state="all"]
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listPullRequests({ state = 'all' } = {}) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/pulls`,
      params: { state, sort: 'updated', direction: 'desc' },
      label: 'github-list-prs',
    });
  }

  /**
   * Lists comments on a pull request (the "conversation" tab on github.com).
   * NOTE: PR conversation comments live on the `issues` endpoint — this is
   * a GitHub quirk since PRs are modelled as issues internally.
   * @param {number} prNumber
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listPullRequestIssueComments(prNumber) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`,
      label: 'github-pr-issue-comments',
    });
  }

  /**
   * Lists the REVIEWS (approve / request-changes / comment events) on a PR.
   * Each review has its own body and optionally a set of inline comments.
   * @param {number} prNumber
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listPullRequestReviews(prNumber) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/reviews`,
      label: 'github-pr-reviews',
    });
  }

  /**
   * Lists INLINE review comments on a PR (the per-line comments inside the
   * "Files changed" tab). Each carries a `pull_request_review_id` that
   * groups it under a review event.
   * @param {number} prNumber
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listPullRequestReviewComments(prNumber) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/comments`,
      label: 'github-pr-review-comments',
    });
  }

  /**
   * Lists files changed in a pull request. Useful for chunker metadata.
   * @param {number} prNumber
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listPullRequestFiles(prNumber) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/files`,
      label: 'github-pr-files',
    });
  }

  /**
   * Lists issues (NOTE: GitHub returns PRs here too; callers must filter out
   * items where `pull_request` is set).
   * Docs: https://docs.github.com/rest/issues/issues#list-repository-issues
   * @param {Object} [args]
   * @param {"all"|"open"|"closed"} [args.state="all"]
   * @param {string} [args.since] ISO8601.
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listIssues({ state = 'all', since } = {}) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/issues`,
      params: { state, since, sort: 'updated', direction: 'desc' },
      label: 'github-list-issues',
    });
  }

  /**
   * Lists comments on an issue.
   * @param {number} issueNumber
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  listIssueComments(issueNumber) {
    return this.paginate({
      path: `/repos/${this.repoOwner}/${this.repoName}/issues/${issueNumber}/comments`,
      label: 'github-issue-comments',
    });
  }

  /**
   * Executes a GraphQL query. GraphQL is used sparingly — only where the
   * REST equivalent would cost many round-trips (notably: listing every
   * branch + its tip committedDate). All retry + rate-limit handling is the
   * same as REST.
   *
   * @param {string} query
   * @param {Record<string, any>} [variables]
   * @returns {Promise<any>} The `data` envelope.
   */
  async graphql(query, variables = {}) {
    const response = await withRetry(
      async () => {
        const raw = await axios.request({
          method: 'post',
          url: this.graphqlEndpoint,
          headers: {
            Authorization: patAuthHeader(this._token()),
            Accept: 'application/vnd.github+json',
            'User-Agent': 'intentera-rag',
          },
          data: { query, variables },
          timeout: DEFAULT_TIMEOUT_MS,
          validateStatus: () => true,
        });
        return this._checkResponse(raw, 'github-graphql');
      },
      { label: 'github-graphql', logger: this.logger }
    );
    if (response.data?.errors?.length) {
      const first = response.data.errors[0];
      throw new Error(`GitHub GraphQL error: ${first.message}`);
    }
    return response.data?.data || {};
  }

  /**
   * Returns the PAT. Stored on the axios instance via the Authorization
   * header; we extract it here so the GraphQL request can reuse it without
   * us holding a second private field that could drift out of sync.
   * @private
   */
  _token() {
    const hdr = String(this.http.defaults.headers?.Authorization || '');
    return hdr.replace(/^token\s+/, '');
  }
}

module.exports = {
  GithubClient,
  parseLinkHeader,
};
