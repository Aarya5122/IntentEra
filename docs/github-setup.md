# GitHub Setup

IntentEra can ingest **one GitHub repository** as an additional RAG source,
alongside Jira. It indexes:

- **Commits** on active branches — SHA, message (headline + body), author,
  committer, date, changed file *paths* (we intentionally do NOT embed the
  raw diff text), associated PR references, and the branches the commit
  appears on.
- **Pull Requests** — number, title, body, state, author, reviewers, labels,
  timestamps, merged status, changed-file summaries, review bodies with
  inline comments grouped under their parent review, conversation comments,
  and linked issue numbers.
- **Issues** — number, title, body, labels, assignees, author, timestamps,
  comments, and linked PR numbers.

This guide walks you, as a beginner, all the way from "no token" to
"first successful GitHub ingestion run".

---

## 1. Pick the repository you want to index

IntentEra currently supports a **single repo per deployment**. Decide now:

- `GITHUB_REPO_OWNER` — the org or user name (e.g. `acme-inc`).
- `GITHUB_REPO_NAME`  — the repo name (e.g. `platform`).

Together they form the "full name" `acme-inc/platform`.

> Tip: if you want to index several repos later, the cleanest path is to run
> a separate Lambda (or a separate EventBridge target) per repo, each with
> its own `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` pair.

---

## 2. Generate a GitHub Personal Access Token (PAT)

IntentEra authenticates with a **classic PAT**. A PAT is a long string that
acts like a password but is scoped to specific permissions.

1. Open
   [github.com/settings/tokens](https://github.com/settings/tokens).
2. Click **"Generate new token" → "Generate new token (classic)"**.
3. Give it a clear **Note**, e.g. `intentera-rag-readonly`.
4. Pick an **Expiration** that matches your security policy (90 days is a
   common starting point; set a reminder to rotate it).
5. Under **Select scopes** enable only what you need:
   - `repo` if the repository is **private**. This is the smallest scope
     that covers commits, pull requests, and issues for a private repo.
   - `public_repo` if the repository is **public**.
6. Click **Generate token**.
7. **Immediately** click the copy icon and paste the value somewhere safe.
   You will never see it again.

The token looks like `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

> Fine-grained tokens or a GitHub App will work too, but for the simplest
> setup we recommend classic PAT first. The client is structured so we can
> swap in a GitHub App later without changing the rest of the code.

---

## 3. Smoke test the token with curl

Before wiring the token into IntentEra, confirm it works:

```bash
curl -sS \
  -H "Authorization: Bearer ghp_your_token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/acme-inc/platform | jq .full_name
```

You should see `"acme-inc/platform"` printed back. If you get `401` the
token is wrong or missing scopes; if you get `404` the repo name is wrong
or the token cannot see the repo.

Also check your remaining rate budget:

```bash
curl -sS \
  -H "Authorization: Bearer ghp_your_token" \
  https://api.github.com/rate_limit | jq .resources.core
```

Authenticated users get **5,000 core requests per hour** — more than
enough for incremental sync of a normal repo.

---

## 4. Decide what "active" means for your repo

To avoid indexing years of abandoned branches, IntentEra only walks
**active branches**. A branch is considered active when its tip commit is
within `GITHUB_STALE_BRANCH_DAYS` (default **90 days**). Older branches
are skipped.

- Short-lived feature branch culture → you can leave the default at 90.
- Long-lived release branches → raise it to 180 or 365.
- You can also cap the total with `GITHUB_MAX_BRANCHES` (default **200**).

These filters apply to **commit ingestion**. Pull requests and issues are
always iterated globally — their scope is the repo, not a branch.

---

## 5. Add environment variables

Copy the block below into your `.env` (for local runs) and/or into the
AWS Secrets Manager payload (for production):

```bash
# Core toggle
GITHUB_ENABLED=true

# Repo + auth
GITHUB_TOKEN=ghp_replace-with-personal-access-token
GITHUB_REPO_OWNER=acme-inc
GITHUB_REPO_NAME=platform

# Entity selection
GITHUB_INCLUDE_COMMITS=true
GITHUB_INCLUDE_PULL_REQUESTS=true
GITHUB_INCLUDE_ISSUES=true

# Branch scope (active branches only)
GITHUB_STALE_BRANCH_DAYS=90
GITHUB_MAX_BRANCHES=200

# Separate Mongo vector collection + index for GitHub chunks
MONGODB_GITHUB_COLLECTION=rag_chunks_github
MONGODB_GITHUB_VECTOR_INDEX=vector_index_github
```

If you plan to run **GitHub only** (no Jira), also set:

```bash
JIRA_ENABLED=false
SYNC_SOURCE=github
```

See [configuration-reference.md](configuration-reference.md) for every
variable (including the tuning knobs for chunk token budgets).

---

## 6. Create the second Mongo Atlas collection and index

IntentEra stores GitHub chunks in a **separate Mongo collection** from
Jira so you can query each source independently. Follow
[mongodb-atlas-setup.md](mongodb-atlas-setup.md) and, when you get to the
"create the vector index" step, repeat it for the GitHub collection too
(the file contains the exact JSON to paste for both).

---

## 7. Run your first GitHub sync locally

```bash
# Inspect the GitHub sync state (should be empty the first time).
node src/cli/runner.js state --source github

# Run a full import. Start with commits only to keep the first run short.
node src/cli/runner.js full --source github --entityTypes commits

# Later, enable everything:
node src/cli/runner.js full --source github
```

Follow-up runs can be incremental:

```bash
node src/cli/runner.js incremental --source github
```

---

## 8. Query GitHub content

```bash
# GitHub only:
node src/cli/runner.js query "What did we change in the SSO flow?" \
  --source github \
  --repo acme-inc/platform \
  --topK 5

# Filter down to a specific PR:
node src/cli/runner.js query "Who approved the change?" \
  --source github --pr 42

# Combine GitHub + Jira in a single retrieval call:
node src/cli/runner.js query "SSO rollout timeline" --source both --topK 10
```

---

## 9. Deploy to AWS

In production:

1. Put `GITHUB_TOKEN` into the same AWS Secrets Manager secret used for
   Jira (see [secrets-manager-setup.md](secrets-manager-setup.md)).
2. Keep the same ingestion Lambda — it reads the `source` field from the
   event payload.
3. Create an EventBridge rule that passes
   `{"source":"github","mode":"incremental"}` as the target input. See
   [examples/github-eventbridge-rule.json](examples/github-eventbridge-rule.json)
   for a ready-to-use rule.

Your final deployment will have **two EventBridge rules**: one invoking
the Lambda for Jira and one for GitHub.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | PAT missing or expired | Regenerate, update the secret |
| `403 rate limit` during ingestion | Exceeded 5k/hr | Wait an hour; the client automatically throttles |
| Zero branches returned | All branches older than `GITHUB_STALE_BRANCH_DAYS` | Raise the value, or run `state` to inspect |
| `GITHUB_ENABLED must be true` | Flag missing/false in env | Set `GITHUB_ENABLED=true` |
| Jira still running when you only wanted GitHub | `JIRA_ENABLED` not set | Set `JIRA_ENABLED=false` and `SYNC_SOURCE=github` |

For anything else, see
[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).
