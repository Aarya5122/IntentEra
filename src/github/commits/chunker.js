'use strict';

/**
 * src/github/commits/chunker.js
 * -----------------------------
 * Turns a `NormalizedCommit` into retrieval-ready chunks.
 *
 * Chunk layout (per commit)
 * -------------------------
 *   1. metadata chunk        → always one; compact summary with SHA, author,
 *                              date, file count, linked PR numbers.
 *   2. message chunk(s)      → body only if the commit message has a body
 *                              (i.e. more than just a headline). Paragraph-
 *                              aware grouping, same primitives as the Jira
 *                              chunker.
 *   3. changed-files chunk   → one per commit; a markdown-style list of all
 *                              changed file paths with per-file
 *                              additions/deletions. Paths ALSO live on
 *                              `metadata.filePaths` so retrieval can filter
 *                              by file without the text ever being embedded.
 *
 * Why not embed the diff?
 * -----------------------
 *   - Diffs are dominated by whitespace, generated files, and lockfiles that
 *     produce noisy, low-signal embeddings.
 *   - Real user questions ("who fixed the login bug?", "when did SSO land?")
 *     are answered by messages + file paths, not patch lines.
 *   - File paths preserved as metadata keep the "touched-this-area" lookup
 *     at zero embedding cost.
 *
 * Deterministic chunk IDs mean re-indexing the same SHA produces identical
 * `_id`s — a no-op in Mongo when nothing changed.
 */

const {
  splitParagraphs,
  groupParagraphsIntoChunks,
  deterministicChunkId,
} = require('../../chunking/chunker');

/**
 * @typedef {"metadata"|"message"|"files"} GithubCommitSourceType
 *
 * @typedef {Object} GithubChunk
 * @property {string} chunkId      Deterministic hash, used as Mongo `_id`.
 * @property {string} entityKey    "commit:<sha>", "pr:<num>", "issue:<num>".
 * @property {"commit"|"pullRequest"|"issue"} entityType
 * @property {string} repoFullName
 * @property {string} sourceType   e.g. "metadata", "message", "files".
 * @property {number} chunkIndex
 * @property {string} text         Text that will be embedded.
 * @property {Record<string, any>} metadata
 */

/**
 * Builds a GitHub chunk with a deterministic ID. Unlike the Jira chunker we
 * use `entityKey` as the uniqueness anchor so the id survives cross-source
 * collisions (a `PROJ-123` Jira ticket and a `commit:...` will never clash).
 *
 * @param {Object} args
 * @param {string} args.entityKey
 * @param {"commit"|"pullRequest"|"issue"} args.entityType
 * @param {string} args.repoFullName
 * @param {string} args.sourceType
 * @param {number} args.chunkIndex
 * @param {string} args.text
 * @param {Record<string, any>} [args.metadata]
 * @returns {GithubChunk}
 */
function makeGithubChunk({ entityKey, entityType, repoFullName, sourceType, chunkIndex, text, metadata = {} }) {
  const chunkId = deterministicChunkId({
    // Reusing the Jira helper, but we prefix the "ticket" slot with the full
    // entity key so IDs never collide across sources/entity types.
    ticketKey: entityKey,
    sourceType: `github:${sourceType}`,
    subIndex: chunkIndex,
    content: text,
  });
  return {
    chunkId,
    entityKey,
    entityType,
    repoFullName,
    sourceType,
    chunkIndex,
    text,
    metadata,
  };
}

/**
 * Emits chunks for one normalised commit.
 *
 * @param {Object} args
 * @param {import('./normalizer').NormalizedCommit} args.commit
 * @param {import('../../../config/appConfig').GithubConfig} args.cfg
 * @returns {GithubChunk[]}
 */
function chunkCommit({ commit, cfg }) {
  /** @type {GithubChunk[]} */
  const out = [];
  const common = {
    entityKey: commit.entityKey,
    entityType: /** @type {"commit"} */ ('commit'),
    repoFullName: commit.repoFullName,
  };
  // Metadata included on every chunk. Chosen so retrieval can filter by
  // branch, file path, or linked PR without re-embedding the content.
  const baseMeta = {
    sha: commit.sha,
    shortSha: commit.shortSha,
    branches: commit.branches,
    authorLogin: commit.authorLogin,
    authorName: commit.authorName,
    committedDate: commit.committedDate,
    authoredDate: commit.authoredDate,
    filePaths: commit.files.map((f) => f.path).filter(Boolean),
    fileCount: commit.files.length,
    totalAdditions: commit.totalAdditions,
    totalDeletions: commit.totalDeletions,
    associatedPullRequestNumbers: commit.associatedPullRequestNumbers,
    htmlUrl: commit.htmlUrl,
  };

  // -------------------------------------------------------------------------
  // 1. Metadata chunk — compact summary card.
  // -------------------------------------------------------------------------
  const metaText =
    `Commit ${commit.shortSha} on ${commit.repoFullName}\n` +
    `Headline: ${commit.messageHeadline || '(no message)'}\n` +
    `Author: ${commit.authorName || 'unknown'}` +
    `${commit.authorLogin ? ` (@${commit.authorLogin})` : ''}\n` +
    `Committed: ${commit.committedDate}\n` +
    `Branches: ${commit.branches.join(', ') || 'unknown'}\n` +
    `Files: ${commit.files.length}  (+${commit.totalAdditions}/-${commit.totalDeletions})` +
    (commit.associatedPullRequestNumbers.length
      ? `\nPull requests: ${commit.associatedPullRequestNumbers.map((n) => `#${n}`).join(', ')}`
      : '');

  out.push(makeGithubChunk({
    ...common,
    sourceType: 'metadata',
    chunkIndex: 0,
    text: metaText.trim(),
    metadata: { ...baseMeta },
  }));

  // -------------------------------------------------------------------------
  // 2. Message body chunk(s) — only when the commit message has a body. The
  //    headline is already in the metadata chunk above, so a body-less commit
  //    needs no additional message chunk.
  // -------------------------------------------------------------------------
  const body = (commit.messageBody || '').trim();
  if (body.length > 0) {
    const paragraphs = splitParagraphs(`${commit.messageHeadline}\n\n${body}`);
    const msgChunks = groupParagraphsIntoChunks(paragraphs, cfg.commitMessageMaxTokens, 0);
    msgChunks.forEach((text, idx) => {
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'message',
        chunkIndex: idx,
        text,
        metadata: { ...baseMeta },
      }));
    });
  }

  // -------------------------------------------------------------------------
  // 3. Changed-files chunk — one chunk listing every path with additions &
  //    deletions. We never split a commit's file list across multiple chunks
  //    unless the file list is genuinely enormous; the paragraph grouper
  //    takes care of that edge case automatically.
  // -------------------------------------------------------------------------
  if (commit.files.length > 0) {
    const lines = commit.files.map((f) => {
      const rename = f.previousFilename ? ` (renamed from ${f.previousFilename})` : '';
      return `- ${f.status}: ${f.path}${rename}  (+${f.additions}/-${f.deletions})`;
    });
    const header = `Files changed in commit ${commit.shortSha}:`;
    const text = `${header}\n${lines.join('\n')}`;
    const paragraphs = splitParagraphs(text);
    const fileChunks = groupParagraphsIntoChunks(paragraphs, cfg.commitFilesMaxTokens, 0);
    fileChunks.forEach((t, idx) => {
      out.push(makeGithubChunk({
        ...common,
        sourceType: 'files',
        chunkIndex: idx,
        text: t,
        metadata: { ...baseMeta },
      }));
    });
  }

  return out;
}

module.exports = {
  chunkCommit,
  makeGithubChunk,
};
