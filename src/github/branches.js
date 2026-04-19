'use strict';

/**
 * src/github/branches.js
 * ----------------------
 * Enumerates the "active" branches of the configured repository.
 *
 * What counts as "active"?
 * ------------------------
 * GitHub's web UI shows a "Stale branches" filter on the Branches page but
 * there is NO REST or GraphQL field that exposes a boolean stale flag. The
 * UI computes it from the branch tip's commit timestamp — a branch is stale
 * if nothing has been committed to it recently.
 *
 * We mirror that behaviour:
 *   active(branch) = branch.tip.committedDate >= (now - staleBranchDays)
 *
 * `staleBranchDays` is configured via GITHUB_STALE_BRANCH_DAYS (default 90).
 *
 * Why GraphQL?
 * ------------
 * The REST endpoint `/repos/:o/:r/branches` returns branches without the
 * commit date — we'd have to follow up with one REST call per branch to
 * fetch the tip commit, which is slow and burns rate limit quota. The
 * GraphQL `refs` connection lets us get name + committedDate for up to 100
 * branches per request.
 *
 * Safety cap
 * ----------
 * `GITHUB_MAX_BRANCHES` (default 50) limits how many active branches we
 * iterate per run. Monorepos can have thousands of stale branches; we sort
 * by most-recent tip first so the active ones are always preferred.
 */

const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} GithubBranch
 * @property {string} name         e.g. "main", "feature/foo"
 * @property {string} headSha      SHA of the branch tip.
 * @property {string} committedDate ISO-8601 UTC committedDate of the tip commit.
 */

/**
 * GraphQL query: paginated list of refs under `refs/heads/` including the
 * tip commit's committedDate. We intentionally do not `filter` by date here
 * because GitHub has no "committedAfter" server-side filter — the cap is
 * applied client-side so we still see the FULL count in logs for debugging.
 */
const REFS_QUERY = /* GraphQL */ `
  query ListBranches($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(
        refPrefix: "refs/heads/",
        first: 100,
        after: $cursor,
        orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          target {
            ... on Commit { oid committedDate }
          }
        }
      }
    }
  }
`;

/**
 * Lists all branches of the repo, paginating through the GraphQL refs
 * connection. Each returned object carries the tip's committedDate.
 *
 * @param {Object} args
 * @param {import('./client').GithubClient} args.client
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<GithubBranch[]>}
 */
async function listAllBranches({ client, logger }) {
  const log = (logger || createLogger()).child({ component: 'githubBranches' });
  /** @type {GithubBranch[]} */
  const branches = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page += 1;
    const data = await client.graphql(REFS_QUERY, {
      owner: client.repoOwner,
      name: client.repoName,
      cursor,
    });
    const refs = data?.repository?.refs;
    if (!refs) break;
    for (const node of refs.nodes || []) {
      const tip = node.target;
      if (!tip?.oid || !tip?.committedDate) continue;
      branches.push({
        name: node.name,
        headSha: tip.oid,
        committedDate: tip.committedDate,
      });
    }
    log.debug('fetched branches page', { page, total: branches.length });
    if (!refs.pageInfo?.hasNextPage) break;
    cursor = refs.pageInfo.endCursor;
  }

  log.info('fetched all branches', { count: branches.length });
  return branches;
}

/**
 * Filters a branch list down to the active set, applying `staleBranchDays`
 * as the cutoff and respecting `maxBranches` as a safety cap.
 *
 * @param {Object} args
 * @param {GithubBranch[]} args.branches
 * @param {number} args.staleBranchDays  branch is active iff tip commit >= now - days.
 * @param {number} args.maxBranches      hard cap on returned active branches.
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {GithubBranch[]}
 */
function filterActive({ branches, staleBranchDays, maxBranches, logger }) {
  const log = (logger || createLogger()).child({ component: 'githubBranches' });
  const cutoffMs = Date.now() - staleBranchDays * 24 * 60 * 60 * 1000;

  const active = branches
    .filter((b) => {
      const t = Date.parse(b.committedDate);
      return Number.isFinite(t) && t >= cutoffMs;
    })
    // Sort newest-first so that when the cap trims the list we always keep
    // the freshest branches.
    .sort((a, b) => Date.parse(b.committedDate) - Date.parse(a.committedDate));

  const trimmed = active.slice(0, maxBranches);
  if (active.length > maxBranches) {
    log.warn('active branch count exceeds cap; trimming', {
      activeCount: active.length,
      cap: maxBranches,
    });
  }
  log.info('resolved active branches', {
    total: branches.length,
    active: active.length,
    kept: trimmed.length,
    staleBranchDays,
  });
  return trimmed;
}

/**
 * Convenience wrapper: list + filter in a single call.
 *
 * @param {Object} args
 * @param {import('./client').GithubClient} args.client
 * @param {number} args.staleBranchDays
 * @param {number} args.maxBranches
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<GithubBranch[]>}
 */
async function listActiveBranches({ client, staleBranchDays, maxBranches, logger }) {
  const all = await listAllBranches({ client, logger });
  return filterActive({ branches: all, staleBranchDays, maxBranches, logger });
}

module.exports = {
  listAllBranches,
  filterActive,
  listActiveBranches,
};
