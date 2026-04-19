'use strict';

/**
 * src/github/issues/normalizer.js
 * -------------------------------
 * Normaliser for repository issues. Mirrors the Jira ticket shape so the
 * retrieval experience for a GitHub issue feels like the Jira one.
 *
 * Important quirk:
 *   GitHub's REST API returns PULL REQUESTS through the same `issues`
 *   endpoint — any row carrying a `pull_request` field is actually a PR.
 *   The fetcher already filters those out; this normaliser just assumes it
 *   is fed "real" issues.
 */

const { extractLinkedIssueNumbers } = require('../pullRequests/normalizer');

/**
 * @typedef {Object} NormalizedIssueComment
 * @property {number|string} id
 * @property {string|null} author
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} body
 */

/**
 * @typedef {Object} NormalizedIssue
 * @property {"issue"} entityType
 * @property {string} entityKey  "issue:<number>"
 * @property {string} repoFullName
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string} state       "open" | "closed"
 * @property {string|null} stateReason
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} closedAt
 * @property {string|null} author
 * @property {string[]} assignees
 * @property {string[]} labels
 * @property {string} htmlUrl
 * @property {NormalizedIssueComment[]} comments
 * @property {number[]} linkedPullRequestNumbers
 */

/**
 * @param {any} raw
 * @returns {string[]}
 */
function mapLogins(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((u) => u?.login).filter((x) => typeof x === 'string' && x.length > 0);
}

/**
 * Normalises an issue bundle.
 *
 * @param {Object} args
 * @param {any} args.raw
 * @param {string} args.repoFullName
 * @param {any[]} [args.comments] Raw comments from `issues/:n/comments`.
 * @returns {NormalizedIssue}
 */
function normalizeIssue({ raw, repoFullName, comments = [] }) {
  const number = Number(raw?.number);
  /** @type {NormalizedIssueComment[]} */
  const normalizedComments = (comments || [])
    .map((c) => ({
      id: c?.id ?? '',
      author: c?.user?.login || null,
      createdAt: c?.created_at || '',
      updatedAt: c?.updated_at || c?.created_at || '',
      body: c?.body || '',
    }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  // Extract "#123"-style references from body + comments; PRs and issues
  // share the same numeric namespace on GitHub, so we report them as
  // "linked PR numbers" at the normaliser level and let retrieval decide.
  const refs = new Set([
    ...extractLinkedIssueNumbers(raw?.body || ''),
    ...normalizedComments.flatMap((c) => extractLinkedIssueNumbers(c.body)),
  ]);
  refs.delete(number);

  return {
    entityType: 'issue',
    entityKey: `issue:${number}`,
    repoFullName,
    number,
    title: raw?.title || '',
    body: raw?.body || '',
    state: raw?.state || 'open',
    stateReason: raw?.state_reason || null,
    createdAt: raw?.created_at || '',
    updatedAt: raw?.updated_at || raw?.created_at || '',
    closedAt: raw?.closed_at || null,
    author: raw?.user?.login || null,
    assignees: mapLogins(raw?.assignees),
    labels: Array.isArray(raw?.labels)
      ? raw.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
      : [],
    htmlUrl: raw?.html_url || '',
    comments: normalizedComments,
    linkedPullRequestNumbers: Array.from(refs).sort((a, b) => a - b),
  };
}

module.exports = {
  normalizeIssue,
};
