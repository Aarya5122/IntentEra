# AWS Deployment Guide

This guide shows the **simplest, most beginner-friendly** way to deploy
IntentEra to AWS:

- **Ingestion Lambda** triggered by **EventBridge** (cron-style schedule)
- **Retrieval Lambda** exposed through **API Gateway** (HTTP POST endpoint)
- Both Lambdas read their secrets from **Secrets Manager**

You can use other tooling (SAM, CDK, Serverless Framework, Terraform) if
you prefer — this guide uses the **AWS Console + zip upload** so nothing
needs to be installed beyond the AWS CLI.

> **Prerequisites before starting this guide:**
> 1. Completed [secrets-manager-setup.md](secrets-manager-setup.md) and
>    you have the secret name (e.g. `intentera/rag/prod`).
> 2. MongoDB Atlas Vector Search index is **ACTIVE** (see
>    [mongodb-atlas-setup.md](mongodb-atlas-setup.md)).
> 3. Redis is reachable from AWS (Upstash / ElastiCache — see
>    [redis-setup.md](redis-setup.md)).

---

## 1. Build the deployment zip

From the project root:

```bash
# Ensure only production dependencies are in node_modules
rm -rf node_modules
npm install --omit=dev

# Package everything Lambda needs
zip -r intentera.zip config src node_modules package.json

# Confirm it's not absurdly large — Lambda allows up to 50 MB zipped direct upload.
ls -lh intentera.zip
```

You should end up with a zip around 20–30 MB. If it's much larger:

- Make sure `dotenv`, `pdf-parse`, `mammoth` are the only heavy deps.
- Remove any accidental `test/` artefacts.

---

## 2. Create the ingestion Lambda

AWS Console → **Lambda** → **"Create function"**:

| Field | Value |
|---|---|
| Create function | **Author from scratch** |
| Function name | `intentera-ingest` |
| Runtime | **Node.js 20.x** (or 18.x) |
| Architecture | `x86_64` or `arm64` — either works |
| Execution role | **"Create a new role with basic Lambda permissions"** |

Click **"Create function"**. AWS gives you a placeholder Lambda.

### Upload the code

1. Tab **"Code"** → **"Upload from"** → **".zip file"**.
2. Upload `intentera.zip`.
3. Scroll down to **"Runtime settings"** → **"Edit"**.
4. **Handler:** `src/handler/ingest.handler` (not the default
   `index.handler`).
5. **Save**.

### Configure memory and timeout

Tab **"Configuration"** → **"General configuration"** → **"Edit"**:

- **Memory:** 1024 MB
- **Timeout:** 15 min 0 sec (maximum)
- **Ephemeral storage:** 512 MB (default is fine)

### Set environment variables

Tab **"Configuration"** → **"Environment variables"** → **"Edit"**. Set
just three values — everything else comes from Secrets Manager:

| Key | Value |
|---|---|
| `USE_SECRETS_MANAGER` | `true` |
| `SECRETS_MANAGER_SECRET_ID` | `intentera/rag/prod` |
| `LOG_LEVEL` | `info` |

Optionally also set:

| Key | Value | When to use |
|---|---|---|
| `SYNC_MODE` | `full` | Temporary flag — every scheduled run does a full import. Usually leave unset. |
| `SYNC_SOURCE` | `github` | Default this Lambda to the GitHub pipeline when the event payload omits `source`. Only needed for single-source deployments. |
| `INCREMENTAL_LOOKBACK_MINUTES` | `60` | Override the default 60-minute overlap. |

### Attach the IAM permission for Secrets Manager

Follow [secrets-manager-setup.md](secrets-manager-setup.md) §6 to attach
the `secretsmanager:GetSecretValue` permission to this Lambda's
**execution role**.

### Smoke test

Tab **"Test"** → **"Create new test event"**:

- Event name: `forced-full`
- Template: **"hello-world"** → replace with:

  ```json
  { "mode": "full" }
  ```

Click **"Test"**. Expect the Lambda to run for 1–10 minutes depending on
your Jira size. When done you'll see the `SyncResult` JSON in the
**Execution results** pane and structured JSON logs in CloudWatch Logs.

---

## 3. Create the EventBridge schedule

AWS Console → **EventBridge** → **"Schedules"** → **"Create schedule"**:

| Field | Value |
|---|---|
| Schedule name | `intentera-incremental-30m` |
| Schedule pattern | **Recurring schedule** |
| Schedule type | **Rate-based** → every `30` minutes |
| Flexible time window | **Off** |
| Target | **AWS Lambda** → `intentera-ingest` |
| Payload | `{}` *(empty — the handler defaults to incremental)* |
| Execution role | **"Create new role"** (EventBridge will create one that can invoke the Lambda) |

Click **"Create schedule"**.

Alternatively, the JSON at
[`examples/eventbridge-rule.json`](examples/eventbridge-rule.json) can be
imported via the AWS CLI:

```bash
aws scheduler create-schedule --cli-input-json file://docs/examples/eventbridge-rule.json
```

### Add a second rule for GitHub (if `GITHUB_ENABLED=true`)

The **same** ingestion Lambda handles both sources — just create a
second EventBridge schedule whose target input is `{"source":"github"}`:

- Schedule name: `intentera-github-incremental-30m`
- Target: the same `intentera-ingest` Lambda
- Payload: `{"source":"github","mode":"incremental"}`

Or use the CLI with the ready-made template:

```bash
aws scheduler create-schedule --cli-input-json file://docs/examples/github-eventbridge-rule.json
```

See [`examples/github-eventbridge-rule.json`](examples/github-eventbridge-rule.json)
and [`examples/github-full-import-invocation.json`](examples/github-full-import-invocation.json)
for the exact shapes.

---

## 4. Create the retrieval Lambda

Repeat the steps for **Lambda #2**:

| Field | Value |
|---|---|
| Function name | `intentera-retrieve` |
| Runtime | Node.js 20.x |
| Handler | `src/handler/retrieve.handler` |
| Memory | 512 MB |
| Timeout | 30 sec (plenty — retrieval should be sub-second) |
| Zip file | Same `intentera.zip` |
| Env vars | Same three: `USE_SECRETS_MANAGER=true`, `SECRETS_MANAGER_SECRET_ID=intentera/rag/prod`, `LOG_LEVEL=info` |
| Execution role permission | Same `secretsmanager:GetSecretValue` policy |

### Smoke test

Tab **"Test"**:

- Event name: `sample-query`
- Body:

  ```json
  {
    "body": "{\"query\":\"How did we fix the login bug?\",\"topK\":5}"
  }
  ```

Click **"Test"**. You should see a `200` response with the retrieval JSON.

---

## 5. Expose retrieval through API Gateway

AWS Console → **API Gateway** → **"Create API"** → **"HTTP API"** →
**"Build"**.

1. Integrations: click **"Add integration"** → pick **Lambda** →
   `intentera-retrieve`.
2. API name: `intentera-retrieve-api`.
3. Routes: method **POST**, path `/retrieve`.
4. Stages: leave the default `$default` with auto-deploy on.
5. Click **"Create"**.

Note the **Invoke URL** (e.g.
`https://abc123.execute-api.us-east-1.amazonaws.com`).

### Test from curl

```bash
# Jira (default source)
curl -X POST "https://abc123.execute-api.us-east-1.amazonaws.com/retrieve" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How did we fix the login bug?",
    "topK": 5,
    "filters": { "projectKey": "PROJ" }
  }'

# GitHub-only query
curl -X POST "https://abc123.execute-api.us-east-1.amazonaws.com/retrieve" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Who reviewed the SSO PR?",
    "source": "github",
    "topK": 5,
    "filters": { "repoFullName": "acme-inc/platform", "entityType": "pullRequest" }
  }'

# Combined retrieval across both sources
curl -X POST "https://abc123.execute-api.us-east-1.amazonaws.com/retrieve" \
  -H "Content-Type: application/json" \
  -d '{ "query": "SSO rollout timeline", "source": "both", "topK": 10 }'
```

You should get the same JSON shape you saw from the Lambda Test tab.
Every result is tagged with `source` (`jira` | `github`), and GitHub
items additionally include `entityType` and `repoFullName`.

### Locking down the endpoint (optional but recommended)

Out of the box the URL is public. For production you probably want:

- **API key** (simplest): in API Gateway → **API keys**, create a key and
  require it on the route.
- **IAM auth**: change the route's authorization to `AWS_IAM`. Clients
  sign requests with SigV4.
- **Cognito / Lambda authorizer**: for user-based auth.

This project does not include an authorizer — add one before going live.

---

## 6. Put it all together — verify end-to-end

1. Wait for the next EventBridge tick, or manually invoke `intentera-ingest`
   once with `{}` to trigger an incremental run.
2. Check CloudWatch Logs (log group `/aws/lambda/intentera-ingest`) for a
   log line: `"sync completed successfully"`.
3. `curl` the retrieval endpoint (step 5) and confirm you get results.

---

## 7. Networking notes

### If your Mongo Atlas or Redis is public

You're fine — Lambdas outside a VPC can reach any public IP. Just make
sure:

- Mongo Atlas **Network Access** allows `0.0.0.0/0` (easiest) or the
  specific Lambda NAT IPs.
- Upstash / ElastiCache public endpoint is reachable.

### If your Redis is inside a VPC (ElastiCache)

Then the Lambda must also be in the VPC:

1. In the Lambda's **Configuration** → **VPC** → attach the same VPC as
   the ElastiCache cluster, pick **private** subnets with a **NAT Gateway**
   (so the Lambda can still reach OpenAI / Mongo Atlas / Jira).
2. Attach a security group that allows outbound port 6379 to the
   ElastiCache security group.
3. Add an inbound rule on the ElastiCache security group allowing
   traffic from the Lambda's security group on port 6379.

Cold starts inside a VPC are ~1–2 seconds slower than outside. Consider
**provisioned concurrency** if that matters.

---

## 8. Costs at a glance

| Service | Typical monthly cost |
|---|---|
| Lambda (both functions, assuming ~48 invocations/day) | Under $1 (often within free tier) |
| EventBridge Scheduler | ~$0 for 48/day |
| API Gateway (1000 retrieval calls/day) | ~$1 |
| CloudWatch Logs (1 GB/month) | ~$0.50 |
| Secrets Manager (1 secret) | $0.40 + $0.05/10k API calls |
| MongoDB Atlas M10 | ~$60 (largest single line item) |
| Upstash free tier | $0 |
| OpenAI embeddings (10k tickets full + 50k incremental updates) | Pennies |

MongoDB Atlas is by far the biggest recurring cost. Pause the cluster via
the Atlas UI when you're not using it to save money.

---

## 9. Upgrading the deployment

To push a code change:

```bash
rm -rf node_modules && npm install --omit=dev
zip -r intentera.zip config src node_modules package.json
aws lambda update-function-code --function-name intentera-ingest --zip-file fileb://intentera.zip
aws lambda update-function-code --function-name intentera-retrieve --zip-file fileb://intentera.zip
```

If you change the handler path, also:

```bash
aws lambda update-function-configuration \
  --function-name intentera-ingest \
  --handler src/handler/ingest.handler
```

---

## 10. Disabling / deleting

To pause the system without deleting anything:

- Disable the EventBridge schedule (the rule stays but stops firing).
- Optionally, set the Lambda concurrency to 0 to block invocations.

To delete:

1. EventBridge schedule → **Delete**.
2. API Gateway API → **Delete**.
3. Both Lambdas → **Delete**.
4. Secrets Manager secret → **Delete** (note: AWS enforces a 7-day
   recovery window by default).
5. MongoDB Atlas cluster → **Pause** or **Terminate**.

---

## Next

- Running into errors? Read
  [debugging-and-troubleshooting.md](debugging-and-troubleshooting.md).
- Want to understand the internals?
  [architecture.md](architecture.md) explains every module and why.
