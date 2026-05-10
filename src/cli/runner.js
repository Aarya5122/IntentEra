'use strict';

/**
 * src/cli/runner.js
 * -----------------
 * Local CLI that simulates Lambda invocations. Uses the SAME handler modules
 * as the deployed Lambdas so behaviour stays consistent between local dev
 * and production.
 *
 * Usage (from the project root):
 *
 *   # Jira (default source)
 *   node src/cli/runner.js incremental
 *   node src/cli/runner.js full
 *   node src/cli/runner.js query "How did we fix the login bug?" [--topK 5] [--project PROJ]
 *
 *   # GitHub
 *   node src/cli/runner.js incremental --source github
 *   node src/cli/runner.js full        --source github
 *   node src/cli/runner.js full        --source github --entityTypes commits,pullRequests
 *   node src/cli/runner.js query "Who reviewed the auth PR?" --source github --repo octocat/hello-world
 *
 *   # Retrieval across both sources
 *   node src/cli/runner.js query "SSO rollout timeline" --source both
 *
 *   # State inspection (source-scoped)
 *   node src/cli/runner.js state --source jira
 *   node src/cli/runner.js state --source github
 *
 * The CLI loads `.env` automatically via dotenv. It also tears down Redis
 * and Mongo connections at the end so Node can exit cleanly.
 */

/* eslint-disable no-console */

require('dotenv').config();

const { handler: ingestHandler } = require('../handler/ingest');
const { handler: retrieveHandler } = require('../handler/retrieve');
const {
  buildIngestionDeps,
  buildGithubIngestionDeps,
  loadConfig,
  teardown,
} = require('../utils/wiring');
const { startAgent } = require('../agent/server');
const { createLogger } = require('../utils/logger');

/**
 * Parses simple `--flag value` pairs from process.argv. Boolean flags are
 * set to `"true"` when followed by another flag or nothing.
 * @param {string[]} args
 * @returns {{positional: string[], flags: Record<string,string>}}
 */
function parseArgs(args) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string,string>} */
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[name] = value;
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

/**
 * Pretty-prints a JSON value.
 * @param {any} value
 */
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * Simulates an ingestion invocation. `source` is added to the event payload
 * so the handler picks the right pipeline.
 * @param {"incremental"|"full"} mode
 * @param {"jira"|"github"} source
 * @param {Record<string,string>} flags
 */
async function runIngestion(mode, source, flags) {
  /** @type {Record<string, any>} */
  const event = { mode, source };
  // GitHub-only: optional per-run entity type filter.
  if (source === 'github' && flags.entityTypes) {
    event.entityTypes = flags.entityTypes.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const context = { awsRequestId: `local-${Date.now()}` };
  const result = await ingestHandler(event, context);
  printJson(result);
}

/**
 * Simulates an API Gateway retrieval invocation. Supports Jira-style and
 * GitHub-style filter flags at the same time — the vector store ignores
 * keys it doesn't understand.
 *
 * @param {string} query
 * @param {Record<string,string>} flags
 */
async function runQuery(query, flags) {
  const source = (flags.source || 'jira').toLowerCase();
  /** @type {Record<string, any>} */
  const filters = {};

  // Jira-side filters.
  if (flags.project) filters.projectKey = flags.project;
  if (flags.ticket) filters.ticketKey = flags.ticket;
  if (flags.sourceType) filters.sourceType = flags.sourceType.split(',');
  if (flags.labels) filters.labels = flags.labels.split(',');

  // GitHub-side filters.
  if (flags.repo) filters.repoFullName = flags.repo;
  if (flags.entityType) filters.entityType = flags.entityType;
  if (flags.entityKey) filters.entityKey = flags.entityKey;
  if (flags.branch) filters.branches = flags.branch.split(',');
  if (flags.filePath) filters.filePaths = flags.filePath.split(',');
  if (flags.pr) filters.prNumber = Number(flags.pr);
  if (flags.issue) filters.issueNumber = Number(flags.issue);
  if (flags.commit) filters.commitSha = flags.commit;

  const event = {
    body: JSON.stringify({
      query,
      source,
      topK: flags.topK ? Number(flags.topK) : undefined,
      filters,
    }),
  };
  const context = { awsRequestId: `local-${Date.now()}` };
  const response = await retrieveHandler(event, context);
  try {
    response.body = JSON.parse(response.body);
  } catch (_err) {
    /* leave body as-is if not JSON */
  }
  printJson(response);
}

/**
 * Prints the current Redis sync state for the requested source. Useful for
 * debugging "did the last run actually finish?".
 * @param {"jira"|"github"} source
 */
async function printState(source) {
  const deps = source === 'github'
    ? await buildGithubIngestionDeps()
    : await buildIngestionDeps();
  const state = await deps.redisState.readState();
  printJson(state);
}

/**
 * Boots the local git agent on `cfg.chat.agentPort` (default 8787) and keeps
 * the process alive until the user hits Ctrl+C. Used by `npm run agent` so
 * the VS Code / Cursor extension has somewhere to ask for git history.
 *
 * NOTE: this does NOT call `teardown()` because the agent is long-running
 * and never reaches the CLI's `finally` clause.
 *
 * @returns {Promise<void>}
 */
async function runAgent() {
  // The agent only needs the chat config block (port, allowlist, caps). We
  // intentionally avoid `buildChatDeps()` here to keep the agent free of
  // OpenAI / Mongo connections — it is purely a local git proxy.
  const cfg = await loadConfig();
  const logger = createLogger({ app: 'intentera', role: 'agent-cli' });
  const { server, url } = await startAgent({ cfg, logger });

  console.log(`IntentEra local git agent ready at ${url}`);
  console.log('Press Ctrl+C to stop.');

  // Keep the event loop alive and shut down cleanly on signals.
  await new Promise((resolve) => {
    const stop = (signal) => {
      console.log(`\n${signal} received — shutting down agent...`);
      server.close(() => resolve());
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}

/**
 * Prints usage help.
 */
function printHelp() {
  console.log(
    [
      'Usage: node src/cli/runner.js <command> [options]',
      '',
      'Commands:',
      '  incremental                          Simulate an incremental sync invocation.',
      '  full                                 Simulate a forced full-import invocation.',
      '  query "..."                          Simulate a retrieval call.',
      '  state                                Print the current Redis sync state.',
      '  agent                                Start the local git agent on AGENT_PORT (default 8787).',
      '',
      'Common options:',
      '  --source jira|github|both            jira (default) for ingest/state,',
      '                                       any of the three for query.',
      '  --topK N                             Override default topK for query.',
      '',
      'GitHub ingestion options:',
      '  --entityTypes commits,pullRequests,issues   Restrict types for this run.',
      '',
      'Jira query filters:',
      '  --project KEY                        Filter by project key.',
      '  --ticket KEY                         Filter by ticket key.',
      '  --sourceType a,b                     Filter by source types.',
      '  --labels l1,l2                       Require ALL of these labels.',
      '',
      'GitHub query filters:',
      '  --repo owner/name                    Filter by repo.',
      '  --entityType commit|pullRequest|issue',
      '  --entityKey pr:42 | commit:<sha> | issue:15',
      '  --branch main,release/1.0',
      '  --filePath src/auth.ts,src/server.ts',
      '  --pr 42                              Filter by PR number.',
      '  --issue 15                           Filter by issue number.',
      '  --commit <sha>                       Filter by commit SHA.',
      '',
      'Examples:',
      '  node src/cli/runner.js incremental',
      '  node src/cli/runner.js full --source github',
      '  node src/cli/runner.js query "who fixed SSO?" --source both --topK 10',
      '  node src/cli/runner.js state --source github',
      '',
    ].join('\n')
  );
}

/**
 * CLI entry point.
 */
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  const mode = command || 'incremental';
  const source = (flags.source || 'jira').toLowerCase();
  if (!['jira', 'github', 'both'].includes(source)) {
    console.error(`error: --source must be one of jira|github|both (got "${flags.source}")`);
    process.exitCode = 1;
    return;
  }

  try {
    switch (mode) {
      case 'incremental':
      case 'full': {
        if (source === 'both') {
          throw new Error('ingestion commands require --source jira or --source github');
        }
        await runIngestion(mode, /** @type {"jira"|"github"} */ (source), flags);
        break;
      }
      case 'query': {
        const query = rest.join(' ') || flags.query;
        if (!query) throw new Error('query command requires a query string');
        await runQuery(query, flags);
        break;
      }
      case 'state': {
        if (source === 'both') {
          throw new Error('state command requires --source jira or --source github');
        }
        await printState(/** @type {"jira"|"github"} */ (source));
        break;
      }
      case 'agent':
      case 'agent-server': {
        // Long-running; we don't tear down on exit because the user stops
        // the process with Ctrl+C.
        await runAgent();
        // After SIGINT we fall through to the finally to release Mongo/Redis
        // (which were never opened by the agent path, but teardown is idempotent).
        break;
      }
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        throw new Error(`Unknown command "${mode}"`);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
    process.exitCode = 1;
  } finally {
    await teardown();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
