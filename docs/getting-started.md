# Getting Started (Beginner-Friendly, End-to-End)

This guide walks you from **"I just cloned the repo"** to **"I successfully
ran a retrieval query"**. No prior AWS experience needed.

> Estimated time: 45–90 minutes (most of it is waiting for AWS / Atlas
> resources to provision).

---

## What you will end up with

By the end of this guide you will have:

- The project installed locally and running via a CLI
- A MongoDB Atlas cluster with a Vector Search index
- A Redis instance (local for now)
- Jira + (optionally) Confluence API tokens
- An OpenAI API key
- A `.env` file filled in, and your first successful incremental sync + retrieval query

Deployment to AWS Lambda is a **separate** follow-up step — see
[aws-deployment.md](aws-deployment.md) once local dev is working.

---

## 1. Prerequisites (what you need installed)

Before anything else, check you have these on your machine. Open a terminal
and run each command.

| Tool | Minimum version | How to check | Install if missing |
|---|---|---|---|
| Node.js | 18.x or newer | `node --version` | [nodejs.org](https://nodejs.org/) (pick the LTS build) |
| npm | 9.x or newer | `npm --version` | Comes bundled with Node.js |
| git | any recent | `git --version` | [git-scm.com](https://git-scm.com/) |
| Docker *(optional)* | any recent | `docker --version` | [docker.com](https://www.docker.com/) — used here only to run Redis locally |

> **Tip:** If `node --version` prints something older than `v18.0.0`, upgrade.
> The project uses modern JavaScript features (async iterators, optional
> chaining) that older Node versions do not fully support.

---

## 2. External accounts you will need

You don't need to set these all up right now — each has its own dedicated
walkthrough below. Here's the at-a-glance list so you know what is coming:

| Account / service | Free tier? | Used for |
|---|---|---|
| **AWS account** | Yes (12-month free tier) | Running the Lambdas, Secrets Manager, EventBridge, API Gateway |
| **MongoDB Atlas** | Yes (M0 free, but **vector search needs M10+**) | Storing embeddings + doing `$vectorSearch` |
| **Redis** | Run it locally for free; managed options include Upstash (free tier) and AWS ElastiCache | Sync checkpoint state |
| **Atlassian Jira** | Yes (if you already have a Jira Cloud account) | Source of ticket data (optional — set `JIRA_ENABLED=false` to skip) |
| **Atlassian Confluence** | Yes (same Atlassian account) | Linked knowledge pages (optional) |
| **GitHub** | Yes | Second RAG source — commits, pull requests, issues (optional — enable with `GITHUB_ENABLED=true`) |
| **OpenAI** | Pay-as-you-go (a few cents for testing) | Text embeddings |

> **Heads-up about MongoDB Atlas:** the free M0 tier does **not** support
> Vector Search. To run this project end-to-end you need at least an **M10**
> cluster (the lowest paid tier). See
> [mongodb-atlas-setup.md](mongodb-atlas-setup.md).

---

## 3. The 10-minute overview (what actually happens)

Before you dive in, here's the 30-second mental model:

1. Jira changes (new tickets, comments, attachments, Confluence links).
2. Our **ingestion Lambda** wakes up every X minutes (EventBridge schedule),
   asks Jira "what changed since last time?", processes each ticket
   (normalise → chunk → embed with OpenAI → write to MongoDB Atlas).
3. It keeps a tiny "when did I last run?" checkpoint in **Redis**.
4. Separately, a **retrieval Lambda** is fronted by API Gateway. When you
   POST a query, it embeds the query, searches MongoDB, and returns the top
   matching ticket chunks.

Locally we don't use EventBridge or API Gateway — we use the CLI runner
(`src/cli/runner.js`) to simulate both invocations. The underlying code is
identical.

---

## 4. Set up each external service (step-by-step)

Do these in order. Each step links to a detailed guide.

### 4.1. MongoDB Atlas (most important — start this first because it takes longest)

Follow **[mongodb-atlas-setup.md](mongodb-atlas-setup.md)**. You will end up
with:

- A connection string (looks like `mongodb+srv://USER:PASS@cluster.mongodb.net/...`)
- A database name (e.g. `intentera`)
- A collection name (e.g. `rag_chunks`)
- A Vector Search index named `vector_index`

Keep these values handy — you'll paste them into `.env` shortly.

### 4.2. Redis

Follow **[redis-setup.md](redis-setup.md)**. The quickest option for local
development is Docker:

```bash
docker run -d --name intentera-redis -p 6379:6379 redis:7
```

This gives you a connection URL of `redis://localhost:6379`.

### 4.3. Jira (+ Confluence)

Follow **[jira-confluence-setup.md](jira-confluence-setup.md)**. You will end
up with:

- Your Jira base URL (e.g. `https://your-company.atlassian.net`)
- Your Atlassian email
- An API token (a long string starting with `ATATT...`)

The same token typically works for both Jira and Confluence.

### 4.4. GitHub *(optional second RAG source)*

If you also want to index a GitHub repository, follow
**[github-setup.md](github-setup.md)**. You will end up with:

- A classic Personal Access Token (starts with `ghp_...`)
- The owner/name of the single repo you want to index
- A second Atlas collection + vector index for GitHub chunks

You can skip this step and enable it later — Jira-only deployments work
out of the box with `GITHUB_ENABLED=false`.

### 4.5. OpenAI

Follow **[openai-setup.md](openai-setup.md)**. You will end up with:

- An API key (starts with `sk-...`)
- A chosen embedding model (default: `text-embedding-3-small`)

### 4.6. AWS Secrets Manager *(skip if you are only running locally for now)*

Follow **[secrets-manager-setup.md](secrets-manager-setup.md)** only when you
deploy to AWS. For local development the `.env` file is enough.

---

## 5. Clone and install the project

```bash
git clone https://github.com/Aarya5122/IntentEra.git
cd IntentEra
npm install
```

The install pulls down Node libraries like `mongodb`, `ioredis`, `openai`,
`pdf-parse`, `mammoth`, `cheerio`, and the AWS SDK. Expect it to take 30–60
seconds.

You should see `added NNN packages in XYs` and no red "ERR!" lines. A few
yellow "deprecated" warnings are normal and safe to ignore.

---

## 6. Create your `.env` file

`.env.example` is a template. Copy it and fill in the real values you
collected above.

```bash
cp .env.example .env
```

Open `.env` in your editor and paste in:

- `MONGODB_URI=` *(from step 4.1)*
- `REDIS_URL=redis://localhost:6379` *(from step 4.2)*
- `JIRA_BASE_URL=`, `JIRA_EMAIL=`, `JIRA_API_TOKEN=` *(from step 4.3)*
- `CONFLUENCE_*` *(optional — if left blank, the Jira credentials are reused)*
- `OPENAI_API_KEY=` *(from step 4.4)*
- `JIRA_PROJECT_KEYS=PROJ` *(replace `PROJ` with the Jira project key you want
  to index — for example `ENG` or `SUP`)*

For a deeper explanation of every variable, see
[configuration-reference.md](configuration-reference.md).

> **Security reminder:** `.env` is already listed in `.gitignore` so it
> won't be committed. Never paste real secrets into a public chat, bug
> report, or pull request.

---

## 7. Run your first full import

Run this from the project root:

```bash
node src/cli/runner.js full
```

What this does, under the hood:

1. Loads `.env` (via the `dotenv` library).
2. Connects to MongoDB, Redis, Jira, Confluence, and OpenAI.
3. Fetches every Jira ticket in the configured scope.
4. Normalises → chunks → embeds → writes to MongoDB.
5. Writes a success checkpoint to Redis.

### What you should see

A stream of JSON log lines that looks similar to this (trimmed for space):

```json
{"level":"info","msg":"ingestion invocation received","time":"2026-04-19T19:00:00Z","mode":"full"}
{"level":"info","msg":"starting jira ticket stream","time":"...","jql":"project in (\"PROJ\") ORDER BY updated ASC"}
{"level":"info","msg":"ticket indexed","time":"...","issueKey":"PROJ-1","chunks":4,"replacedOld":0}
{"level":"info","msg":"ticket indexed","time":"...","issueKey":"PROJ-2","chunks":6,"replacedOld":0}
...
{"level":"info","msg":"sync completed successfully","mode":"full","ticketsProcessed":42,"chunksInserted":213,"chunksDeleted":0}
```

The final line (a JSON summary) will also be printed to stdout because the
CLI prints the handler's return value. It looks like:

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

### If it fails

Jump to
[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md). Common
first-time issues:

- `Missing required env var` — you missed a field in `.env`.
- `MongoServerSelectionError` — MongoDB Atlas IP allowlist blocks your home
  IP. Add your IP in Atlas → Network Access.
- `401 Unauthorized` (Jira) — bad API token or wrong email.
- `vector_index not found` — you skipped creating the Atlas Vector Search index.

---

## 8. Run an incremental sync

After the full import succeeds, run:

```bash
node src/cli/runner.js incremental
```

If nothing has changed in Jira in the last hour, the output shows
`ticketsProcessed: 0` and that's perfect — it means the checkpoint system
works.

If you update a ticket in Jira and run incremental again, you should see
exactly that ticket appear in the log.

---

## 9. Run your first retrieval query

```bash
node src/cli/runner.js query "How did we fix the login bug?" --topK 5
```

You should get a JSON response like:

```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json" },
  "body": {
    "query": "How did we fix the login bug?",
    "retrievedAt": "2026-04-19T19:05:00Z",
    "topK": 5,
    "appliedFilters": {},
    "results": [
      { "chunkId": "...", "ticketKey": "PROJ-17", "sourceType": "comments", "score": 0.843, "text": "We fixed the login bug by ...", "metadata": { ... } },
      ...
    ],
    "context": "--- [1] PROJ-17 (comments) score=0.843 ---\nWe fixed..."
  }
}
```

The `context` field is specifically formatted so you can paste it straight
into an LLM prompt.

---

## 10. Inspect the Redis sync state

```bash
node src/cli/runner.js state
```

You'll see a pretty-printed version of the checkpoint shown in
[`examples/redis-state.json`](examples/redis-state.json). If
`"status": "idle"` and `"failureReason": null`, your system is healthy.

---

## 11. What's next?

- Read [local-development.md](local-development.md) for the full CLI
  reference and debugging tips.
- Read [aws-deployment.md](aws-deployment.md) when you are ready to deploy
  the two Lambdas to production.
- Read [architecture.md](architecture.md) to understand the "why" behind each
  design decision.

Happy indexing!
