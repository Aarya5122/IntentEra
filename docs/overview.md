# Project Overview (Read This First)

This doc is the absolute starting point. If you have **never used RAG, AWS
Lambda, MongoDB vector search, or Jira / GitHub APIs before**, read this
page cover-to-cover — in plain English it explains:

- What this project does
- How Jira and GitHub fit into the same project
- What "full import" vs "incremental sync" means
- Why we need Redis, MongoDB Atlas, OpenAI, AWS Lambda, and Secrets Manager
- How the pieces connect

When you are done here, move on to
[getting-started.md](getting-started.md) for the hands-on walkthrough.

---

## 1. What is this project?

IntentEra is a **Retrieval-Augmented Generation (RAG) pipeline** for your
internal knowledge. In one sentence:

> It continuously copies content out of Jira and GitHub, turns that
> content into searchable vectors, and lets a chatbot (or any API
> caller) find the exact snippets that answer a natural-language
> question.

Think of it as a smart search engine tailored to your own tickets, pull
requests, issues, and commits — one that understands meaning, not just
keywords.

### The two things it does

1. **Ingestion** — a scheduled job that fetches new/changed content from
   Jira and GitHub, breaks it into small "chunks", converts each chunk
   into a vector (a list of 1536 numbers that capture meaning), and
   stores the vectors in MongoDB Atlas.
2. **Retrieval** — an HTTP endpoint that takes a natural-language
   question, converts it into the same kind of vector, and finds the
   top-N most similar chunks in MongoDB. It returns those chunks along
   with a ready-to-paste "context" string you can feed into an LLM.

A normal user flow is: your chatbot calls the retrieval endpoint first,
then concatenates its own prompt with the returned context and calls
OpenAI / Claude / etc. This is the "R" and "A" in "RAG" — the "G" for
generation is the caller's problem, not ours.

---

## 2. What does Jira ingestion cover?

IntentEra reads **Jira Cloud** via its REST API. For every ticket in
scope it captures:

- Metadata (key, summary, status, priority, labels, assignee, dates)
- Description (as Atlassian Document Format, converted to clean text)
- All comments (each comment is kept as a separate chunk group)
- Linked issues (short references, not deep copies)
- Attachment text extracted from **PDF, DOCX, TXT, HTML** files
- Linked Confluence pages (optional — the "web links" on tickets)

Jira tickets end up in the `rag_chunks` MongoDB collection.

> Tip: you can turn Jira off entirely with `JIRA_ENABLED=false` if you
> only want GitHub.

---

## 3. What does GitHub ingestion cover?

IntentEra reads a **single GitHub repository** via its REST + GraphQL
APIs. For that repo it captures three entity types:

1. **Commits** on "active" branches (branches whose tip commit is newer
   than `GITHUB_STALE_BRANCH_DAYS`). Per commit we index:
   - SHA, author, committer, date
   - Full commit message (headline + body)
   - The **list of changed file paths** (we do NOT index the raw diff —
     see the note at the end of this section)
   - Which branches the commit appears on
   - Associated PR numbers
2. **Pull Requests** — title, body, state, reviewers, labels, timestamps,
   merged status, changed-file summary, **review bodies with their
   inline comments grouped together**, conversation comments, and
   linked issue numbers.
3. **Issues** — title, body, labels, assignees, timestamps, comments,
   and linked PR numbers. (The GitHub API returns PRs through the
   issues endpoint, but we filter those out — PRs are ingested
   separately.)

GitHub entities end up in a **separate** `rag_chunks_github` collection.

> Why we don't index commit diffs: diff text is dominated by whitespace,
> lockfile noise, and generated code. Embedding it produces poor
> retrieval results ("who changed this function?" gets swamped by
> unrelated line-by-line edits) and costs far more in OpenAI tokens.
> The file-path list is kept in metadata so you can still filter by
> "touched src/auth.ts".

---

## 4. How Jira and GitHub fit into the **same** project

They share:

- The same ingestion Lambda (`src/handler/ingest.js`) — the event
  payload's `source` field selects which pipeline runs.
- The same retrieval Lambda (`src/handler/retrieve.js`) — the request
  body's `source` field is `"jira"`, `"github"`, or `"both"`.
- The same OpenAI embedding model (one vector model, two collections).
- The same Redis instance (with **per-source keys**
  `intentera:sync:state:jira` and `intentera:sync:state:github`).
- The same AWS Secrets Manager secret (all credentials in one JSON
  blob).

They do **not** share:

- Vector collections — Jira and GitHub each get their own, so you can
  have a fast index just for GitHub commits without polluting Jira
  retrieval, and vice-versa.
- Atlas vector indexes — one index per collection, each with slightly
  different filter fields.
- Sync state — each source keeps its own checkpoint so full-importing
  GitHub doesn't restart Jira.

Feature flags decide which source is on:

- `JIRA_ENABLED=true` (default) / `JIRA_ENABLED=false`
- `GITHUB_ENABLED=true` / `GITHUB_ENABLED=false` (default `false`)

At retrieval time:

- `source: "jira"` queries the Jira collection only (back-compat default
  when Jira is enabled).
- `source: "github"` queries the GitHub collection only.
- `source: "both"` queries both in parallel and returns a single ranked
  list, tagging every result with its `source` and (for GitHub)
  `entityType` (`commit` / `pullRequest` / `issue`).

---

## 5. Full import vs incremental sync

Both sources support two ingestion modes.

### Full import

"Re-read everything in scope and rebuild the index from scratch." Use
this:

- On the **first run** (there is nothing to be incremental about yet).
- When you change config that affects scope (new project keys, new
  branches included, new chunking rules).
- When you suspect the index is stale or corrupt.

What happens internally:

- All tickets / commits / PRs / issues in scope are streamed.
- For each entity: **delete** all its existing chunks, then **insert**
  fresh ones.
- After streaming finishes, any entity that was in the previous
  `knownTicketKeys` / `knownEntityIds` set but is no longer in scope
  gets deleted too (this is the "deletion sweep").
- Redis state is rewritten with a success marker and the latest
  `lastFullImportAt`.

Full imports are slower and more expensive in OpenAI cost. Typical
numbers: 2–3 seconds per Jira ticket, 1–2 seconds per GitHub entity.

### Incremental sync

"Re-read only what has changed since the last successful run." This is
the default mode and is what the EventBridge schedule fires every 30
minutes.

What happens internally:

- The orchestrator reads Redis to find `lastIncrementalStartAt`.
- It computes `since = lastIncrementalStartAt - INCREMENTAL_LOOKBACK_MINUTES`
  (a small safety overlap so late updates are not missed).
- It queries Jira / GitHub for entities updated since that timestamp.
- Each changed entity is re-chunked and re-embedded via the same
  delete-then-insert pattern (so old chunks never leak).
- Entities that disappear from scope are removed on each run.

Idempotency is critical: every chunk's Mongo `_id` is deterministic
(`sha256(source|entityKey|chunkSlot)`), so the same input always
produces the same document id. Re-running the same window is cheap —
you can safely run two incrementals back to back.

---

## 6. Why each infrastructure piece exists

### Why MongoDB Atlas Vector Search?

- We need a database that can do **vector similarity search**
  (`$vectorSearch` with cosine similarity) on thousands of 1536-float
  embeddings.
- Mongo lets us combine vector search with ordinary field filters
  (project key, repo name, branches, labels) in a single query.
- It is fully managed — we don't run the DB ourselves.
- We use **two collections** so Jira and GitHub don't fight for the same
  index.

### Why Redis?

- It holds the **sync state**: when did the last run start, when did it
  finish, what entities are currently indexed, and is a run in progress
  right now?
- The state is tiny (a single JSON blob per source) but **must be fast
  and consistent** so incremental runs can compute "changed since when?".
- Redis also holds a **distributed lock** (`intentera:sync:lock:<source>`)
  so two overlapping invocations can't trample each other.

### Why OpenAI?

- It provides the `text-embedding-3-small` model (1536 dimensions) that
  converts text into vectors.
- The same model is used on ingestion and retrieval so vectors are in
  the same space.
- You can swap it for any other embedding provider — but the Atlas
  vector index's `numDimensions` must match.

### Why AWS Lambda?

- Ingestion runs on a **schedule** (every 30 minutes), does bursty work
  (lots of API calls + embeddings), then goes idle. Lambda is billed
  per-run so we pay almost nothing during idle windows.
- Retrieval runs **per-request** from an API Gateway HTTPS endpoint.
  Again, pay-per-use is ideal.
- No server to patch, no container to manage.

### Why AWS Secrets Manager?

- The pipeline needs **many secrets** (Jira token, Confluence token,
  GitHub token, MongoDB URI, Redis URL, OpenAI key). Storing them as
  Lambda env vars exposes them in the console and in every IAM policy.
- Secrets Manager keeps them encrypted at rest, rotatable, and
  auditable. The Lambda reads one JSON blob on cold start.

### Why EventBridge?

- It's the simplest cron for AWS. One rule per source (Jira, GitHub)
  invokes the same ingestion Lambda with a different `source` payload,
  and you're done.

---

## 7. Picture of the whole thing

```
┌───────────────┐   schedule   ┌─────────────────────┐   jira/github
│ EventBridge   │─────────────▶│ ingest.handler      │───────────────┐
│ rules         │              │ (runs every ~30 min)│               │
│ one per       │              └────────┬────────────┘               │
│ source        │                       │ state + lock               │
└───────────────┘                       ▼                            │
                                 ┌─────────────┐                     │
                                 │ Redis       │                     │
                                 │ per-source  │                     │
                                 │ state/lock  │                     │
                                 └─────────────┘                     │
                                                                     │
                                  writes chunks                      ▼
                            ┌──────────────────────┐      ┌─────────────────┐
                            │ MongoDB Atlas         │◀────│ OpenAI          │
                            │ rag_chunks (Jira)     │     │ embeddings API  │
                            │ rag_chunks_github     │     └─────────────────┘
                            │ + vector indexes      │
                            └──────────┬───────────┘
                                       │ vector search
                                       ▼
┌──────────┐    HTTPS    ┌─────────────────────────┐
│ Chatbot  │────────────▶│ retrieve.handler        │
│ /LLM app │             │ (API Gateway in front)  │
└──────────┘             └─────────────────────────┘
```

Everything else in the project is infrastructure plumbing around that
picture.

---

## 8. Next steps

Pick the page that matches what you want to do right now:

| I want to… | Go to |
|---|---|
| Set up the whole thing from scratch | [getting-started.md](getting-started.md) |
| Understand what happens before/during/after each run | [execution-lifecycle.md](execution-lifecycle.md) |
| Confirm a run actually worked | [verification.md](verification.md) |
| Look up an environment variable | [configuration-reference.md](configuration-reference.md) |
| Run it on my laptop | [local-development.md](local-development.md) |
| Deploy it to AWS | [aws-deployment.md](aws-deployment.md) |
| Fix an error I just hit | [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md) |

Full index: [docs/README.md](README.md).
