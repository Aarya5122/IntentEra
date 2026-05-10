# Code chat (VS Code / Cursor extension)

IntentEra ships a **chat panel** for VS Code and Cursor that answers
**"why is this code the way it is?"** for a file or selected line range,
backed by:

1. **Local git history** for the attached file/range, pulled from your
   working tree on disk.
2. **The team's Jira tickets and GitHub PRs/issues**, retrieved from the
   existing IntentEra MongoDB Atlas Vector Search RAG.
3. **An OpenAI chat completion** that fuses the two and produces a
   non-technical "WHY" paragraph plus a grounded list of cited commits,
   tickets, and PRs.

This document describes the architecture, the three pieces you must run,
and the privacy implications.

> **Looking for the run guide?** The action-oriented "how do I turn this
> on" three-step runbook is [code-chat-runbook.md](code-chat-runbook.md).
> This document is the reference / design doc.

---

## Already running the older Jira/GitHub flow?

If you already have IntentEra ingestion + retrieval running and are just
adding the chat feature on top, **none of the older code paths change**.
Specifically:

- The ingestion Lambda (`src/handler/ingest.handler`) and the retrieval
  Lambda (`src/handler/retrieve.handler`) are unchanged in behaviour.
- The CLI commands `npm run cli`, `npm run cli:full`,
  `npm run cli:incremental`, `npm run cli:query`, and `npm start` work
  exactly as documented in [local-development.md](local-development.md).
- The `agent` script in [package.json](../package.json) is the only new
  entry point; existing scripts are untouched.
- The new env vars in [.env.example](../.env.example) are **purely
  additive** with safe defaults:
  - `OPENAI_CHAT_MODEL` (defaults to `gpt-4o-mini`)
  - `CHAT_PER_VECTOR_TOP_K` / `CHAT_MERGED_TOP_N` /
    `CHAT_MAX_LOCAL_COMMITS`
  - `AGENT_PORT` / `AGENT_ALLOWED_PROJECT_ROOTS` (read only by
    `npm run agent`)
- The `chat` block on the `appConfig` object (see
  [config/appConfig.js](../config/appConfig.js)) is read only by the
  chat handler and the local agent. The ingest and retrieve code paths
  do not touch it.

In short: leave every new variable unset and the older Jira/GitHub
ingest+retrieve pipeline runs identically to before. To actually turn
the chat feature **on**, follow
[code-chat-runbook.md](code-chat-runbook.md).

---

## Architecture at a glance

```
+------------------------+         +-------------------------+         +------------------------+
| VS Code / Cursor       |  POST   | Local git agent         |         | AWS Lambda  /chat      |
| extension webview      |  /git/  | (npm run agent)         |         | (src/handler/chat.js)  |
| (extension/)           |  history| 127.0.0.1:8787          |         | + Mongo Atlas + OpenAI |
|                        |-------->| reads your local clone  |         |                        |
|                        |<--------|   commits[] + skipped[] |         |                        |
|                        |                                              |                        |
|                        |  POST /chat (question + commits[] + atts[])  |                        |
|                        |--------------------------------------------> |                        |
|                        |  answer + citations (commits/tickets/PRs)    |                        |
|                        |<-------------------------------------------- |                        |
+------------------------+                                              +------------------------+
```

Three boxes, three deploys:

- **Lambda `/chat` handler** — already in this repo; deploy alongside the
  existing ingest + retrieve Lambdas.
- **Local git agent** — a tiny Node/Express server you run on the same
  machine as VS Code/Cursor, with `npm run agent`. It is the only thing
  that touches your filesystem; it never makes outbound calls.
- **Extension** — installable VSIX built from `extension/` (see
  [extension/README.md](../extension/README.md)).

---

## Wire formats

### Local git agent

```http
POST http://127.0.0.1:8787/git/history
Content-Type: application/json

{
  "projectPath": "/Users/me/code/my-app",
  "attachments": [
    { "file": "src/server/auth.ts", "range": [42, 80] },
    { "file": "README.md" }
  ]
}
```

Response:

```json
{
  "projectPath": "/Users/me/code/my-app",
  "commits": [
    {
      "sha": "abc123…",
      "shortSha": "abc123",
      "author": { "name": "Jane", "email": "jane@example.com" },
      "date":   "2024-09-12T11:05:00+00:00",
      "subject": "fix(auth): retry token refresh on 401",
      "body":    "We saw the SSO provider return 401 after…",
      "filesChanged": ["src/server/auth.ts"],
      "parentShas":   ["…"],
      "jiraKeys":     ["PROJ-123"]
    }
  ],
  "skipped": []
}
```

There's also `GET /healthz` for the extension's liveness banner.

### Lambda `/chat`

```http
POST https://<api-gw>/chat
x-api-key: <optional>
Content-Type: application/json

{
  "question":   "Why are we doing the retry like this?",
  "commits":    [ /* exactly what the agent returned */ ],
  "attachments":[ { "file": "src/server/auth.ts", "range": [42, 80], "content": "…" } ],
  "history":    [ { "role": "user|assistant", "content": "…" } ]
}
```

Response:

```json
{
  "answer": "In plain English: …",
  "citations": {
    "commits": [{ "sha", "shortSha", "subject", "reasonPlain", "jiraKeys", "filesChanged", "date", "author" }],
    "tickets": [{ "key", "summary", "status", "url", "snippet", "score", "reasonPlain" }],
    "prs":     [{ "repo", "number", "title", "url", "snippet", "score", "reasonPlain" }]
  },
  "retrieved": { "jiraCount": 5, "githubCount": 4, "localCommitCount": 8, "mergedCount": 9 },
  "usage":     { "embeddingTokens": 0, "promptTokens": 1234, "completionTokens": 312 }
}
```

The Lambda performs **multi-query RAG**: it embeds the question PLUS each
commit subject in one batch, runs `$vectorSearch` against both Jira and
GitHub stores, dedupes hits by `chunkId` keeping the max score, and passes
the merged top N to the LLM. The LLM is forced into JSON-mode and we drop
any cited SHA/key/PR that isn't in the supplied context.

---

## Setup

### 1) Deploy the Lambda

The chat handler lives at `src/handler/chat.handler` and shares the same
deployment artifact as ingest + retrieve. Trigger it with API Gateway POST
on a route like `POST /chat`. New environment variables:

| Variable                  | Default              | Notes |
|---------------------------|----------------------|-------|
| `OPENAI_CHAT_MODEL`       | `gpt-4o-mini`        | Any chat model that supports `response_format=json_object`. |
| `CHAT_PER_VECTOR_TOP_K`   | `3`                  | Per-query topK in the multi-query fan-out. |
| `CHAT_MERGED_TOP_N`       | `12`                 | Cap on merged hits passed to the LLM. |
| `CHAT_MAX_LOCAL_COMMITS`  | `50`                 | Defensive cap on commits accepted per request. |

Existing variables (`MONGODB_URI`, `OPENAI_API_KEY`, `JIRA_ENABLED`,
`GITHUB_ENABLED`, etc.) are reused. If `JIRA_ENABLED=false`, only the
GitHub leg of RAG runs (and vice versa).

### 2) Run the local git agent

In a checkout of the IntentEra repo on the developer's machine:

```bash
npm install
npm run agent
# IntentEra local git agent ready at http://127.0.0.1:8787
```

The agent:

- Binds to **127.0.0.1 only** (loopback). Not reachable off-host.
- Requires `projectPath` to be **absolute** and to contain a `.git/` dir.
- Optionally enforces an **allowlist** via `AGENT_ALLOWED_PROJECT_ROOTS`
  (comma-separated absolute prefixes).

The agent has **zero outbound dependencies** — no Mongo, no OpenAI, no
network egress. It only shells out to `git`.

### 3) Install the extension

See [extension/README.md](../extension/README.md). Quick summary:

```bash
cd extension
npm install
npm run build
# F5 in VS Code with the extension folder open to launch a Dev Host
# OR `npx vsce package` to produce a .vsix and install with
#    code --install-extension intentera-chat-0.1.0.vsix
```

In settings, set `intentera.lambdaChatUrl` to your `/chat` API Gateway URL
(and `intentera.lambdaApiKey` if you require an API key).

---

## Privacy / data flow

When the user sends a chat message:

- Selected file paths, selected line ranges, and the **content** of the
  attached selection/file are sent to the Lambda, which forwards them to
  OpenAI as part of the prompt.
- Local git commit metadata (SHA, author name/email, date, subject, body,
  filesChanged, parentShas, parsed Jira keys) is sent to the Lambda and
  forwarded to OpenAI.
- Diffs / patches are **not** included — we explicitly use
  `git log --no-patch`.

The Lambda itself talks to:

- MongoDB Atlas (vector search) — only embeddings and chunk text fields
  already indexed at ingestion time leave Atlas.
- OpenAI — embeddings + chat completion.

Nothing is persisted server-side beyond standard CloudWatch logs.

---

## Operational tips

- **No agent? No commits.** If the local agent is offline, the extension
  still calls `/chat` but with an empty `commits` array. Answers degrade to
  "based only on the question and any attached file content". The status
  banner in the panel makes this state visible.
- **No Jira/GitHub RAG?** Disable the unused source via `JIRA_ENABLED=false`
  or `GITHUB_ENABLED=false`. The chat handler skips that leg entirely.
- **Cost control.** `CHAT_PER_VECTOR_TOP_K * (1 + commitCount)` Atlas hits
  per request. Multi-query embedding is one OpenAI batch.
- **Cursor support.** The extension uses only the public VS Code extension
  API and ships as a standard `.vsix`, so the same artifact installs in
  both VS Code and Cursor.
