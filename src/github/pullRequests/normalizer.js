'use strict';

/**
 * src/github/pullRequests/normalizer.js
 * -------------------------------------
 * Converts a raw GitHub PR payload plus its satellite resources (conversation
 * comments, reviews, inline review-comments, changed files) into a unified
 * `NormalizedPullRequest` shape.
 *
 * Why group review-comments under their parent review?
 * ----------------------------------------------------
 * On github.com, an inline review-comment is ALWAYS part of a "review event"
 * (approve / request changes / comment). Grouping them preserves that
 * conversational context, which matters for retrieval:
 *
 *   "Why did Alice request changes on the login refactor?"
 *
 * is much better answered by a single chunk containing Alice's review body
 * and all her inline comments than by one disconnected chunk per comment.
 */

/**
 * @typedef {Object} NormalizedPrComment
 * @property {number|string} id
 * @property {string|null} author
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} body
 */

/**
 * @typedef {Object} NormalizedPrReviewComment
 * @property {number|string} id
 * @property {string|null} author
 * @property {string} createdAt
 * @property {string} body
 * @property {string|null} path
 * @property {number|null} line
 */

/**
 * @typedef {Object} NormalizedPrReview
 * @property {number|string} id
 * @property {string|null} author
 * @property {string} state           "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | ...
 * @property {string} submittedAt
 * @property {string} body
 * @property {NormalizedPrReviewComment[]} inlineComments
 */

/**
 * @typedef {Object} NormalizedPrFile
 * @property {string} path
 * @property {string} status
 * @property {number} additions
 * @property {number} deletions
 */

/**
 * @typedef {Object} NormalizedPullRequest
 * @property {"pullRequest"} entityType
 * @property {string} entityKey         "pr:<number>"
 * @property {string} repoFullName
 * @property {number} number
 * @property {string} title
 * @property {string} body              Raw markdown body (may be empty).
 * @property {string} state             "open" | "closed"
 * @property {boolean} merged
 * @property {string|null} mergedAt
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} closedAt
 * @property {string|null} author
 * @property {string[]} assignees
 * @property {string[]} requestedReviewers
 * @property {string[]} labels
 * @property {string} headBranch
 * @property {string} baseBranch
 * @property {string} htmlUrl
 * @property {NormalizedPrFile[]} files
 * @property {NormalizedPrComment[]} conversationComments
 * @property {NormalizedPrReview[]} reviews
 * @property {number[]} linkedIssueNumbers
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
 * Scans a body or comment for "#123" references and returns unique numbers.
 * The parent orchestrator can optionally confirm these are real issues vs
 * PRs; we do not attempt that here to keep the normaliser pure.
 * @param {string} text
 * @returns {number[]}
 */
function extractLinkedIssueNumbers(text) {
  if (!text) return [];
  const out = new Set();
  const re = /(?:^|\s|[,.:;(\[])#(\d{1,7})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.add(Number(m[1]));
  }
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Normalises a pull request bundle.
 *
 * @param {Object} args
 * @param {any} args.raw                  Raw PR payload.
 * @param {string} args.repoFullName
 * @param {any[]} [args.conversationComments] Raw comments from `issues/:n/comments`.
 * @param {any[]} [args.reviews]              Raw reviews from `pulls/:n/reviews`.
 * @param {any[]} [args.reviewComments]       Raw inline comments from `pulls/:n/comments`.
 * @param {any[]} [args.files]                Raw files from `pulls/:n/files`.
 * @returns {NormalizedPullRequest}
 */
function normalizePullRequest({
  raw,
  repoFullName,
  conversationComments = [],
  reviews = [],
  reviewComments = [],
  files = [],
}) {
  const number = Number(raw?.number);

  /** @type {NormalizedPrComment[]} */
  const normalizedConvo = conversationComments
    .map((c) => ({
      id: c?.id ?? '',
      author: c?.user?.login || null,
      createdAt: c?.created_at || '',
      updatedAt: c?.updated_at || c?.created_at || '',
      body: c?.body || '',
    }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  // Group inline review-comments under their parent review. Comments that
  // lack a `pull_request_review_id` (rare, usually older data) bucket into
  // a synthetic "unattached" review.
  /** @type {Map<string|number, NormalizedPrReviewComment[]>} */
  const inlineByReview = new Map();
  for (const c of reviewComments) {
    const parentId = c?.pull_request_review_id ?? 'unattached';
    const arr = inlineByReview.get(parentId) || [];
    arr.push({
      id: c?.id ?? '',
      author: c?.user?.login || null,
      createdAt: c?.created_at || '',
      body: c?.body || '',
      path: c?.path || null,
      line: Number.isFinite(c?.line) ? Number(c.line) : (Number.isFinite(c?.original_line) ? Number(c.original_line) : null),
    });
    inlineByReview.set(parentId, arr);
  }

  /** @type {NormalizedPrReview[]} */
  const normalizedReviews = reviews.map((r) => ({
    id: r?.id ?? '',
    author: r?.user?.login || null,
    state: r?.state || 'COMMENTED',
    submittedAt: r?.submitted_at || '',
    body: r?.body || '',
    inlineComments: (inlineByReview.get(r?.id) || []).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    ),
  }));
  // Surface any "unattached" bucket as a synthetic review so no inline
  // comments are silently dropped.
  const unattached = inlineByReview.get('unattached');
  if (unattached && unattached.length) {
    normalizedReviews.push({
      id: 'unattached',
      author: null,
      state: 'COMMENTED',
      submittedAt: unattached[0].createdAt,
      body: '',
      inlineComments: unattached.sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
      ),
    });
  }
  normalizedReviews.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));

  /** @type {NormalizedPrFile[]} */
  const normalizedFiles = Array.isArray(files)
    ? files.map((f) => ({
        path: f?.filename || '',
        status: f?.status || 'modified',
        additions: Number(f?.additions) || 0,
        deletions: Number(f?.deletions) || 0,
      }))
    : [];

  const bodyText = raw?.body || '';
  const linked = new Set([
    ...extractLinkedIssueNumbers(bodyText),
    ...normalizedConvo.flatMap((c) => extractLinkedIssueNumbers(c.body)),
    ...normalizedReviews.flatMap((r) =>
      [r.body, ...r.inlineComments.map((ic) => ic.body)].flatMap(extractLinkedIssueNumbers)
    ),
  ]);
  // A PR cannot link to itself.
  linked.delete(number);

  return {
    entityType: 'pullRequest',
    entityKey: `pr:${number}`,
    repoFullName,
    number,
    title: raw?.title || '',
    body: bodyText,
    state: raw?.state || 'open',
    merged: Boolean(raw?.merged_at),
    mergedAt: raw?.merged_at || null,
    createdAt: raw?.created_at || '',
    updatedAt: raw?.updated_at || raw?.created_at || '',
    closedAt: raw?.closed_at || null,
    author: raw?.user?.login || null,
    assignees: mapLogins(raw?.assignees),
    requestedReviewers: mapLogins(raw?.requested_reviewers),
    labels: Array.isArray(raw?.labels)
      ? raw.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
      : [],
    headBranch: raw?.head?.ref || '',
    baseBranch: raw?.base?.ref || '',
    htmlUrl: raw?.html_url || '',
    files: normalizedFiles,
    conversationComments: normalizedConvo,
    reviews: normalizedReviews,
    linkedIssueNumbers: Array.from(linked).sort((a, b) => a - b),
  };
}

module.exports = {
  normalizePullRequest,
  extractLinkedIssueNumbers,
};
