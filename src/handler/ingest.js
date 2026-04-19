'use strict';

/**
 * src/handler/ingest.js
 * ---------------------
 * AWS Lambda entry point for the INGESTION pipeline.
 *
 * Trigger sources:
 *   1. EventBridge scheduled rule (recommended for incremental sync). The
 *      event payload will look something like:
 *          { "source": "aws.events", "detail-type": "Scheduled Event", ... }
 *      which we treat as "mode not specified" → default to incremental.
 *   2. Manual invocation (AWS Console, aws-cli, or the local CLI runner).
 *      Payload may include `{ "mode": "full" }` to force a full import.
 *
 * Event payload contract:
 *   - `mode` (optional): "incremental" | "full"
 *
 * Environment fallback:
 *   - If the payload does not specify mode, we look at `SYNC_MODE`.
 *   - If that is also unset, we default to "incremental".
 *
 * Return shape (also logged):
 *   - Success: the SyncResult object from the orchestrator.
 *   - Failure: the handler lets the error propagate so Lambda marks the
 *     invocation as failed and CloudWatch metrics reflect that.
 */

const { runSync } = require('../sync/orchestrator');
const { buildIngestionDeps } = require('../utils/wiring');

/**
 * Resolves the run mode from event payload and env vars.
 * @param {any} event
 * @param {string} envDefault
 * @returns {"incremental"|"full"}
 */
function resolveMode(event, envDefault) {
  const candidate = (event?.mode || envDefault || 'incremental').toLowerCase();
  if (candidate !== 'incremental' && candidate !== 'full') {
    throw new Error(`Invalid mode "${candidate}" — expected "incremental" or "full"`);
  }
  return candidate;
}

/**
 * Lambda handler. Named `handler` to match the common AWS convention; configure
 * the Lambda with `src/handler/ingest.handler` as the entry point.
 *
 * @param {any} event Raw event payload from Lambda.
 * @param {any} [context] Lambda runtime context (unused directly).
 * @returns {Promise<import('../sync/orchestrator').SyncResult>}
 */
async function handler(event, context) {
  const deps = await buildIngestionDeps();
  const mode = resolveMode(event, deps.cfg.defaultMode);
  deps.logger.info('ingestion invocation received', {
    mode,
    awsRequestId: context?.awsRequestId,
  });
  return runSync(deps, { mode, logger: deps.logger });
}

module.exports = { handler, resolveMode };
