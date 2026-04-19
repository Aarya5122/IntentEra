# AWS Secrets Manager Setup

Once you deploy to AWS, you do **not** want to set a dozen Lambda
environment variables that contain real secrets (they show up in the
console and IAM policies). Instead, put all the secrets in **AWS Secrets
Manager** and give each Lambda permission to read that one secret.

IntentEra's `config/secrets.js` loads the secret, parses the JSON, and
merges the keys into `process.env` before config validation runs. From the
rest of the code's perspective, the values still just come from
`process.env`.

---

## 1. Open Secrets Manager

AWS Console → **Secrets Manager** → make sure you are in the **region**
where your Lambdas will run (top-right region picker).

---

## 2. Create a new secret

1. Click **"Store a new secret"**.
2. Secret type: **"Other type of secret"**.
3. Key/value pairs: click **"Plaintext"** and paste this JSON (replace the
   placeholder values with your real ones):

   ```json
   {
     "JIRA_BASE_URL": "https://your-company.atlassian.net",
     "JIRA_EMAIL": "you@your-company.com",
     "JIRA_API_TOKEN": "ATATT3xFfG...",
     "CONFLUENCE_BASE_URL": "https://your-company.atlassian.net/wiki",
     "OPENAI_API_KEY": "sk-...",
     "MONGODB_URI": "mongodb+srv://USER:PASS@cluster.mongodb.net/?retryWrites=true",
     "MONGODB_DATABASE": "intentera",
     "MONGODB_COLLECTION": "rag_chunks",
     "MONGODB_VECTOR_INDEX": "vector_index",
     "REDIS_URL": "rediss://:password@redis.example.com:6379",
     "REDIS_KEY_PREFIX": "intentera:sync:"
   }
   ```

   You can also include non-secret config keys here if you prefer one
   central place for everything.

4. Encryption key: leave as **"aws/secretsmanager"** (the default AWS-managed
   KMS key). Don't worry about KMS details unless your org requires
   customer-managed keys.
5. Click **"Next"**.

---

## 3. Name the secret

- **Secret name:** `intentera/rag/prod` (or `intentera/rag/dev`, whatever
  matches your environment).
- **Description:** `IntentEra Jira RAG — pooled config/secrets`.
- Click **"Next"**.

Remember this name — you will paste it into a Lambda env var.

---

## 4. Rotation

For a first-pass deployment, choose **"Disable automatic rotation"**.
You can enable it later if needed (for example to rotate the Atlassian
token every 90 days).

Click **"Next"** → **"Store"**.

---

## 5. Copy the ARN

Open the secret you just created. At the top you will see an ARN like:

```
arn:aws:secretsmanager:us-east-1:123456789012:secret:intentera/rag/prod-AbCdEf
```

Copy it — you will use it in the Lambda IAM policy.

---

## 6. Grant the Lambda permission to read the secret

### Option A: Inline policy on the Lambda execution role (simplest)

1. Open your ingestion Lambda in the AWS Console.
2. Tab **"Configuration"** → **"Permissions"** → click the **execution
   role** link.
3. In IAM, click **"Add permissions"** → **"Create inline policy"**.
4. Switch to **"JSON"** and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowReadIntentEraSecret",
         "Effect": "Allow",
         "Action": "secretsmanager:GetSecretValue",
         "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:intentera/rag/prod-*"
       }
     ]
   }
   ```

   Notice the trailing `-*` — AWS appends a 6-character random suffix to
   secret ARNs, and the wildcard matches them.

5. Click **"Review policy"**, give it a name (`IntentEraReadSecret`), then
   **"Create policy"**.

Repeat for the retrieval Lambda role.

### Option B: Managed policy shared by both roles

If you have many Lambdas that need the same secret, create a customer
managed policy once and attach it to both roles.

---

## 7. Point the Lambdas at the secret

On each Lambda's **"Environment variables"** panel, set:

| Key | Value |
|---|---|
| `USE_SECRETS_MANAGER` | `true` |
| `SECRETS_MANAGER_SECRET_ID` | `intentera/rag/prod` |
| `AWS_REGION` | (same as the Lambda's region, e.g. `us-east-1`) |

All other env vars can now be removed — they will be loaded from the
secret instead.

> **Tip:** you can still set env vars on the Lambda and they will
> **override** the Secrets Manager values. This is useful for quick
> experiments (e.g. temporarily set `LOG_LEVEL=debug`) without editing the
> secret.

---

## 8. Verify

Invoke the Lambda (either via the **Test** button with
`{ "mode": "incremental" }` or through the EventBridge rule you set up in
[aws-deployment.md](aws-deployment.md)). In CloudWatch Logs you should
see structured JSON like:

```
{"level":"info","msg":"ingestion invocation received","mode":"incremental","awsRequestId":"..."}
```

and later:

```
{"level":"info","msg":"sync completed successfully","mode":"incremental","ticketsProcessed":3,...}
```

If you see errors like `Missing required env var "MONGODB_URI"`, the
Secrets Manager merge did not happen. Double-check:

1. `USE_SECRETS_MANAGER=true` (lowercase `true`).
2. `SECRETS_MANAGER_SECRET_ID` matches the secret name (not the ARN — the
   name alone works).
3. The Lambda's execution role has `secretsmanager:GetSecretValue` on the
   right ARN.

---

## 9. Rotating or updating a secret

To change a value (e.g. rotate the Atlassian token):

1. Open the secret in Secrets Manager.
2. Click **"Retrieve secret value"** → **"Edit"**.
3. Update the JSON. Click **"Save"**.

The Lambda will see the new value on the **next cold start**. Warm
containers keep the cached value until they cycle (AWS typically cycles
containers after ~15 minutes of inactivity, or when the underlying host is
rotated). If you need an immediate refresh, re-deploy the Lambda (any
config change forces a new container).

---

## 10. Local development reminder

For local development you do **not** need Secrets Manager. The CLI runner
loads `.env` directly via `dotenv`. Keep `USE_SECRETS_MANAGER=false` (the
default) in your local `.env`.

---

## Next

- Continue to [aws-deployment.md](aws-deployment.md) to package and deploy
  the Lambdas.
