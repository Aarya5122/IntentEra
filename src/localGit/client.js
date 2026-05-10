'use strict';

/**
 * src/localGit/client.js
 * ----------------------
 * Thin wrapper around `simple-git` that exposes the three operations the
 * chat orchestrator needs:
 *
 *   1. `lineHistory(file, start, end)` — every commit that touched the given
 *      line range of `file`. Implemented with `git log -L start,end:file`,
 *      the canonical "blame this range over time" plumbing command.
 *   2. `fileHistory(file, { follow })` — every commit that touched the file
 *      itself. With `follow: true` we follow renames so a file that was
 *      moved still shows the full history.
 *   3. `show(sha)` — full commit detail (subject, body, file list).
 *
 * Each method returns commits in our normalised shape:
 *
 *   {
 *     sha:           "abc123...",
 *     shortSha:      "abc123",
 *     author:        { name, email },
 *     date:          "2024-09-12T11:05:00Z",     // ISO 8601, UTC
 *     subject:       "fix(auth): retry token refresh on 401",
 *     body:          "We saw the SSO provider return 401 ...",
 *     filesChanged:  ["src/server/auth.ts", "..."],
 *     parentShas:    ["..."],
 *     jiraKeys:      ["PROJ-123"]
 *   }
 *
 * Jira keys are extracted from the subject + body via the standard
 * `<PROJECT>-<NUMBER>` regex. They become first-class signals downstream
 * (for filtering RAG hits, surfacing tickets in the answer, etc.).
 *
 * Why a wrapper at all?
 * ---------------------
 * - Centralises the parsing of `git log` output into our normalised shape so
 *   no caller has to know about `simple-git` internals.
 * - Makes the behaviour easy to mock in tests (the chat orchestrator only
 *   sees the normalised shape).
 * - Lets us layer in additional safety later (e.g. timeouts on every call,
 *   shared rate limiting if we ever go remote).
 */

const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const { createLogger } = require('../utils/logger');

/** Matches Jira-style keys like `PROJ-123`, `ENG-7`, `ABC1-42`. */
const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** `git log` formatter used so we can split the output into well-known fields. */
const LOG_FORMAT = [
  'sha=%H',
  'parents=%P',
  'an=%an',
  'ae=%ae',
  'date=%aI',
  'subject=%s',
  // The body comes last so embedded newlines don't corrupt the record split.
  'body=%b',
].join('%x1f'); // unit separator between fields

/** Record separator between commits (a literal NUL-like marker). */
const RECORD_SEP = '\u001e';

/**
 * Extracts unique Jira keys from a string. Returns a deterministic order
 * (first occurrence wins).
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractJiraKeys(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(JIRA_KEY_RE)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

/**
 * Parses one or more `git log` records emitted with the LOG_FORMAT above.
 * Each record is the concatenation of the formatter fields, and records are
 * separated by `RECORD_SEP`.
 *
 * @param {string} stdout
 * @returns {Array<Omit<NormalizedCommit, "filesChanged">>}
 */
function parseLogRecords(stdout) {
  if (!stdout) return [];
  /** @type {Array<Omit<NormalizedCommit, "filesChanged">>} */
  const out = [];
  for (const rawRecord of stdout.split(RECORD_SEP)) {
    const record = rawRecord.trim();
    if (!record) continue;
    const fields = record.split('\u001f');
    /** @type {Record<string,string>} */
    const map = {};
    for (const field of fields) {
      const eq = field.indexOf('=');
      if (eq < 0) continue;
      const key = field.slice(0, eq);
      // body may contain '=' so we must not split again.
      map[key] = field.slice(eq + 1);
    }
    if (!map.sha) continue;
    const subject = (map.subject || '').trim();
    const body = (map.body || '').trim();
    const parentShas = (map.parents || '').split(/\s+/).filter(Boolean);
    out.push({
      sha: map.sha,
      shortSha: map.sha.slice(0, 7),
      author: { name: map.an || '', email: map.ae || '' },
      date: map.date || '',
      subject,
      body,
      parentShas,
      jiraKeys: extractJiraKeys(`${subject}\n${body}`),
    });
  }
  return out;
}

/**
 * @typedef {Object} NormalizedCommit
 * @property {string} sha
 * @property {string} shortSha
 * @property {{ name: string, email: string }} author
 * @property {string} date         ISO 8601 (author date, %aI).
 * @property {string} subject
 * @property {string} body
 * @property {string[]} filesChanged
 * @property {string[]} parentShas
 * @property {string[]} jiraKeys
 */

class LocalGitClient {
  /**
   * @param {Object} opts
   * @param {string} opts.projectPath Absolute path to a git working tree.
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   * @param {number} [opts.maxBuffer=10485760] simple-git stdout buffer cap.
   */
  constructor({ projectPath, logger, maxBuffer = 10 * 1024 * 1024 }) {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('LocalGitClient: projectPath is required');
    }
    if (!path.isAbsolute(projectPath)) {
      throw new Error(`LocalGitClient: projectPath must be absolute, got "${projectPath}"`);
    }
    if (!fs.existsSync(path.join(projectPath, '.git'))) {
      throw new Error(`LocalGitClient: no .git directory at "${projectPath}"`);
    }

    this.projectPath = projectPath;
    this.logger = (logger || createLogger()).child({ component: 'localGit' });
    // simple-git: bind to the working tree, set a stdout cap so a giant
    // history doesn't exhaust memory, and force C locale so output parsing
    // never has to deal with localised messages.
    this.git = simpleGit({
      baseDir: projectPath,
      maxConcurrentProcesses: 4,
      // simple-git accepts `binary` and `unsafe`; we keep defaults.
    });
    this.maxBuffer = maxBuffer;
  }

  /**
   * Returns commits whose changes touched the given line range of `file`.
   * Implemented with `git log -L start,end:file --no-patch` so we get the
   * commit metadata only (no diff hunks — those would balloon the response).
   *
   * Edge cases:
   *   - If `start > end` we swap them.
   *   - If the file never had those lines (e.g. a fresh untracked file),
   *     git exits non-zero — we surface a typed error so the caller can
   *     report `skipped: [{ file, reason: "no history" }]` to the UI.
   *
   * @param {string} file Path RELATIVE to the working tree.
   * @param {number} start 1-based inclusive start line.
   * @param {number} end   1-based inclusive end line.
   * @returns {Promise<NormalizedCommit[]>}
   */
  async lineHistory(file, start, end) {
    const [lo, hi] = start <= end ? [start, end] : [end, start];
    const range = `${lo},${hi}:${file}`;
    const args = [
      'log',
      `-L`,
      range,
      '--no-patch',
      `--pretty=format:${LOG_FORMAT}${RECORD_SEP}`,
    ];
    this.logger.debug('git log -L', { file, range });
    let stdout;
    try {
      stdout = await this.git.raw(args);
    } catch (err) {
      throw this._wrapGitError(err, `line history failed for ${file}:${lo}-${hi}`);
    }
    const commits = parseLogRecords(stdout);
    return this._enrichWithFiles(commits);
  }

  /**
   * Returns commits that touched `file`, optionally following renames.
   *
   * @param {string} file Path RELATIVE to the working tree.
   * @param {{ follow?: boolean, limit?: number }} [opts]
   * @returns {Promise<NormalizedCommit[]>}
   */
  async fileHistory(file, opts = {}) {
    const { follow = true, limit = 100 } = opts;
    const args = ['log', `--pretty=format:${LOG_FORMAT}${RECORD_SEP}`, '--no-patch'];
    if (follow) args.push('--follow');
    if (limit) args.push(`-n`, String(limit));
    args.push('--', file);
    this.logger.debug('git log file', { file, follow, limit });
    let stdout;
    try {
      stdout = await this.git.raw(args);
    } catch (err) {
      throw this._wrapGitError(err, `file history failed for ${file}`);
    }
    const commits = parseLogRecords(stdout);
    return this._enrichWithFiles(commits);
  }

  /**
   * Returns the full normalised metadata for a single commit, including the
   * list of files it touched. Used when a SHA is provided directly (e.g. by
   * a future "show me commit X" UI affordance).
   *
   * @param {string} sha
   * @returns {Promise<NormalizedCommit|null>}
   */
  async show(sha) {
    let stdout;
    try {
      stdout = await this.git.raw([
        'log',
        '-1',
        sha,
        `--pretty=format:${LOG_FORMAT}${RECORD_SEP}`,
        '--no-patch',
      ]);
    } catch (err) {
      throw this._wrapGitError(err, `show failed for ${sha}`);
    }
    const commits = parseLogRecords(stdout);
    if (commits.length === 0) return null;
    const enriched = await this._enrichWithFiles(commits);
    return enriched[0];
  }

  /**
   * Adds the `filesChanged` field to each commit by running
   * `git show --name-only <sha>` once per commit. Done sequentially with a
   * tiny worker pool to keep the system load reasonable.
   *
   * @private
   * @param {Array<Omit<NormalizedCommit, "filesChanged">>} commits
   * @returns {Promise<NormalizedCommit[]>}
   */
  async _enrichWithFiles(commits) {
    /** @type {NormalizedCommit[]} */
    const out = new Array(commits.length);
    const concurrency = 4;
    let cursor = 0;

    const worker = async () => {
      while (cursor < commits.length) {
        const idx = cursor++;
        const c = commits[idx];
        let filesChanged = [];
        try {
          const raw = await this.git.raw([
            'show',
            '--name-only',
            '--pretty=format:',
            c.sha,
          ]);
          filesChanged = (raw || '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
        } catch (err) {
          this.logger.warn('failed to enrich commit with file list', {
            sha: c.sha,
            error: err.message,
          });
        }
        out[idx] = { ...c, filesChanged };
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return out;
  }

  /**
   * Normalises errors from simple-git into a single shape the agent server
   * can convert into a clean HTTP response.
   *
   * @private
   * @param {any} err
   * @param {string} context
   * @returns {Error}
   */
  _wrapGitError(err, context) {
    const message = err?.message || String(err);
    const wrapped = new Error(`${context}: ${message}`);
    /** @type {any} */ (wrapped).cause = err;
    /** @type {any} */ (wrapped).code = 'GIT_ERROR';
    return wrapped;
  }
}

module.exports = {
  LocalGitClient,
  extractJiraKeys,
  parseLogRecords,
};
