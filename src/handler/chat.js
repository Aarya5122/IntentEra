'use strict';

/**
 * src/handler/chat.js
 * -------------------
 * AWS Lambda entry point for the CHAT API used by the VS Code / Cursor
 * extension. Mirrors the structure of `src/handler/retrieve.js` so an
 * operator who knows one knows the other.
 *
 * Expected trigger: API Gateway (HTTP API or REST API) POST.
 * Accepts both invocation styles:
 *   - API Gateway proxy integration: event has `body` as a JSON string.
 *   - Direct Lambda invoke: event IS the JSON payload already.
 *
 * Request body:
 *   {
 *     "question":   "Why are we doing the retry like this?",
 *     "commits":    [ NormalizedCommit, ... ],   // from local git agent
 *     "attachments":[ { file, range?, content? }, ... ],
 *     "history":    [ { role, content }, ... ],   // optional
 *     "filters":    { ... }                        // optional, vector-store filters
 *   }
 *
 * Response (API Gateway proxy shape):
 *   {
 *     "statusCode": 200,
 *     "headers":    { "Content-Type": "application/json" },
 *     "body":       "<JSON answer + citations>"
 *   }
 *
 * On bad input we return 4xx with `{error: "..."}`. On any other failure we
 * return 5xx with a generic message and log the stack server-side.
 */

const { ChatOrchestrator } = require('../chat/orchestrator');
const { buildChatDeps } = require('../utils/wiring');

/**
 * Extracts the parsed JSON body regardless of invocation style.
 * @param {any} event
 * @returns {Record<string, any>}
 */
function parseBody(event) {
  if (!event) return {};
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body);
    } catch (_err) {
      throw new Error('request body is not valid JSON');
    }
  }
  if (event.body && typeof event.body === 'object') return event.body;
  return event;
}

/**
 * Wraps a body in the API Gateway proxy envelope.
 *
 * CORS is permissive (`*`) so the VS Code webview (which sends
 * `Origin: vscode-webview://...`) and the local agent (loopback) can both
 * call us during development. In production lock this down to your domain.
 *
 * @param {number} statusCode
 * @param {any} body
 */
function envelope(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Lambda handler. Configure the Lambda with `src/handler/chat.handler` as
 * the entry point.
 *
 * @param {any} event
 * @param {any} [context]
 */
async function handler(event, context) {
  // Short-circuit CORS preflight without doing any work.
  if (event?.requestContext?.http?.method === 'OPTIONS' || event?.httpMethod === 'OPTIONS') {
    return envelope(204, {});
  }

  const deps = await buildChatDeps();
  deps.logger.debug('chat invocation received', { awsRequestId: context?.awsRequestId });

  let body;
  try {
    body = parseBody(event);
  } catch (err) {
    return envelope(400, { error: err.message });
  }

  const orchestrator = new ChatOrchestrator({
    embedder: deps.embedder,
    jiraVectorStore: deps.jiraVectorStore,
    githubVectorStore: deps.githubVectorStore,
    answerer: deps.answerer,
    cfg: deps.cfg,
    logger: deps.logger,
  });

  try {
    const result = await orchestrator.chat({
      question: body.question,
      commits: body.commits,
      attachments: body.attachments,
      history: body.history,
      filters: body.filters,
    });
    return envelope(200, result);
  } catch (err) {
    const isClientError = /must be|invalid|required|unsupported/i.test(err?.message || '');
    deps.logger.error('chat failed', { error: err });
    return envelope(isClientError ? 400 : 500, {
      error: isClientError ? err.message : 'chat failed',
    });
  }
}

module.exports = { handler };
