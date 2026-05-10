'use strict';

/**
 * src/chat/multiQueryRetriever.js
 * -------------------------------
 * "Multi-query" RAG fan-out used by the chat orchestrator.
 *
 * Why multiple queries?
 * ---------------------
 * The user's natural language question is one signal, but the local commits
 * we extracted from the user's selection are arguably stronger signals about
 * which Jira tickets and GitHub PRs are relevant. Each commit subject is a
 * compact summary of an actual change, so we use it as an additional vector
 * query alongside the question itself.
 *
 * Algorithm
 * ---------
 *   1. Build the query list:  [userQuestion, ...commit.subject (deduped)].
 *   2. Embed all of them in ONE OpenAI batch (Embedder.embedMany), which is
 *      cheap and one round-trip.
 *   3. For each query embedding, fan out a `vectorSearch` against EACH
 *      configured store (Jira and/or GitHub) with a small `perVectorTopK`.
 *   4. Merge results, deduping by `chunkId` and keeping the MAX score across
 *      query embeddings (this is the "max-pool" reranking trick).
 *   5. Sort the merged list by score desc, slice to `mergedTopN`.
 *
 * Why max-pool?
 * -------------
 * A chunk that scores well on the user's question is good. A chunk that
 * scores well on multiple commit subjects is also good. We don't want to
 * average (a chunk that's barely related to one query but perfect for
 * another should still surface). Taking the MAX is a cheap, robust signal.
 *
 * Cost/safety
 * -----------
 *   - We dedupe commit subjects to avoid embedding identical strings.
 *   - We cap the number of subjects via the orchestrator (commits already
 *     come pre-capped at `chat.maxLocalCommits`).
 *   - Per-store fan-out is parallelised across the two collections.
 */

const { createLogger } = require('../utils/logger');

class MultiQueryRetriever {
  /**
   * @param {Object} deps
   * @param {import('../embeddings/embedder').Embedder} deps.embedder
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.jiraVectorStore]
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.githubVectorStore]
   * @param {{perVectorTopK: number, mergedTopN: number}} deps.chatCfg
   * @param {ReturnType<typeof createLogger>} [deps.logger]
   */
  constructor({ embedder, jiraVectorStore, githubVectorStore, chatCfg, logger }) {
    if (!embedder) throw new Error('MultiQueryRetriever: embedder is required');
    this.embedder = embedder;
    this.jiraVectorStore = jiraVectorStore || null;
    this.githubVectorStore = githubVectorStore || null;
    this.chatCfg = chatCfg;
    this.logger = (logger || createLogger()).child({ component: 'multiQueryRetriever' });
  }

  /**
   * Runs the multi-query fan-out and returns merged hits.
   *
   * @param {Object} args
   * @param {string} args.question
   * @param {Array<{ subject: string }>} [args.commits]
   * @param {Object} [args.filters] Forwarded to vectorSearch as-is (each
   *        store ignores keys that aren't in its filter DSL).
   * @returns {Promise<{
   *   hits: Array<{ source: 'jira'|'github', chunkId: string, score: number, text: string, queryHits: number, metadata: any } & Record<string, any>>,
   *   queryCount: number,
   *   embeddingCount: number,
   * }>}
   */
  async retrieve({ question, commits = [], filters = {} }) {
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error('MultiQueryRetriever: question must be a non-empty string');
    }
    const subjects = uniqueNonEmpty(commits.map((c) => c?.subject || ''));
    const queries = [question.trim(), ...subjects];
    this.logger.debug('multi-query embed', {
      questionPreview: question.slice(0, 80),
      subjectCount: subjects.length,
    });

    const embeddings = await this.embedder.embedMany(queries);
    const perVectorTopK = Math.max(1, Number(this.chatCfg.perVectorTopK) || 3);
    const mergedTopN = Math.max(1, Number(this.chatCfg.mergedTopN) || 12);

    // Each search is independent so we run them all in parallel. Each task
    // emits an array of normalised hits tagged with its source.
    /** @type {Promise<Array<any>>[]} */
    const tasks = [];
    embeddings.forEach((embedding, idx) => {
      if (this.jiraVectorStore) {
        tasks.push(
          this.jiraVectorStore
            .vectorSearch({ embedding, topK: perVectorTopK, filters })
            .then((rows) => rows.map((r) => ({ ...r, source: 'jira', _q: idx })))
            .catch((err) => {
              this.logger.warn('jira vector search failed for query', {
                queryIndex: idx,
                error: err.message,
              });
              return [];
            })
        );
      }
      if (this.githubVectorStore) {
        tasks.push(
          this.githubVectorStore
            .vectorSearch({ embedding, topK: perVectorTopK, filters })
            .then((rows) => rows.map((r) => ({ ...r, source: 'github', _q: idx })))
            .catch((err) => {
              this.logger.warn('github vector search failed for query', {
                queryIndex: idx,
                error: err.message,
              });
              return [];
            })
        );
      }
    });

    const allRows = (await Promise.all(tasks)).flat();

    // Max-pool merge: keep the highest-scoring occurrence per chunkId, and
    // count how many distinct queries hit it (a useful debug signal).
    /** @type {Map<string, any>} */
    const byChunkId = new Map();
    for (const row of allRows) {
      if (!row?.chunkId) continue;
      const existing = byChunkId.get(row.chunkId);
      if (!existing) {
        byChunkId.set(row.chunkId, { ...row, queryHits: 1 });
        continue;
      }
      existing.queryHits += 1;
      if ((row.score || 0) > (existing.score || 0)) {
        existing.score = row.score;
        existing._q = row._q;
      }
    }

    const merged = Array.from(byChunkId.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, mergedTopN);

    this.logger.info('multi-query merge complete', {
      queries: queries.length,
      stores: [this.jiraVectorStore && 'jira', this.githubVectorStore && 'github'].filter(Boolean),
      rawHits: allRows.length,
      uniqueHits: byChunkId.size,
      returned: merged.length,
    });

    return {
      hits: merged,
      queryCount: queries.length,
      embeddingCount: embeddings.length,
    };
  }
}

/**
 * Returns the unique, non-empty trimmed strings from `arr` in first-seen
 * order. Used to dedupe commit subjects before embedding.
 * @param {string[]} arr
 * @returns {string[]}
 */
function uniqueNonEmpty(arr) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of arr) {
    const s = (raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

module.exports = {
  MultiQueryRetriever,
};
