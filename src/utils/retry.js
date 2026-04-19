'use strict';

/**
 * src/utils/retry.js
 * ------------------
 * Reusable exponential-backoff retry helper for transient failures.
 *
 * Many of the external systems we talk to (Jira, Confluence, MongoDB Atlas,
 * Redis, OpenAI, Secrets Manager) can occasionally return 429/503 errors or
 * drop connections during cold-start periods. This helper lets every call
 * site add resilience with one line:
 *
 *     const data = await withRetry(() => axios.get(url), { label: 'jira-get' });
 *
 * The delay schedule is 250ms, 500ms, 1s, 2s, 4s, ..., capped at `maxDelayMs`.
 * A small random "jitter" is added to avoid thundering-herd re-connects when
 * many Lambda containers are rate-limited simultaneously.
 */

const { createLogger } = require('./logger');

const defaultLogger = createLogger({ component: 'retry' });

/**
 * Sleeps for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default "is this error worth retrying?" predicate. Retries on:
 *   - network errors (no status)
 *   - HTTP 408, 409, 425, 429
 *   - HTTP 5xx
 * Extend or override via options.shouldRetry.
 *
 * @param {any} err
 * @returns {boolean}
 */
function defaultShouldRetry(err) {
  if (!err) return false;
  // Axios puts status on err.response.status.
  const status = err?.response?.status ?? err?.status;
  if (status === undefined) return true; // no status = likely network/timeout
  if ([408, 409, 425, 429].includes(status)) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/**
 * Runs `fn` and retries on transient failures using exponential backoff.
 *
 * @template T
 * @param {() => Promise<T>} fn The operation to run. Must return a promise.
 * @param {Object} [opts]
 * @param {number} [opts.maxAttempts=5]   Including the first attempt.
 * @param {number} [opts.baseDelayMs=250] Delay before the second attempt.
 * @param {number} [opts.maxDelayMs=8000] Cap for the exponential backoff.
 * @param {(err:any)=>boolean} [opts.shouldRetry] Override retry predicate.
 * @param {string} [opts.label] Free-form name used in log lines.
 * @param {ReturnType<typeof createLogger>} [opts.logger] Structured logger to use.
 * @returns {Promise<T>}
 */
async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 250,
    maxDelayMs = 8000,
    shouldRetry = defaultShouldRetry,
    label = 'operation',
    logger = defaultLogger,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const retryable = shouldRetry(err);
      if (!retryable || attempt >= maxAttempts) {
        logger.warn('retry giving up', {
          label,
          attempt,
          retryable,
          error: err?.message,
        });
        throw err;
      }

      // Exponential backoff with ±20% jitter.
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = exp * (0.8 + Math.random() * 0.4);
      logger.warn('retry scheduled', {
        label,
        attempt,
        nextDelayMs: Math.round(jitter),
        error: err?.message,
      });
      await sleep(jitter);
    }
  }
}

module.exports = {
  withRetry,
  sleep,
  defaultShouldRetry,
};
