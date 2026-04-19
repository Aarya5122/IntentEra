'use strict';

/**
 * src/github/commits/normalizer.js
 * --------------------------------
 * Transforms a raw GitHub commit payload (as returned by
 * `GET /repos/:o/:r/commits/:sha`) into a unified `NormalizedCommit` shape
 * that the chunker can consume without knowing the raw GitHub schema.
 *
 * Shape goals:
 *   - Stable, predictable field names that the chunker can rely on.
 *   - Derived fields computed here (e.g. file-path list, additions summary)
 *     so the chunker stays focused on chunk layout.
 *   - No filtering — "which SHAs to ingest" is a fetcher decision.
 */

/**
 * @typedef {Object} NormalizedCommitFile
 * @property {string} path
 * @property {string} status   "added" | "modified" | "removed" | "renamed" | ...
 * @property {number} additions
 * @property {number} deletions
 * @property {string|null} previousFilename Only set on renames.
 */

/**
 * @typedef {Object} NormalizedCommit
 * @property {"commit"} entityType
 * @property {string}   entityKey      Canonical identifier: "commit:<sha>".
 * @property {string}   sha            Full commit SHA.
 * @property {string}   shortSha       First 7 chars of the SHA.
 * @property {string}   repoFullName   "owner/name"
 * @property {string[]} branches       Branch names this commit is visible on.
 * @property {string|null} authorName
 * @property {string|null} authorEmail
 * @property {string|null} authorLogin GitHub username when known.
 * @property {string|null} committerName
 * @property {string|null} committerEmail
 * @property {string|null} committerLogin
 * @property {string}   authoredDate   ISO-8601.
 * @property {string}   committedDate  ISO-8601.
 * @property {string}   messageHeadline First line of the commit message.
 * @property {string}   messageBody    Remainder of the message (may be empty).
 * @property {string}   message        Full raw commit message (headline + body).
 * @property {string}   htmlUrl        Web URL of the commit page.
 * @property {NormalizedCommitFile[]} files
 * @property {number}   totalAdditions
 * @property {number}   totalDeletions
 * @property {number[]} associatedPullRequestNumbers
 */

/**
 * Normalises a raw commit payload. The `branches` array is passed in by the
 * fetcher because the commit-detail endpoint does not return branch
 * attribution — we build that information while iterating branches.
 *
 * @param {Object} args
 * @param {any} args.raw            Raw payload from `GET .../commits/:sha`.
 * @param {string} args.repoFullName
 * @param {string[]} args.branches  Branch names known to contain this SHA.
 * @param {number[]} [args.associatedPullRequestNumbers]
 * @returns {NormalizedCommit}
 */
function normalizeCommit({ raw, repoFullName, branches, associatedPullRequestNumbers = [] }) {
  const sha = raw?.sha || '';
  const commit = raw?.commit || {};
  const author = commit.author || {};
  const committer = commit.committer || {};
  const fullMessage = commit.message || '';

  // Split the commit message into headline (first non-empty line) and body.
  // Convention in git: the first line is the short summary, then a blank
  // line, then an optional longer body.
  const firstNl = fullMessage.indexOf('\n');
  const messageHeadline = firstNl === -1 ? fullMessage : fullMessage.slice(0, firstNl);
  const messageBody = firstNl === -1 ? '' : fullMessage.slice(firstNl + 1).replace(/^\n+/, '');

  // Files — only present when the commit-detail endpoint was used (which is
  // what our fetcher does). Collapse to a small, predictable shape.
  /** @type {NormalizedCommitFile[]} */
  const files = Array.isArray(raw?.files)
    ? raw.files.map((f) => ({
        path: f?.filename || '',
        status: f?.status || 'modified',
        additions: Number(f?.additions) || 0,
        deletions: Number(f?.deletions) || 0,
        previousFilename: f?.previous_filename || null,
      }))
    : [];

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return {
    entityType: 'commit',
    entityKey: `commit:${sha}`,
    sha,
    shortSha: sha.slice(0, 7),
    repoFullName,
    branches: Array.isArray(branches) ? [...new Set(branches)].sort() : [],
    authorName: author.name || null,
    authorEmail: author.email || null,
    authorLogin: raw?.author?.login || null,
    committerName: committer.name || null,
    committerEmail: committer.email || null,
    committerLogin: raw?.committer?.login || null,
    // Git commits carry two timestamps; `committedDate` is the one that moves
    // forward when a commit is rebased, so we expose both.
    authoredDate: author.date || committer.date || new Date(0).toISOString(),
    committedDate: committer.date || author.date || new Date(0).toISOString(),
    messageHeadline,
    messageBody,
    message: fullMessage,
    htmlUrl: raw?.html_url || '',
    files,
    totalAdditions,
    totalDeletions,
    associatedPullRequestNumbers: [...new Set(associatedPullRequestNumbers)],
  };
}

module.exports = {
  normalizeCommit,
};
