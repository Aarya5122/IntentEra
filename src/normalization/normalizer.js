'use strict';

/**
 * src/normalization/normalizer.js
 * -------------------------------
 * Transforms a raw Jira "TicketBundle" (see src/jira/fetcher.js) into the
 * unified `NormalizedTicket` shape used by every downstream module.
 *
 * Why normalise?
 *   - The raw Jira JSON is a deeply nested, option-heavy structure. Passing
 *     it around makes chunking and logging code hideous.
 *   - Jira supports "Atlassian Document Format" (ADF) in description and
 *     comment bodies. We convert ADF into plain text here so chunking only
 *     has to deal with strings.
 *   - Confluence and attachment content are collapsed into the same flat
 *     structure so the chunker has a single contract.
 */

const { ConfluenceClient } = require('../confluence/client');
const { extractAttachmentText } = require('../attachments/parser');
const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} NormalizedComment
 * @property {string} id
 * @property {string} author
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} text
 */

/**
 * @typedef {Object} NormalizedLinkedIssue
 * @property {string} key
 * @property {string} relationship e.g. "blocks", "is blocked by"
 * @property {string} summary
 * @property {string} status
 */

/**
 * @typedef {Object} NormalizedAttachment
 * @property {string} id
 * @property {string} fileName
 * @property {string} fileType The detected type from attachments/parser.
 * @property {string} text Extracted text ("" on failure).
 * @property {string|null} parseError
 */

/**
 * @typedef {Object} NormalizedConfluencePage
 * @property {string} pageId
 * @property {string} title
 * @property {string} url
 * @property {string} text
 */

/**
 * @typedef {Object} NormalizedTicket
 * @property {string} key
 * @property {string} projectKey
 * @property {string} summary
 * @property {string} description
 * @property {string} issueType
 * @property {string} status
 * @property {string} priority
 * @property {string} assignee
 * @property {string} reporter
 * @property {string[]} labels
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {NormalizedComment[]} comments
 * @property {NormalizedLinkedIssue[]} linkedIssues
 * @property {NormalizedAttachment[]} attachments
 * @property {NormalizedConfluencePage[]} confluencePages
 */

/**
 * Recursively walks an Atlassian Document Format (ADF) node and returns a
 * flat plain-text rendering. ADF is Jira Cloud's rich-text format for
 * descriptions and comments; the top-level is `{ type: "doc", content: [...] }`.
 *
 * We only care about rendering text that a human would read, so we:
 *   - concatenate `text` nodes
 *   - insert newlines between block-level nodes
 *   - expand common marks (bullet list, ordered list) minimally
 *
 * If the input is already a string (older Jira APIs, or tickets created via
 * the Classic editor), we just return it.
 *
 * @param {any} node
 * @returns {string}
 */
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;

  // Leaf text node.
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  // List items get a dash prefix for readability.
  if (node.type === 'listItem') {
    const inner = (node.content || []).map(adfToText).join('');
    return `- ${inner.trim()}\n`;
  }

  // Hard break → explicit newline.
  if (node.type === 'hardBreak') return '\n';

  // Headings get a blank line before and after so paragraphs stay separated.
  if (node.type === 'heading') {
    const inner = (node.content || []).map(adfToText).join('');
    return `\n${inner.trim()}\n`;
  }

  // Default recursion for container nodes (doc, paragraph, bulletList, etc.).
  if (Array.isArray(node.content)) {
    const joined = node.content.map(adfToText).join('');
    // Block-level types end with a newline to separate them from peers.
    const blockTypes = new Set(['paragraph', 'bulletList', 'orderedList', 'blockquote', 'codeBlock']);
    return blockTypes.has(node.type) ? `${joined}\n` : joined;
  }

  return '';
}

/**
 * Safely reads a deeply nested Jira field. Returns fallback when missing.
 * @param {any} obj
 * @param {string[]} path
 * @param {any} [fallback]
 */
function pick(obj, path, fallback = '') {
  let cur = obj;
  for (const key of path) {
    if (cur == null) return fallback;
    cur = cur[key];
  }
  return cur ?? fallback;
}

/**
 * Normalises a single raw comment into a NormalizedComment.
 * @param {any} raw Jira comment JSON.
 * @returns {NormalizedComment}
 */
function normalizeComment(raw) {
  return {
    id: String(raw.id || ''),
    author: pick(raw, ['author', 'displayName'], 'unknown'),
    createdAt: raw.created || '',
    updatedAt: raw.updated || raw.created || '',
    text: adfToText(raw.body).trim(),
  };
}

/**
 * Extracts linked issue summaries from Jira's `issuelinks` field.
 * @param {any[]} issueLinks
 * @returns {NormalizedLinkedIssue[]}
 */
function normalizeLinkedIssues(issueLinks) {
  const out = [];
  for (const link of issueLinks || []) {
    // An `issuelink` has either `inwardIssue` or `outwardIssue` depending on
    // the direction. We surface both with a relationship string for context.
    const inward = link.inwardIssue;
    const outward = link.outwardIssue;
    if (inward) {
      out.push({
        key: inward.key,
        relationship: pick(link, ['type', 'inward'], 'related to'),
        summary: pick(inward, ['fields', 'summary'], ''),
        status: pick(inward, ['fields', 'status', 'name'], ''),
      });
    }
    if (outward) {
      out.push({
        key: outward.key,
        relationship: pick(link, ['type', 'outward'], 'related to'),
        summary: pick(outward, ['fields', 'summary'], ''),
        status: pick(outward, ['fields', 'status', 'name'], ''),
      });
    }
  }
  return out;
}

/**
 * Normalises one ticket bundle. Performs:
 *   - ADF → text rendering for description & comments
 *   - attachment text extraction via the parser module
 *   - Confluence page fetches for any remote links
 *
 * The function accepts a pre-constructed ConfluenceClient so tests/mocks can
 * inject a fake.
 *
 * @param {Object} args
 * @param {import('../jira/fetcher').TicketBundle} args.bundle
 * @param {import('../confluence/client').ConfluenceClient|null} args.confluenceClient
 * @param {boolean} [args.includeConfluence=true]
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<NormalizedTicket>}
 */
async function normalizeTicket({ bundle, confluenceClient, includeConfluence = true, logger }) {
  const log = (logger || createLogger()).child({ component: 'normalizer' });
  const { issue, comments, remoteLinks, attachments } = bundle;
  const fields = issue.fields || {};
  const issueKey = issue.key;

  // ---- Basic fields -------------------------------------------------------
  const normalizedComments = comments.map(normalizeComment);
  const linkedIssues = normalizeLinkedIssues(fields.issuelinks);

  // ---- Attachments --------------------------------------------------------
  /** @type {NormalizedAttachment[]} */
  const normalizedAttachments = [];
  for (const att of attachments) {
    const meta = att.metadata || {};
    // Use the pre-download parse error from the fetcher if present; otherwise
    // run the actual parser on the buffer.
    if (att.parseError) {
      normalizedAttachments.push({
        id: String(meta.id || ''),
        fileName: meta.filename || '',
        fileType: 'unsupported',
        text: '',
        parseError: att.parseError,
      });
      continue;
    }
    const parsed = await extractAttachmentText({
      buffer: att.content,
      fileName: meta.filename,
      mimeType: meta.mimeType,
      logger: log,
    });
    normalizedAttachments.push({
      id: String(meta.id || ''),
      fileName: meta.filename || '',
      fileType: parsed.detectedType,
      text: parsed.text,
      parseError: parsed.parseError,
    });
  }

  // ---- Confluence pages ---------------------------------------------------
  /** @type {NormalizedConfluencePage[]} */
  const confluencePages = [];
  if (includeConfluence && confluenceClient && remoteLinks?.length) {
    const confluenceLinks = ConfluenceClient.filterConfluenceLinks(remoteLinks);
    for (const link of confluenceLinks) {
      const page = await confluenceClient.fetchPage(link.pageId);
      if (!page) {
        // Fetch failures are logged in the client. We skip silently here.
        continue;
      }
      confluencePages.push({
        pageId: page.pageId,
        title: page.title || link.title,
        url: page.url || link.url,
        text: page.textContent,
      });
    }
  }

  /** @type {NormalizedTicket} */
  const normalized = {
    key: issueKey,
    projectKey: pick(fields, ['project', 'key'], issueKey.split('-')[0] || ''),
    summary: fields.summary || '',
    description: adfToText(fields.description).trim(),
    issueType: pick(fields, ['issuetype', 'name'], ''),
    status: pick(fields, ['status', 'name'], ''),
    priority: pick(fields, ['priority', 'name'], ''),
    assignee: pick(fields, ['assignee', 'displayName'], ''),
    reporter: pick(fields, ['reporter', 'displayName'], ''),
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    createdAt: fields.created || '',
    updatedAt: fields.updated || '',
    comments: normalizedComments,
    linkedIssues,
    attachments: normalizedAttachments,
    confluencePages,
  };

  return normalized;
}

module.exports = {
  normalizeTicket,
  adfToText,
};
