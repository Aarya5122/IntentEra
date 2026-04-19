'use strict';

/**
 * src/github/pullRequests/chunker.js
 * ----------------------------------
 * Turns a `NormalizedPullRequest` into retrieval-ready chunks.
 *
 * Chunk layout (per PR)
 * ---------------------
 *   1. metadata chunk       — compact summary (title, state, labels, author,
 *                             head→base, file count, linked issues).
 *   2. body chunk(s)        — PR description, paragraph-grouped with overlap.
 *   3. review chunk(s)      — ONE chunk per review event. Each carries the
 *                             review body + inline-comment text with file
 *                             path + line breadcrumbs. Long reviews are
 *                             re-grouped by paragraph.
 *   4. conversation chunks  — conversation comments grouped N-at-a-time, the
 *                             same window strategy the Jira chunker uses for
 *                             ticket comments.
 *
 * Why not chunk every inline comment separately?
 *   - Inline comments are usually short (1-3 lines). Embedding each of them
 *     creates many tiny, noisy chunks that dilute retrieval relevance. A
 *     per-review chunk keeps the review as a coherent semantic unit.
 *
 * All chunks share `metadata.prNumber` + `parentEntityId = "pr:<num>"` so
 * retrieval can return sibling chunks together.
 */

const {
  splitParagraphs,
  groupParagraphsIntoChunks,
  approxTokens,
} = require('../../chunking/chunker');
const { makeGithubChunk } = require('../commits/chunker');

/**
 * Emits chunks for one normalised pull request.
 *
 * @param {Object} args
 * @param {import('./normalizer').NormalizedPullRequest} args.pr
 * @param {import('../../../config/appConfig').GithubConfig} args.cfg
 * @returns {import('../commits/chunker').GithubChunk[]}
 */
function chunkPullRequest({ pr, cfg }) {
  /** @type {import('../commits/chunker').GithubChunk[]} */
  const out = [];
  const common = {
    entityKey: pr.entityKey,
    entityType: /** @type {"pullRequest"} */ ('pullRequest'),
    repoFullName: pr.repoFullName,
  };
  const baseMeta = {
    prNumber: pr.number,
    parentEntityId: pr.entityKey,
    title: pr.title,
    state: pr.state,
    merged: pr.merged,
    labels: pr.labels,
    author: pr.author,
    assignees: pr.assignees,
    requestedReviewers: pr.requestedReviewers,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    filePaths: pr.files.map((f) => f.path).filter(Boolean),
    linkedIssueNumbers: pr.linkedIssueNumbers,
    htmlUrl: pr.htmlUrl,
  };

  // -------------------------------------------------------------------------
  // 1. Metadata chunk — card-like summary.
  // -------------------------------------------------------------------------
  const stateLabel = pr.merged ? 'merged' : pr.state;
  const metaText =
    `Pull request #${pr.number} on ${pr.repoFullName}: ${pr.title}\n` +
    `State: ${stateLabel}   Author: ${pr.author || 'unknown'}\n` +
    `Branches: ${pr.headBranch || '?'} -> ${pr.baseBranch || '?'}\n` +
    `Labels: ${pr.labels.join(', ') || 'none'}\n` +
    `Created: ${pr.createdAt}   Updated: ${pr.updatedAt}` +
    (pr.mergedAt ? `   Merged: ${pr.mergedAt}` : '') +
    `\nFiles changed: ${pr.files.length}` +
    (pr.linkedIssueNumbers.length
      ? `\nLinked issues: ${pr.linkedIssueNumbers.map((n) => `#${n}`).join(', ')}`
      : '');

  out.push(makeGithubChunk({
    ...common,
    sourceType: 'metadata',
    chunkIndex: 0,
    text: metaText.trim(),
    metadata: { ...baseMeta },
  }));

  // -------------------------------------------------------------------------
  // 2. Body chunks — paragraph grouping with overlap (same as Jira desc).
  // -------------------------------------------------------------------------
  if ((pr.body || '').trim().length > 0) {
    const paragraphs = splitParagraphs(pr.body);
    const bodyChunks = groupParagraphsIntoChunks(
      paragraphs,
      cfg.prBodyMaxTokens,
      cfg.prBodyOverlapTokens
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

  // -------------------------------------------------------------------------
  // 3. Review chunks — ONE chunk per review event, with inline comments
  //    interleaved. Long reviews get re-grouped by paragraph to respect
  //    the budget.
  // -------------------------------------------------------------------------
  pr.reviews.forEach((review, rIdx) => {
    const bodyLines = [];
    bodyLines.push(
      `Review by ${review.author || 'unknown'} on ${review.submittedAt || '(unknown time)'} — ${review.state}`
    );
    if ((review.body || '').trim()) {
      bodyLines.push('');
      bodyLines.push(review.body.trim());
    }
    if (review.inlineComments.length) {
      bodyLines.push('');
      bodyLines.push(`Inline comments (${review.inlineComments.length}):`);
      for (const ic of review.inlineComments) {
        const where = ic.path ? `${ic.path}${ic.line != null ? `:${ic.line}` : ''}` : '(general)';
        bodyLines.push(`- [${where}] ${ic.author || 'unknown'}: ${ic.body.trim()}`);
      }
    }
    const text = bodyLines.join('\n').trim();
    if (!text) return;

    const reviewMeta = {
      ...baseMeta,
      reviewId: review.id,
      reviewState: review.state,
      reviewAuthor: review.author,
      reviewSubmittedAt: review.submittedAt,
      inlineCommentPaths: review.inlineComments.map((c) => c.path).filter(Boolean),
    };

    // Respect the per-review token budget. A small review fits in one chunk;
    // a long one gets paragraph-grouped.
    if (approxTokens(text) <= cfg.prReviewMaxTokens) {
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'review',
        chunkIndex: rIdx * 100,
        text,
        metadata: reviewMeta,
      }));
    } else {
      const paragraphs = splitParagraphs(text);
      const chunks = groupParagraphsIntoChunks(paragraphs, cfg.prReviewMaxTokens, 0);
      chunks.forEach((t, subIdx) => {
        out.push(makeGithubChunk({
          ...common,
          sourceType: 'review',
          chunkIndex: rIdx * 100 + subIdx,
          text: t,
          metadata: reviewMeta,
        }));
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Conversation comments — grouped N-at-a-time, long comments solo.
  // -------------------------------------------------------------------------
  const convoChunks = chunkConversationComments(pr, cfg, baseMeta, common);
  for (const c of convoChunks) out.push(c);

  return out;
}

/**
 * Windowing strategy for PR conversation comments. Mirrors the Jira comment
 * chunker so PRs and Jira tickets feel similar at retrieval time.
 *
 * @param {import('./normalizer').NormalizedPullRequest} pr
 * @param {import('../../../config/appConfig').GithubConfig} cfg
 * @param {Record<string, any>} baseMeta
 * @param {{entityKey: string, entityType: "pullRequest", repoFullName: string}} common
 * @returns {import('../commits/chunker').GithubChunk[]}
 */
function chunkConversationComments(pr, cfg, baseMeta, common) {
  /** @type {import('../commits/chunker').GithubChunk[]} */
  const out = [];
  if (!pr.conversationComments.length) return out;

  const windowSize = cfg.prCommentGroupSize;
  const maxTokens = cfg.prBodyMaxTokens;
  /** @type {import('./normalizer').NormalizedPrComment[]} */
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
      sourceType: 'conversation',
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

  for (const c of pr.conversationComments) {
    const t = approxTokens(c.body);
    if (t >= maxTokens) {
      flush();
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'conversation',
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
  chunkPullRequest,
};
