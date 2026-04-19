ll the beginner-friendly setup, execution, and operational documentation has been added to the docs/ folder. Here is the complete set that was created/updated:

New documentation files in docs/:

README.md — Index of every guide, read-in-order recommendation, and "where to go when stuck" pointer.
getting-started.md — End-to-end first-run path from "nothing installed" to "successful retrieval query" (prerequisites, accounts, the 10-minute mental model, and a concrete 11-step walkthrough).
mongodb-atlas-setup.md — Step-by-step Atlas account, M10 cluster, DB user, network access, connection string, collection, and Vector Search index JSON.
redis-setup.md — Three options (Docker local, Upstash serverless, AWS ElastiCache) with verification snippets.
jira-confluence-setup.md — API token generation, base URL, scope filters, test curl/node snippets, permissions notes.
openai-setup.md — API key creation, billing caps, model choice, dimensions warning (must match Atlas index), verification snippet.
secrets-manager-setup.md — Create secret, name it, set rotation, IAM inline policy, point Lambda env vars at the secret, verification.
local-development.md — Install, pre-flight env check, full CLI command reference (incremental, full, query, state), expected output, debugging tips (per-ticket isolation, Mongo inspection, state reset).
aws-deployment.md — Zip packaging, creating both Lambdas (handler paths, memory, timeout, env vars), EventBridge schedule, API Gateway HTTP API with curl test, VPC networking notes, cost breakdown, upgrade + delete steps.
configuration-reference.md — Every environment variable explained in plain English, grouped by purpose, with defaults and "what counts as secret".
debugging-and-troubleshooting.md — Common errors indexed by exact message (401 Unauthorized, MongoServerSelectionError, ECONNREFUSED, insufficient_quota, timeouts, API Gateway 500s, retrieval-quality issues) with specific fixes, plus a "reset to clean slate" recipe.
Root README.md updated to feature the beginner-friendly path (docs/getting-started.md) prominently and to link out to the full documentation map.

Each guide is self-contained, cross-links to related guides, and is written for someone with minimal AWS or Node.js experience.



-------------


Jira RAG Lambda System - Full Build Plan

Architecture Overview

flowchart TD
    EB[EventBridge Schedule] -->|"incremental trigger"| IngestLambda
    CLI[Local CLI Runner] -->|"simulates event payload"| IngestLambda
    CLI -->|"simulates query payload"| RetrieveLambda
    APIGW[API Gateway] --> RetrieveLambda

    subgraph ingestion [Ingestion Lambda]
        IngestLambda[handler/ingest.js] --> SyncOrchestrator[sync/orchestrator.js]
        SyncOrchestrator --> JiraClient[jira/client.js]
        SyncOrchestrator --> ConfluenceClient[confluence/client.js]
        SyncOrchestrator --> AttachmentParser[attachments/parser.js]
        SyncOrchestrator --> Normalizer[normalization/normalizer.js]
        SyncOrchestrator --> Chunker[chunking/chunker.js]
        SyncOrchestrator --> Embedder[embeddings/embedder.js]
        SyncOrchestrator --> VectorStore[vectorStore/mongoStore.js]
        SyncOrchestrator --> StateManager[state/redisState.js]
    end

    subgraph retrieval [Retrieval Lambda]
        RetrieveLambda[handler/retrieve.js] --> QueryHandler[retrieval/queryHandler.js]
        QueryHandler --> Embedder2[embeddings/embedder.js]
        QueryHandler --> VectorSearch[vectorStore/mongoStore.js]
    end

    SecretsManager[AWS Secrets Manager] --> IngestLambda
    SecretsManager --> RetrieveLambda
    Redis[(Redis)] --> StateManager
    MongoDB[(MongoDB Atlas)] --> VectorStore
    Jira[Jira API] --> JiraClient
    Confluence[Confluence API] --> ConfluenceClient



1. Lambda Execution and Scheduling





Ingestion Lambda (handler/ingest.js) triggered by:





EventBridge cron (incremental mode by default)



Manual invocation with { "mode": "full" } payload for forced full import



Retrieval Lambda (handler/retrieve.js) triggered by:





API Gateway POST with { "query": "...", "filters": {} }



Mode is determined by reading event.mode → fallback to process.env.SYNC_MODE → default incremental



2. Full Import vs Incremental Sync

Full Import:





Fetch all Jira issues matching configured scope (project, type, status, labels)



For each issue: fetch comments, linked issues, attachments, Confluence refs



Normalize → chunk → embed → upsert vectors



Delete any stale vectors not present in this run (by scanning existing sourceId values)



Write fresh Redis sync state on success

Incremental Sync:





Read lastSyncStartTime from Redis



Compute effectiveStart = lastSyncStartTime - lookbackWindow (default 1 hour)



Query Jira for issues updated >= effectiveStart



For each changed issue: delete old chunks by ticketKey, re-normalize → re-chunk → re-embed → upsert



Detect deleted issues via Jira's deletedSince API or by cross-checking known keys in Redis



Write new lastSyncStartTime to Redis only on full success

Why the lookback window exists: Jira's updatedDate can lag behind real changes by minutes. The 1-hour overlap ensures we never miss an update. Idempotency (delete-before-upsert per ticket) makes duplicate processing safe.



3. Redis Sync State Design

Redis key prefix: intentera:sync:

intentera:sync:state          →  JSON object:
  {
    "lastFullImportAt": "ISO8601",
    "lastIncrementalStartAt": "ISO8601",
    "lastIncrementalCompletedAt": "ISO8601",
    "mode": "incremental" | "full",
    "status": "idle" | "running" | "failed",
    "failureReason": "...",
    "schemaVersion": 1,
    "knownTicketKeys": ["PROJ-1", "PROJ-2", ...]  // for deletion detection
  }





State is written only after successful run to prevent partial checkpoint corruption



A running status lock prevents overlapping incremental runs



Forced full import clears knownTicketKeys and rebuilds from scratch



Corrupted/missing state triggers a safe fallback to full import



4. Deletion Detection and Stale-Index Cleanup

Strategy (delete-before-upsert per ticket):





Every chunk stored in MongoDB carries metadata: { ticketKey, sourceType, chunkIndex }



A compound field chunkId is a deterministic key: MD5(ticketKey + sourceType + contentHash)



On re-indexing a ticket: deleteMany({ ticketKey }) → then upsert all new chunks



For removed tickets detected via Jira deleted-issues API (or missing from full import set): deleteMany({ ticketKey })



For removed attachments/Confluence links: tracked in normalized issue; delta computed on re-index



5. Chunking Strategy

Per-ticket chunk pipeline (no naive fixed-size splitting):







Chunk Type



Strategy



Typical Size





Ticket metadata



Single chunk: key + summary + labels + status + priority + assignee



~200 tokens





Description



Section-aware paragraph splitting; overlap 50 tokens between adjacent chunks



300–500 tokens





Comments



Group short comments into windows of ≤3; long comments split individually



200–400 tokens





Linked issues



One chunk per linked issue summary



~200 tokens





Attachments



Recursive paragraph split on extracted text; separate chunk per file



300–500 tokens





Confluence pages



Section-header-aware split; separate chunk pipeline



400–600 tokens

Stable chunk IDs: sha256(ticketKey + sourceType + subIndex + contentFingerprint) — deterministic, survives re-runs, enables exact-match deduplication.



6. Attachment Parsing







Format



Library



Tradeoff





PDF



pdf-parse



Fast, no native deps; struggles with scanned PDFs





DOCX



mammoth



Clean HTML/text output; no OLE binary support





TXT



Native fs read



Trivial





HTML



cheerio



Lightweight DOM; strips tags cleanly





Parse failure → log warning, retain attachment metadata chunk with empty text + parseError: true flag



All attachment chunks carry: { sourceType: "attachment", fileName, fileType, attachmentId, ticketKey }



7. Confluence Ingestion





Discovered via Jira issue remote links (remoteLinks REST endpoint)



Fetched live per indexing run using Confluence REST API v2



Chunked separately from ticket text using the same section-aware strategy



Metadata: { sourceType: "confluence", pageId, pageTitle, ticketKey }



Removed Confluence links: detected by diffing currentRemoteLinks vs previousRemoteLinks stored in Redis/normalized state → triggers deleteMany({ pageId, ticketKey })



Fetch failures are logged and skipped; do not fail the entire run



8. MongoDB Vector Document Structure

{
  "_id": "<chunkId>",
  "ticketKey": "PROJ-123",
  "projectKey": "PROJ",
  "sourceType": "description | comments | attachment | confluence | metadata | linkedIssues",
  "chunkIndex": 0,
  "text": "...",
  "embedding": [0.001, ...],
  "metadata": {
    "summary": "...",
    "status": "In Progress",
    "priority": "High",
    "labels": ["backend"],
    "updatedAt": "ISO8601",
    "fileName": null,
    "pageTitle": null,
    "attachmentId": null
  },
  "indexedAt": "ISO8601"
}

Atlas Vector Search index on embedding field (1536 dimensions for text-embedding-3-small).



9. Retrieval API Design





Retrieval Lambda (handler/retrieve.js) is a separate Lambda from ingestion



API Gateway POST → { query, topK, filters: { projectKey, sourceType, labels } }



Flow: embed(query) → vectorSearch(embedding, filters, topK) → assemble context payload



Response: { results: [{ chunkId, text, score, metadata }], query, retrievedAt }



Shared modules: embeddings/embedder.js, vectorStore/mongoStore.js, config/secrets.js



Project Structure

IntentEra/
├── package.json
├── .env.example
├── config/
│   ├── appConfig.js          # env-driven config with validation
│   └── secrets.js            # AWS Secrets Manager loader
├── src/
│   ├── handler/
│   │   ├── ingest.js         # Lambda entry point - ingestion
│   │   └── retrieve.js       # Lambda entry point - retrieval
│   ├── cli/
│   │   └── runner.js         # Local CLI simulator
│   ├── jira/
│   │   ├── client.js         # Jira REST API client (paginated)
│   │   └── fetcher.js        # Fetch tickets, comments, attachments, links
│   ├── confluence/
│   │   └── client.js         # Confluence REST API client
│   ├── attachments/
│   │   └── parser.js         # PDF/DOCX/TXT/HTML parsers
│   ├── sync/
│   │   └── orchestrator.js   # Full/incremental sync orchestration
│   ├── state/
│   │   └── redisState.js     # Redis sync state read/write
│   ├── normalization/
│   │   └── normalizer.js     # Normalize raw Jira → unified schema
│   ├── chunking/
│   │   └── chunker.js        # Section-aware chunking per source type
│   ├── embeddings/
│   │   └── embedder.js       # OpenAI embeddings with retry
│   ├── vectorStore/
│   │   └── mongoStore.js     # MongoDB Atlas upsert/delete/search
│   ├── retrieval/
│   │   └── queryHandler.js   # Retrieval logic module
│   └── utils/
│       ├── logger.js         # Structured logger
│       └── retry.js          # Exponential backoff retry helper
└── docs/
    └── architecture.md       # Design decisions reference



Key Dependencies





@aws-sdk/client-secrets-manager - Secrets Manager



openai - Embeddings API



mongodb - Atlas driver



ioredis - Redis client



axios - HTTP client for Jira/Confluence



pdf-parse - PDF text extraction



mammoth - DOCX text extraction



cheerio - HTML parsing



crypto (built-in) - Deterministic chunk ID hashing



dotenv - Local dev env loading



Tradeoffs and Future Improvements





Single Lambda run for all tickets: Works for moderate Jira scopes; for very large orgs (10k+ tickets), fan-out with SQS + per-ticket Lambda would be needed



OpenAI embeddings: text-embedding-3-small is cost-effective and 1536-dimensional; can swap to text-embedding-3-large for higher quality or to Cohere/local model later



MongoDB Atlas: Requires Atlas M10+ cluster for vector search; free tier is not supported



Redis lock: Simple SET NX EX lock; for true distributed safety, use Redlock



Confluence fetch: Live fetch per run adds latency; a future TTL-cached fetch layer could reduce API calls



Comment edit detection: Relies on Jira's updated timestamp on the parent issue (not per-comment); per-comment change detection would require storing comment hashes in Redis


