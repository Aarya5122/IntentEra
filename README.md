# IntentEra — Jira RAG on AWS Lambda

A production-minded, beginner-friendly JavaScript project that ingests Jira
tickets, linked Confluence pages, and attachments into a
**MongoDB Atlas Vector Search** RAG index, and exposes a retrieval API for
downstream chat/LLM systems.

Everything is built for **AWS Lambda**:

- An **ingestion Lambda** is triggered by an EventBridge schedule
  (incremental) and can be manually invoked with `{ "mode": "full" }`.
- A separate **retrieval Lambda** is fronted by API Gateway.
- A **CLI runner** simulates both locally using the same code paths.

**New to the project?** Start with the beginner-friendly guide:
**[docs/getting-started.md](docs/getting-started.md)**. It walks you from a
fresh machine to a successful retrieval query step by step.

For the deeper design writeup, see
[docs/architecture.md](docs/architecture.md). For a list of every doc
available, see [docs/README.md](docs/README.md).

---

## Quick start (local)

```bash
# 1) Install dependencies
npm install

# 2) Copy the example env and fill in real values
cp .env.example .env
$EDITOR .env

# 3) Run an incremental sync (the default command)
node src/cli/runner.js incremental

# 4) Force a full import
node src/cli/runner.js full

# 5) Ask a retrieval query
node src/cli/runner.js query "How did we fix the login bug?" \
  --topK 5 --project PROJ

# 6) Inspect the current Redis sync state
node src/cli/runner.js state
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
│   ├── confluence/client.js# Confluence REST API client (live fetch)
│   ├── attachments/parser.js# PDF/DOCX/TXT/HTML parsing
│   ├── sync/orchestrator.js# Full + incremental sync orchestration
│   ├── state/redisState.js # Redis sync state read/write
│   ├── normalization/normalizer.js # Jira raw → unified schema
│   ├── chunking/chunker.js # Section-aware chunking per source type
│   ├── embeddings/embedder.js# OpenAI embeddings with retry + batching
│   ├── vectorStore/mongoStore.js # MongoDB Atlas upsert/delete/search
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

1. **Ingestion Lambda**
   - Handler: `src/handler/ingest.handler`
   - Memory: 1024 MB recommended
   - Timeout: 15 min (maximum)
   - Env vars: see [`.env.example`](.env.example) (or set
     `USE_SECRETS_MANAGER=true` + `SECRETS_MANAGER_SECRET_ID`)
   - Trigger: EventBridge rule, e.g.
     [`docs/examples/eventbridge-rule.json`](docs/examples/eventbridge-rule.json)

2. **Retrieval Lambda**
   - Handler: `src/handler/retrieve.handler`
   - Memory: 512 MB recommended
   - Timeout: 15–30 seconds
   - Trigger: API Gateway HTTP API POST route (e.g. `POST /retrieve`).

3. **Atlas Vector Search index** — create it in the Atlas UI with the
   definition from `docs/architecture.md` §9. Name must match
   `MONGODB_VECTOR_INDEX`.

4. **IAM permissions** — each Lambda needs permission to call
   `secretsmanager:GetSecretValue` on the configured secret ARN, plus the
   usual VPC / network access for MongoDB Atlas and your Redis endpoint.

---

## How to force a full import

Any of these work:

- AWS Console: open the ingestion Lambda → Test event → payload
  `{"mode":"full"}` → Invoke.
- CLI (aws): `aws lambda invoke --function-name intentera-ingest
  --payload '{"mode":"full"}' /tmp/out.json`.
- Env flag: set `SYNC_MODE=full` on the Lambda config and invoke.
- Local CLI: `node src/cli/runner.js full`.

---

## Documentation map

Full index with descriptions: **[docs/README.md](docs/README.md)**.

Beginner-friendly walkthroughs:

- [docs/getting-started.md](docs/getting-started.md) — end-to-end first-run
  guide.
- [docs/local-development.md](docs/local-development.md) — CLI usage,
  expected output, debugging tips.
- [docs/aws-deployment.md](docs/aws-deployment.md) — Lambda packaging,
  EventBridge, API Gateway, IAM.
- [docs/configuration-reference.md](docs/configuration-reference.md) —
  every env var in plain language.
- [docs/debugging-and-troubleshooting.md](docs/debugging-and-troubleshooting.md)
  — common errors and how to fix them.

Per-service setup:

- [docs/mongodb-atlas-setup.md](docs/mongodb-atlas-setup.md)
- [docs/redis-setup.md](docs/redis-setup.md)
- [docs/jira-confluence-setup.md](docs/jira-confluence-setup.md)
- [docs/openai-setup.md](docs/openai-setup.md)
- [docs/secrets-manager-setup.md](docs/secrets-manager-setup.md)

Deeper technical reading:

- [docs/architecture.md](docs/architecture.md) — design walkthrough,
  chunking strategy, Redis state, Atlas index definition, tradeoffs.
- [docs/examples/](docs/examples/) — example EventBridge rule,
  invocation payloads, Secrets Manager JSON, Redis state shape.
- Every `.js` file in `src/` and `config/` has extensive inline comments.
