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

## MongoDB Atlas Vector Search (SECRET for URI)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `MONGODB_URI` | Yes | — | Full connection string including username/password. |
| `MONGODB_DATABASE` | No | `intentera` | Database name where chunks are stored. |
| `MONGODB_COLLECTION` | No | `rag_chunks` | Collection name. |
| `MONGODB_VECTOR_INDEX` | No | `vector_index` | Name of the Atlas Vector Search index. Must match what you created in the Atlas UI. |

---

## Redis (SECRET for password)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `REDIS_URL` | Yes | — | Full URL, e.g. `redis://localhost:6379` or `rediss://:TOKEN@host:6379`. |
| `REDIS_KEY_PREFIX` | No | `intentera:sync:` | Prefix used for the two keys IntentEra writes (`state`, `lock`). |

---

## OpenAI (SECRET)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Starts with `sk-`. |
| `OPENAI_EMBEDDING_MODEL` | No | `text-embedding-3-small` | Any OpenAI embedding model. If you change this, update the Atlas vector index's `numDimensions`. |
| `OPENAI_EMBEDDING_DIMENSIONS` | No | `1536` | Must match the model's output size AND the Atlas vector index. |
| `OPENAI_EMBEDDING_BATCH_SIZE` | No | `64` | How many texts are embedded per request. Raise if Mongo + OpenAI throughput is under-used; lower if you hit payload limits. |

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
