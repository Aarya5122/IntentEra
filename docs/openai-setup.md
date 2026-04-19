# OpenAI Setup

IntentEra uses OpenAI to generate **embeddings** (numeric vectors that
represent text meaning). We do **not** use OpenAI to write answers — that
is the downstream chat/LLM system's job.

---

## 1. Create an account

Sign up at [platform.openai.com](https://platform.openai.com/signup).

Note: `platform.openai.com` is the developer dashboard (billing, API keys).
It is different from `chat.openai.com` (the consumer chat app).

---

## 2. Add billing

OpenAI's API requires a payment method even for small usage. You can cap
your spend:

1. Go to **Settings** → **Billing** → **Payment methods** and add a card.
2. Go to **Settings** → **Limits** and set a **monthly budget** (e.g. $5)
   so you can't be surprised by a runaway bill.

### Expected cost

Embeddings are extremely cheap with `text-embedding-3-small`:

| Scale | Approx cost (embedding only) |
|---|---|
| 1,000 Jira tickets (full import, avg 6 chunks each) | ~$0.01 |
| 10,000 tickets / month (incremental churn) | Pennies |
| Retrieval queries (1 query = 1 embedding) | Fractions of a cent each |

---

## 3. Create an API key

1. Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Click **"Create new secret key"**.
3. Give it a name (e.g. `intentera-rag`).
4. Permissions: **"All"** (or scoped **"Restricted"** to only the
   `embeddings` endpoint if you prefer).
5. Copy the key — it starts with `sk-...` and is shown **once only**.

Paste that value into `.env`:

```
OPENAI_API_KEY=sk-replace-me
```

---

## 4. Choose an embedding model

The default is fine for most projects:

```
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

If you want higher retrieval quality (at ~6x the cost per token), upgrade:

```
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
OPENAI_EMBEDDING_DIMENSIONS=3072
```

> **Very important:** if you change the dimensions, you MUST recreate the
> MongoDB Atlas Vector Search index with the matching `numDimensions`
> value. See [mongodb-atlas-setup.md](mongodb-atlas-setup.md) §7.

---

## 5. Test the key

```bash
node -e "
require('dotenv').config();
const { OpenAI } = require('openai');
(async () => {
  const c = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const r = await c.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    input: ['hello world'],
    dimensions: Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 1536),
  });
  console.log('OpenAI OK — first 5 dimensions of embedding:', r.data[0].embedding.slice(0, 5));
})().catch(e => { console.error('FAILED:', e.status, e.message); process.exit(1); });
"
```

Expected output:

```
OpenAI OK — first 5 dimensions of embedding: [ 0.023..., -0.014..., ... ]
```

Common failures:

- `401` — the API key is wrong or was revoked.
- `429` — rate limit or no billing configured. Add a payment method.
- `ENOTFOUND api.openai.com` — your network blocks outbound HTTPS.

---

## 6. How IntentEra uses the key

- At ingestion time: every chunk's text is sent in batches (default 64 per
  request) via `src/embeddings/embedder.js`. The returned vector is stored
  in MongoDB alongside the chunk.
- At retrieval time: the incoming query is embedded once and matched via
  Mongo's `$vectorSearch`.

The embedder automatically retries transient failures (429 / 5xx) via
`src/utils/retry.js`.

---

## Next

- If you're running only locally, you're ready to return to
  [getting-started.md](getting-started.md) step 5 (install the project).
- If you plan to deploy to AWS, continue to
  [secrets-manager-setup.md](secrets-manager-setup.md).
