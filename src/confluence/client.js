'use strict';

/**
 * src/confluence/client.js
 * ------------------------
 * Live fetcher for Confluence Cloud pages that were linked from a Jira issue.
 *
 * Design notes:
 *   - We follow remote links embedded in Jira issues. A remote link looks
 *     like `{ object: { url: "https://acme.atlassian.net/wiki/spaces/X/pages/123/Title", title: "..." }, ... }`.
 *   - We extract the page ID from the URL using a regex (Confluence Cloud
 *     uses `/wiki/spaces/<SPACE>/pages/<ID>/<slug>`).
 *   - We fetch the page content in `storage` representation (XHTML) using the
 *     REST API v2. The chunker later converts that HTML into clean text.
 *   - A fetch failure for one page does NOT fail the whole ticket. We log a
 *     warning and return `null` so the orchestrator can skip it.
 *
 * Caching policy:
 *   - Intentionally NO cache. The user explicitly requested live fetches on
 *     every relevant indexing run. Future improvements may introduce a TTL
 *     cache, but that is out of scope for now.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { withRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

const CONFLUENCE_PAGE_ID_RE = /\/pages\/(\d+)(?:[\/?#]|$)/;

/**
 * @typedef {Object} ConfluencePage
 * @property {string} pageId
 * @property {string} title
 * @property {string} url
 * @property {string} textContent Plain text extracted from the storage XHTML.
 */

class ConfluenceClient {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl e.g. https://acme.atlassian.net/wiki
   * @param {string} opts.email
   * @param {string} opts.apiToken
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ baseUrl, email, apiToken, logger }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.logger = (logger || createLogger()).child({ component: 'confluence' });

    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    });
  }

  /**
   * Extracts a page ID from a Confluence page URL. Returns null if the URL
   * does not look like a Confluence Cloud page.
   * @param {string} url
   * @returns {string|null}
   */
  static extractPageId(url) {
    if (!url) return null;
    const match = CONFLUENCE_PAGE_ID_RE.exec(url);
    return match ? match[1] : null;
  }

  /**
   * Filters raw Jira remote links to those that point to Confluence pages and
   * returns { pageId, url, title }. Returns an empty array if nothing matches.
   * @param {any[]} remoteLinks Raw Jira remote link array.
   * @returns {Array<{pageId: string, url: string, title: string}>}
   */
  static filterConfluenceLinks(remoteLinks) {
    const out = [];
    for (const link of remoteLinks || []) {
      const url = link?.object?.url;
      const title = link?.object?.title || '';
      const pageId = ConfluenceClient.extractPageId(url);
      if (pageId) out.push({ pageId, url, title });
    }
    return out;
  }

  /**
   * Fetches a single Confluence page. Returns null if the page cannot be
   * retrieved (404, 403, network error, etc) — callers should treat null as
   * "skip this page" rather than a hard error.
   *
   * We use REST API v2 because it is the current Atlassian-recommended API
   * surface and it returns the body in `storage` format directly.
   *
   * @param {string} pageId
   * @returns {Promise<ConfluencePage|null>}
   */
  async fetchPage(pageId) {
    try {
      const { data } = await withRetry(
        () =>
          this.http.get(`/api/v2/pages/${encodeURIComponent(pageId)}`, {
            params: { 'body-format': 'storage' },
          }),
        { label: 'confluence-get-page', logger: this.logger }
      );
      const title = data?.title || `Confluence ${pageId}`;
      const storage = data?.body?.storage?.value || '';
      const url = `${this.baseUrl}${data?._links?.webui || ''}`;
      return {
        pageId,
        title,
        url,
        textContent: ConfluenceClient.storageToText(storage),
      };
    } catch (err) {
      // Deliberately swallow and log: a broken Confluence link should never
      // fail the whole ticket, let alone the whole sync run.
      this.logger.warn('confluence page fetch failed', {
        pageId,
        status: err?.response?.status,
        error: err?.message,
      });
      return null;
    }
  }

  /**
   * Converts Confluence "storage" XHTML into plain text using cheerio.
   * We strip Confluence macros (e.g. <ac:structured-macro>) that usually
   * contain layout metadata rather than readable content.
   * @param {string} xhtml
   * @returns {string}
   */
  static storageToText(xhtml) {
    if (!xhtml) return '';
    const $ = cheerio.load(`<div id="__root">${xhtml}</div>`, { xmlMode: false });

    // Remove Confluence-specific macros that only hold metadata / UI hints.
    $('ac\\:structured-macro, ac\\:parameter, ac\\:rich-text-body').each((_, el) => {
      const $el = $(el);
      // Preserve the inner text of rich-text-body; drop the wrapper only.
      if (el.tagName === 'ac:rich-text-body') {
        $el.replaceWith($el.html() || '');
      } else {
        $el.remove();
      }
    });

    // Replace common block-level tags with newlines so text flows paragraph
    // by paragraph rather than running together.
    $('br').replaceWith('\n');
    $('p, h1, h2, h3, h4, h5, h6, li').each((_, el) => {
      $(el).append('\n');
    });

    const text = $('#__root').text();
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }
}

module.exports = {
  ConfluenceClient,
};
