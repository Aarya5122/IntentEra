# IntentEra — Multi-Source RAG on AWS Lambda

A production-minded, beginner-friendly JavaScript project that ingests two
independent knowledge sources into a **MongoDB Atlas Vector Search** RAG
index, and exposes a retrieval API for downstream chat/LLM systems:

- **Jira** tickets (with linked Confluence pages and attachments).
- **GitHub** commits, pull requests, and issues from one repository.

Each source is fully optional — turn either on or off via
`JIRA_ENABLED` / `GITHUB_ENABLED`. The same ingestion Lambda handles both
pipelines (distinguished by the `source` field in the event payload), and
retrieval queries can target `jira`, `github`, or `both` in a single call.

Everything is built for **AWS Lambda**:

- An **ingestion Lambda** is triggered by EventBridge schedules —
  typically one rule per source — and can be manually invoked with
  `{ "mode": "full", "source": "jira" }` or
  `{ "mode": "full", "source": "github" }`.
- A separate **retrieval Lambda** is fronted by API Gateway and accepts a
  `source` field on the request body.
- A **CLI runner** simulates both locally using the same code paths, with
  a `--source` flag on every command.

**New to the project?** Read these three in order — they are written for
someone with no prior AWS / Node / RAG experience:

1. **[docs/overview.md](docs/overview.md)** — what this project does,
   why Jira + GitHub share the same pipeline, and why we use each piece
   of infrastructure.
2. **[docs/getting-started.md](docs/getting-started.md)** — end-to-end
   hands-on walkthrough from a fresh machine to your first successful
   retrieval query.
3. **[docs/execution-lifecycle.md](docs/execution-lifecycle.md)** —
   step-by-step explanation of what happens **before, during, and
   after** each run (Jira and GitHub side by side).

After your first run, use
**[docs/verification.md](docs/verification.md)** to confirm it worked
and **[docs/debugging-and-troubleshooting.md](docs/debugging-and-troubleshooting.md)**
when it doesn't.

For the deeper design writeup, see
[docs/architecture.md](docs/architecture.md). For a list of every doc
available (task-based navigation), see [docs/README.md](docs/README.md).

---

## Quick start (local)

```bash
# 1) Install dependencies
npm install

# 2) Copy the example env and fill in real values
cp .env.example .env
$EDITOR .env

# 3) Run an incremental sync (default source = jira)
node src/cli/runner.js incremental

# 4) Force a full import
node src/cli/runner.js full

# 5) Ask a retrieval query
node src/cli/runner.js query "How did we fix the login bug?" \
  --topK 5 --project PROJ

# 6) Inspect the current Redis sync state
node src/cli/runner.js state --source jira

# --- GitHub equivalents (if GITHUB_ENABLED=true) ---
node src/cli/runner.js full        --source github
node src/cli/runner.js incremental --source github
node src/cli/runner.js state       --source github
node src/cli/runner.js query "who reviewed the auth PR?" \
  --source github --repo acme-inc/platform

# Combined retrieval across both sources
node src/cli/runner.js query "SSO rollout timeline" --source both --topK 10
```

---

## Project structure

```
IntentEra/
├── config/
│   ├── appConfig.js        # Env-driven config with validation
│   └── secrets.js          # AWS Secrets Manager loader
├── src/
│   ├── handler/
│   │   ├── ingest.js       # Lambda entry: ingestion
│   │   └── retrieve.js     # Lambda entry: retrieval
│   ├── cli/runner.js       # Local CLI simulator
│   ├── jira/
│   │   ├── client.js       # Jira REST API client (paginated)
│   │   └── fetcher.js      # Fetch tickets, comments, attachments, links
│   ├── github/
│   │   ├── client.js       # GitHub REST + GraphQL client (PAT auth)
│   │   ├── branches.js     # List active branches (staleness cutoff)
│   │   ├── commits/{fetcher,normalizer,chunker}.js
│   │   ├── pullRequests/{fetcher,normalizer,chunker}.js
│   │   ├── issues/{fetcher,normalizer,chunker}.js
│   │   └── orchestrator.js # Full + incremental GitHub sync
│   ├── confluence/client.js# Confluence REST API client (live fetch)
│   ├── attachments/parser.js# PDF/DOCX/TXT/HTML parsing
│   ├── sync/orchestrator.js# Full + incremental Jira sync
│   ├── state/redisState.js # Redis sync state read/write
│   ├── normalization/normalizer.js # Jira raw → unified schema
│   ├── chunking/chunker.js # Section-aware Jira chunking per source type
│   ├── embeddings/embedder.js# OpenAI embeddings with retry + batching
│   ├── vectorStore/mongoStore.js # MongoDB Atlas upsert/delete/search
│   │                               # (two collections: Jira + GitHub)
│   ├── retrieval/queryHandler.js # Retrieval logic module
│   ├── utils/
│   │   ├── logger.js       # Structured JSON logger
│   │   ├── retry.js        # Exponential-backoff retry helper
│   │   └── wiring.js       # Dependency factory (shared by Lambdas + CLI)
│   └── index.js            # Convenience re-exports
└── docs/
    ├── architecture.md     # Design guide (read this!)
    └── examples/           # EventBridge, Secrets Manager, retrieval, etc.
```

---

## Deploying to AWS

You can package this project with any tooling you prefer (SAM, Serverless
Framework, CDK, raw ZIP). At a minimum you need:

1. **Ingestion Lambda** (one Lambda, both sources)
   - Handler: `src/handler/ingest.handler`
   - Memory: 1024 MB recommended
   - Timeout: 15 min (maximum)
   - Env vars: see [`.env.example`](.env.example) (or set
     `USE_SECRETS_MANAGER=true` + `SECRETS_MANAGER_SECRET_ID`)
   - Triggers: typically **two** EventBridge rules, one per source —
     [`docs/examples/eventbridge-rule.json`](docs/examples/eventbridge-rule.json)
     for Jira and
     [`docs/examples/github-eventbridge-rule.json`](docs/examples/github-eventbridge-rule.json)
     for GitHub. The `source` field on each rule's payload selects the
     pipeline.

2. **Retrieval Lambda**
   - Handler: `src/handler/retrieve.handler`
   - Memory: 512 MB recommended
   - Timeout: 15–30 seconds
   - Trigger: API Gateway HTTP API POST route (e.g. `POST /retrieve`).

3. **Atlas Vector Search indexes** — create them in the Atlas UI using
   the JSON definitions in
   [`docs/mongodb-atlas-setup.md`](docs/mongodb-atlas-setup.md). You need
   the Jira index (`MONGODB_VECTOR_INDEX`, default `vector_index`) and,
   if GitHub ingestion is enabled, the GitHub index
   (`MONGODB_GITHUB_VECTOR_INDEX`, default `vector_index_github`) on the
   separate `rag_chunks_github` collection.

4. **IAM permissions** — each Lambda needs permission to call
   `secretsmanager:GetSecretValue` on the configured secret ARN, plus the
   usual VPC / network access for MongoDB Atlas and your Redis endpoint.

---

## How to force a full import

Any of these work. The `source` field selects `jira` (default) or
`github`:

- AWS Console: open the ingestion Lambda → Test event → payload
  `{"mode":"full","source":"jira"}` or
  `{"mode":"full","source":"github"}` → Invoke.
- CLI (aws):
  `aws lambda invoke --function-name intentera-ingest \
     --payload '{"mode":"full","source":"github"}' /tmp/out.json`.
- Env flags: set `SYNC_MODE=full` and/or `SYNC_SOURCE=github` on the
  Lambda config and invoke.
- Local CLI: `node src/cli/runner.js full --source github`.

---

## Documentation map

Full index with descriptions: **[docs/README.md](docs/README.md)**.

Beginner-friendly walkthroughs:

- [docs/overview.md](docs/overview.md) — what the project does, plain
  language.
- [docs/getting-started.md](docs/getting-started.md) — end-to-end first-run
  guide.
- [docs/execution-lifecycle.md](docs/execution-lifecycle.md) — before /
  during / after every run.
- [docs/verification.md](docs/verification.md) — checklist to confirm a
  run succeeded.
- [docs/local-development.md](docs/local-development.md) — CLI usage,
  expected output, debugging tips.
- [docs/aws-deployment.md](docs/aws-deployment.md) — Lambda packaging,
  EventBridge, API Gateway, IAM.
- [docs/configuration-reference.md](docs/configuration-reference.md) —
  every env var in plain language.
- [docs/debugging-and-troubleshooting.md](docs/debugging-and-troubleshooting.md)
  — common errors and how to fix them (Jira + GitHub + multi-source).

Per-service setup:

- [docs/mongodb-atlas-setup.md](docs/mongodb-atlas-setup.md)
- [docs/redis-setup.md](docs/redis-setup.md)
- [docs/jira-confluence-setup.md](docs/jira-confluence-setup.md)
- [docs/github-setup.md](docs/github-setup.md)
- [docs/openai-setup.md](docs/openai-setup.md)
- [docs/secrets-manager-setup.md](docs/secrets-manager-setup.md)

Deeper technical reading:

- [docs/architecture.md](docs/architecture.md) — design walkthrough,
  chunking strategy, Redis state, Atlas index definition, tradeoffs.
- [docs/examples/](docs/examples/) — example EventBridge rule,
  invocation payloads, Secrets Manager JSON, Redis state shape.
- Every `.js` file in `src/` and `config/` has extensive inline comments.
