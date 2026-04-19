'use strict';

/**
 * src/utils/logger.js
 * -------------------
 * A tiny structured logger that writes one JSON line per log event. Why JSON?
 *
 *   - In AWS Lambda, CloudWatch Logs Insights can parse JSON fields natively,
 *     which makes querying (filter, count, group-by) dramatically easier than
 *     scraping plain text messages.
 *   - It is also fine for local development: the CLI just prints JSON lines.
 *
 * Log levels follow the usual hierarchy:
 *     debug < info < warn < error
 * and the current level is read from LOG_LEVEL (default "info").
 *
 * We deliberately do NOT pull in a heavy library (pino, winston, bunyan) to
 * keep the Lambda deployment package small.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Returns the numeric threshold for the currently configured log level.
 * Reads process.env every call so that mid-run env changes (mostly tests)
 * take effect.
 * @returns {number}
 */
function currentThreshold() {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

/**
 * Writes a structured log line if the event's level is at or above threshold.
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message Human-readable summary of the event.
 * @param {Record<string, any>} [meta] Extra structured fields to include.
 */
function write(level, message, meta) {
  if (LEVELS[level] < currentThreshold()) return;

  // We keep the payload flat so CloudWatch Insights can do `fields level, msg`.
  const entry = {
    level,
    msg: message,
    time: new Date().toISOString(),
    ...(meta && typeof meta === 'object' ? meta : {}),
  };

  // Error levels go to stderr so Lambda marks the invocation as warning/error
  // in the dashboard if applicable. Everything else goes to stdout.
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/**
 * Creates a logger "bound" to a context object that is merged into every
 * subsequent log line. Useful for carrying trace/run identifiers.
 * @param {Record<string, any>} [context]
 * @returns {Logger}
 */
function createLogger(context = {}) {
  /** @typedef {{
   *   debug: (msg: string, meta?: Record<string, any>) => void,
   *   info:  (msg: string, meta?: Record<string, any>) => void,
   *   warn:  (msg: string, meta?: Record<string, any>) => void,
   *   error: (msg: string, meta?: Record<string, any>) => void,
   *   child: (extra: Record<string, any>) => Logger
   * }} Logger */

  const merge = (meta) => ({ ...context, ...(meta || {}) });

  return {
    debug: (msg, meta) => write('debug', msg, merge(meta)),
    info: (msg, meta) => write('info', msg, merge(meta)),
    warn: (msg, meta) => write('warn', msg, merge(meta)),
    error: (msg, meta) => {
      // If caller passes an Error instance directly under `error`, extract
      // name/message/stack so they survive JSON.stringify (Error is not
      // serialisable by default).
      const prepared = meta && meta.error instanceof Error
        ? { ...meta, error: { name: meta.error.name, message: meta.error.message, stack: meta.error.stack } }
        : meta;
      write('error', msg, merge(prepared));
    },
    child: (extra) => createLogger({ ...context, ...(extra || {}) }),
  };
}

module.exports = {
  createLogger,
};
