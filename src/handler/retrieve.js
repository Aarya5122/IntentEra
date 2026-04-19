'use strict';

/**
 * src/handler/retrieve.js
 * -----------------------
 * AWS Lambda entry point for the RETRIEVAL API.
 *
 * Expected trigger: API Gateway (HTTP API or REST API) POST.
 * Accepts both:
 *   - API Gateway proxy integration: event has `body` as a JSON string.
 *   - Direct Lambda invoke: event IS the JSON payload already.
 *
 * Request body:
 *   {
 *     "query":   "How did we fix the login bug in July?",
 *     "topK":    8,                           // optional
 *     "source":  "jira" | "github" | "both",  // optional, default jira
 *     "filters": {                            // optional
 *       // Jira filters:
 *       "projectKey": "PROJ",
 *       "sourceType": ["description","comments"],
 *       "ticketKey":  "PROJ-123",
 *       "labels":     ["auth","ssr"],
 *       // GitHub filters:
 *       "repoFullName": "octocat/hello-world",
 *       "entityType":   "pullRequest",
 *       "entityKey":    "pr:42",
 *       "branches":     ["main","release/1.0"],
 *       "filePaths":    ["src/auth.ts"],
 *       "prNumber":     42,
 *       "issueNumber":  15,
 *       "commitSha":    "abcd..."
 *     }
 *   }
 *
 * Response (API Gateway proxy shape):
 *   {
 *     "statusCode": 200,
 *     "headers":    { "Content-Type": "application/json" },
 *     "body":       "<JSON retrieval response>"
 *   }
 *
 * On error we return a 4xx / 5xx with a JSON body describing the failure.
 * We avoid leaking internal stack traces to the client.
 */

const { RetrievalHandler } = require('../retrieval/queryHandler');
const { buildRetrievalDeps } = require('../utils/wiring');

/**
 * Extracts the parsed JSON body regardless of invocation style.
 * @param {any} event
 * @returns {Record<string, any>}
 */
function parseBody(event) {
  if (!event) return {};
  // API Gateway proxy integration passes the body as a string.
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (_err) {
      throw new Error('request body is not valid JSON');
    }
  }
  if (event.body && typeof event.body === 'object') return event.body;
  // Direct Lambda invoke: the event itself is the payload.
  return event;
}

/**
 * Helper that wraps a plain response body in the API Gateway proxy envelope.
 * @param {number} statusCode
 * @param {any} body
 * @returns {{statusCode: number, headers: Record<string,string>, body: string}}
 */
function envelope(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Lambda handler. Configure the Lambda with `src/handler/retrieve.handler`
 * as the entry point.
 *
 * @param {any} event
 * @param {any} [context]
 * @returns {Promise<object>} API Gateway proxy response.
 */
async function handler(event, context) {
  const deps = await buildRetrievalDeps();
  deps.logger.debug('retrieval invocation received', { awsRequestId: context?.awsRequestId });

  let body;
  try {
    body = parseBody(event);
  } catch (err) {
    return envelope(400, { error: err.message });
  }

  const retrieval = new RetrievalHandler({
    embedder: deps.embedder,
    jiraVectorStore: deps.jiraVectorStore,
    githubVectorStore: deps.githubVectorStore,
    vectorStore: deps.vectorStore,
    retrievalCfg: deps.cfg.retrieval,
    logger: deps.logger,
  });

  try {
    // Default source follows the same "jira if enabled, else github" rule as
    // the config so a github-only deployment works out of the box.
    const defaultSource = deps.cfg.jira.enabled ? 'jira' : 'github';
    const result = await retrieval.retrieve({
      query: body.query,
      topK: body.topK,
      source: body.source || defaultSource,
      filters: body.filters,
    });
    return envelope(200, result);
  } catch (err) {
    const isClientError = /must be|invalid|unsupported/i.test(err?.message || '');
    deps.logger.error('retrieval failed', { error: err });
    return envelope(isClientError ? 400 : 500, {
      error: isClientError ? err.message : 'retrieval failed',
    });
  }
}

module.exports = { handler };
