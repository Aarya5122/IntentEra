# Redis Setup

IntentEra uses Redis for one purpose: storing the **sync checkpoint** (when
did the last successful run complete, which tickets do we know about, is a
run currently in progress). The data set is tiny — a single JSON object
plus a short-lived lock key.

You have three realistic options. Pick ONE.

| Option | Best for | Cost | Effort |
|---|---|---|---|
| Local Docker | Local development | Free | 30 seconds |
| Upstash (serverless Redis) | Any non-VPC Lambda, tiny data | Free tier (10k commands/day) | 2 minutes |
| AWS ElastiCache | Production Lambdas in a VPC | ~$12/month (cache.t4g.micro) | 10 minutes |

---

## Option A: Local Redis via Docker (for dev)

**Prerequisite:** Docker Desktop installed.

```bash
# Start a Redis container (name it so you can start/stop it later)
docker run -d --name intentera-redis -p 6379:6379 redis:7

# Check it's running
docker ps --filter name=intentera-redis

# Quick ping test (optional, needs redis-cli or use docker exec)
docker exec -it intentera-redis redis-cli ping
# Expected: PONG
```

In your `.env`:

```
REDIS_URL=redis://localhost:6379
```

To stop it later: `docker stop intentera-redis`. To start it again:
`docker start intentera-redis`. To remove it completely:
`docker rm -f intentera-redis`.

---

## Option B: Upstash (managed serverless Redis)

Easiest path for a real deployment without running your own infrastructure.

1. Sign up at [upstash.com](https://upstash.com) (free tier works).
2. Click **"Create Database"**:
   - Name: `intentera-sync`
   - Region: pick one close to your AWS Lambda region
   - TLS / Eviction: leave defaults
3. Once created, open the database detail page.
4. Scroll to **"Connect to your database"** → pick **"Node.js (ioredis)"** tab.
5. Copy the URL shown (it looks like `rediss://default:<TOKEN>@<host>:6379`).

In your `.env` (or AWS Secrets Manager):

```
REDIS_URL=rediss://default:YOUR_TOKEN@regional-endpoint.upstash.io:6379
```

Note `rediss://` (two s's) — this enables TLS, required by Upstash.

---

## Option C: AWS ElastiCache (for production VPC Lambdas)

Use this if your Lambdas live inside a VPC and you want your Redis to stay
in the same VPC.

1. AWS Console → **ElastiCache** → **"Create"** → **"Redis OSS"**.
2. Cluster mode: **"Disabled"** (single node is enough for our workload).
3. Name: `intentera-sync`
4. Node type: `cache.t4g.micro` is sufficient.
5. Subnet group + security group: make sure the Lambda's security group can
   reach this security group on port 6379.
6. Once the cluster is **"Available"**, copy the **Primary Endpoint**
   (something like `intentera-sync.abc123.0001.use1.cache.amazonaws.com:6379`).

In your `.env` (or Secrets Manager):

```
REDIS_URL=redis://intentera-sync.abc123.0001.use1.cache.amazonaws.com:6379
```

> ElastiCache in a private VPC means the Lambda **must also be in the VPC**.
> This adds cold-start time and requires a NAT Gateway for outbound internet
> (so the Lambda can reach OpenAI, MongoDB Atlas, and Jira).

---

## Verify Redis is reachable

From the project root with `.env` filled in:

```bash
node -e "
require('dotenv').config();
const Redis = require('ioredis');
(async () => {
  const r = new Redis(process.env.REDIS_URL);
  console.log('PING:', await r.ping());
  await r.quit();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
"
```

Expected output:

```
PING: PONG
```

Common failures:

- `ECONNREFUSED` on `redis://localhost:6379` → the local Docker container
  isn't running. `docker start intentera-redis`.
- `ETIMEDOUT` with ElastiCache → your laptop is not in the VPC. ElastiCache
  is only reachable from inside the VPC.
- `NOAUTH` → the URL is missing a password that the server requires. Use
  `rediss://:YOUR_TOKEN@host:port` (Upstash) or add the password to the URL.

---

## What IntentEra stores in Redis

Two keys under the `REDIS_KEY_PREFIX` (default `intentera:sync:`):

```
intentera:sync:state   → a single JSON object (see examples/redis-state.json)
intentera:sync:lock    → a short-lived lock token with a TTL (auto-expires)
```

That's it. No per-ticket Redis writes, no hot keys.

---

## Cost note

- Local Docker: free.
- Upstash free tier: 10,000 commands/day — way more than enough for typical
  incremental sync schedules (every 30 min × ~2 commands per run = ~100
  commands/day).
- ElastiCache t4g.micro: ~$12/month.

---

## Next

- Go back to [getting-started.md](getting-started.md) step 4.3
  (Jira + Confluence).
