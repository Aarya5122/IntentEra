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
 *   node src/cli/runner.js incremental
 *   node src/cli/runner.js full
 *   node src/cli/runner.js query "How did we fix the login bug?" [--topK 5] [--project PROJ]
 *   node src/cli/runner.js state    # prints the current Redis sync state
 *
 * The CLI loads `.env` automatically via dotenv. It also tears down Redis
 * and Mongo connections at the end so Node can exit cleanly.
 */

/* eslint-disable no-console */

// Load environment variables from a local .env file if present. In Lambda
// this is a no-op because the file does not exist — the SDK picks up env
// vars from the Lambda configuration instead.
require('dotenv').config();

const { handler: ingestHandler } = require('../handler/ingest');
const { handler: retrieveHandler } = require('../handler/retrieve');
const { buildIngestionDeps, teardown } = require('../utils/wiring');

/**
 * Parses simple `--flag value` pairs from process.argv.
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
 * Simulates an EventBridge / manual invocation of the ingestion Lambda.
 * @param {"incremental"|"full"} mode
 */
async function runIngestion(mode) {
  const event = mode ? { mode } : {};
  // We mimic the Lambda context lightly so code that logs `awsRequestId`
  // still works during local dev.
  const context = { awsRequestId: `local-${Date.now()}` };
  const result = await ingestHandler(event, context);
  printJson(result);
}

/**
 * Simulates an API Gateway retrieval invocation.
 * @param {string} query
 * @param {Record<string,string>} flags
 */
async function runQuery(query, flags) {
  const filters = {};
  if (flags.project) filters.projectKey = flags.project;
  if (flags.ticket) filters.ticketKey = flags.ticket;
  if (flags.sourceType) filters.sourceType = flags.sourceType.split(',');
  if (flags.labels) filters.labels = flags.labels.split(',');

  const event = {
    body: JSON.stringify({
      query,
      topK: flags.topK ? Number(flags.topK) : undefined,
      filters,
    }),
  };
  const context = { awsRequestId: `local-${Date.now()}` };
  const response = await retrieveHandler(event, context);
  // Parse the proxy-envelope body so the CLI output is easy to read.
  try {
    response.body = JSON.parse(response.body);
  } catch (_err) {
    /* leave body as-is if not JSON */
  }
  printJson(response);
}

/**
 * Prints the current Redis sync state. Useful for debugging.
 */
async function printState() {
  const { redisState } = await buildIngestionDeps();
  const state = await redisState.readState();
  printJson(state);
}

/**
 * CLI entry point.
 */
async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;

  // Default to incremental if the caller provided no command.
  const mode = command || 'incremental';

  try {
    switch (mode) {
      case 'incremental':
      case 'full':
        await runIngestion(mode);
        break;
      case 'query': {
        const query = rest.join(' ') || flags.query;
        if (!query) throw new Error('query command requires a query string');
        await runQuery(query, flags);
        break;
      }
      case 'state':
        await printState();
        break;
      case 'help':
      case '--help':
      case '-h':
        console.log(
          'Usage: node src/cli/runner.js <full|incremental|query|state>\n\n' +
          '  incremental         Simulate the EventBridge incremental sync event.\n' +
          '  full                Simulate a forced full-import invocation.\n' +
          '  query "..."         Simulate an API Gateway retrieval call.\n' +
          '     --topK N           Override default topK\n' +
          '     --project KEY      Filter by project key\n' +
          '     --ticket KEY       Filter by ticket key\n' +
          '     --sourceType a,b   Filter by source types (comma-separated)\n' +
          '     --labels l1,l2     Require all of these labels\n' +
          '  state               Print the current Redis sync state.\n'
        );
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

// Only run main when this file is executed directly, not when required in
// tests.
if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
