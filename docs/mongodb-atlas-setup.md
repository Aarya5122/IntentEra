# MongoDB Atlas Setup (Vector Search)

This guide walks you through creating a MongoDB Atlas cluster and enabling
**Vector Search** so IntentEra can store and query embeddings.

> Heads-up: MongoDB Atlas's free tier (M0) does **not** support Vector
> Search. You need at least the M10 paid tier (approximately $0.08/hour at
> the time of writing). If you only want to explore the code without running
> real searches, you can skip this setup and stub the vector store in tests.

---

## 1. Create an Atlas account

1. Go to [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register).
2. Sign up with your email (or Google/GitHub SSO).
3. When prompted, choose the free **"M0 Sandbox"** cluster to get started —
  you will upgrade to M10 later in this guide.

---

## 2. Create a cluster

In the Atlas UI:

1. Click **"Create"** → **"Build a Database"**.
2. Pick **"Dedicated"** (M10 minimum, required for Vector Search).
3. Choose a cloud provider and region close to where your AWS Lambda runs
  (e.g. `AWS / us-east-1`). Co-locating keeps latency low.
4. Give the cluster a name (e.g. `intentera-prod`).
5. Click **"Create Cluster"**. Provisioning takes 5–10 minutes — grab a
  coffee.

> **Cost reminder:** M10 costs roughly $60/month if left running 24/7. For a
> quick proof of concept you can pause the cluster between sessions from the
> Atlas UI.

---

## 3. Create a database user

Atlas does not let you connect without creating a dedicated database user
first.

1. Left nav → **"Database Access"** → **"Add New Database User"**.
2. Authentication method: **"Password"**.
3. Username: `intentera` (or anything memorable).
4. Password: click **"Autogenerate Secure Password"** and **save it somewhere
  safe**. This password is part of the connection string you will paste
   into `.env`.
5. Database User Privileges: **"Read and write to any database"** is the
  simplest option. Click **"Add User"**.

---

## 4. Allow network access

By default Atlas blocks every IP. Add your home IP for local dev:

1. Left nav → **"Network Access"** → **"Add IP Address"**.
2. Click **"Add Current IP Address"**.
3. Give it a comment (e.g. `my laptop`) and click **"Confirm"**.

> **For production** you will later add the AWS NAT Gateway's elastic IP (or
> use VPC peering / PrivateLink). For now, your laptop IP is enough.

---

## 5. Get the connection string

1. Left nav → **"Database"** → find your cluster → click **"Connect"**.
2. Pick **"Drivers"** → choose **Node.js** → the latest version.
3. Copy the URI that looks like:
  ```
   mongodb+srv://intentera:<password>@intentera-prod.ab12c.mongodb.net/?retryWrites=true&w=majority
  ```
4. Replace `<password>` with the password you saved in step 3. Keep this
  full string — this is your `MONGODB_URI` value.

---

## 6. Create the database and collection

The collection doesn't strictly need to exist before Lambda runs (it will
be auto-created on first insert), but creating it now lets you add the
vector index up front.

1. Left nav → **"Database"** → click **"Browse Collections"** on your cluster.
2. Click **"Add My Own Data"**.
3. Database name: `intentera`
4. Collection name: `rag_chunks`
5. Click **"Create"**.

These match the defaults in `.env.example`:

```
MONGODB_DATABASE=intentera
MONGODB_COLLECTION=rag_chunks
```

---

## 6b. Create the GitHub collection (only if GITHUB_ENABLED=true)

IntentEra keeps GitHub chunks in a **separate collection** from Jira so
each source has its own vector index and you can query them
independently.

1. In Atlas → **Browse Collections** → use the same `intentera` database.
2. Click **"Create Collection"**.
3. Collection name: `rag_chunks_github`.
4. Click **"Create"**.

These match the defaults in `.env.example`:

```
MONGODB_GITHUB_COLLECTION=rag_chunks_github
MONGODB_GITHUB_VECTOR_INDEX=vector_index_github
```

You will create the vector index for this collection in the next step.

---

## 7. Create the Vector Search index (the important part)

1. Inside the `rag_chunks` collection, click the **"Search Indexes"** tab.
2. Click **"Create Search Index"**.
3. Choose **"JSON Editor"**.
4. Pick **"Atlas Vector Search"** (the newer type).
5. **Index name:** `vector_index` (matches the default in `.env.example`).
6. Paste this exact JSON:
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
7. Click **"Next"** → **"Create Search Index"**.

The index takes 1–3 minutes to build. Wait for its status to go from
`BUILDING` (orange) to `ACTIVE` (green) before running your first query.

### 7b. GitHub vector index (only if GITHUB_ENABLED=true)

Repeat the steps above on the `**rag_chunks_github`** collection using
the JSON below (note the GitHub-specific filter fields):

- **Index name:** `vector_index_github`
- **JSON:**
  ```json
  {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "entityKey" },
      { "type": "filter", "path": "entityType" },
      { "type": "filter", "path": "sourceType" },
      { "type": "filter", "path": "repoFullName" },
      { "type": "filter", "path": "metadata.branches" },
      { "type": "filter", "path": "metadata.filePaths" },
      { "type": "filter", "path": "metadata.labels" },
      { "type": "filter", "path": "metadata.prNumber" },
      { "type": "filter", "path": "metadata.issueNumber" },
      { "type": "filter", "path": "metadata.commitSha" }
    ]
  }
  ```

Wait for this index to reach `ACTIVE` status before running GitHub
retrievals.

> **If you use a different embedding model**, update `numDimensions` to
> match the model's output size:
>
> - `text-embedding-3-small` → 1536 (default)
> - `text-embedding-3-large` → 3072
> - Any other model → check the provider's docs

---

## 8. Test the connection locally

A quick smoke test — from the project root after you've filled in `.env`:

```bash
`
```

Expected output:

```
MongoDB OK: { ok: 1 }
```

If you see `MongoServerSelectionError` or similar, the most likely causes
are:

- Your IP isn't allowlisted (re-do step 4).
- The password in the URI is wrong (go back to step 5 and regenerate the
full URI from the Atlas UI).
- You're on a network that blocks port 27017 (corporate / coffee-shop
Wi-Fi sometimes does this).

---

## 9. What IntentEra writes to this collection

Each Mongo document looks like this (see `src/vectorStore/mongoStore.js`):

```json
{
  "_id": "<deterministic 32-char hex chunk id>",
  "ticketKey": "PROJ-123",
  "projectKey": "PROJ",
  "sourceType": "description | comments | attachment | confluence | metadata | linkedIssues",
  "chunkIndex": 0,
  "text": "...the text that was embedded...",
  "embedding": [0.001, 0.024, ...],
  "metadata": {
    "summary": "...",
    "status": "In Progress",
    "priority": "High",
    "labels": ["backend"],
    "updatedAt": "2026-04-19T18:00:00Z",
    "fileName": null,
    "pageTitle": null
  },
  "indexedAt": "2026-04-19T19:00:00Z"
}
```

- `_id` is **deterministic**: the same content always hashes to the same ID.
This lets us safely re-run ingestion without creating duplicates.
- `embedding` is the vector — 1536 floats by default.
- `metadata.`* fields power the filters you can pass to the retrieval API
(`projectKey`, `sourceType`, `labels`, `ticketKey`).

---

## 10. Costs to be aware of


| Thing                 | Approx. cost                                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| M10 cluster           | ~$60/month running 24/7 (or ~$0.08/hour if you pause between uses)             |
| Storage               | Typically small — chunks are just text + a 1536-float vector (~6 KB per chunk) |
| Vector Search queries | Included with the cluster; no per-query charge                                 |


Pause the cluster via Atlas UI when you are not using it to cut costs.

---

## Next

- Go back to [getting-started.md](getting-started.md) step 4.2 (Redis).
- If you prefer, jump to [redis-setup.md](redis-setup.md) directly.

