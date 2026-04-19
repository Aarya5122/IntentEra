'use strict';

/**
 * src/github/issues/chunker.js
 * ----------------------------
 * Emits chunks for one normalised GitHub issue, mirroring the Jira ticket
 * layout closely:
 *
 *   1. metadata chunk     — summary card.
 *   2. body chunk(s)      — paragraph-grouped issue body with overlap.
 *   3. comment chunk(s)   — comments grouped into windows of N, long ones
 *                           emitted solo.
 */

const {
  splitParagraphs,
  groupParagraphsIntoChunks,
  approxTokens,
} = require('../../chunking/chunker');
const { makeGithubChunk } = require('../commits/chunker');

/**
 * @param {Object} args
 * @param {import('./normalizer').NormalizedIssue} args.issue
 * @param {import('../../../config/appConfig').GithubConfig} args.cfg
 * @returns {import('../commits/chunker').GithubChunk[]}
 */
function chunkIssue({ issue, cfg }) {
  /** @type {import('../commits/chunker').GithubChunk[]} */
  const out = [];
  const common = {
    entityKey: issue.entityKey,
    entityType: /** @type {"issue"} */ ('issue'),
    repoFullName: issue.repoFullName,
  };
  const baseMeta = {
    issueNumber: issue.number,
    parentEntityId: issue.entityKey,
    title: issue.title,
    state: issue.state,
    stateReason: issue.stateReason,
    labels: issue.labels,
    author: issue.author,
    assignees: issue.assignees,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    linkedPullRequestNumbers: issue.linkedPullRequestNumbers,
    htmlUrl: issue.htmlUrl,
  };

  // 1. Metadata chunk.
  const metaText =
    `Issue #${issue.number} on ${issue.repoFullName}: ${issue.title}\n` +
    `State: ${issue.state}${issue.stateReason ? ` (${issue.stateReason})` : ''}   ` +
    `Author: ${issue.author || 'unknown'}\n` +
    `Labels: ${issue.labels.join(', ') || 'none'}\n` +
    `Assignees: ${issue.assignees.join(', ') || 'none'}\n` +
    `Created: ${issue.createdAt}   Updated: ${issue.updatedAt}` +
    (issue.closedAt ? `   Closed: ${issue.closedAt}` : '') +
    (issue.linkedPullRequestNumbers.length
      ? `\nLinked PRs: ${issue.linkedPullRequestNumbers.map((n) => `#${n}`).join(', ')}`
      : '');

  out.push(makeGithubChunk({
    ...common,
    sourceType: 'metadata',
    chunkIndex: 0,
    text: metaText.trim(),
    metadata: { ...baseMeta },
  }));

  // 2. Body chunks.
  if ((issue.body || '').trim().length > 0) {
    const paragraphs = splitParagraphs(issue.body);
    const bodyChunks = groupParagraphsIntoChunks(
      paragraphs,
      cfg.issueBodyMaxTokens,
      50 // modest overlap, mirroring the Jira description chunker
    );
    bodyChunks.forEach((text, idx) => {
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'body',
        chunkIndex: idx,
        text,
        metadata: { ...baseMeta },
      }));
    });
  }

  // 3. Comment chunks.
  const commentChunks = chunkIssueComments(issue, cfg, baseMeta, common);
  for (const c of commentChunks) out.push(c);

  return out;
}

/**
 * Groups issue comments into retrieval-sized windows, matching the Jira
 * comment chunker's windowing logic.
 *
 * @param {import('./normalizer').NormalizedIssue} issue
 * @param {import('../../../config/appConfig').GithubConfig} cfg
 * @param {Record<string, any>} baseMeta
 * @param {{entityKey: string, entityType: "issue", repoFullName: string}} common
 * @returns {import('../commits/chunker').GithubChunk[]}
 */
function chunkIssueComments(issue, cfg, baseMeta, common) {
  /** @type {import('../commits/chunker').GithubChunk[]} */
  const out = [];
  if (!issue.comments.length) return out;

  const windowSize = cfg.issueCommentGroupSize;
  const maxTokens = cfg.issueBodyMaxTokens;
  /** @type {import('./normalizer').NormalizedIssueComment[]} */
  let group = [];
  let groupTokens = 0;
  let chunkIdx = 0;

  const flush = () => {
    if (!group.length) return;
    const text = group
      .map((c) => `[${c.author || 'unknown'} on ${c.createdAt}]\n${c.body.trim()}`)
      .join('\n\n---\n\n');
    out.push(makeGithubChunk({
      ...common,
      sourceType: 'comments',
      chunkIndex: chunkIdx++,
      text,
      metadata: {
        ...baseMeta,
        commentIds: group.map((c) => c.id),
        commentAuthors: group.map((c) => c.author),
      },
    }));
    group = [];
    groupTokens = 0;
  };

  for (const c of issue.comments) {
    const t = approxTokens(c.body);
    if (t >= maxTokens) {
      flush();
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'comments',
        chunkIndex: chunkIdx++,
        text: `[${c.author || 'unknown'} on ${c.createdAt}]\n${c.body}`,
        metadata: {
          ...baseMeta,
          commentIds: [c.id],
          commentAuthors: [c.author],
        },
      }));
      continue;
    }
    if (group.length >= windowSize || groupTokens + t > maxTokens) flush();
    group.push(c);
    groupTokens += t;
  }
  flush();
  return out;
}

module.exports = {
  chunkIssue,
};
