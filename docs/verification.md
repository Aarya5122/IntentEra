# Verification Checklist

Use this page **right after your first Jira run, first GitHub run, and
first retrieval query**, then any time you are unsure whether the
pipeline is actually healthy. Every check is a concrete command with an
expected outcome.

If a check fails, the fix will be in
[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).

> Quick orientation:
> - The `rag_chunks` collection stores **Jira** chunks.
> - The `rag_chunks_github` collection stores **GitHub** chunks.
> - Redis holds per-source state under
>   `intentera:sync:state:jira` and `intentera:sync:state:github`.

---

## A. Before you trigger anything — pre-flight

### A.1. `.env` has the right toggles

```bash
grep -E '^(JIRA_ENABLED|GITHUB_ENABLED|SYNC_SOURCE|MONGODB_DATABASE|MONGODB_COLLECTION|MONGODB_GITHUB_COLLECTION)=' .env
```

Expected: one value per line, and the `ENABLED` flags match what you
actually want to run.

### A.2. Mongo is reachable and both indexes are ACTIVE

Atlas UI → cluster → **Browse Collections**:

- `intentera.rag_chunks` exists. Its **Search Indexes** tab shows
  `vector_index` with status **ACTIVE**.
- If `GITHUB_ENABLED=true`: `intentera.rag_chunks_github` also exists
  with `vector_index_github` **ACTIVE**.

### A.3. Redis is reachable

```bash
# Local docker
docker exec -it intentera-redis redis-cli PING
# Expected: PONG
```

---

## B. After a **Jira full import**

Assuming you just ran:

```bash
node src/cli/runner.js full --source jira
```

### B.1. The CLI returned a clean SyncResult

Expected tail output:

```json
{
  "mode": "full",
  "ticketsProcessed": <N>,
  "chunksInserted": <M>,
  "chunksDeleted": 0,
  "ticketsDeleted": 0,
  ...
}
```

Fail signals: `chunksInserted: 0` (scope filters too strict or Jira
auth failed silently), non-empty `failureReason` in the final state.

### B.2. Redis state looks right

```bash
node src/cli/runner.js state --source jira
```

Expect:

- `"status": "idle"`
- `"failureReason": null`
- `"lastFullImportAt"` recent
- `"knownTicketKeys"` non-empty
- `"schemaVersion": 1`

### B.3. Mongo actually received chunks

In the Atlas **Data Explorer** or any Mongo shell connected to the URI:

```javascript
use intentera;

db.rag_chunks.countDocuments({});

db.rag_chunks.aggregate([
  { $group: { _id: "$sourceType", n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]);

// Spot-check one ticket
db.rag_chunks.find(
  { ticketKey: "PROJ-17" },
  { text: 1, sourceType: 1, chunkIndex: 1, _id: 0 }
).limit(5).pretty();
```

Expected:

- Total count ≥ 1 per ticket (usually 3–10 per ticket).
- `sourceType` values include at least `metadata` and `description`;
  likely also `comments`, `attachment`, `confluence`, `linkedIssues`
  depending on your data.
- Every doc has an `embedding` array of length 1536 (or whatever you
  configured).

### B.4. Retrieval finds real content

```bash
node src/cli/runner.js query "your question about an actual ticket" \
  --source jira --topK 3
```

Expected:

- `results[].score` values mostly `> 0.50` for relevant questions.
- The top `text` visibly relates to the question.
- `appliedFilters` is `{}` (no filter applied).

If scores are all very low (< 0.3) across multiple questions, jump to
[troubleshooting → retrieval quality issues](debugging-and-troubleshooting.md#retrieval-quality-issues).

---

## C. After a **Jira incremental sync**

```bash
node src/cli/runner.js incremental --source jira
```

### C.1. SyncResult sanity

Expected on a quiet window:

```json
{ "mode": "incremental", "ticketsProcessed": 0, "chunksInserted": 0, "chunksDeleted": 0 }
```

A small `ticketsProcessed` count (1–20) on a busy window is normal.

### C.2. State advanced

```bash
node src/cli/runner.js state --source jira
```

`lastIncrementalCompletedAt` should be newer than before; the
`lastIncrementalStartAt` should be roughly when you started this run.

### C.3. No duplicate chunks were created

```javascript
db.rag_chunks.aggregate([
  { $group: { _id: { ticketKey: "$ticketKey", chunkIndex: "$chunkIndex", sourceType: "$sourceType" }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }
]);
```

Expected: empty result (deterministic `_id` guarantees no duplicates).
If this query returns rows, the vector index definition or the
`MONGODB_COLLECTION` might be mismatched — see troubleshooting.

---

## D. After a **GitHub full import**

```bash
node src/cli/runner.js full --source github
```

### D.1. SyncResult sanity

Expected return shape includes per-entity counts:

```json
{
  "mode": "full",
  "entitiesProcessed": { "commit": 140, "pullRequest": 42, "issue": 17 },
  "chunksInserted": <M>,
  "chunksDeleted": 0,
  ...
}
```

If any of `commit`, `pullRequest`, or `issue` is `0`:

- Is the corresponding `GITHUB_INCLUDE_*` flag `true`?
- Is the repo actually non-empty for that type? (Private repos with
  no issues will naturally return 0.)
- For commits specifically: is any branch newer than
  `GITHUB_STALE_BRANCH_DAYS`? Raise the value if all your branches are
  old.

### D.2. Redis state looks right

```bash
node src/cli/runner.js state --source github
```

Expect:

- `"status": "idle"`, `"failureReason": null`
- `"lastFullImportAt"` recent
- `"knownEntityIds": { "commit": [...], "pullRequest": [...], "issue": [...] }`
- `"branchCheckpoints": { "<branch>": "<ISO timestamp>" }`

### D.3. Mongo chunks landed in the **right** collection

Common mistake: writing GitHub chunks into the Jira collection
because `MONGODB_GITHUB_COLLECTION` was not set. Verify:

```javascript
use intentera;

// Counts per collection — GitHub should be in rag_chunks_github only.
db.rag_chunks.countDocuments({ source: "github" });         // expect 0
db.rag_chunks_github.countDocuments({});                    // expect > 0
db.rag_chunks_github.aggregate([
  { $group: { _id: "$entityType", n: { $sum: 1 } } }
]);
```

Expected `entityType` values: some combination of `commit`,
`pullRequest`, `issue` matching what you enabled.

### D.4. Chunks carry the right metadata

```javascript
db.rag_chunks_github.findOne(
  { entityType: "commit" },
  { entityKey: 1, repoFullName: 1, metadata: 1, text: 1, _id: 0 }
);
```

Expect to see:

- `entityKey` starts with `commit:` (or `pr:` / `issue:` for those
  types).
- `repoFullName` matches `"<GITHUB_REPO_OWNER>/<GITHUB_REPO_NAME>"`.
- `metadata.branches` contains at least one branch name.
- `metadata.filePaths` is a non-empty array for most commits.

### D.5. Retrieval returns GitHub results

```bash
node src/cli/runner.js query "who touched the login module last quarter?" \
  --source github --repo <owner>/<name> --topK 5
```

Every result item should have:

- `"source": "github"`
- `"entityType"` = `commit` / `pullRequest` / `issue`
- `"repoFullName"` matching the repo you configured.

---

## E. After a **GitHub incremental sync**

```bash
node src/cli/runner.js incremental --source github
```

### E.1. Only changed entities were reprocessed

Inspect the SyncResult. On a quiet window `entitiesProcessed` should
be small (often 0). Branch checkpoints advance only for branches with
new commits.

### E.2. No stale data remains

If you delete a GitHub issue, close-and-reopen it, or let a branch go
stale, the next incremental should reflect that:

- Deleted issues: `chunksDeleted > 0`, `knownEntityIds.issue` shrinks.
- Stale branch: its commits are no longer re-indexed; existing chunks
  stay (because the commit hasn't been deleted, just its branch is no
  longer active).

### E.3. Redis `branchCheckpoints` evolve

```bash
node src/cli/runner.js state --source github | jq '.branchCheckpoints'
```

Expect timestamps for active branches to move forward across
incremental runs.

---

## F. After a **retrieval query**

### F.1. Response envelope is correct

For API Gateway invocations, the `statusCode` should be `200` and
`body` should be a JSON string parseable into:

```json
{
  "query": "...",
  "retrievedAt": "<ISO>",
  "source": "jira" | "github" | "both",
  "topK": <n>,
  "appliedFilters": { ... },
  "results": [ ... ],
  "context": "--- [1] ... ---\n..."
}
```

### F.2. Each `results[]` item is source-tagged

- Jira hits: `"source": "jira"`, `"entityKey": "PROJ-123"`,
  `"projectKey": "PROJ"`, `"entityType": null`, `"repoFullName": null`.
- GitHub hits: `"source": "github"`, `"entityKey": "pr:42"` (or
  `commit:<sha>` / `issue:15`), `"entityType"` set, `"repoFullName"`
  set.

### F.3. `source: "both"` actually mixes

```bash
node src/cli/runner.js query "SSO launch" --source both --topK 10
```

Expect `results` to contain a **mix** of `"source": "jira"` and
`"source": "github"` entries. If only one side appears:

- Check both vector indexes are ACTIVE.
- Check both `ENABLED` flags are `true`.
- Check the question actually has cross-source signal (it's fine for a
  Jira-only question to return only Jira rows — `both` is best-effort
  relevance, not a 50/50 split guarantee).

---

## G. End-to-end daily smoke test

Run this once a day (or put it in a dashboard) to catch silent
regressions.

```bash
# 1. Jira / GitHub state is healthy
node src/cli/runner.js state --source jira    | jq '{status, failureReason, lastIncrementalCompletedAt}'
node src/cli/runner.js state --source github  | jq '{status, failureReason, lastIncrementalCompletedAt}'

# 2. Known chunk counts (run in Mongo shell)
#    db.rag_chunks.countDocuments({})
#    db.rag_chunks_github.countDocuments({})

# 3. One retrieval each way
node src/cli/runner.js query "ping"                  --source jira   --topK 1
node src/cli/runner.js query "ping"                  --source github --topK 1
```

All three steps should succeed in under 5 seconds each.

---

## H. Signs that a run did **not** succeed

Any of the following means the run did not fully succeed:

| Symptom | Likely cause |
|---|---|
| `"status": "failed"` in state | Uncaught exception — see `failureReason` in state + CloudWatch logs |
| `ticketsProcessed: 0` on a full import you know has data | Scope filters (`JIRA_PROJECT_KEYS`) wrong, or Jira auth silently failing |
| `entitiesProcessed.commit: 0` despite active branches | `GITHUB_STALE_BRANCH_DAYS` too low, or `GITHUB_INCLUDE_COMMITS=false` |
| No docs in `rag_chunks_github` but `GITHUB_ENABLED=true` | `MONGODB_GITHUB_COLLECTION` not set, or the GitHub orchestrator is writing into Jira's collection due to wiring misconfig |
| Retrieval returns 0 results for `source: "github"` | GitHub index still `BUILDING`, or `MONGODB_GITHUB_VECTOR_INDEX` name mismatch |
| Retrieval `source: "both"` always returns only one side | Other side's vector store failed to build — check `buildRetrievalDeps` logs |

For each of these, the exact fix lives in
[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).
