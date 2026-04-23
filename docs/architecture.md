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


| Chunk type     | Strategy                                                       | Why                                                                                  |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `metadata`     | A single compact chunk with summary, labels, status, priority. | Answers "what is PROJ-123 about?" with one laser-focused match.                      |
| `description`  | Paragraph-aware grouping under a token budget, small overlap.  | Preserves paragraph boundaries for coherent semantics.                               |
| `comments`     | Group up to N short comments together; long comments alone.    | Short comments in isolation are noisy; grouping them retains conversational context. |
| `linkedIssues` | One per linked issue summary.                                  | Retrieval can find "what depends on PROJ-123?" through these.                        |
| `attachment`   | Paragraph-aware grouping per file, no overlap.                 | Attachments are usually self-contained documents.                                    |
| `confluence`   | Paragraph-aware grouping per page, no overlap.                 | Same reasoning as attachments.                                                       |


Stable chunk IDs keep the delete-before-upsert workflow safe and repeatable.

---

## 7. Attachment parsing strategy

See [src/attachments/parser.js](../src/attachments/parser.js).

- PDF: `pdf-parse` — pure JS, handles text-layer PDFs quickly. Does not handle OCR  
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
- `**text-embedding-3-small`** is cost-effective. For higher retrieval quality,
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

---

## 15. Pipeline deep dive — artifacts, normalization, attachments, chunking, embeddings

This section is a rationale-first walkthrough of the four stages that turn raw
Jira / Confluence / GitHub data into vectors. It is written in a viva / Q&A
style so it can double as revision material. For every stage we cover
**what it does**, **why it exists**, **how it works internally**, and
**follow-up questions with ready answers**.

### 15.1 Artifacts — what actually gets indexed?

An **artifact** is any source object the pipeline can turn into embeddings.
Two families exist:

**Jira-centric (per ticket)** — assembled in a `TicketBundle`, then collapsed
into one `NormalizedTicket`:

| Artifact                      | Source                               | Chunk `sourceType` |
| ----------------------------- | ------------------------------------ | ------------------ |
| Summary + core fields         | Jira REST `/issue/{key}`             | `metadata`         |
| Description (ADF body)        | Jira REST `/issue/{key}`             | `description`      |
| Comments                      | Jira REST `/issue/{key}/comment`     | `comments`         |
| Linked issues                 | `fields.issuelinks`                  | `linkedIssues`     |
| Attachments (PDF/DOCX/TXT/HTML) | Downloaded bytes → parser          | `attachment`       |
| Linked Confluence pages       | `remotelink` → Confluence v2 API     | `confluence`       |

**GitHub-centric (per commit)** — see `src/github/commits/normalizer.js` and
`src/github/commits/chunker.js`:

| Artifact                                     | Chunk `sourceType` |
| -------------------------------------------- | ------------------ |
| Commit header (SHA, author, branches, PRs)   | `metadata`         |
| Commit message body                          | `message`          |
| Changed files list with additions/deletions  | `files`            |

**Core design principle — one contract, many sources.** Every artifact is
reshaped into the same chunk envelope `{ chunkId, text, sourceType, metadata, … }`.
Downstream code (embedder, Mongo writer, retrieval) does not know or care
whether a chunk came from a Jira comment or a Git commit.

**Likely questions**

- *Why not store one big document per ticket?* Embeddings dilute as inputs
  get longer — a vector covering summary + repro steps + 30 comments is not
  clearly "about" any one thing, so top-k retrieval returns lukewarm hits.
  Several focused chunks per ticket yield sharper cosine similarity.
- *Why is GitHub a separate pipeline?* Different identifiers (`PROJ-123` vs
  `commit:<sha>`) and different chunking needs (we deliberately skip diffs)
  but the primitives (`splitParagraphs`, `groupParagraphsIntoChunks`,
  `deterministicChunkId`) are shared.

### 15.2 Normalization — why is this stage necessary?

Implemented in `src/normalization/normalizer.js` (Jira) and
`src/github/commits/normalizer.js` (Git). It is the translation layer between
raw vendor JSON and a flat, predictable shape.

**Three problems it solves**

1. **Schema chaos.** Jira's raw JSON is deeply nested
   (`fields.assignee.displayName`, `fields.project.key`, …). Normalization
   produces a flat object with stable names so chunking and logging stay
   readable.
2. **Atlassian Document Format (ADF).** Jira Cloud returns descriptions and
   comments as a tree of typed nodes (`doc → paragraph → text`, `bulletList
   → listItem`, `heading`, `hardBreak`, `codeBlock`, …). Embeddings need
   **plain text**, so `adfToText()` recursively walks the tree:
   - `text` leaves → concatenated
   - `listItem` → prefixed with `- ` and a newline
   - `heading` → wrapped in blank lines so it becomes a paragraph boundary
   - Block nodes (paragraph, blockquote, codeBlock, lists) terminated with
     `\n` so the later paragraph splitter still works.
3. **Heterogeneous sub-sources.** Attachments (bytes → parser) and Confluence
   (remote HTTP fetch) are collapsed into fields on the same
   `NormalizedTicket`, so the chunker sees only strings.

**The normalized contract (Jira)** — every downstream module depends on this
shape and only this shape:

```text
NormalizedTicket {
  key, projectKey, summary, description, issueType, status, priority,
  assignee, reporter, labels[], createdAt, updatedAt,
  comments: NormalizedComment[],
  linkedIssues: NormalizedLinkedIssue[],
  attachments: NormalizedAttachment[],
  confluencePages: NormalizedConfluencePage[],
}
```

**Normalization for GitHub commits** — `normalizeCommit()` additionally
**derives** fields the raw API does not give directly:

- `shortSha` from `sha.slice(0,7)`.
- `messageHeadline` / `messageBody` by splitting on the first `\n` (git
  convention: headline, blank line, optional body).
- `totalAdditions` / `totalDeletions` — reduced from `files[]` so the chunker
  does not recompute them.
- `branches` — **injected by the fetcher**, because GitHub's commit-detail
  endpoint does not carry branch attribution.

**Likely questions**

- *Why is `adfToText()` recursive?* ADF is a tree of arbitrarily nested
  container nodes. Recursion lets us handle any depth without hard-coding
  every possible type; unknown block types fall through the default recursion
  path and still yield their inner text.
- *What happens on a fetch failure (e.g. Confluence page 404)?* We log and
  skip — a single dead link never aborts a ticket. For attachments, a
  placeholder chunk is still emitted with `parseError`, so retrieval can
  report "file exists but unreadable."
- *Why does normalization also parse attachments?* Because attachment bytes
  are a ticket-scoped side-channel; wiring them into the `NormalizedTicket`
  keeps the chunker's input a pure, flat, string-bearing object.

### 15.3 Attachments handling — `src/attachments/parser.js`

Attachments matter because tickets frequently carry the real design doc or
the PDF that the engineer is actually asking about. Parsing them well
directly improves retrieval recall.

**Supported formats and parsers**

| Format | Library     | Notes                                                              |
| ------ | ----------- | ------------------------------------------------------------------ |
| PDF    | `pdf-parse` | Wraps `pdfjs-dist`. Text-layer PDFs only; no OCR for scanned images. |
| DOCX   | `mammoth`   | `extractRawText()` from Word 2007+ OOXML.                          |
| HTML   | `cheerio`   | Removes `<script>/<style>/<noscript>`, reads `<body>` text.        |
| TXT    | `Buffer`    | UTF-8 by default; falls back to latin1 if replacement chars appear.|

**Type detection** — `detectType()` checks MIME type first (authoritative),
then falls back to the filename extension. The fallback also covers the
common cases where Jira reports a generic `application/octet-stream` for
genuine text files.

**Lazy loading of heavy libs.** `pdf-parse` and `mammoth` are each several
MB. They are `require`'d inside their parser functions, not at module load
time, so Lambda cold starts only pay for the libraries the current sync
actually needs.

**Encoding safety for TXT.** The parser defaults to UTF-8 but inspects the
decoded string for the Unicode replacement character `\uFFFD`. If it finds
any, the file is re-decoded as `latin1` — this salvages readable text from
legacy attachments instead of producing a noisy stream of replacement
glyphs.

**Failure policy — never throw to the orchestrator.** The parser returns a
structured object `{ text, parseError, detectedType }` for every input. The
orchestrator therefore cannot be aborted by a single malformed file. Three
failure cases are all handled the same way:

1. Download failed upstream → `parseError = 'download failed'`.
2. File type not supported → `parseError = 'unsupported format'`.
3. Library threw (corrupt PDF, password-protected DOCX, etc.) →
   `parseError = <error.message>`.

**Downstream effect in the chunker.** A failed attachment still produces a
**single placeholder chunk** so retrieval can surface "file exists but
unreadable":

```text
Attachment "design.pdf" (pdf) — text extraction not available (password protected).
```

The placeholder keeps the `attachmentId`, `fileName`, `fileType`, and
`parseError` on `metadata`, so operators can search for affected files
later.

**Why paragraph-grouping, no overlap for attachments.** Attachments are
already self-contained documents; a paragraph break tends to be a real
section boundary, not a continuation of prose. Overlap would mostly
duplicate noise.

**Likely questions**

- *Why not OCR scanned PDFs?* OCR is expensive (CPU + memory), error-prone,
  and the vast majority of Jira attachments are text-layer PDFs exported
  from tools like Confluence or Word. Scanned PDFs fall through to the
  placeholder-chunk path so they are surfaceable but not silently indexed as
  empty.
- *Why trust MIME before filename?* Some systems rename files without
  changing the content (`design.pdf` that is actually PNG bytes); MIME
  sniffed by the uploader is usually more reliable. We still fall back to
  the extension when the MIME is generic or missing.
- *What if the same attachment is re-uploaded unchanged?* The chunker sees
  identical bytes, produces identical text, and therefore produces identical
  deterministic chunk IDs — the delete-before-upsert cycle becomes a no-op.

### 15.4 Chunking — the single biggest factor for retrieval quality

Lives in `src/chunking/chunker.js` (Jira) and `src/github/commits/chunker.js`
(GitHub). Retrieval quality is dominated by chunk shape — if this stage is
wrong, no amount of good embeddings will rescue you.

**Anti-patterns we explicitly avoid**

- Naive fixed-character splits that chop mid-sentence and mix unrelated
  content, which hurts embedding similarity.
- One giant chunk per ticket, which dilutes embeddings so the top result is
  never clearly about any one thing.

**Core primitives (shared by every pipeline)**

1. **Token approximation.** `approxTokens(s) = ceil(len(s) / 4)`. One token
   ≈ 4 characters. Deliberate trade-off: avoids pulling in `tiktoken`
   (heavy, native bindings), accurate enough to enforce budgets, not to
   report exact token counts.
2. **Paragraph splitting.** `splitParagraphs(text)` splits on runs of two or
   more newlines (`/\n{2,}/`). This is why `adfToText()` carefully emits
   `\n` after block-level nodes — the splitter depends on that contract.
3. **Paragraph grouping with overlap.** `groupParagraphsIntoChunks()` is the
   workhorse:
   1. Maintain a buffer of paragraphs.
   2. If adding the next paragraph would exceed `maxTokens`, flush the
      buffer as one chunk.
   3. On flush, retain the last `overlapTokens` worth of characters from the
      emitted chunk as the seed for the next buffer — this is the overlap.
   4. If a single paragraph is itself larger than the budget, hard-split it
      on the character budget (`clampTokens`) so no chunk ever exceeds the
      cap.

This gives three guarantees: paragraph boundaries respected where possible,
no chunk exceeds the token cap, concepts that span paragraph boundaries are
still discoverable via the overlap.

**Jira chunk recipes** (budgets come from `ChunkingConfig` in
`config/appConfig.js`):

| Chunk type     | Strategy                                                 | Overlap?    |
| -------------- | -------------------------------------------------------- | ----------- |
| `metadata`     | Single compact chunk: summary, status, priority, etc.    | N/A (single)|
| `description`  | Paragraph-grouped under `descriptionMaxTokens`.          | Small       |
| `comments`     | Windows of up to `commentGroupSize` comments; long solo. | N/A         |
| `linkedIssues` | One chunk per linked issue, relationship included.       | N/A         |
| `attachment`   | Paragraph-grouped per file.                              | None        |
| `confluence`   | Paragraph-grouped per page, prefixed with page title.    | None        |

**GitHub chunk recipes** — and the interesting decision not to embed diffs:

- Diffs are dominated by whitespace, generated files, and lockfiles that
  produce noisy, low-signal embeddings.
- Real user questions ("who fixed the login bug?", "when did SSO land?")
  are answered by messages + file paths, not patch lines.
- File paths preserved as `metadata.filePaths` keep "touched-this-area"
  lookups at zero embedding cost.

So for each commit the chunker emits:

1. One `metadata` chunk (SHA, author, branches, PRs, file count,
   `+additions/-deletions`).
2. Zero or more `message` chunks — only when the commit message has a body
   beyond the headline. The headline is already in the metadata chunk, so
   body-less commits skip this entirely.
3. One (or more, if huge) `files` chunk — a markdown-style list of
   `<status>: <path> (+N/-M)` for every changed file.

**Deterministic chunk IDs**

```text
chunkId = sha256(ticketKey | sourceType | subIndex | chunk-text).slice(0, 32)
```

- Stable across runs if the input is unchanged → re-indexing is a no-op.
- Changes if content changes → old chunk disappears, new one takes its
  place.
- This is what makes the delete-before-upsert workflow idempotent (§5, §6).

**Cross-source collision safety.** Jira keys look like `PROJ-123`; commit
entities use `commit:<sha>`. The GitHub chunker feeds `entityKey` into the
same `deterministicChunkId()` helper but prefixes `sourceType` with
`github:`. Result: a Jira chunk and a commit chunk can never collide on
`_id`.

**Likely questions**

- *Why is the overlap measured in tokens if you approximate tokens with
  chars?* The overlap is applied by slicing characters
  (`tail.slice(-Math.floor(overlapTokens / TOKENS_PER_CHAR))`). The
  approximation is consistent end-to-end, so the budget math stays
  internally correct.
- *What if a single paragraph is huge (e.g. stack trace)?* The grouper
  falls back to `clampTokens` which hard-splits on the character budget.
  You lose paragraph semantics only for that one outsized unit.
- *Why group comments into windows of N?* Short comments ("+1", "fixed in
  main") are nearly worthless in isolation; grouping them with their
  neighbours preserves the thread's conversational context while keeping
  chunks small enough to embed sharply.
- *Why no overlap for attachments or Confluence?* They are self-contained
  documents; paragraph breaks are real section boundaries. Overlap would
  mostly produce duplicated noise.
- *How do you prove chunking is idempotent?* Re-run with identical input →
  `deterministicChunkId` produces identical IDs → delete-before-upsert
  replaces each chunk with a byte-identical one → Mongo sees a no-op.

### 15.5 Embeddings — `src/embeddings/embedder.js`

A thin wrapper over `openai.embeddings.create()` that:

- Accepts one string (`embedQuery`) for the retrieval Lambda.
- Accepts many strings (`embedMany`) for the ingest Lambda, with batching.
- Returns vectors in input order (the OpenAI API guarantees this, and we
  rely on it to zip back with chunks).

**Key configuration**

- **Model:** `text-embedding-3-small` (default) → 1536 dimensions,
  ~$0.02 / 1 M tokens.
- **Dimensions:** passed explicitly on every call so output matches the
  Atlas Vector Search index. (v3 embedding models support Matryoshka
  dimensionality reduction — omitting the parameter yields the model
  default; pinning it prevents silent mismatches after a config change.)
- **Batch size:** 64 strings per request (configurable via
  `openai.batchSize`). Balances throughput, per-request payload size, and
  OpenAI rate-limit friendliness.

**Input safety**

- Every input is truncated to `MAX_INPUT_CHARS = 8000` (≈ 2000 tokens)
  before sending. `text-embedding-3-small` accepts up to 8192 input
  tokens, so this is a conservative defensive cap against pathological
  chunks. Chunk budgets are already well below this, so truncation is
  effectively a safety net.

**Batching loop — order preservation**

- We pre-allocate `out = new Array(texts.length)` and write each vector by
  absolute index (`out[start + i] = item.embedding`). Off-by-one errors
  are therefore structurally impossible even if the API returned batches
  out of order (which it does not).
- `withRetry` wraps the HTTP call, so 429/5xx transients are retried with
  exponential backoff (retry budget: 5 attempts, 8 s cap — see §14).

**How vectors plug into MongoDB Atlas** (see also §9)

- Each chunk becomes one Mongo document with `_id = chunkId`,
  `embedding = float[1536]`, and filter fields (`ticketKey`, `projectKey`,
  `sourceType`, `metadata.labels`, …).
- Atlas Vector Search index uses **cosine** similarity. OpenAI embeddings
  are unit-normalised, so cosine ≡ dot product — the fastest case for
  Atlas to compute.

**Swap-friendliness.** Provider coupling is confined to this one file plus
the index dimensionality. Migrating to another provider changes only the
class body and `numDimensions` in the Atlas index — nothing upstream
(chunker, normalizer, handlers) needs to know.

**Likely questions**

- *Why cosine and not Euclidean?* For text embeddings magnitude carries
  little semantic signal; direction does. Cosine ignores magnitude. OpenAI
  vectors are also unit-normalised so cosine = dot product, which is
  efficient.
- *Why batch size 64?* Empirically the sweet spot: large enough to
  amortise HTTP overhead, small enough that a single failure only costs
  64 re-embeds on retry, and stays well under OpenAI's per-request input
  cap.
- *What if OpenAI returns fewer vectors than inputs?* It does not — the
  API contract guarantees one vector per input in input order. The
  index-based assignment in the batching loop makes mismatches impossible
  anyway.
- *Rough cost for a realistic org?* 5000 tickets × ~6 chunks/ticket ×
  ~400 tokens/chunk ≈ 12 M tokens × $0.02 / 1 M ≈ **$0.24** for a full
  re-index. Incremental cost is a tiny fraction of that.
- *How do you upgrade to `text-embedding-3-large`?* Set
  `OPENAI_EMBEDDING_MODEL=text-embedding-3-large` and
  `OPENAI_EMBEDDING_DIMENSIONS=3072`, recreate the Atlas vector index with
  `numDimensions: 3072`, and run a full import. Old chunks are overwritten
  by the delete-before-upsert cycle.

### 15.6 End-to-end walkthrough (one ticket)

Imagine `PROJ-123` shows up in an incremental sync because a comment was
just added.

1. **Fetcher** pulls the issue, its comments, its remote links, and its
   attachment bytes into a `TicketBundle`.
2. **Normalizer** converts ADF → text for description & comments, runs the
   attachment parser for each binary, fetches any Confluence pages, and
   emits one flat `NormalizedTicket`.
3. **Chunker** produces roughly:
   - 1 × `metadata` chunk
   - 1–3 × `description` chunks (paragraph-grouped, small overlap)
   - 0–N × `comments` chunks (windows of `commentGroupSize` or solo for
     long ones)
   - 1 chunk per linked issue
   - 1 or more chunks per attachment (or a placeholder on parse failure)
   - 1 or more chunks per Confluence page
   Each chunk carries a deterministic `chunkId`.
4. **Embedder** batches all chunk texts into OpenAI calls of up to 64 and
   returns 1536-dim vectors in the same order.
5. **Mongo writer** does `deleteMany({ ticketKey: 'PROJ-123' })` then
   `insertMany(chunks)`. Idempotent, safe to repeat.
6. **Retrieval** later embeds the user's query, runs `$vectorSearch` with
   optional `filter` predicates, and returns both a structured list and a
   concatenated context string.

### 15.7 One-line summary

> The pipeline is four decoupled stages — fetch → normalize → chunk →
> embed — joined only by two stable contracts: a flat `Normalized*` object
> between stages 1–2, and a uniform `Chunk` object between stages 3–4.
> That is why GitHub support could be added in parallel without touching
> the Jira code, and why swapping embedding providers is a one-file change.

