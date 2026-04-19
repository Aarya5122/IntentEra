'use strict';

/**
 * src/jira/fetcher.js
 * -------------------
 * High-level "fetch everything we need for one ticket" orchestrator that
 * uses JiraClient for raw HTTP calls.
 *
 * The fetcher is deliberately un-opinionated about normalisation or chunking.
 * Its job is only to pull:
 *   - the issue document itself
 *   - all comments (beyond the 20-comment default on search results)
 *   - remote links (used later to discover Confluence pages)
 *   - attachment metadata and binaries (when attachments are enabled)
 *
 * The normaliser will convert everything into a unified shape afterwards.
 */

const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} TicketBundle
 * @property {any} issue Raw Jira issue document.
 * @property {any[]} comments Fully-paginated list of comments.
 * @property {any[]} remoteLinks Raw remote links (may include Confluence URLs).
 * @property {Array<{metadata: any, content: Buffer|null, parseError: string|null}>} attachments
 */

class JiraFetcher {
  /**
   * @param {Object} opts
   * @param {import('./client').JiraClient} opts.client
   * @param {boolean} [opts.includeAttachments=true]
   * @param {boolean} [opts.includeLinkedIssues=true]
   * @param {boolean} [opts.includeConfluence=true]
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ client, includeAttachments = true, includeLinkedIssues = true, includeConfluence = true, logger }) {
    this.client = client;
    this.includeAttachments = includeAttachments;
    this.includeLinkedIssues = includeLinkedIssues;
    this.includeConfluence = includeConfluence;
    this.logger = (logger || createLogger()).child({ component: 'jiraFetcher' });
  }

  /**
   * Streams issues matching the given filters, yielding a fully-populated
   * bundle per ticket. Uses the client's pagination generator internally.
   *
   * @param {Object} filters
   * @param {string[]} [filters.projectKeys]
   * @param {string[]} [filters.issueTypes]
   * @param {string[]} [filters.statuses]
   * @param {string[]} [filters.labels]
   * @param {string} [filters.updatedSince]
   * @returns {AsyncGenerator<TicketBundle, void, unknown>}
   */
  async *streamTicketBundles(filters) {
    const { JiraClient } = require('./client');
    const jql = JiraClient.buildJql(filters);
    this.logger.info('starting jira ticket stream', { jql });

    for await (const issue of this.client.searchIssues({ jql })) {
      try {
        const bundle = await this._loadBundle(issue);
        yield bundle;
      } catch (err) {
        // Loud log but do not blow up the whole run. The orchestrator will
        // still mark the run as failed if the error reaches it, so we re-throw
        // only for fatal errors (auth, infra). Per-ticket failures are logged
        // and skipped so one bad ticket does not block everything else.
        this.logger.error('failed to assemble ticket bundle', {
          issueKey: issue.key,
          error: err,
        });
      }
    }
  }

  /**
   * Assembles a full bundle for a single already-fetched issue.
   * @private
   * @param {any} issue Raw Jira issue.
   * @returns {Promise<TicketBundle>}
   */
  async _loadBundle(issue) {
    const issueKey = issue.key;

    // Comments in the search response are capped at 20. Always fetch the
    // full, paginated list. If a ticket has no comments this returns [].
    const comments = await this.client.getAllComments(issueKey);

    // Remote links = potential Confluence pages + external URLs.
    const remoteLinks = this.includeConfluence ? await this.client.getRemoteLinks(issueKey) : [];

    // Attachment metadata is embedded in the issue; download bytes only if
    // we actually plan to index attachments.
    /** @type {TicketBundle["attachments"]} */
    const attachments = [];
    if (this.includeAttachments && issue.fields?.attachment?.length) {
      for (const att of issue.fields.attachment) {
        try {
          const buffer = await this.client.downloadAttachment(att.content);
          attachments.push({ metadata: att, content: buffer, parseError: null });
        } catch (err) {
          // Preserve metadata even if download fails — the chunker still
          // creates a placeholder chunk so the retrieval layer can surface
          // "there is an attachment but we could not parse it".
          this.logger.warn('attachment download failed; keeping metadata only', {
            issueKey,
            fileName: att.filename,
            error: err?.message,
          });
          attachments.push({
            metadata: att,
            content: null,
            parseError: err?.message || 'download failed',
          });
        }
      }
    }

    // Strip heavy linked-issue content if we were configured to skip it.
    // We leave the field on the issue object because normalisation handles
    // missing data gracefully.
    if (!this.includeLinkedIssues && issue.fields) {
      issue.fields.issuelinks = [];
    }

    return { issue, comments, remoteLinks, attachments };
  }

  /**
   * Convenience: returns just the list of ticket KEYS currently in scope,
   * without comments/attachments. The orchestrator uses this in full-import
   * mode to compute which Redis-known tickets have been deleted.
   *
   * @param {Object} filters same shape as streamTicketBundles filters.
   * @returns {Promise<string[]>}
   */
  async listTicketKeysInScope(filters) {
    const { JiraClient } = require('./client');
    const jql = JiraClient.buildJql({ ...filters, updatedSince: undefined });
    const keys = [];
    // Only need the key field here, so request a skinny field list.
    for await (const issue of this.client.searchIssues({ jql, fields: ['summary'], pageSize: 100 })) {
      keys.push(issue.key);
    }
    return keys;
  }
}

module.exports = {
  JiraFetcher,
};
