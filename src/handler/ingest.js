'use strict';

/**
 * src/handler/ingest.js
 * ---------------------
 * AWS Lambda entry point for the INGESTION pipeline.
 *
 * Trigger sources:
 *   1. EventBridge scheduled rule (recommended for incremental sync). The
 *      payload is just the scheduled-event envelope so we treat "no mode,
 *      no source" as "mode=incremental, source=<SYNC_SOURCE or jira>".
 *   2. Manual invocation (AWS Console, aws-cli, or the local CLI runner).
 *      Payload may include:
 *         {
 *           "mode":         "full" | "incremental",
 *           "source":       "jira" | "github",
 *           "entityTypes":  ["commits","pullRequests","issues"] // github only
 *         }
 *
 * Environment fallback:
 *   - If the payload does not specify `mode`, we look at `SYNC_MODE`.
 *   - If the payload does not specify `source`, we look at `SYNC_SOURCE`.
 *     Both default to `incremental` / `jira` respectively.
 *
 * Return shape (also logged):
 *   - Success: SyncResult (jira) or GithubSyncResult (github).
 *   - Failure: the handler lets the error propagate so Lambda marks the
 *     invocation as failed.
 */

const { runSync } = require('../sync/orchestrator');
const { runGithubSync } = require('../github/orchestrator');
const {
  buildIngestionDeps,
  buildGithubIngestionDeps,
} = require('../utils/wiring');

/**
 * Resolves the run mode from event payload + env vars.
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
 * Resolves the source from event payload + env vars. Defaults to "jira" so
 * existing EventBridge rules continue to invoke the Jira pipeline without
 * needing a new payload.
 * @param {any} event
 * @param {string} envDefault
 * @returns {"jira"|"github"}
 */
function resolveSource(event, envDefault) {
  const candidate = (event?.source || envDefault || 'jira').toLowerCase();
  if (candidate !== 'jira' && candidate !== 'github') {
    throw new Error(`Invalid source "${candidate}" — expected "jira" or "github"`);
  }
  return candidate;
}

/**
 * Lambda handler. Named `handler` to match the common AWS convention.
 * Configure the Lambda with `src/handler/ingest.handler` as the entry point.
 *
 * @param {any} event Raw event payload from Lambda.
 * @param {any} [context] Lambda runtime context (unused directly).
 * @returns {Promise<any>}
 */
async function handler(event, context) {
  // We need SOME deps loaded to read the config defaults. Use the jira
  // ingestion-dep builder lazily since its cfg is shared with github.
  // `buildIngestionDeps` is lightweight when source=github ends up being
  // used because the real ingestion still goes through buildGithubIngestionDeps.
  // To avoid requiring Jira creds when the user is github-only, we load the
  // config directly via loadConfig.
  const { loadConfig } = require('../utils/wiring');
  const cfg = await loadConfig();
  const source = resolveSource(event, cfg.defaultSource);
  const mode = resolveMode(event, cfg.defaultMode);

  if (source === 'github') {
    const deps = await buildGithubIngestionDeps();
    deps.logger.info('github ingestion invocation received', {
      mode,
      entityTypes: event?.entityTypes || null,
      awsRequestId: context?.awsRequestId,
    });
    return runGithubSync(deps, {
      mode,
      entityTypes: Array.isArray(event?.entityTypes) ? event.entityTypes : undefined,
      logger: deps.logger,
    });
  }

  const deps = await buildIngestionDeps();
  deps.logger.info('jira ingestion invocation received', {
    mode,
    awsRequestId: context?.awsRequestId,
  });
  return runSync(deps, { mode, logger: deps.logger });
}

module.exports = { handler, resolveMode, resolveSource };
