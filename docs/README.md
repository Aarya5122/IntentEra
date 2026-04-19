# IntentEra Documentation

Welcome. This folder is the full documentation for IntentEra — a RAG
pipeline that indexes both **Jira** and **GitHub** content on AWS
Lambda.

If you are new, the **single best place to start** is
[overview.md](overview.md). It explains in plain language what this
project does, why every piece of infrastructure exists, and how Jira
and GitHub fit into the same system.

---

## Jump to what you need

### "I just want to understand the project."

- [overview.md](overview.md) — what this does and why (15 min read).
- [architecture.md](architecture.md) — deeper design walkthrough
  (chunking, state, tradeoffs).

### "I want to set it up from scratch."

- [getting-started.md](getting-started.md) — end-to-end walkthrough
  from "just cloned" to "first retrieval query works".
- [mongodb-atlas-setup.md](mongodb-atlas-setup.md) — create the cluster
  + both Jira and GitHub vector indexes.
- [redis-setup.md](redis-setup.md) — run Redis locally and in AWS.
- [jira-confluence-setup.md](jira-confluence-setup.md) — create the
  Atlassian token.
- [github-setup.md](github-setup.md) — create the GitHub PAT + pick
  the repo to index.
- [openai-setup.md](openai-setup.md) — get an API key.
- [secrets-manager-setup.md](secrets-manager-setup.md) — stash all
  secrets in one AWS Secrets Manager secret.

### "I want to run it locally."

- [local-development.md](local-development.md) — CLI reference, Jira
  examples, GitHub examples, debugging tips.
- [configuration-reference.md](configuration-reference.md) — every
  environment variable in plain English (Jira + GitHub blocks).

### "I want to deploy it to AWS."

- [aws-deployment.md](aws-deployment.md) — Lambda packaging, dual
  EventBridge rules (one per source), API Gateway, IAM permissions.

### "I want to understand what happens when I run it."

- [execution-lifecycle.md](execution-lifecycle.md) — step-by-step
  **before / during / after** a run, covering Jira and GitHub side by
  side.

### "I just ran it — did it work?"

- [verification.md](verification.md) — concrete commands and expected
  outputs to confirm Jira ingestion, GitHub ingestion, and retrieval
  all succeeded.

### "Something went wrong."

- [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)
  — error messages indexed by the exact text you'll see, with
  dedicated sections for Jira, GitHub, multi-source retrieval,
  MongoDB, Redis, OpenAI, and AWS.

---

## Full file map

### Reading order for absolute beginners

1. [overview.md](overview.md)
2. [getting-started.md](getting-started.md)
3. [mongodb-atlas-setup.md](mongodb-atlas-setup.md)
4. [redis-setup.md](redis-setup.md)
5. [jira-confluence-setup.md](jira-confluence-setup.md) *(if using Jira)*
6. [github-setup.md](github-setup.md) *(if using GitHub)*
7. [openai-setup.md](openai-setup.md)
8. [secrets-manager-setup.md](secrets-manager-setup.md) *(AWS only)*
9. [local-development.md](local-development.md)
10. [execution-lifecycle.md](execution-lifecycle.md)
11. [verification.md](verification.md)
12. [aws-deployment.md](aws-deployment.md)
13. [configuration-reference.md](configuration-reference.md) *(as needed)*
14. [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)
    *(as needed)*
15. [architecture.md](architecture.md) *(optional deep dive)*

### By topic

**Concept / design**
- [overview.md](overview.md)
- [architecture.md](architecture.md)
- [execution-lifecycle.md](execution-lifecycle.md)

**Setup**
- [getting-started.md](getting-started.md)
- [mongodb-atlas-setup.md](mongodb-atlas-setup.md)
- [redis-setup.md](redis-setup.md)
- [jira-confluence-setup.md](jira-confluence-setup.md)
- [github-setup.md](github-setup.md)
- [openai-setup.md](openai-setup.md)
- [secrets-manager-setup.md](secrets-manager-setup.md)

**Running**
- [local-development.md](local-development.md)
- [aws-deployment.md](aws-deployment.md)

**Reference**
- [configuration-reference.md](configuration-reference.md)
- [verification.md](verification.md)
- [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)

---

## Ready-to-use JSON examples

Under [examples/](examples/):

**Jira**
- [eventbridge-rule.json](examples/eventbridge-rule.json) — schedule
  an incremental Jira sync.
- [full-import-invocation.json](examples/full-import-invocation.json) —
  Lambda payload for a forced Jira full import.
- [retrieval-request.json](examples/retrieval-request.json) — API
  Gateway-style payload for Jira retrieval.
- [redis-state.json](examples/redis-state.json) — shape of
  `intentera:sync:state:jira` after a run.

**GitHub**
- [github-eventbridge-rule.json](examples/github-eventbridge-rule.json)
  — schedule an incremental GitHub sync.
- [github-full-import-invocation.json](examples/github-full-import-invocation.json)
  — payload for a forced GitHub full import.
- [github-retrieval-request.json](examples/github-retrieval-request.json)
  — retrieval payload with GitHub filters.
- [redis-state-github.json](examples/redis-state-github.json) — shape
  of `intentera:sync:state:github` after a run.

**Shared**
- [secrets-manager-payload.json](examples/secrets-manager-payload.json)
  — AWS Secrets Manager JSON covering Jira + GitHub + shared keys.

---

## If you get stuck

1. Re-read the guide for the step you're on (links above).
2. Walk the [verification.md](verification.md) checklist — it tells you
   which check fails and points to the right fix.
3. Search [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)
   for the **exact text** of your error.

If none of those help, open an issue with:

- The command you ran (and the `--source` flag value).
- Your Node version (`node --version`).
- The last few log lines (with secrets redacted).
- Which `*_ENABLED` flags are set and what source you targeted.
