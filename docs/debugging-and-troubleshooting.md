# Debugging & Troubleshooting

Common errors and how to fix them. Search this page for the error message
you see — entries are indexed by the exact text the CLI or Lambda prints.

---

## Before diving in: the two log-level superpowers

### 1. Turn up verbosity

Set `LOG_LEVEL=debug` (in `.env` locally, or as a Lambda env var). You'll
get every retry attempt, every embedding batch, and every Redis command.

### 2. Inspect the Redis state

```bash
node src/cli/runner.js state
```

If `status === "failed"` or `failureReason` is non-null, the previous run
crashed and left a breadcrumb for you. Incremental runs keep retrying the
same window from the last successful checkpoint, so you generally don't
need to "clear" anything manually.

---

## Config & env var errors

### `Missing required env var "<NAME>"`

`config/appConfig.js` couldn't find a required value. Either:

- Add it to `.env` (local) OR
- Add it to the AWS Secrets Manager secret (production) OR
- Set it directly on the Lambda's env vars (overrides Secrets Manager).

### `SYNC_MODE must be "incremental" or "full", got "..."`

You set `SYNC_MODE` to something other than those two strings. Typos like
`FULL` (uppercase) work because the config lowercases before comparing,
but `syncMode=one-off` won't.

### `Env var "<NAME>" must be numeric, got "..."`

A numeric env var (e.g. `INCREMENTAL_LOOKBACK_MINUTES`) has non-numeric
content. Common cause: accidentally quoting it in `.env` like
`INCREMENTAL_LOOKBACK_MINUTES="60 minutes"`. Remove the unit.

### `Secrets Manager secret "..." returned no SecretString`

You stored the secret as binary, not as plaintext JSON. In AWS Console →
Secrets Manager → the secret → **Retrieve secret value** → it should show
JSON in the "Plaintext" tab. If the "Binary" tab has the data instead,
re-create the secret as plaintext.

### `Secrets Manager secret "..." is not valid JSON`

The secret is not JSON. Open it in the console, click **Edit**, and paste
the shape shown in
[`examples/secrets-manager-payload.json`](examples/secrets-manager-payload.json).

---

## Jira errors

### `401 Unauthorized` on any Jira call

- Your `JIRA_EMAIL` or `JIRA_API_TOKEN` is wrong.
- The token may have been revoked. Regenerate at
  [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

### `403 Forbidden` on `/rest/api/3/search` or `/issue/.../comment`

The token's account doesn't have "Browse projects" on the target project.
Either grant the permission or change `JIRA_PROJECT_KEYS` to a project
the account can see.

### `403 Forbidden` on attachment downloads

The account can read the issue but not download attachments. The
attachment parser treats this as a parse failure and emits a placeholder
chunk. Add "View attachments" permission or set
`JIRA_INCLUDE_ATTACHMENTS=false` to skip entirely.

### `429 Too Many Requests`

Jira is rate-limiting. The built-in retry helper (`src/utils/retry.js`)
will back off and try again. If this happens every run, either narrow the
scope (fewer projects) or extend
`INCREMENTAL_LOOKBACK_MINUTES` so each run covers fewer updates per minute
of wall clock.

### `ENOTFOUND your-company.atlassian.net`

Typo in `JIRA_BASE_URL`. Remove any trailing slash and make sure the
domain resolves (try `curl -I https://your-company.atlassian.net`).

---

## Confluence errors

### Confluence pages never appear in results

Most likely causes:

1. `JIRA_INCLUDE_CONFLUENCE=false` in `.env`. Set it to `true`.
2. The Jira tickets don't actually have Confluence remote links. Verify
   by opening a Jira ticket and checking "Issue Links" / "Web links".
3. The Confluence credentials can't see the pages. Test with the curl
   command in [jira-confluence-setup.md](jira-confluence-setup.md) §7.

### `confluence page fetch failed` logs with `status: 404`

The remote link URL points to a page that no longer exists. This is
expected over time — the orchestrator logs and skips. No action needed.

---

## MongoDB errors

### `MongoServerSelectionError: connect ECONNREFUSED`

Your IP isn't allowlisted in Atlas → **Network Access**. Add your current
IP (local dev) or `0.0.0.0/0` temporarily for Lambda tests.

### `bad auth : authentication failed`

The username/password in `MONGODB_URI` is wrong. Regenerate the user
password in Atlas → **Database Access** and rebuild the URI via
**Connect** in Atlas UI.

### `vectorSearch embedding must have 1536 dimensions`

You changed `OPENAI_EMBEDDING_MODEL` to a model with different
dimensions, but:

- Didn't update `OPENAI_EMBEDDING_DIMENSIONS`, OR
- Didn't recreate the Atlas vector index with the matching
  `numDimensions`.

The **three** must agree:

1. `OPENAI_EMBEDDING_MODEL` output size (e.g. `text-embedding-3-large` = 3072).
2. `OPENAI_EMBEDDING_DIMENSIONS` env var.
3. `numDimensions` inside the Atlas Vector Search index definition.

### `Error: index "vector_index" not found` (or similar from `$vectorSearch`)

Either:

- The index doesn't exist — see
  [mongodb-atlas-setup.md](mongodb-atlas-setup.md) §7.
- The index name doesn't match `MONGODB_VECTOR_INDEX` (default
  `vector_index`). Fix one or the other.
- The index is still `BUILDING` — wait for it to turn `ACTIVE`.

### `WriteError: document would exceed the maximum BSON size (16 MB)`

An extremely large attachment produced a single oversized chunk. The
chunker has a budget cap (`CHUNK_ATTACHMENT_MAX_TOKENS`) that should
prevent this. If it still triggers, lower the cap or set
`JIRA_INCLUDE_ATTACHMENTS=false` for the problem ticket.

---

## Redis errors

### `ECONNREFUSED redis://localhost:6379`

The local Docker Redis isn't running. Start it:

```bash
docker start intentera-redis
# or create it the first time:
docker run -d --name intentera-redis -p 6379:6379 redis:7
```

### `NOAUTH Authentication required` or `WRONGPASS`

The URL is missing a password or has the wrong one.

- Upstash: use `rediss://default:TOKEN@...` (two s's for TLS).
- ElastiCache with auth enabled: include the auth token in the URL or
  pass it via env vars the `ioredis` client understands.

### `ETIMEDOUT` with ElastiCache

The Lambda is not in the VPC that ElastiCache is in. See
[aws-deployment.md](aws-deployment.md) §7 "Networking notes".

### `another sync run appears to be in progress; skipping`

A lock key (`intentera:sync:lock`) is held. This is intentional
protection against overlapping runs. Wait for the TTL to expire (15
minutes by default) or manually clear:

```bash
docker exec -it intentera-redis redis-cli DEL intentera:sync:lock
```

Only do the manual delete if you are sure no run is actually in progress.

### `sync state is corrupt JSON; resetting to defaults`

Something wrote non-JSON into the state key. The orchestrator treats this
as "no checkpoint" and upgrades the next run to a full import. No action
needed.

---

## OpenAI errors

### `401 Invalid Authentication`

`OPENAI_API_KEY` is wrong, revoked, or stale. Regenerate at
[platform.openai.com/api-keys](https://platform.openai.com/api-keys).

### `429 Rate limit reached` or `insufficient_quota`

- You have no billing configured. Add a payment method at
  [platform.openai.com/account/billing](https://platform.openai.com/account/billing/payment-methods).
- Or you hit your monthly budget cap.

### `model ... does not exist`

The `OPENAI_EMBEDDING_MODEL` value is wrong. Use
`text-embedding-3-small` (default) or `text-embedding-3-large`.

---

## AWS errors

### `AccessDenied` reading the Secrets Manager secret

The Lambda's execution role lacks `secretsmanager:GetSecretValue` for the
secret's ARN. See
[secrets-manager-setup.md](secrets-manager-setup.md) §6.

### Lambda times out

1. Check CloudWatch Logs for the last log line before timeout. If it's
   `starting jira ticket stream`, your Jira scope is too big — narrow
   `JIRA_PROJECT_KEYS` or raise `INCREMENTAL_LOOKBACK_MINUTES` (so fewer
   tickets qualify per run).
2. Increase the Lambda's memory to 2048 MB — AWS gives proportionally
   more CPU to higher-memory Lambdas, which speeds attachment parsing.
3. If you are at the 15-minute maximum and still timing out, split the
   project list across multiple Lambdas or fan-out via SQS (future work).

### EventBridge fires but nothing happens

- Confirm the rule's target ARN matches the actual Lambda's ARN (typos
  are common after renaming a function).
- Check the Lambda's **Monitor → Invocations** tab. If the count is 0, the
  EventBridge IAM role likely lacks `lambda:InvokeFunction` on the
  target. Re-creating the schedule often fixes this.

### API Gateway returns `{"message":"Internal server error"}`

- Open CloudWatch Logs for `/aws/lambda/intentera-retrieve` to see the
  real error.
- The most common cause is `body` missing or not being a JSON string.
  API Gateway's HTTP API passes the body as a string. See
  [`examples/retrieval-request.json`](examples/retrieval-request.json) for
  the correct shape.

---

## Retrieval quality issues

### The top result feels unrelated

- Try `LOG_LEVEL=debug` to see what's in the index and what filters were
  applied.
- Make sure the Atlas index is `ACTIVE` and was created with the same
  dimensions you're embedding with.
- Narrow the search using filters: `--project`, `--sourceType`,
  `--labels`. Filters are intersected, not merged, and dramatically
  reduce noise.
- Check your chunk sizes in `.env`. Overly large chunks dilute relevance;
  overly small chunks over-fragment context.

### Results include outdated content

- The ticket or Confluence page was removed. Run an incremental sync; the
  orchestrator will detect the removal and delete the relevant Mongo
  chunks.
- Or, force a full import: `node src/cli/runner.js full`.

### Confluence pages return empty text

Storage-format XHTML can sometimes be dominated by macros with no inline
text. The cheerio stripper in `src/confluence/client.js` removes macros
by default — if your pages rely on macros for content (e.g.
`structured-macro` for code blocks), consider switching to the Confluence
v1 `content?expand=body.view` endpoint and rendering HTML instead.

---

## "How do I reset everything to a clean slate?"

**Development only:**

```bash
# 1. Wipe Redis state
docker exec -it intentera-redis redis-cli DEL intentera:sync:state intentera:sync:lock

# 2. Wipe Mongo collection
# Open the Atlas UI → your cluster → Browse Collections → delete all docs, OR:
node -e "
require('dotenv').config();
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const r = await c.db(process.env.MONGODB_DATABASE).collection(process.env.MONGODB_COLLECTION).deleteMany({});
  console.log('Deleted', r.deletedCount, 'chunks');
  await c.close();
})();
"

# 3. Rebuild
node src/cli/runner.js full
```

---

## Still stuck?

- Re-read the relevant setup guide ([mongodb-atlas-setup.md](mongodb-atlas-setup.md),
  [redis-setup.md](redis-setup.md), [jira-confluence-setup.md](jira-confluence-setup.md),
  [openai-setup.md](openai-setup.md)).
- Open a GitHub issue with:
  - The command you ran
  - The full log output (redact secrets)
  - The value of `node --version` and `npm --version`
  - Which region/services you're deploying to

Someone helpful will take a look.
