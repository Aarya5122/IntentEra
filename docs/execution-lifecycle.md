# Execution Lifecycle (Before / During / After)

This is the "what actually happens when I invoke the pipeline?" guide —
in very plain English — for **both Jira and GitHub**. Every run (whether
triggered by EventBridge, the CLI, or a manual Lambda test) goes through
the same three phases.

If you want to understand why things are happening in a specific order,
or if something is stuck and you need to know *where* it is stuck, this
is the right page.

---

## Phase 1 — **Before** execution (what must be true for a run to work)

A run cannot succeed unless all of this is already set up. This is
identical whether you run locally or in AWS.

### 1. Configuration is available

- Locally: a `.env` file in the project root.
- In Lambda: `USE_SECRETS_MANAGER=true` plus `SECRETS_MANAGER_SECRET_ID`
  pointing at a secret whose JSON body holds the same keys.

Use [configuration-reference.md](configuration-reference.md) to audit
every variable. Minimum pre-flight checklist:

| Key | Needed when | Example |
|---|---|---|
| `OPENAI_API_KEY` | Always | `sk-…` |
| `MONGODB_URI` | Always | `mongodb+srv://…` |
| `MONGODB_DATABASE` | Always | `intentera` |
| `REDIS_URL` | Always | `redis://localhost:6379` |
| `JIRA_ENABLED` | Defaults `true` | `false` if GitHub-only |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEYS` | When Jira enabled | |
| `GITHUB_ENABLED` | Defaults `false` | `true` to turn GitHub on |
| `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` | When GitHub enabled | |
| `MONGODB_COLLECTION` / `MONGODB_VECTOR_INDEX` | Jira | default `rag_chunks` / `vector_index` |
| `MONGODB_GITHUB_COLLECTION` / `MONGODB_GITHUB_VECTOR_INDEX` | GitHub | default `rag_chunks_github` / `vector_index_github` |

### 2. External services are reachable

- **MongoDB Atlas:** the database + target collection(s) exist and
  their **Vector Search indexes are ACTIVE** (not `BUILDING`). If
  GitHub is enabled, *both* indexes must be ACTIVE.
- **Redis:** reachable from the machine/Lambda running the job. Locally
  that usually means the Docker container is running; in Lambda it
  means the VPC / public endpoint is reachable.
- **Jira:** the API token is valid and the account can see the
  projects listed in `JIRA_PROJECT_KEYS`.
- **GitHub:** the Personal Access Token is valid and has `repo` (for a
  private repo) or `public_repo` scope, and the repo is accessible.
- **OpenAI:** the API key is valid and there is billing attached.

### 3. IAM / network permissions (AWS only)

- Lambda execution role has `secretsmanager:GetSecretValue` on the
  secret ARN.
- If Redis is inside a VPC, the Lambda is attached to that VPC with an
  egress route to OpenAI, MongoDB, Jira, and GitHub.

### 4. Schedule / trigger exists

- Ingestion: at least one EventBridge rule targeting the ingest
  Lambda, with an `Input` like `{"source":"jira"}` or
  `{"source":"github"}`. See
  [`examples/eventbridge-rule.json`](examples/eventbridge-rule.json)
  and [`examples/github-eventbridge-rule.json`](examples/github-eventbridge-rule.json).
- Retrieval: an API Gateway HTTP API with a `POST /retrieve` route
  pointing at the retrieve Lambda.

> If **any** of the above is missing or stale, the run will fail early
> and the error you see will usually be in the "Config & env var"
> or "MongoDB / Redis / Jira / GitHub" sections of
> [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).

---

## Phase 2 — **During** execution (what the code actually does, step by step)

The same shape applies to both Jira and GitHub runs; only the data
source differs.

### Step 0 — Lambda cold start / CLI boot

1. `dotenv` (or Lambda) loads env vars.
2. `config/secrets.js` (if enabled) fetches the Secrets Manager secret
   and merges its keys into `process.env`.
3. `config/appConfig.js` validates the config. If anything is missing,
   the run **fails here** with a clear message.
4. `src/utils/wiring.js` lazily creates and caches clients for Mongo,
   Redis, OpenAI, Jira, GitHub (only the ones needed for this run).

### Step 1 — Resolve source + mode

- `source` comes from the event payload or `SYNC_SOURCE` env var
  (default `jira`).
- `mode` comes from the event payload or `SYNC_MODE` env var (default
  `incremental`).

The handler logs:

```
{"level":"info","msg":"jira ingestion invocation received","mode":"incremental"}
```

or for GitHub:

```
{"level":"info","msg":"github ingestion invocation received","mode":"incremental","entityTypes":null}
```

### Step 2 — Acquire the per-source lock

The orchestrator calls `RedisState.acquireLock()` on
`intentera:sync:lock:<source>`. If another run is already in progress
for the same source, you'll see:

```
another sync run appears to be in progress; skipping
```

and the run exits cleanly without touching Mongo.

Jira and GitHub have **independent** locks, so they can run
simultaneously.

### Step 3 — Read prior state, compute the time window

- Orchestrator reads `intentera:sync:state:<source>` from Redis.
- For incremental mode: `since = lastIncrementalStartAt - lookback
  minutes`.
- For full mode: `since = null` (fetch everything in scope).

The orchestrator also stamps a fresh `lastIncrementalStartAt` *before*
doing any work, so the next run's lookback computes off the time this
run started (not finished).

### Step 4 — Stream entities

**Jira side:**

- Build a JQL query from `JIRA_PROJECT_KEYS` + filters + `updatedSince`.
- Page through tickets one at a time.
- For each ticket, fetch comments, remote links, and attachment
  binaries. Parse PDFs / DOCX / HTML inline.
- Follow Confluence remote links (if `JIRA_INCLUDE_CONFLUENCE=true`).

**GitHub side** — the orchestrator processes enabled entity types
sequentially:

1. **Commits** — list active branches via GraphQL, filter by
   `GITHUB_STALE_BRANCH_DAYS`, walk each branch's commits using
   `?since=<ISO>` for incrementals, dedupe SHAs across branches using
   an in-memory `Set`, and hydrate each unique commit with its changed
   file list.
2. **Pull Requests** — paginate `pulls?state=all&sort=updated&direction=desc`
   and stop early when `updated_at < since`. For each PR, fetch issue
   comments, reviews, review comments (grouped under their parent
   review), and changed file summary.
3. **Issues** — paginate `issues?state=all&sort=updated&since=<ISO>`,
   filter out PR rows (GitHub returns PRs through this endpoint too),
   and fetch each issue's comments.

Logs look like:

```
{"msg":"ticket indexed","issueKey":"PROJ-17","chunks":5,"replacedOld":3}
```

or:

```
{"msg":"commit indexed","sha":"9fceb02","chunks":3,"branches":["main"]}
{"msg":"pull request indexed","prNumber":42,"chunks":6}
{"msg":"issue indexed","issueNumber":15,"chunks":3}
```

### Step 5 — Normalise and chunk

For each entity, the pipeline:

- **Normalises** the raw API response into a unified shape (Jira ADF →
  plain text; GitHub commit message → headline + body; PR inline
  comments → grouped under their parent review).
- **Chunks** the normalised content into retrieval-ready pieces. Each
  chunk has a `sourceType` (`description`, `comments`, `attachment`,
  `confluence`, `metadata`, `commitMessage`, `prReview`,
  `prConversation`, `issueBody`, `issueComments`, etc.) so the
  retrieval side can filter by type.

### Step 6 — Embed chunks

Chunks are grouped into batches of `OPENAI_EMBEDDING_BATCH_SIZE`
(default 64) and sent to OpenAI's embeddings API with exponential
backoff on 429s. Each chunk gets a 1536-element vector back.

### Step 7 — Upsert into Mongo (delete-then-insert)

Per entity:

1. `deleteEntity(entityKey)` removes every pre-existing chunk for this
   entity in the relevant collection (`rag_chunks` or
   `rag_chunks_github`).
2. `insertMany([...chunks with embeddings...])` writes the fresh chunks.

Because the `_id` of each chunk is deterministic, this is idempotent
even if the same ticket is processed twice in the same window.

### Step 8 — Deletion sweep

After streaming completes, the orchestrator compares the entity IDs it
just processed against the **previous** `knownTicketKeys` /
`knownEntityIds` from Redis. Anything in the old list but not the new
list is deleted from Mongo (handles Jira tickets moved to a different
project, GitHub branches going stale, issues deleted, etc.).

### Step 9 — Write the success checkpoint

Redis state is updated with:

- `status: "idle"`
- `failureReason: null`
- `lastIncrementalCompletedAt` (or `lastFullImportAt`)
- New `knownTicketKeys` / `knownEntityIds`
- (GitHub only) `branchCheckpoints`, `knownCommitShas`,
  `knownPullRequestNumbers`, `knownIssueNumbers`

### Step 10 — Release the lock, return a SyncResult

A typical Lambda return:

```json
{
  "mode": "incremental",
  "startedAt": "2026-04-19T19:00:00.000Z",
  "completedAt": "2026-04-19T19:03:42.812Z",
  "ticketsProcessed": 5,
  "chunksInserted": 22,
  "chunksDeleted": 7,
  "ticketsDeleted": 0,
  "knownTicketKeys": ["…"]
}
```

For GitHub the shape is similar but with `entitiesProcessed`,
`knownEntityIds`, and a per-entity-type breakdown.

---

## Phase 2 (retrieval side) — What happens when a query comes in

Retrieval is much shorter than ingestion.

1. API Gateway forwards `POST /retrieve` → the retrieve Lambda.
2. The handler parses the body and extracts `query`, `source`, `topK`,
   `filters`.
3. OpenAI embeds the query (one API call, one vector).
4. Mongo runs `$vectorSearch` against the relevant collection(s):
   - `source: "jira"` → `rag_chunks`
   - `source: "github"` → `rag_chunks_github`
   - `source: "both"` → both collections in parallel, results merged and
     re-sorted by score.
5. Each hit is wrapped into a `RetrievalResultItem` carrying
   `source`, `entityKey`, `entityType` (GitHub), `projectKey` (Jira),
   `repoFullName` (GitHub), `sourceType`, `score`, `text`, `metadata`.
6. A `context` string is assembled for downstream prompting, where each
   chunk is labelled with its source so the LLM can cite it.
7. The Lambda returns `{"statusCode": 200, "body": "<json>"}`.

Typical end-to-end latency: **150–400 ms**.

---

## Phase 3 — **After** execution (what to check)

Regardless of which source you ran, after a run verify the same set of
things. Full recipes with commands are in
[verification.md](verification.md); the quick version:

### 1. Did it succeed?

- Lambda: Monitor tab → Invocations chart; look for a **green** bar,
  no errors.
- Locally: the CLI printed a `SyncResult` with `status: "idle"` and
  `failureReason: null`.

### 2. What does the sync state say?

```bash
node src/cli/runner.js state --source jira
node src/cli/runner.js state --source github
```

`status` should be `"idle"`, `lastIncrementalCompletedAt` should be
recent, and `knownTicketKeys` / `knownEntityIds` should be non-empty
after your first run.

### 3. Did chunks land in Mongo?

```javascript
// Jira
db.rag_chunks.countDocuments({});
db.rag_chunks.aggregate([{ $group: { _id: "$sourceType", n: { $sum: 1 } } }]);

// GitHub
db.rag_chunks_github.countDocuments({});
db.rag_chunks_github.aggregate([{ $group: { _id: "$entityType", n: { $sum: 1 } } }]);
```

### 4. Does retrieval return sane results?

```bash
# Jira
node src/cli/runner.js query "What did we do for SSO?" --source jira

# GitHub
node src/cli/runner.js query "who fixed the login regression?" --source github

# Both
node src/cli/runner.js query "SSO rollout timeline" --source both --topK 10
```

The top result's `text` should look related to the question. If the
scores are all below ~0.4, something is off — start with
[verification.md](verification.md) then
[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).

### 5. Will the next incremental pick up new changes?

Yes, as long as `status: "idle"` and `lastIncrementalStartAt` is set
to the time this run started. That timestamp minus
`INCREMENTAL_LOOKBACK_MINUTES` is the anchor for the next run.

### 6. What if a run failed midway?

- Redis state retains `status: "failed"` and `failureReason: <message>`.
- The lock key auto-expires (15 min TTL) so you don't need to clear it.
- The next run picks up with `since = lastIncrementalStartAt -
  lookback` — you do **not** lose the window you were working on.

---

## Common lifecycle questions

**Q: Jira and GitHub run at the same time — are they safe to do so?**
Yes. Each source has its own Redis state key and its own Redis lock,
and writes to its own Mongo collection. They only share OpenAI + Redis
connections, which are both thread-safe.

**Q: If I change `JIRA_PROJECT_KEYS`, do I need a full import?**
The next run (even if incremental) will see the new scope. Entities in
the **removed** projects will be detected as out of scope by the
deletion sweep and removed. To be on the safe side, run
`node src/cli/runner.js full --source jira` once after the config
change.

**Q: Does turning `GITHUB_ENABLED=false` delete GitHub chunks?**
No — it just skips the GitHub pipeline. The existing `rag_chunks_github`
collection is untouched until you drop it manually.

**Q: Why does incremental sometimes re-process unchanged entities?**
The `INCREMENTAL_LOOKBACK_MINUTES` overlap (default 60) means each run
briefly re-covers entities touched in the last hour, to catch late
`updated` timestamps. Because chunk IDs are deterministic, this is a
no-op at the database level — same bytes written over themselves.

**Q: Is there a way to dry-run?**
Not as a first-class feature, but you can:

- Set `LOG_LEVEL=debug` to see every API call without actually making
  new ones: the pipeline still hits the APIs, but logs reveal what
  chunks *would* be inserted.
- Run the pipeline against a **test Mongo database** (`MONGODB_DATABASE=intentera_dev`)
  so nothing pollutes production.
