# IntentEra Jira RAG — Architecture & Operations Guide

This document complements the code with a deeper narrative of **why** each
piece exists, how they interact, and how to operate the system.

---

## 1. Overall system architecture

Two Lambdas share a common set of infrastructure (MongoDB Atlas Vector Search,
Redis, OpenAI, AWS Secrets Manager):

- **Ingestion Lambda** — `src/handler/ingest.js`
  - Triggered by an EventBridge schedule (incremental) OR manual invocation
    with `{ "mode": "full" }` (full import).
  - Reads Jira tickets + linked Confluence + attachments, normalises them,
    chunks them, embeds them, and upserts into MongoDB Atlas.
  - Records sync state in Redis.

- **Retrieval Lambda** — `src/handler/retrieve.js`
  - Fronted by API Gateway.
  - Accepts `{ query, topK, filters }`, embeds the query, runs a Mongo
    `$vectorSearch`, and returns a structured context payload.

Both Lambdas are built from the same `src/` modules and therefore share exactly
one implementation of Mongo, OpenAI, and config loading logic.

---

## 2. Lambda scheduling and execution

- **EventBridge rule** (incremental) is the recommended production trigger.
  Suggested cron: every 30 minutes. EventBridge events do not include a
  `mode` field, so the handler falls back to `SYNC_MODE` env var (default
  `incremental`).
- **Forced full import** is a one-off invocation. Any of these work:
  1. AWS Console → Test event `{ "mode": "full" }`.
  2. `aws lambda invoke --function-name intentera-ingest --payload '{"mode":"full"}' /tmp/out.json`.
  3. Local CLI: `node src/cli/runner.js full`.
- **Lambda timeout**: set to 15 minutes (maximum). Ingestion streams issues
  one at a time so it can make steady progress even with many thousands of
  tickets.
- **Lambda memory**: 1024 MB is a reasonable starting point; attachment
  parsing (especially large PDFs) is the main memory-heavy activity.
- **Retrieval Lambda** should have a lower timeout (15s is plenty) and be
  tuned for short, fast responses.

---

## 3. Full import vs incremental sync

### Full import

1. Redis state is wiped at the end of a successful run (the success writer
   replaces the whole state object).
2. JQL has no `updatedSince` clause — we fetch ALL tickets in scope.
3. For each ticket: delete existing Mongo chunks → insert fresh ones.
4. After processing, any key that was in the previous `knownTicketKeys` set
   but NOT in the newly processed set is deleted from Mongo.

### Incremental sync

1. Read Redis state → get `lastIncrementalStartAt` (fall back to
   `lastFullImportAt`).
2. Compute `effectiveStart = anchor - lookbackMinutes`.
3. JQL uses `updated >= "<effectiveStart>"`.
4. For each changed ticket: delete existing Mongo chunks → insert fresh ones.
5. Ask Jira for the full in-scope key list (skinny query). Any
   `knownTicketKey` missing from that list is considered deleted/out-of-scope.
6. On success, write the new `lastIncrementalStartAt = runStartedAt`.

### Why a lookback window?

Jira's `updatedDate` is not strictly real-time — it is updated by asynchronous
processes and can lag by a minute or more. If we used a zero-overlap window we
would occasionally miss updates that landed a few seconds after our last run
finished.

The 1-hour default is conservative. Shorten it if you run frequent incrementals
and want to minimise reprocessing; lengthen it if you observe missed updates.

### Idempotency

Because every ticket re-index does `deleteMany({ ticketKey }) → insertMany(...)`,
re-processing the same ticket multiple times (which the overlap window forces)
is completely safe:

- No duplicate chunks.
- No partial-old + partial-new state: either the old chunks are still there
  or the new ones are.

---

## 4. Redis sync state design

See [src/state/redisState.js](../src/state/redisState.js) for the schema and
helper methods.

```json
{
  "lastFullImportAt": "2026-04-19T18:00:00Z",
  "lastIncrementalStartAt": "2026-04-19T19:00:00Z",
  "lastIncrementalCompletedAt": "2026-04-19T19:03:42Z",
  "mode": "incremental",
  "status": "idle",
  "failureReason": null,
  "schemaVersion": 1,
  "knownTicketKeys": ["PROJ-1", "PROJ-2", "PROJ-3"]
}
```

Operational rules we enforce in code:

- State is written only on successful completion (`writeIncrementalSuccess` /
  `writeFullImportSuccess`).
- On error we call `markRunFailed`, which changes `status` and
  `failureReason` but DOES NOT advance time checkpoints.
- A distributed lock (`<prefix>lock`) held via Redis `SET NX EX` prevents two
  Lambdas from running at the same time. The TTL ensures a crashed holder
  cannot wedge the lock permanently.
- If Redis state is missing, corrupt, or unreadable, the orchestrator
  upgrades an incremental run to a full import so we do not lose tickets.

---

## 5. Deletion detection and stale-index cleanup

Three deletion flows:

1. **Ticket no longer in scope** — detected at the end of both full and
   incremental runs by diffing `prev.knownTicketKeys` against the
   authoritative current set.
2. **Attachments / Confluence links removed from a ticket** — handled
   implicitly by the ticket's delete-before-upsert cycle. When we re-index a
   ticket, ALL its old chunks disappear in the delete step. If an attachment
   or Confluence link is no longer referenced, its chunks simply are not
   regenerated.
3. **Comment edits / deletions** — the parent ticket's `updated` timestamp
   changes whenever a comment is added, edited, or deleted, so the ticket
   appears in the next incremental run and the full delete-before-upsert
   cycle repeats.

Because every chunk uses a deterministic `chunkId = sha256(ticketKey | sourceType | subIndex | contentFingerprint)`,
repeated re-indexing of unchanged content keeps producing the same chunk IDs,
avoiding churn.

---

## 6. Chunking methodology

Implemented in [src/chunking/chunker.js](../src/chunking/chunker.js).

| Chunk type | Strategy | Why |
|---|---|---|
| `metadata` | A single compact chunk with summary, labels, status, priority. | Answers "what is PROJ-123 about?" with one laser-focused match. |
| `description` | Paragraph-aware grouping under a token budget, small overlap. | Preserves paragraph boundaries for coherent semantics. |
| `comments` | Group up to N short comments together; long comments alone. | Short comments in isolation are noisy; grouping them retains conversational context. |
| `linkedIssues` | One per linked issue summary. | Retrieval can find "what depends on PROJ-123?" through these. |
| `attachment` | Paragraph-aware grouping per file, no overlap. | Attachments are usually self-contained documents. |
| `confluence` | Paragraph-aware grouping per page, no overlap. | Same reasoning as attachments. |

Stable chunk IDs keep the delete-before-upsert workflow safe and repeatable.

---

## 7. Attachment parsing strategy

See [src/attachments/parser.js](../src/attachments/parser.js).

- PDF: `pdf-parse` — pure JS, handles text-layer PDFs quickly. Does not OCR
  scanned images; a metadata-only chunk is produced in that case.
- DOCX: `mammoth` — clean text extraction from Word Open Office XML.
- TXT: Buffer → UTF-8 (or latin1 fallback if replacement characters appear).
- HTML: `cheerio` — strip scripts and styles, pull body text.

Failure policy: emit a placeholder chunk with `parseError` set so retrieval
can still surface "file exists but unreadable" without breaking the run.

---

## 8. Confluence ingestion strategy

See [src/confluence/client.js](../src/confluence/client.js).

- Confluence pages are discovered through Jira's REST remote-link endpoint
  (`/rest/api/3/issue/<key>/remotelink`).
- Only links whose URL matches `/pages/<id>/...` are treated as Confluence
  pages.
- We use the Confluence v2 API (`/api/v2/pages/<id>?body-format=storage`) to
  fetch page content and convert the storage XHTML to plain text via cheerio.
- Fetch failures are logged and skipped — a single dead link never aborts a
  run.

No caching is used: every indexing run performs live fetches, as required.

---

## 9. Embedding + MongoDB vector design

- Provider: OpenAI `text-embedding-3-small` by default (1536 dimensions).
- Storage: one Mongo document per chunk, `_id` = deterministic chunk hash.
- Atlas Vector Search index definition (create this in the Atlas UI):

  ```json
  {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "ticketKey" },
      { "type": "filter", "path": "projectKey" },
      { "type": "filter", "path": "sourceType" },
      { "type": "filter", "path": "metadata.labels" }
    ]
  }
  ```

  The index name must match `MONGODB_VECTOR_INDEX` (default `vector_index`).

---

## 10. Retrieval API design

See [src/handler/retrieve.js](../src/handler/retrieve.js) and
[src/retrieval/queryHandler.js](../src/retrieval/queryHandler.js).

Flow: `parse event` → `embed query` → `vector search with filters` →
`return structured context`.

Filters supported out of the box: `projectKey`, `sourceType`, `ticketKey`,
`labels`. Any combination may be supplied.

The response contains both:

- Structured `results[]` for programmatic consumption.
- A concatenated `context` string ready to paste into an LLM prompt.

---

## 11. Local CLI simulation

See [src/cli/runner.js](../src/cli/runner.js). The runner reuses the exact
handler modules the Lambdas use, guaranteeing parity between local and cloud.

Examples:

```bash
node src/cli/runner.js incremental
node src/cli/runner.js full
node src/cli/runner.js query "How did we fix the login bug?" --topK 5 --project PROJ
node src/cli/runner.js state
```

---

## 12. EventBridge example

```json
{
  "Name": "intentera-incremental-30m",
  "ScheduleExpression": "rate(30 minutes)",
  "State": "ENABLED",
  "Targets": [
    {
      "Id": "ingest-lambda",
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:intentera-ingest",
      "Input": "{}"
    }
  ]
}
```

Manual full-import invocation:

```bash
aws lambda invoke \
  --function-name intentera-ingest \
  --payload '{"mode":"full"}' \
  /tmp/out.json
```

Retrieval invocation via API Gateway (`curl` example):

```bash
curl -X POST https://api.example.com/intentera/retrieve \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "How did we fix the login bug in July?",
    "topK": 8,
    "filters": { "projectKey": "PROJ", "sourceType": ["comments","description"] }
  }'
```

---

## 13. AWS Secrets Manager example payload

Create a secret (JSON) at e.g. `intentera/rag/prod`:

```json
{
  "JIRA_BASE_URL": "https://acme.atlassian.net",
  "JIRA_EMAIL": "ingestor@acme.com",
  "JIRA_API_TOKEN": "ATATT3xFfG...",
  "OPENAI_API_KEY": "sk-...",
  "MONGODB_URI": "mongodb+srv://user:pw@cluster.mongodb.net/?retryWrites=true",
  "REDIS_URL": "rediss://:password@redis.example.com:6379",
  "CONFLUENCE_BASE_URL": "https://acme.atlassian.net/wiki"
}
```

Then set Lambda env vars:

```
USE_SECRETS_MANAGER=true
SECRETS_MANAGER_SECRET_ID=intentera/rag/prod
AWS_REGION=us-east-1
```

The loader at `config/secrets.js` merges the secret into `process.env` before
`appConfig.js` validates.

---

## 14. Tradeoffs and future improvements

- **Single-run ingestion** works up to a few thousand tickets. For very large
  orgs, fan out via SQS → per-ticket Lambda workers.
- **`text-embedding-3-small`** is cost-effective. For higher retrieval quality,
  switch to `text-embedding-3-large` (update `OPENAI_EMBEDDING_DIMENSIONS` to
  3072 and recreate the Atlas vector index).
- **Atlas Vector Search** requires M10+ clusters. A self-hosted alternative
  could be pgvector or OpenSearch.
- **Comment-edit detection** currently relies on the parent issue's `updated`
  timestamp, which Jira always bumps when comments change. Per-comment diff
  detection would require storing per-comment hashes and is only worth doing
  if rebuild cost becomes a concern.
- **Confluence TTL cache** could reduce API pressure. Out of scope for the
  current build since the requirement is strictly "live-fetch".
- **Retry budget** is currently 5 attempts / 8s cap. For very noisy networks
  you can raise `baseDelayMs` / `maxAttempts` via `withRetry` call sites.
- **Distributed locking** uses a single-key `SET NX EX`. For multi-region
  deployments, swap in Redlock.
