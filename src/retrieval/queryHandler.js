'use strict';

/**
 * src/retrieval/queryHandler.js
 * -----------------------------
 * Retrieval-side business logic.
 *
 * Given a natural language query, this module:
 *   1. Generates a query embedding.
 *   2. Runs MongoDB Atlas Vector Search against one or both source stores
 *      (jira / github / both).
 *   3. Assembles a clean, structured response that downstream chat / LLM
 *      systems can feed directly into a prompt.
 *
 * Source selection
 * ----------------
 *   - `source: "jira"`   → query only the Jira vector store.
 *   - `source: "github"` → query only the GitHub vector store.
 *   - `source: "both"`   → query BOTH stores with the same embedding, then
 *                          interleave the results sorted by score.
 *                          Each store receives its own topK slice (half
 *                          the requested topK, rounded up) so the total
 *                          hit count never exceeds `topK`.
 *
 * The module intentionally does NOT:
 *   - Call any LLM to compose an answer. We return the retrieved context so
 *     the calling service can prompt its own model.
 *   - Do cross-source reranking; a simple score-sorted concatenation is our
 *     current strategy and is noted as future work.
 */

const { createLogger } = require('../utils/logger');

/**
 * @typedef {Object} RetrievalResultItem
 * @property {string} chunkId
 * @property {"jira"|"github"} source
 * @property {string} entityKey          Jira: ticketKey; GitHub: entityKey.
 * @property {string|null} entityType    GitHub only: "commit"|"pullRequest"|"issue".
 * @property {string|null} projectKey    Jira only.
 * @property {string|null} repoFullName  GitHub only.
 * @property {string} sourceType
 * @property {number} score
 * @property {string} text
 * @property {Record<string, any>} metadata
 */

/**
 * @typedef {Object} RetrievalResponse
 * @property {string} query
 * @property {string} retrievedAt
 * @property {"jira"|"github"|"both"} source
 * @property {number} topK
 * @property {Record<string, any>} appliedFilters
 * @property {RetrievalResultItem[]} results
 * @property {string} context
 */

class RetrievalHandler {
  /**
   * @param {Object} deps
   * @param {import('../embeddings/embedder').Embedder} deps.embedder
   * @param {import('../vectorStore/mongoStore').MongoVectorStore} [deps.vectorStore]
   *        Back-compat alias. If provided and no jira/github stores are set,
   *        treated as the Jira store.
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.jiraVectorStore]
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.githubVectorStore]
   * @param {{defaultTopK: number, maxTopK: number}} deps.retrievalCfg
   * @param {ReturnType<typeof createLogger>} [deps.logger]
   */
  constructor({
    embedder,
    vectorStore,
    jiraVectorStore,
    githubVectorStore,
    retrievalCfg,
    logger,
  }) {
    this.embedder = embedder;
    this.jiraVectorStore = jiraVectorStore || (vectorStore && vectorStore.source === 'jira' ? vectorStore : null) || vectorStore || null;
    this.githubVectorStore = githubVectorStore || null;
    this.retrievalCfg = retrievalCfg;
    this.logger = (logger || createLogger()).child({ component: 'retrieval' });
  }

  /**
   * Executes a retrieval request.
   *
   * @param {Object} args
   * @param {string} args.query
   * @param {number} [args.topK]
   * @param {"jira"|"github"|"both"} [args.source="jira"]
   * @param {Object} [args.filters]
   * @returns {Promise<RetrievalResponse>}
   */
  async retrieve({ query, topK, source, filters }) {
    if (typeof query !== 'string' || !query.trim()) {
      throw new Error('query must be a non-empty string');
    }
    const resolvedSource = (source || 'jira').toLowerCase();
    if (!['jira', 'github', 'both'].includes(resolvedSource)) {
      throw new Error(`source must be "jira", "github", or "both"; got "${source}"`);
    }

    // Guard against missing stores — we only fail when the user actually
    // asks for the store we can't build.
    if ((resolvedSource === 'jira' || resolvedSource === 'both') && !this.jiraVectorStore) {
      if (resolvedSource === 'jira') {
        throw new Error('Jira retrieval requested but Jira vector store is not configured');
      }
    }
    if ((resolvedSource === 'github' || resolvedSource === 'both') && !this.githubVectorStore) {
      if (resolvedSource === 'github') {
        throw new Error('GitHub retrieval requested but GitHub vector store is not configured');
      }
    }

    const requested = Number.isFinite(topK) ? Number(topK) : this.retrievalCfg.defaultTopK;
    const clampedTopK = Math.min(
      Math.max(1, Math.floor(requested)),
      this.retrievalCfg.maxTopK
    );

    const cleanedFilters = this._cleanFilters(filters);
    this.logger.info('retrieving chunks', {
      queryPreview: query.slice(0, 80),
      source: resolvedSource,
      topK: clampedTopK,
      filters: cleanedFilters,
    });

    const embedding = await this.embedder.embedQuery(query);

    /** @type {RetrievalResultItem[]} */
    let results = [];

    if (resolvedSource === 'jira') {
      const rows = await this.jiraVectorStore.vectorSearch({
        embedding,
        topK: clampedTopK,
        filters: cleanedFilters,
      });
      results = rows.map((r) => this._toJiraItem(r));
    } else if (resolvedSource === 'github') {
      const rows = await this.githubVectorStore.vectorSearch({
        embedding,
        topK: clampedTopK,
        filters: cleanedFilters,
      });
      results = rows.map((r) => this._toGithubItem(r));
    } else {
      // "both": split topK across stores; in practice each store might return
      // fewer than asked for so we tolerate that.
      const perStore = Math.ceil(clampedTopK / 2);
      const [jiraRows, ghRows] = await Promise.all([
        this.jiraVectorStore
          ? this.jiraVectorStore.vectorSearch({ embedding, topK: perStore, filters: cleanedFilters })
          : Promise.resolve([]),
        this.githubVectorStore
          ? this.githubVectorStore.vectorSearch({ embedding, topK: perStore, filters: cleanedFilters })
          : Promise.resolve([]),
      ]);
      const combined = [
        ...jiraRows.map((r) => this._toJiraItem(r)),
        ...ghRows.map((r) => this._toGithubItem(r)),
      ]
        // Stable sort by descending score.
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, clampedTopK);
      results = combined;
    }

    return {
      query,
      retrievedAt: new Date().toISOString(),
      source: /** @type {"jira"|"github"|"both"} */ (resolvedSource),
      topK: clampedTopK,
      appliedFilters: cleanedFilters,
      results,
      context: this._buildContextString(results),
    };
  }

  /**
   * Maps a Jira vector-search row into a RetrievalResultItem. Jira rows keep
   * their legacy `ticketKey` / `projectKey` top-level fields.
   * @private
   * @param {any} r
   * @returns {RetrievalResultItem}
   */
  _toJiraItem(r) {
    return {
      chunkId: r.chunkId,
      source: 'jira',
      entityKey: r.ticketKey || r.entityKey || '',
      entityType: null,
      projectKey: r.projectKey || null,
      repoFullName: null,
      sourceType: r.sourceType,
      score: r.score,
      text: r.text,
      metadata: r.metadata || {},
    };
  }

  /**
   * Maps a GitHub vector-search row into a RetrievalResultItem.
   * @private
   * @param {any} r
   * @returns {RetrievalResultItem}
   */
  _toGithubItem(r) {
    return {
      chunkId: r.chunkId,
      source: 'github',
      entityKey: r.entityKey || '',
      entityType: r.entityType || null,
      projectKey: null,
      repoFullName: r.repoFullName || null,
      sourceType: r.sourceType,
      score: r.score,
      text: r.text,
      metadata: r.metadata || {},
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
   * Builds a human/LLM-readable context string. Clearly labels each chunk
   * with its source so downstream prompts can cite them.
   * @private
   * @param {RetrievalResultItem[]} results
   * @returns {string}
   */
  _buildContextString(results) {
    return results
      .map((r, idx) => {
        const scope =
          r.source === 'jira'
            ? `jira:${r.entityKey}`
            : `github:${r.entityType || 'entity'}:${r.entityKey}`;
        const extras = [
          r.metadata?.fileName && `file=${r.metadata.fileName}`,
          r.metadata?.pageTitle && `page="${r.metadata.pageTitle}"`,
          r.repoFullName && `repo=${r.repoFullName}`,
        ]
          .filter(Boolean)
          .join(', ');
        const header =
          `--- [${idx + 1}] ${scope} (${r.sourceType}${extras ? `, ${extras}` : ''}) ` +
          `score=${r.score?.toFixed(3) ?? 'n/a'} ---`;
        return `${header}\n${r.text}`;
      })
      .join('\n\n');
  }
}

module.exports = {
  RetrievalHandler,
};
