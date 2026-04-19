# IntentEra Documentation

Welcome. This folder contains **everything a beginner needs** to set up, run,
and operate IntentEra — the Jira RAG ingestion and retrieval system that runs
on AWS Lambda.

If you are new to the project, read the guides in the order below. Each guide
has been written to assume you have **minimal AWS or Node.js experience**, so
don't worry if some terms are new — they are explained as they appear.

---

## Start here

1. **[getting-started.md](getting-started.md)** — A single end-to-end path from
   "nothing installed" to "first successful retrieval query". Read this first.

## Setting up each external service (step-by-step)

These guides explain how to create and configure each service IntentEra
depends on. You can do them in any order, but the order below matches how
`getting-started.md` walks through them.

2. **[mongodb-atlas-setup.md](mongodb-atlas-setup.md)** — Create a free-tier
   MongoDB Atlas cluster and the Vector Search index.
3. **[redis-setup.md](redis-setup.md)** — Run Redis locally (for dev) and
   set up a managed Redis in AWS (for production).
4. **[jira-confluence-setup.md](jira-confluence-setup.md)** — Generate Jira
   and Confluence API tokens and verify access with a quick `curl`.
5. **[openai-setup.md](openai-setup.md)** — Create an OpenAI API key and
   choose the right embedding model.
6. **[secrets-manager-setup.md](secrets-manager-setup.md)** — Put all your
   secrets into AWS Secrets Manager (one place, encrypted).

## Running the project

7. **[local-development.md](local-development.md)** — Install, configure
   `.env`, run the CLI, simulate the different Lambda invocations, read the
   output.
8. **[aws-deployment.md](aws-deployment.md)** — Package and deploy both
   Lambdas, schedule EventBridge, expose the retrieval API through API
   Gateway, and set IAM permissions.

## Reference material

9. **[configuration-reference.md](configuration-reference.md)** — Every
   environment variable explained in plain language.
10. **[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)**
    — Common errors and how to fix them.
11. **[architecture.md](architecture.md)** — The deeper technical design
    (why each piece exists and how they fit together).

## Examples

Under **[examples/](examples/)** you will find ready-to-use JSON payloads:

- `eventbridge-rule.json` — the EventBridge rule that triggers incremental
  sync.
- `full-import-invocation.json` — Lambda payload for a forced full import.
- `retrieval-request.json` — an API Gateway style payload for retrieval.
- `secrets-manager-payload.json` — the shape of the AWS Secrets Manager
  secret.
- `redis-state.json` — what the Redis sync state looks like after a run.

---

## If you get stuck

Go to **[debugging-and-troubleshooting.md](debugging-and-troubleshooting.md)**.
That guide indexes the most common errors by the message text you will see,
so you can search the page for any error and find the fix.
