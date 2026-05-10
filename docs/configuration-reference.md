# Configuration Reference

Every environment variable used by IntentEra, in plain English, grouped by
what it controls. See `.env.example` at the project root for the template.

> **Where these values come from at runtime:**
> - Local dev: `dotenv` reads `.env` and places them in `process.env`.
> - AWS Lambda: either direct Lambda env vars OR keys inside the AWS
>   Secrets Manager secret (see
>   [secrets-manager-setup.md](secrets-manager-setup.md)). Direct Lambda
>   env vars **override** values that come from Secrets Manager.

---

## Runtime & mode

| Variable | Required | Default | What it does |
|---|---|---|---|
| `SYNC_MODE` | No | `incremental` | Default run mode when an invocation payload doesn't specify `mode`. Valid: `incremental`, `full`. |
| `SYNC_SOURCE` | No | `jira` | Default data source when an invocation payload doesn't specify `source`. Valid: `jira`, `github`. |
| `JIRA_ENABLED` | No | `true` | When `false`, Jira ingestion/config is skipped and its credentials are not required. |
| `GITHUB_ENABLED` | No | `false` | When `true`, GitHub ingestion is enabled and its credentials become required. |
| `NODE_ENV` | No | `production` | Standard Node flag. Only affects minor dev niceties here. |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error`. Turn up to `debug` when investigating. |

---

## Incremental sync window

| Variable | Required | Default | What it does |
|---|---|---|---|
| `INCREMENTAL_LOOKBACK_MINUTES` | No | `60` | How many minutes before the last sync start we begin the next one. Gives us a safety overlap for late Jira updates. |

---

## Jira scope filters

Use these to control which tickets IntentEra ingests. All filters are
AND-combined. Empty values mean "no filter on this field".

| Variable | Required | Default | What it does |
|---|---|---|---|
| `JIRA_PROJECT_KEYS` | Recommended | *(empty = all projects)* | Comma-separated project keys (e.g. `PROJ,ENG`). |
| `JIRA_ISSUE_TYPES` | No | *(empty)* | e.g. `Bug,Story`. |
| `JIRA_STATUSES` | No | *(empty)* | e.g. `Open,In Progress`. |
| `JIRA_LABELS` | No | *(empty)* | e.g. `backend,auth`. Matches tickets with ANY of these labels. |
| `JIRA_INCLUDE_LINKED_ISSUES` | No | `true` | Whether to index linked-issue summaries. |
| `JIRA_INCLUDE_ATTACHMENTS` | No | `true` | Whether to download and parse attachments. |
| `JIRA_INCLUDE_CONFLUENCE` | No | `true` | Whether to follow Confluence remote links. |

---

## Jira credentials (SECRET)

| Variable | Required | What it does |
|---|---|---|
| `JIRA_BASE_URL` | Yes | Your Atlassian root, e.g. `https://your-company.atlassian.net`. No trailing slash. |
| `JIRA_EMAIL` | Yes | Atlassian login email (not display name). |
| `JIRA_API_TOKEN` | Yes | API token from `id.atlassian.com/manage-profile/security/api-tokens`. |

---

## Confluence credentials (SECRET, optional)

If left blank, IntentEra falls back to the Jira credentials — normally
what you want on Atlassian Cloud.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `CONFLUENCE_BASE_URL` | No | `<JIRA_BASE_URL>/wiki` | e.g. `https://your-company.atlassian.net/wiki`. |
| `CONFLUENCE_EMAIL` | No | Reuses `JIRA_EMAIL` | Atlassian login email for Confluence. |
| `CONFLUENCE_API_TOKEN` | No | Reuses `JIRA_API_TOKEN` | API token for Confluence. |

---

## GitHub (SECRET for token)

Required only when `GITHUB_ENABLED=true`. See
[github-setup.md](github-setup.md) for step-by-step setup.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | — | Personal Access Token (classic). Needs `repo` scope for private repos or `public_repo` for public. |
| `GITHUB_REPO_OWNER` | Yes | — | Org or user that owns the repo, e.g. `acme-inc`. |
| `GITHUB_REPO_NAME` | Yes | — | Repo name, e.g. `platform`. |
| `GITHUB_INCLUDE_COMMITS` | No | `true` | Whether to index commits on active branches. |
| `GITHUB_INCLUDE_PULL_REQUESTS` | No | `true` | Whether to index pull requests, reviews, and conversation comments. |
| `GITHUB_INCLUDE_ISSUES` | No | `true` | Whether to index issues and their comments. |
| `GITHUB_STALE_BRANCH_DAYS` | No | `90` | Branches with a last commit older than this are skipped. Must be > 0. |
| `GITHUB_MAX_BRANCHES` | No | `200` | Safety cap on how many active branches we traverse per run. |
| `GITHUB_INCREMENTAL_LOOKBACK_MINUTES` | No | reuses `INCREMENTAL_LOOKBACK_MINUTES` | Overlap window used by the GitHub incremental sync. |
| `GITHUB_COMMIT_MESSAGE_MAX_TOKENS` | No | `500` | Max tokens per commit-message chunk. |
| `GITHUB_PR_BODY_MAX_TOKENS` | No | `500` | Max tokens per PR-body chunk. |
| `GITHUB_PR_REVIEW_MAX_TOKENS` | No | `600` | Max tokens per grouped review chunk. |
| `GITHUB_PR_CONVERSATION_GROUP_SIZE` | No | `3` | Max conversation comments grouped into one chunk. |
| `GITHUB_ISSUE_BODY_MAX_TOKENS` | No | `500` | Max tokens per issue-body chunk. |
| `GITHUB_ISSUE_COMMENT_GROUP_SIZE` | No | `3` | Max issue comments grouped into one chunk. |

> At least one of `GITHUB_INCLUDE_COMMITS`, `GITHUB_INCLUDE_PULL_REQUESTS`,
> or `GITHUB_INCLUDE_ISSUES` must be `true` when GitHub is enabled.

---

## MongoDB Atlas Vector Search (SECRET for URI)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `MONGODB_URI` | Yes | — | Full connection string including username/password. |
| `MONGODB_DATABASE` | No | `intentera` | Database name where chunks are stored. |
| `MONGODB_COLLECTION` | No | `rag_chunks` | Jira collection name. |
| `MONGODB_VECTOR_INDEX` | No | `vector_index` | Name of the Jira Atlas Vector Search index. Must match what you created in the Atlas UI. |
| `MONGODB_GITHUB_COLLECTION` | No | `rag_chunks_github` | GitHub collection name (separate from Jira). |
| `MONGODB_GITHUB_VECTOR_INDEX` | No | `vector_index_github` | Name of the GitHub Atlas Vector Search index. Must match what you created in the Atlas UI. |

---

## Redis (SECRET for password)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `REDIS_URL` | Yes | — | Full URL, e.g. `redis://localhost:6379` or `rediss://:TOKEN@host:6379`. |
| `REDIS_KEY_PREFIX` | No | `intentera:sync:` | Prefix used for the keys IntentEra writes. State and locks are now scoped per source — e.g. `intentera:sync:state:jira` and `intentera:sync:state:github`. |

---

## OpenAI (SECRET)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Starts with `sk-`. |
| `OPENAI_EMBEDDING_MODEL` | No | `text-embedding-3-small` | Any OpenAI embedding model. If you change this, update the Atlas vector index's `numDimensions`. |
| `OPENAI_EMBEDDING_DIMENSIONS` | No | `1536` | Must match the model's output size AND the Atlas vector index. |
| `OPENAI_EMBEDDING_BATCH_SIZE` | No | `64` | How many texts are embedded per request. Raise if Mongo + OpenAI throughput is under-used; lower if you hit payload limits. |
| `OPENAI_CHAT_MODEL` | No | `gpt-4o-mini` | Chat-completion model used by the chat handler (`src/handler/chat.handler`). Must support `response_format=json_object`. Only consumed when the chat feature is in use; see [code-chat-runbook.md](code-chat-runbook.md). |

---

## AWS Secrets Manager

| Variable | Required | Default | What it does |
|---|---|---|---|
| `USE_SECRETS_MANAGER` | No | `false` | When `true`, load the secret JSON and merge its keys into `process.env`. |
| `SECRETS_MANAGER_SECRET_ID` | When `USE_SECRETS_MANAGER=true` | — | The secret's name (e.g. `intentera/rag/prod`). Not the ARN. |
| `AWS_REGION` | No (AWS sets it in Lambda) | `us-east-1` | Region of the Secrets Manager secret. |

---

## Chunking tuning (advanced)

Defaults are solid for most Jira instances — only change these if you've
analysed retrieval quality and want to tune it.

| Variable | Default | What it does |
|---|---|---|
| `CHUNK_DESCRIPTION_MAX_TOKENS` | `500` | Max tokens per description chunk. |
| `CHUNK_DESCRIPTION_OVERLAP_TOKENS` | `50` | Overlap between adjacent description chunks. |
| `CHUNK_COMMENT_GROUP_SIZE` | `3` | Max short comments grouped into one chunk. |
| `CHUNK_ATTACHMENT_MAX_TOKENS` | `500` | Max tokens per attachment chunk. |
| `CHUNK_CONFLUENCE_MAX_TOKENS` | `600` | Max tokens per Confluence chunk. |

Tokens are approximated as `chars / 4`. Not strictly accurate but close
enough for budget enforcement.

---

## Retrieval defaults

| Variable | Default | What it does |
|---|---|---|
| `RETRIEVAL_DEFAULT_TOP_K` | `8` | Result count when the caller doesn't specify `topK`. |
| `RETRIEVAL_MAX_TOP_K` | `25` | Hard cap to prevent absurdly large requests. |

At retrieval time you can also pass `source` on the request body:

- `"jira"` — queries the Jira vector collection (default when Jira is enabled).
- `"github"` — queries the GitHub vector collection.
- `"both"` — splits `topK` between both collections, runs the searches
  in parallel, and returns the best combined results sorted by score.
  Each result is tagged with its `source` and, for GitHub, its
  `entityType` (`commit`, `pullRequest`, or `issue`).

---

## Chat feature (extension + Lambda /chat)

These variables are consumed by the chat handler at
`src/handler/chat.handler` and tune the multi-query RAG fan-out. They
have safe defaults — leave them unset unless you are tuning cost or
quality. See [code-chat-runbook.md](code-chat-runbook.md) for how to
turn the chat feature on, and [code-chat.md](code-chat.md) for the wire
contract.

| Variable | Default | What it does |
|---|---|---|
| `CHAT_PER_VECTOR_TOP_K` | `3` | Per-query topK in the multi-query fan-out. The Lambda runs `1 + commitCount` separate vector queries (the user question plus each commit subject) and pulls this many hits from each. Total Atlas hits per request ≈ `CHAT_PER_VECTOR_TOP_K * (1 + commitCount)`. |
| `CHAT_MERGED_TOP_N` | `12` | Cap on the merged, de-duplicated hit list passed to the LLM after combining all per-query results. |
| `CHAT_MAX_LOCAL_COMMITS` | `50` | Defensive cap on how many local commits a single chat request may include. Protects the Lambda from oversized payloads. |

The chat-completion model is configured via `OPENAI_CHAT_MODEL` in the
[OpenAI](#openai-secret) section above.

---

## Local git agent

These variables are read **only** by `npm run agent` (i.e. the Node
process started by `node src/cli/runner.js agent`). The Lambda ignores
them. The agent is the local-only piece described in
[code-chat-runbook.md](code-chat-runbook.md#step-2--run-the-local-git-agent).

| Variable | Default | What it does |
|---|---|---|
| `AGENT_PORT` | `8787` | Port the agent listens on (loopback only). If you change this, also update `intentera.agentUrl` in your IDE settings to match. Must be 1–65535. |
| `AGENT_ALLOWED_PROJECT_ROOTS` | *(empty)* | Optional safety allowlist. Comma-separated absolute path prefixes; the agent will reject any `projectPath` that does not start with one of these. Empty = any absolute path containing a `.git/` directory is acceptable. |

---

## What counts as "secret"

Everything labelled SECRET above should be stored in AWS Secrets Manager
(in production) or `.env` (locally). Keep these OUT of:

- Git commits
- CI logs
- Bug reports / Slack messages
- Screenshots in public docs

Everything else can live in plain Lambda env vars or committed defaults.

---

## Examples

### Minimal `.env` for local development

```
JIRA_BASE_URL=https://acme.atlassian.net
JIRA_EMAIL=me@acme.com
JIRA_API_TOKEN=ATATT3xFfG...
JIRA_PROJECT_KEYS=PROJ

MONGODB_URI=mongodb+srv://intentera:PASS@cluster.mongodb.net/?retryWrites=true
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
```

### Minimal Lambda env vars (with Secrets Manager)

```
USE_SECRETS_MANAGER=true
SECRETS_MANAGER_SECRET_ID=intentera/rag/prod
AWS_REGION=us-east-1
LOG_LEVEL=info
```

Everything else comes from the secret JSON — see
[`examples/secrets-manager-payload.json`](examples/secrets-manager-payload.json).
