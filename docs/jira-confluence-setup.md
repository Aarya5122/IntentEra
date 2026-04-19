# Jira and Confluence Setup

IntentEra reads data from **Atlassian Jira Cloud** and (optionally)
**Atlassian Confluence Cloud**. Both use the same account and the same API
token — you create one token and reuse it.

---

## 1. Find your Atlassian base URL

Look at the URL you use to log in to Jira. It is usually something like:

```
https://your-company.atlassian.net
```

That is your `JIRA_BASE_URL`. For Confluence it is the same domain plus
`/wiki`:

```
https://your-company.atlassian.net/wiki
```

That is your `CONFLUENCE_BASE_URL`. You can leave `CONFLUENCE_BASE_URL`
blank in `.env` — IntentEra falls back to `<JIRA_BASE_URL>/wiki`
automatically.

---

## 2. Generate an Atlassian API token

1. Visit
   [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Sign in if prompted.
3. Click **"Create API token"**.
4. Give it a label (e.g. `intentera-rag`).
5. Click **"Create"**.
6. **Immediately** click **"Copy to clipboard"** and paste the token
   somewhere safe. You will NOT be able to see it again.

That token value (a long string starting with `ATATT...`) is your
`JIRA_API_TOKEN`. Reuse the same token for `CONFLUENCE_API_TOKEN` unless
you specifically want a separate Confluence token.

---

## 3. Identify your Atlassian email

Your Atlassian **email** is what you log in with (not your display name).
Paste it into `.env` as `JIRA_EMAIL` (and `CONFLUENCE_EMAIL` if needed).

---

## 4. Pick which Jira projects to index

You can limit the ingestion scope to one or more Jira projects using their
project **keys** (the prefix in ticket IDs — for example, `PROJ` in
`PROJ-123`).

In `.env`:

```
JIRA_PROJECT_KEYS=PROJ,ENG
```

Leave it blank to ingest **every** project you have access to (not
recommended unless your Jira instance is small).

---

## 5. Optional: narrow the scope further

You can also filter by issue type, status, or labels:

```
JIRA_ISSUE_TYPES=Bug,Story
JIRA_STATUSES=Open,In Progress
JIRA_LABELS=backend,auth
```

Empty values mean "no filter on this field". The filters are AND-combined.

---

## 6. Test Jira access

From a terminal with `.env` filled in:

```bash
node -e "
require('dotenv').config();
const axios = require('axios');
const auth = Buffer.from(process.env.JIRA_EMAIL + ':' + process.env.JIRA_API_TOKEN).toString('base64');
axios.get(process.env.JIRA_BASE_URL + '/rest/api/3/myself', {
  headers: { Authorization: 'Basic ' + auth }
}).then(r => console.log('Jira OK — logged in as:', r.data.displayName))
  .catch(e => { console.error('FAILED:', e.response?.status, e.response?.data || e.message); process.exit(1); });
"
```

Expected output:

```
Jira OK — logged in as: Your Name
```

If you see:

- `401 Unauthorized` — bad email or token. Regenerate the token.
- `403 Forbidden` — your account doesn't have permission for that endpoint
  (rare).
- `ENOTFOUND` — the `JIRA_BASE_URL` is wrong (typo or missing `https://`).

---

## 7. Test Confluence access (optional)

Only needed if you set `JIRA_INCLUDE_CONFLUENCE=true`.

```bash
node -e "
require('dotenv').config();
const axios = require('axios');
const email = process.env.CONFLUENCE_EMAIL || process.env.JIRA_EMAIL;
const token = process.env.CONFLUENCE_API_TOKEN || process.env.JIRA_API_TOKEN;
const base = process.env.CONFLUENCE_BASE_URL || (process.env.JIRA_BASE_URL + '/wiki');
const auth = Buffer.from(email + ':' + token).toString('base64');
axios.get(base + '/api/v2/spaces?limit=1', {
  headers: { Authorization: 'Basic ' + auth }
}).then(r => console.log('Confluence OK — found', r.data.results.length, 'space(s)'))
  .catch(e => { console.error('FAILED:', e.response?.status, e.response?.data || e.message); process.exit(1); });
"
```

---

## 8. About permissions

A few things to know:

- The API token grants the **same permissions your user account has**.
- For IntentEra to see tickets in a project, your account must be a
  member of that project (with "Browse projects" at minimum).
- For attachments to download, your account needs "View attachments"
  permission on that project.
- For Confluence, your account must have "View" access on the spaces you
  want indexed.

If you are an admin, the easiest approach is to use a dedicated "service
account" user that is granted read-only access to all relevant projects
and spaces. That way a human leaving the company doesn't break ingestion.

---

## 9. How IntentEra uses these credentials

- `src/jira/client.js` makes Basic-auth REST calls to
  `/rest/api/3/search`, `/rest/api/3/issue/<key>/comment`, and
  `/rest/api/3/issue/<key>/remotelink`.
- `src/confluence/client.js` makes Basic-auth REST calls to
  `/api/v2/pages/<id>?body-format=storage`.
- Attachment downloads use the same Basic-auth header on the signed
  content URL Jira returns.

All requests go through `src/utils/retry.js`, so transient 429/5xx errors
are automatically retried with exponential backoff.

---

## Next

- Go back to [getting-started.md](getting-started.md) step 4.4 (OpenAI).
