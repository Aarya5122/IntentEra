'use strict';

/**
 * src/jira/client.js
 * ------------------
 * Minimal HTTP wrapper around the Jira Cloud REST API.
 *
 * What this module does:
 *   - Authenticates with Jira using Basic auth (email + API token).
 *   - Executes paginated JQL searches, yielding one page at a time.
 *   - Fetches comments, remote links, attachment metadata, and raw
 *     attachment binaries.
 *
 * What this module does NOT do:
 *   - It does not normalise field names or do any business logic. That work
 *     lives in `src/jira/fetcher.js` and `src/normalization/normalizer.js`.
 *
 * Why a thin client?
 *   - Easier to mock in tests.
 *   - Keeps HTTP details in one place so we can swap libraries later.
 */

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Builds the HTTP Authorization header for Jira Cloud.
 * @param {string} email
 * @param {string} apiToken
 * @returns {string}
 */
function basicAuthHeader(email, apiToken) {
  const encoded = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return `Basic ${encoded}`;
}

class JiraClient {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl e.g. https://acme.atlassian.net
   * @param {string} opts.email
   * @param {string} opts.apiToken
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ baseUrl, email, apiToken, logger }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.logger = (logger || createLogger()).child({ component: 'jira' });

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        Authorization: basicAuthHeader(email, apiToken),
        Accept: 'application/json',
      },
    });
  }

  /**
   * Builds a JQL string from a set of scope filters. Any empty filter is
   * simply left out of the final query.
   *
   * @param {Object} filters
   * @param {string[]} [filters.projectKeys]
   * @param {string[]} [filters.issueTypes]
   * @param {string[]} [filters.statuses]
   * @param {string[]} [filters.labels]
   * @param {string} [filters.updatedSince] ISO8601. Translated to `updated >= "..."`.
   * @returns {string}
   */
  static buildJql(filters = {}) {
    const clauses = [];
    const quoteList = (arr) => arr.map((v) => `"${v}"`).join(', ');

    if (filters.projectKeys?.length) {
      clauses.push(`project in (${quoteList(filters.projectKeys)})`);
    }
    if (filters.issueTypes?.length) {
      clauses.push(`issuetype in (${quoteList(filters.issueTypes)})`);
    }
    if (filters.statuses?.length) {
      clauses.push(`status in (${quoteList(filters.statuses)})`);
    }
    if (filters.labels?.length) {
      // Labels don't support "in", so OR them together.
      const parts = filters.labels.map((l) => `labels = "${l}"`);
      clauses.push(`(${parts.join(' OR ')})`);
    }
    if (filters.updatedSince) {
      // Jira's JQL expects `"yyyy-MM-dd HH:mm"` for the `updated` operator.
      const dt = new Date(filters.updatedSince);
      const pad = (n) => String(n).padStart(2, '0');
      const jqlTs = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
      clauses.push(`updated >= "${jqlTs}"`);
    }

    // Deterministic ORDER BY makes paginated results safe.
    const where = clauses.join(' AND ');
    const base = where ? `${where} ORDER BY updated ASC` : 'ORDER BY updated ASC';
    return base;
  }

  /**
   * Async generator over paginated Jira search results. Yields one issue at
   * a time. The caller decides how many to process concurrently.
   *
   * Why generators?
   *   - Incremental work: we do not have to buffer the entire response in
   *     memory when a project contains thousands of tickets.
   *   - Natural back-pressure: downstream code can await each issue.
   *
   * @param {Object} opts
   * @param {string} opts.jql
   * @param {number} [opts.pageSize=50]
   * @param {string[]} [opts.fields] Fields to request. Falls back to "*all".
   * @returns {AsyncGenerator<any, void, unknown>}
   */
  async *searchIssues({ jql, pageSize = 50, fields }) {
    let startAt = 0;
    // Jira caps pageSize at 100 for most tenants; 50 is a conservative default.
    const fieldsParam = fields?.length ? fields.join(',') : '*all';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await withRetry(
        () =>
          this.http.post('/rest/api/3/search', {
            jql,
            startAt,
            maxResults: pageSize,
            fields: fieldsParam.split(','),
            // `expand` fetches useful sub-resources in one round trip.
            expand: ['renderedFields', 'names'],
          }),
        { label: 'jira-search', logger: this.logger }
      );

      const { issues = [], total = 0 } = response.data || {};
      for (const issue of issues) {
        yield issue;
      }

      // If we got fewer than requested OR we've consumed `total`, we're done.
      startAt += issues.length;
      if (issues.length < pageSize || startAt >= total) break;
    }
  }

  /**
   * Fetches ALL comments on an issue by paginating the dedicated endpoint.
   * Using the dedicated endpoint (rather than the `comment` field in search)
   * matters because the search response caps comment count at 20.
   *
   * @param {string} issueIdOrKey
   * @returns {Promise<any[]>}
   */
  async getAllComments(issueIdOrKey) {
    const all = [];
    let startAt = 0;
    const pageSize = 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await withRetry(
        () =>
          this.http.get(`/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/comment`, {
            params: { startAt, maxResults: pageSize, orderBy: 'created' },
          }),
        { label: 'jira-comments', logger: this.logger }
      );
      const comments = data.comments || [];
      all.push(...comments);
      startAt += comments.length;
      if (comments.length < pageSize || startAt >= (data.total || 0)) break;
    }
    return all;
  }

  /**
   * Retrieves remote links attached to an issue. Remote links are how Jira
   * tickets reference external URLs, including Confluence pages.
   * @param {string} issueIdOrKey
   * @returns {Promise<any[]>}
   */
  async getRemoteLinks(issueIdOrKey) {
    const { data } = await withRetry(
      () => this.http.get(`/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/remotelink`),
      { label: 'jira-remotelinks', logger: this.logger }
    );
    return Array.isArray(data) ? data : [];
  }

  /**
   * Downloads an attachment's bytes using the `content` URL provided by the
   * search response. Jira requires the same Basic auth header that we use
   * for API calls.
   * @param {string} contentUrl Absolute URL to the binary content.
   * @returns {Promise<Buffer>}
   */
  async downloadAttachment(contentUrl) {
    const { data } = await withRetry(
      () =>
        axios.get(contentUrl, {
          headers: this.http.defaults.headers,
          responseType: 'arraybuffer',
          timeout: 60000,
        }),
      { label: 'jira-download-attachment', logger: this.logger }
    );
    return Buffer.from(data);
  }
}

module.exports = {
  JiraClient,
};
