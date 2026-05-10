# Local Development Guide

This guide assumes you have finished [getting-started.md](getting-started.md)
(accounts created, services running, `.env` filled in) and you now want to
run the system locally and understand what it does.

---

## 1. Install dependencies

From the project root:

```bash
npm install
```

You should see `added NNN packages in Xs`. Most deprecation warnings are
harmless and come from transitive dependencies.

---

## 2. Verify your `.env` before running

A common cause of first-run failures is a missing or typo'd env var. You
can do a pre-flight check:

```bash
node -e "
require('dotenv').config();
const required = ['JIRA_BASE_URL','JIRA_EMAIL','JIRA_API_TOKEN','MONGODB_URI','REDIS_URL','OPENAI_API_KEY','JIRA_PROJECT_KEYS'];
const missing = required.filter(k => \!process.env[k]);
console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'All required env vars are set.');
"
```

If anything prints as `MISSING`, go back to `.env` and fill it in.

For a full reference of every variable and what it means, see
[configuration-reference.md](configuration-reference.md).

---

## 3. The CLI runner

Everything locally goes through `src/cli/runner.js`. The package also
exposes friendly npm scripts:

```bash
npm run cli              # default: incremental sync
npm run cli:full         # force full import
npm run cli:incremental  # same as npm run cli
npm run cli:query        # not usable directly (no query arg), see below
```

Or call the runner with any args directly:

```bash
node src/cli/runner.js <command> [args] [--flag value]
```

Available commands:

| Command | What it does |
|---|---|
| `incremental` *(default)* | Runs an incremental sync — fetches changes since the last checkpoint. |
| `full` | Forces a full import — re-indexes every entity in scope. |
| `query "<natural language>"` | Runs a retrieval query against the current index. |
| `state` | Prints the current Redis sync state (read-only). |
| `help` | Prints usage. |

Every command accepts `--source jira` (default) or `--source github` to
select the pipeline. The retrieval command additionally supports
`--source both` to query Jira and GitHub together. See the
"GitHub" section below.

---

## 4. Simulate a **full import**

Use this for the **very first run** or whenever you want to rebuild from
scratch.

```bash
node src/cli/runner.js full
```

### What happens

1. `dotenv` reads `.env`.
2. `buildIngestionDeps()` constructs the Jira, Confluence, OpenAI, Mongo,
   Redis clients (reuses them on warm runs).
3. The orchestrator acquires a Redis run-lock so two instances can't trample
   each other.
4. It builds a JQL query covering every project in `JIRA_PROJECT_KEYS`.
5. It streams tickets one at a time, and for each ticket:
   - Fetches comments, remote links, and attachment binaries.
   - Normalises everything (ADF → plain text, comments, linked issues).
   - Chunks the ticket into retrieval-ready pieces.
   - Calls OpenAI in batches to embed the chunks.
   - Deletes all existing Mongo chunks for this ticket, then inserts the
     new ones.
6. After processing every ticket, it compares the processed set to the
   previous `knownTicketKeys` and deletes any that disappeared.
7. Writes a new success checkpoint to Redis.

### What you see

A stream of JSON log lines similar to:

```json
{"level":"info","msg":"ingestion invocation received","mode":"full","awsRequestId":"local-...","time":"..."}
{"level":"info","msg":"helper indexes ensured","time":"..."}
{"level":"info","msg":"starting jira ticket stream","jql":"project in (\"PROJ\") ORDER BY updated ASC"}
{"level":"info","msg":"ticket indexed","issueKey":"PROJ-1","chunks":4,"replacedOld":0}
{"level":"info","msg":"ticket indexed","issueKey":"PROJ-2","chunks":9,"replacedOld":0}
...
{"level":"info","msg":"sync completed successfully","mode":"full","ticketsProcessed":42,"chunksInserted":213,"chunksDeleted":0,"ticketsDeleted":0,...}
```

And at the very end, a pretty-printed summary (the handler's return value):

```json
{
  "mode": "full",
  "startedAt": "2026-04-19T19:00:00.000Z",
  "completedAt": "2026-04-19T19:02:37.812Z",
  "ticketsProcessed": 42,
  "chunksInserted": 213,
  "chunksDeleted": 0,
  "ticketsDeleted": 0,
  "knownTicketKeys": ["PROJ-1", "PROJ-2", "..."]
}
```

Rough timing: ~2–3 seconds per ticket (dominated by OpenAI embedding
calls). 100 tickets ≈ 3–5 minutes.

---

## 5. Simulate an **incremental sync**

```bash
node src/cli/runner.js incremental
# or just:
node src/cli/runner.js
```

If nothing has changed since the last run, you'll see `ticketsProcessed: 0`
in the summary. That is the correct happy path.

### The lookback window

The incremental run does not start from "last run completed". It starts
from **`lastIncrementalStartAt - INCREMENTAL_LOOKBACK_MINUTES`**. So if
your last run started at 19:00 and the default 60-minute lookback is in
place, this run covers `updated >= 18:00`.

Why? Jira's `updated` timestamp can lag a few minutes behind real changes,
and a 60-minute overlap ensures nothing is missed. Idempotent
delete-before-upsert handling makes the overlap safe — duplicate work does
**not** produce duplicate Mongo documents.

Change the window in `.env`:

```
INCREMENTAL_LOOKBACK_MINUTES=30
```

Shorter = faster re-runs and less wasted work, but higher risk of missing
late-arriving updates.

---

## 6. Simulate a **retrieval query**

```bash
node src/cli/runner.js query "How did we fix the login bug?"
```

With filters:

```bash
node src/cli/runner.js query "When did we add SSO support?" \
  --topK 10 \
  --project ENG \
  --sourceType description,comments \
  --labels auth,sso
```

Available query flags:

| Flag | Meaning |
|---|---|
| `--topK N` | Return the top N results. Capped by `RETRIEVAL_MAX_TOP_K`. |
| `--project KEY` | Restrict to one Jira project. |
| `--ticket KEY` | Restrict to one ticket (useful for "summarise PROJ-17"). |
| `--sourceType a,b` | Restrict to certain chunk source types. Valid values: `metadata`, `description`, `comments`, `linkedIssues`, `attachment`, `confluence`. |
| `--labels l1,l2` | Require all listed labels on the ticket. |
| `--source jira\|github\|both` | Which data source(s) to query. Default `jira`. |
| `--repo owner/name` | *GitHub only.* Filter by repository full name. |
| `--entityType commit\|pullRequest\|issue` | *GitHub only.* Filter to a single entity type. |
| `--entityKey pr:42` | *GitHub only.* Filter to one entity key (commit:`<sha>` / pr:`<n>` / issue:`<n>`). |
| `--branch name` | *GitHub commits only.* Comma-separated list of branches. |
| `--filePath path` | *GitHub only.* Comma-separated list of file paths touched. |
| `--pr N` | *GitHub PRs only.* Filter by PR number. |
| `--issue N` | *GitHub issues only.* Filter by issue number. |
| `--commit SHA` | *GitHub commits only.* Filter by commit SHA. |

### Output

The CLI prints an API-Gateway-shaped response with the JSON body parsed
for readability:

```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json" },
  "body": {
    "query": "How did we fix the login bug?",
    "retrievedAt": "2026-04-19T19:10:00.000Z",
    "topK": 5,
    "appliedFilters": {},
    "results": [
      {
        "chunkId": "1f3e2a...",
        "ticketKey": "PROJ-17",
        "projectKey": "PROJ",
        "sourceType": "comments",
        "score": 0.843,
        "text": "[Alice on 2026-03-10] We tracked the regression to ...",
        "metadata": { "summary": "Login broken after SSO upgrade", "status": "Done", "labels": ["auth","sso"], "commentIds": ["10231"] }
      }
    ],
    "context": "--- [1] PROJ-17 (comments) score=0.843 ---\n..."
  }
}
```

- Use `results[]` for programmatic consumption.
- Use `context` as a ready-to-paste prompt segment for your downstream LLM.

---

## 7. Inspect the sync state

Sync state is now scoped **per source**, so pass `--source`:

```bash
node src/cli/runner.js state --source jira
node src/cli/runner.js state --source github
```

For Jira, the shape is documented in
[`examples/redis-state.json`](examples/redis-state.json); for GitHub, see
[`examples/redis-state-github.json`](examples/redis-state-github.json).
Fields you care about most:

- `status` — `"idle"` is healthy.
- `failureReason` — `null` is healthy.
- `lastIncrementalStartAt` — the anchor used to compute the next lookback
  window.
- `knownTicketKeys` (Jira) / `knownEntityIds` (GitHub) — the set of
  entities currently indexed. Shrinks when something moves out of scope.

---

## 7b. GitHub quickstart

If `GITHUB_ENABLED=true` in your `.env`, you can run the GitHub pipeline
identically to Jira — just pass `--source github`:

```bash
# First run: full import, commits only (fast smoke test)
node src/cli/runner.js full --source github --entityTypes commits

# Full import for every type
node src/cli/runner.js full --source github

# Later runs
node src/cli/runner.js incremental --source github

# Inspect state
node src/cli/runner.js state --source github

# Query GitHub only, or both sources at once
node src/cli/runner.js query "who reviewed the auth PR?" \
  --source github --repo acme-inc/platform --pr 42
node src/cli/runner.js query "SSO rollout timeline" --source both --topK 10
```

See [github-setup.md](github-setup.md) for token and configuration
details.

---

## 7c. Running the local git agent (chat feature)

Only needed if you also want to use the **chat extension** for VS Code
or Cursor. The CLI runner exposes a long-lived `agent` mode that boots a
loopback-only HTTP server which the extension calls for git history.

```bash
npm run agent
# IntentEra local git agent ready at http://127.0.0.1:8787
```

You can verify it's healthy from another terminal:

```bash
curl http://127.0.0.1:8787/healthz
```

The agent shells out to `git log --no-patch` against your working tree
and never makes outbound network calls. Optional env vars (`AGENT_PORT`,
`AGENT_ALLOWED_PROJECT_ROOTS`) are documented in
[configuration-reference.md](configuration-reference.md#local-git-agent).

For the full three-step run guide (Lambda + agent + extension), see
[code-chat-runbook.md](code-chat-runbook.md). Architecture and wire
formats live in [code-chat.md](code-chat.md).

---

## 8. Debugging tips

### Turn up the log level

```bash
LOG_LEVEL=debug node src/cli/runner.js incremental
```

Or set `LOG_LEVEL=debug` in `.env`. Debug adds every retry attempt and a
trace for each embedding batch.

### Isolate a single ticket

Want to inspect what chunks a specific ticket produces? Temporarily set
`JIRA_ISSUE_TYPES=` and reduce the project filter, or just run an ad-hoc
Node script:

```bash
node -e "
require('dotenv').config();
(async () => {
  const { buildIngestionDeps, teardown } = require('./src/utils/wiring');
  const { normalizeTicket } = require('./src/normalization/normalizer');
  const { chunkTicket } = require('./src/chunking/chunker');
  const deps = await buildIngestionDeps();
  for await (const bundle of deps.fetcher.streamTicketBundles({ projectKeys: ['PROJ'], updatedSince: '2026-01-01T00:00:00Z' })) {
    if (bundle.issue.key !== 'PROJ-17') continue;
    const n = await normalizeTicket({ bundle, confluenceClient: deps.confluenceClient, includeConfluence: true });
    const chunks = chunkTicket({ ticket: n, cfg: deps.cfg.chunking });
    console.log(JSON.stringify(chunks.map(c => ({ sourceType: c.sourceType, chunkIndex: c.chunkIndex, preview: c.text.slice(0, 120) })), null, 2));
    break;
  }
  await teardown();
})();
"
```

### Check what's in Mongo

With the Mongo shell or Atlas UI, query the collection directly:

```javascript
db.rag_chunks.find({ ticketKey: "PROJ-17" }, { text: 1, sourceType: 1, chunkIndex: 1 }).pretty();
```

Or count per source type:

```javascript
db.rag_chunks.aggregate([
  { $group: { _id: "$sourceType", n: { $sum: 1 } } }
]);
```

### Force a fresh checkpoint

If the Redis state ever gets into a weird place during development, you
can wipe it with `redis-cli`:

```bash
# Jira state
docker exec -it intentera-redis redis-cli DEL intentera:sync:state:jira intentera:sync:lock:jira
# GitHub state
docker exec -it intentera-redis redis-cli DEL intentera:sync:state:github intentera:sync:lock:github
```

The next `incremental` run will detect the missing state and upgrade to a
full import automatically.

### Reset the Mongo collection

**Dev only** — never do this in production:

```javascript
db.rag_chunks.deleteMany({});
```

Then run `node src/cli/runner.js full` again.

### Common `403 Forbidden` on attachments

A Jira user might be able to read an issue but not its attachments. The
parser treats this as a parse failure and emits a placeholder chunk.
Grant the token's account "View attachments" permission if you want the
text in the index.

---

## 9. Git / version control hygiene

- `.env` is already in `.gitignore` — never force-add it.
- Don't commit `node_modules/` (also in `.gitignore`).
- Keep `.env.example` up to date if you introduce a new env var.

---

## Next

- Ready for production? Continue with
  [aws-deployment.md](aws-deployment.md).
- Hitting an error? Jump to
  [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).
