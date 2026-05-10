'use strict';

/**
 * src/localGit/historyExtractor.js
 * --------------------------------
 * Given the user's chat attachments (a mix of "whole file" and
 * "file + line range") this module fans out to a `LocalGitClient`, dedupes
 * the commits by SHA, sorts newest-first, and caps the result at a
 * configurable limit.
 *
 * Why dedupe?
 * -----------
 * A user often attaches both a file AND a selection from that file. Without
 * dedupe we'd send the same SHAs to the LLM twice, which wastes tokens and
 * confuses the answer ("...the commit X did Y... commit X did Y...").
 *
 * Why a cap?
 * ----------
 * Long-lived files can have hundreds of commits. We pass the dense metadata
 * directly to the LLM so a hard cap protects both the prompt budget and the
 * Lambda response size. The cap is sourced from `config.chat.maxLocalCommits`
 * upstream.
 */

const { LocalGitClient } = require('./client');
const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} ChatAttachment
 * @property {string} file Path RELATIVE to the project root.
 * @property {[number, number]} [range] 1-based inclusive `[start, end]`.
 * @property {string} [content] Optional file/selection text the UI sent.
 */

/**
 * @typedef {Object} ExtractedHistory
 * @property {import('./client').NormalizedCommit[]} commits Newest-first.
 * @property {Array<{ file: string, reason: string }>} skipped
 */

class LocalHistoryExtractor {
  /**
   * @param {Object} opts
   * @param {string} opts.projectPath
   * @param {number} [opts.maxCommits=50]
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ projectPath, maxCommits = 50, logger }) {
    this.projectPath = projectPath;
    this.maxCommits = maxCommits;
    this.logger = (logger || createLogger()).child({ component: 'history' });
    this.client = new LocalGitClient({ projectPath, logger: this.logger });
  }

  /**
   * Extracts commits for a list of attachments.
   *
   * @param {ChatAttachment[]} attachments
   * @returns {Promise<ExtractedHistory>}
   */
  async extract(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return { commits: [], skipped: [] };
    }

    /** @type {Map<string, import('./client').NormalizedCommit>} */
    const bySha = new Map();
    /** @type {Array<{ file: string, reason: string }>} */
    const skipped = [];

    for (const att of attachments) {
      if (!att || typeof att.file !== 'string' || !att.file.trim()) {
        skipped.push({ file: String(att?.file || ''), reason: 'invalid attachment' });
        continue;
      }
      const file = att.file.trim();
      try {
        let commits;
        if (Array.isArray(att.range) && att.range.length === 2) {
          const [s, e] = att.range;
          commits = await this.client.lineHistory(file, Number(s), Number(e));
        } else {
          commits = await this.client.fileHistory(file, { follow: true, limit: this.maxCommits });
        }
        for (const c of commits) {
          // Keep the FIRST occurrence (which is the newest one because git
          // log returns reverse-chronological by default).
          if (!bySha.has(c.sha)) bySha.set(c.sha, c);
        }
      } catch (err) {
        this.logger.warn('history extraction skipped a file', {
          file,
          error: err.message,
        });
        skipped.push({ file, reason: err.message });
      }
    }

    // Sort newest-first by ISO date, then cap.
    const merged = Array.from(bySha.values()).sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    const capped = merged.slice(0, this.maxCommits);

    this.logger.info('local history extracted', {
      attachmentCount: attachments.length,
      uniqueCommits: merged.length,
      returned: capped.length,
      skipped: skipped.length,
    });

    return { commits: capped, skipped };
  }
}

module.exports = {
  LocalHistoryExtractor,
};
