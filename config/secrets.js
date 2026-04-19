'use strict';

/**
 * config/secrets.js
 * -----------------
 * Loads secret values from AWS Secrets Manager and merges them into
 * `process.env` so that the rest of the application can keep reading values
 * from environment variables uniformly.
 *
 * Why merge into process.env?
 *   - `appConfig.js` reads every setting from process.env. That keeps the app
 *     code simple (just read env vars) regardless of whether we are running
 *     locally (values come from a .env file) or in AWS (values come from
 *     Secrets Manager). The loader here is the ONE place that knows about
 *     Secrets Manager.
 *
 * Flow:
 *   1. Lambda boots → calls `loadSecretsIfConfigured()` very early (before
 *      `appConfig.js` is imported).
 *   2. If USE_SECRETS_MANAGER=true AND SECRETS_MANAGER_SECRET_ID is set,
 *      we fetch the secret JSON, parse it, and copy keys into process.env.
 *   3. Existing env vars are NOT overwritten. This way, operators can pin a
 *      value via Lambda environment variables if they ever need to override
 *      what is in Secrets Manager.
 *
 * Local development:
 *   - Leave USE_SECRETS_MANAGER=false (the default).
 *   - The CLI runner calls `dotenv.config()` which populates process.env from
 *     a local `.env` file, and `loadSecretsIfConfigured()` becomes a no-op.
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

/**
 * Cached promise so that multiple concurrent callers (e.g. handler + shared
 * init code in the same Lambda cold start) do not each round-trip to AWS.
 * @type {Promise<void> | null}
 */
let cachedLoad = null;

/**
 * Returns a boolean env flag defensively (handles undefined/empty/etc).
 * @param {string} name env var name
 * @param {boolean} fallback value to return if env var is unset
 * @returns {boolean}
 */
function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

/**
 * Fetches the configured AWS Secrets Manager secret and merges its JSON
 * payload into process.env. Idempotent: repeated calls reuse the first result.
 *
 * Expected secret payload shape (a plain JSON object with string values):
 *   {
 *     "JIRA_BASE_URL": "...",
 *     "JIRA_EMAIL": "...",
 *     "JIRA_API_TOKEN": "...",
 *     "OPENAI_API_KEY": "...",
 *     "MONGODB_URI": "...",
 *     "REDIS_URL": "...",
 *     ...
 *   }
 *
 * @returns {Promise<void>}
 */
async function loadSecretsIfConfigured() {
  if (cachedLoad) return cachedLoad;

  // Exit early for local development so the developer does not need AWS creds.
  const enabled = readBoolEnv('USE_SECRETS_MANAGER', false);
  const secretId = process.env.SECRETS_MANAGER_SECRET_ID;
  if (!enabled || !secretId) {
    cachedLoad = Promise.resolve();
    return cachedLoad;
  }

  cachedLoad = (async () => {
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new SecretsManagerClient({ region });

    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );

    // Secrets Manager can return either SecretString (JSON/text) or
    // SecretBinary (base64). For our use case we expect JSON strings.
    const raw = response.SecretString;
    if (!raw) {
      throw new Error(
        `Secrets Manager secret "${secretId}" returned no SecretString`
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Secrets Manager secret "${secretId}" is not valid JSON: ${err.message}`
      );
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(
        `Secrets Manager secret "${secretId}" must be a JSON object`
      );
    }

    // Merge without overwriting existing env vars: Lambda console values win.
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = typeof value === 'string' ? value : String(value);
      }
    }
  })();

  return cachedLoad;
}

/**
 * Resets the cache. Primarily useful in tests where we want to re-run the
 * loader with different mocks. Production code should never call this.
 */
function _resetSecretsCache() {
  cachedLoad = null;
}

module.exports = {
  loadSecretsIfConfigured,
  _resetSecretsCache,
};
