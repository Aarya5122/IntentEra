'use strict';

/**
 * src/retrieval/queryHandler.js
 * -----------------------------
 * Retrieval-side business logic.
 *
 * Given a natural language query, this module:
 *   1. Generates a query embedding.
 *   2. Runs MongoDB Atlas Vector Search with optional metadata filters.
 *   3. Assembles a clean, structured response that downstream chat / LLM
 *      systems can feed directly into a prompt.
 *
 * The module intentionally does NOT:
 *   - Call any LLM to compose an answer. We return the retrieved context so
 *     the calling service can prompt its own model (OpenAI, Bedrock, etc).
 *   - Paginate. Callers ask for a `topK` and we return exactly that.
 */

const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} RetrievalResultItem
 * @property {string} chunkId
 * @property {string} ticketKey
 * @property {string} projectKey
 * @property {string} sourceType
 * @property {number} score Similarity score from Atlas Vector Search.
 * @property {string} text
 * @property {Record<string, any>} metadata
 */

/**
 * @typedef {Object} RetrievalResponse
 * @property {string} query
 * @property {string} retrievedAt
 * @property {number} topK
 * @property {Record<string, any>} appliedFilters
 * @property {RetrievalResultItem[]} results
 * @property {string} context Human / LLM-readable concatenation of results.
 */

class RetrievalHandler {
  /**
   * @param {Object} deps
   * @param {import('../embeddings/embedder').Embedder} deps.embedder
   * @param {import('../vectorStore/mongoStore').MongoVectorStore} deps.vectorStore
   * @param {{defaultTopK: number, maxTopK: number}} deps.retrievalCfg
   * @param {ReturnType<typeof createLogger>} [deps.logger]
   */
  constructor({ embedder, vectorStore, retrievalCfg, logger }) {
    this.embedder = embedder;
    this.vectorStore = vectorStore;
    this.retrievalCfg = retrievalCfg;
    this.logger = (logger || createLogger()).child({ component: 'retrieval' });
  }

  /**
   * Executes a retrieval request.
   *
   * @param {Object} args
   * @param {string} args.query The natural language query.
   * @param {number} [args.topK] Override the default topK.
   * @param {Object} [args.filters] Optional metadata filters — see mongoStore.vectorSearch.
   * @returns {Promise<RetrievalResponse>}
   */
  async retrieve({ query, topK, filters }) {
    if (typeof query !== 'string' || !query.trim()) {
      throw new Error('query must be a non-empty string');
    }

    // Clamp topK so a malicious caller can't ask for 1M rows.
    const requested = Number.isFinite(topK) ? Number(topK) : this.retrievalCfg.defaultTopK;
    const clampedTopK = Math.min(
      Math.max(1, Math.floor(requested)),
      this.retrievalCfg.maxTopK
    );

    const cleanedFilters = this._cleanFilters(filters);
    this.logger.info('retrieving chunks', {
      queryPreview: query.slice(0, 80),
      topK: clampedTopK,
      filters: cleanedFilters,
    });

    // Embed the query. We use `embedQuery` (single-item) because batching
    // a single string adds overhead without upside.
    const embedding = await this.embedder.embedQuery(query);
    const rows = await this.vectorStore.vectorSearch({
      embedding,
      topK: clampedTopK,
      filters: cleanedFilters,
    });

    /** @type {RetrievalResultItem[]} */
    const results = rows.map((r) => ({
      chunkId: r.chunkId,
      ticketKey: r.ticketKey,
      projectKey: r.projectKey,
      sourceType: r.sourceType,
      score: r.score,
      text: r.text,
      metadata: r.metadata || {},
    }));

    return {
      query,
      retrievedAt: new Date().toISOString(),
      topK: clampedTopK,
      appliedFilters: cleanedFilters,
      results,
      context: this._buildContextString(results),
    };
  }

  /**
   * Drops nullish / empty values so we don't accidentally filter on undefined
   * and so the log output is tidy.
   * @private
   * @param {any} filters
   * @returns {Record<string, any>}
   */
  _cleanFilters(filters) {
    if (!filters || typeof filters !== 'object') return {};
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      out[k] = v;
    }
    return out;
  }

  /**
   * Builds a single human-readable string that is ready to paste into an LLM
   * prompt. We include light metadata per chunk so the model can cite the
   * source.
   * @private
   * @param {RetrievalResultItem[]} results
   * @returns {string}
   */
  _buildContextString(results) {
    return results
      .map((r, idx) => {
        const header =
          `--- [${idx + 1}] ${r.ticketKey} (${r.sourceType}` +
          `${r.metadata.fileName ? `, file=${r.metadata.fileName}` : ''}` +
          `${r.metadata.pageTitle ? `, page="${r.metadata.pageTitle}"` : ''}` +
          `) score=${r.score?.toFixed(3) ?? 'n/a'} ---`;
        return `${header}\n${r.text}`;
      })
      .join('\n\n');
  }
}

module.exports = {
  RetrievalHandler,
};
