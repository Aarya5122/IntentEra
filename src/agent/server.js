'use strict';

/**
 * src/agent/server.js
 * -------------------
 * The "Local Git Agent": a tiny HTTP server that the VS Code / Cursor
 * extension talks to in order to extract commit history from the user's
 * local clone of the project. Lambdas can't reach the user's filesystem,
 * so this lives on the dev machine.
 *
 * Endpoints
 * ---------
 *   GET  /healthz      → liveness check used by the extension.
 *   POST /git/history  → core endpoint: returns commits for attachments.
 *
 * Wire format
 * -----------
 *   Request body:
 *     {
 *       projectPath: "/Users/me/code/my-app",
 *       attachments: [
 *         { file: "src/server/auth.ts", range: [42, 80] },
 *         { file: "README.md" }
 *       ],
 *       maxCommits: 50            // optional override; clamped to config.
 *     }
 *
 *   Response body (200):
 *     {
 *       projectPath: "/Users/me/code/my-app",
 *       commits:     [ ...NormalizedCommit ],
 *       skipped:     [ { file, reason } ]
 *     }
 *
 * Security model
 * --------------
 *   - Bound to 127.0.0.1 only — never reachable off-host.
 *   - No auth: loopback-only on a developer machine is the trust boundary.
 *   - `projectPath` MUST be an absolute path containing a `.git` directory.
 *   - When `chat.allowedProjectRoots` is non-empty, projectPath must start
 *     with one of the configured prefixes.
 *
 * Why Express?
 * ------------
 * The codebase already depends on `express` for nothing else, but the API
 * surface is tiny and the readability benefits (routing, body parsing,
 * error middleware) more than pay for the ~150KB it adds. We keep the
 * agent's footprint minimal so it can boot in well under a second.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const { LocalHistoryExtractor } = require('../localGit/historyExtractor');
const { createLogger } = require('../utils/logger');

/**
 * Builds (but does not start) an Express app for the local git agent.
 * Exported separately so tests can mount the app on supertest without a
 * real HTTP listener.
 *
 * @param {Object} opts
 * @param {import('../../config/appConfig').AppConfig} opts.cfg
 * @param {ReturnType<typeof createLogger>} [opts.logger]
 * @returns {import('express').Express}
 */
function createAgentApp({ cfg, logger }) {
  const log = (logger || createLogger({ app: 'intentera', role: 'agent' })).child({
    component: 'agent',
  });
  const app = express();

  // Generous JSON limit so a multi-attachment request with file contents
  // still fits, but bounded so a runaway client cannot exhaust memory.
  app.use(express.json({ limit: '4mb' }));

  // Allow only the VS Code webview origin and well-known localhost dev
  // tooling. We never want this open to arbitrary cross-origin pages.
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const allow =
      !origin ||
      origin.startsWith('vscode-webview://') ||
      origin.startsWith('vscode-file://') ||
      origin.startsWith('http://127.0.0.1') ||
      origin.startsWith('http://localhost');
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      service: 'intentera-local-git-agent',
      version: require('../../package.json').version,
    });
  });

  app.post('/git/history', async (req, res) => {
    const body = req.body || {};
    try {
      validateProjectPath(body.projectPath, cfg.chat.allowedProjectRoots);
    } catch (err) {
      log.warn('rejecting /git/history (path)', { error: err.message });
      res.status(400).json({ error: err.message });
      return;
    }
    if (!Array.isArray(body.attachments)) {
      res.status(400).json({ error: '`attachments` must be an array' });
      return;
    }

    const maxCommits = clampInt(
      body.maxCommits,
      1,
      cfg.chat.maxLocalCommits,
      cfg.chat.maxLocalCommits
    );

    const extractor = new LocalHistoryExtractor({
      projectPath: body.projectPath,
      maxCommits,
      logger: log,
    });

    try {
      const result = await extractor.extract(body.attachments);
      res.json({
        projectPath: body.projectPath,
        commits: result.commits,
        skipped: result.skipped,
      });
    } catch (err) {
      log.error('git history extraction failed', { error: err });
      res.status(500).json({ error: 'history extraction failed', detail: err.message });
    }
  });

  // Catch-all error handler so async exceptions still produce JSON.
  app.use((err, _req, res, _next) => {
    log.error('agent unhandled error', { error: err });
    res.status(500).json({ error: 'internal agent error' });
  });

  return app;
}

/**
 * Boots the local git agent on `cfg.chat.agentPort`, bound to 127.0.0.1.
 *
 * @param {Object} opts
 * @param {import('../../config/appConfig').AppConfig} opts.cfg
 * @param {ReturnType<typeof createLogger>} [opts.logger]
 * @returns {Promise<{ app: import('express').Express, server: import('http').Server, url: string }>}
 */
async function startAgent({ cfg, logger }) {
  const log = (logger || createLogger({ app: 'intentera', role: 'agent' })).child({
    component: 'agent',
  });
  const app = createAgentApp({ cfg, logger: log });

  return new Promise((resolve, reject) => {
    const server = app.listen(cfg.chat.agentPort, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${cfg.chat.agentPort}`;
      log.info('local git agent listening', { url });
      resolve({ app, server, url });
    });
    server.on('error', (err) => {
      log.error('agent failed to bind', { error: err });
      reject(err);
    });
  });
}

/**
 * Validates `projectPath` against the allowlist + the .git existence rule.
 *
 * @param {any} projectPath
 * @param {string[]} allowedRoots
 */
function validateProjectPath(projectPath, allowedRoots) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('`projectPath` is required and must be a string');
  }
  if (!path.isAbsolute(projectPath)) {
    throw new Error('`projectPath` must be an absolute path');
  }
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    throw new Error(`no .git directory at "${projectPath}"`);
  }
  if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
    const ok = allowedRoots.some((root) => projectPath === root || projectPath.startsWith(`${root}${path.sep}`));
    if (!ok) {
      throw new Error('`projectPath` is not in AGENT_ALLOWED_PROJECT_ROOTS');
    }
  }
}

/**
 * Clamps a value to `[min,max]`, returning `fallback` if the value isn't a
 * finite number.
 *
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

module.exports = {
  createAgentApp,
  startAgent,
  validateProjectPath,
};
