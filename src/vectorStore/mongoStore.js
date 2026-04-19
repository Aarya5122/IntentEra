'use strict';

/**
 * src/vectorStore/mongoStore.js
 * -----------------------------
 * MongoDB Atlas Vector Search wrapper.
 *
 * What we store (shape of each document):
 *   {
 *     _id:         <chunkId>,       // deterministic from chunker.js
 *     ticketKey:   "PROJ-123",
 *     projectKey:  "PROJ",
 *     sourceType:  "description" | ... ,
 *     chunkIndex:  0,
 *     text:        "...",
 *     embedding:   [1536 floats],
 *     metadata:    { ... retrieval filter fields ... },
 *     indexedAt:   ISO8601
 *   }
 *
 * Per the requirements we do NOT store the raw original normalized source
 * payload alongside chunk text — only the chunk text and metadata.
 *
 * Operations exposed:
 *   - connect(): opens the Mongo client (lazy, idempotent)
 *   - disconnect(): closes the client
 *   - replaceTicketChunks(ticketKey, chunks): delete-then-insert for a ticket
 *   - deleteTicket(ticketKey): removes all chunks for a ticket
 *   - ensureIndexes(): creates a few helper b-tree indexes for fast lookup
 *   - vectorSearch({ embedding, topK, filters }): Atlas `$vectorSearch` query
 *
 * Delete-before-upsert design:
 *   Re-indexing a ticket always deletes ALL existing chunks for that ticket
 *   first, then inserts the freshly generated chunks. This avoids
 *   reconciliation bugs (orphan comments, stale attachment text, etc.) and
 *   is simple to reason about.
 */

const { MongoClient } = require('mongodb');
const { withRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

class MongoVectorStore {
  /**
   * @param {Object} opts
   * @param {string} opts.uri
   * @param {string} opts.database
   * @param {string} opts.collection
   * @param {string} opts.vectorIndex Name of the Atlas Vector Search index.
   * @param {number} opts.embeddingDimensions
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ uri, database, collection, vectorIndex, embeddingDimensions, logger }) {
    this.uri = uri;
    this.databaseName = database;
    this.collectionName = collection;
    this.vectorIndex = vectorIndex;
    this.embeddingDimensions = embeddingDimensions;
    this.logger = (logger || createLogger()).child({ component: 'mongoStore' });

    this.client = new MongoClient(uri, {
      // Reasonable defaults for Lambda: keep the pool small to match the
      // single-invocation concurrency the orchestrator uses.
      maxPoolSize: 5,
    });
    this._connected = false;
  }

  /**
   * Returns the native collection handle, ensuring the client is connected.
   * @private
   */
  async _coll() {
    if (!this._connected) {
      await withRetry(() => this.client.connect(), { label: 'mongo-connect', logger: this.logger });
      this._connected = true;
      this.logger.debug('mongo connected', { db: this.databaseName });
    }
    return this.client.db(this.databaseName).collection(this.collectionName);
  }

  /** Alias for external callers. */
  async connect() { await this._coll(); }

  /** Closes the Mongo client. */
  async disconnect() {
    if (this._connected) {
      await this.client.close();
      this._connected = false;
    }
  }

  /**
   * Ensures the helper b-tree indexes exist. The actual Atlas Vector Search
   * index must be created through the Atlas UI / API (MongoDB does not allow
   * creating vector indexes via the driver). We document the required shape
   * at the bottom of docs/architecture.md.
   *
   * @returns {Promise<void>}
   */
  async ensureIndexes() {
    const coll = await this._coll();
    await coll.createIndex({ ticketKey: 1 });
    await coll.createIndex({ projectKey: 1, sourceType: 1 });
    await coll.createIndex({ indexedAt: 1 });
    this.logger.info('helper indexes ensured');
  }

  /**
   * Deletes all chunks for a ticket.
   * @param {string} ticketKey
   * @returns {Promise<number>} deletedCount
   */
  async deleteTicket(ticketKey) {
    const coll = await this._coll();
    const { deletedCount } = await withRetry(
      () => coll.deleteMany({ ticketKey }),
      { label: 'mongo-delete-ticket', logger: this.logger }
    );
    this.logger.debug('ticket chunks deleted', { ticketKey, deletedCount });
    return deletedCount || 0;
  }

  /**
   * Deletes chunks for a set of tickets. Used when we detect multiple deleted
   * tickets in a single sync run.
   * @param {string[]} ticketKeys
   * @returns {Promise<number>} deletedCount
   */
  async deleteTickets(ticketKeys) {
    if (!ticketKeys?.length) return 0;
    const coll = await this._coll();
    const { deletedCount } = await withRetry(
      () => coll.deleteMany({ ticketKey: { $in: ticketKeys } }),
      { label: 'mongo-delete-tickets', logger: this.logger }
    );
    this.logger.info('bulk ticket chunks deleted', {
      count: ticketKeys.length,
      deletedCount,
    });
    return deletedCount || 0;
  }

  /**
   * Replaces every chunk for a ticket atomically-enough-for-our-purposes.
   *
   * Implementation detail: we use a two-step "deleteMany then insertMany"
   * because Atlas does not offer a single-call bulk replace keyed by
   * ticketKey. On a rare crash between the two steps the ticket would be
   * left with zero chunks, which the next sync run will heal.
   *
   * @param {string} ticketKey
   * @param {import('../chunking/chunker').Chunk[]} chunks
   * @param {number[][]} embeddings Parallel array to `chunks`.
   * @returns {Promise<{inserted: number, deleted: number}>}
   */
  async replaceTicketChunks(ticketKey, chunks, embeddings) {
    if (chunks.length !== embeddings.length) {
      throw new Error(
        `chunks (${chunks.length}) and embeddings (${embeddings.length}) length mismatch`
      );
    }
    const coll = await this._coll();
    const now = new Date().toISOString();

    const { deletedCount } = await withRetry(
      () => coll.deleteMany({ ticketKey }),
      { label: 'mongo-replace-delete', logger: this.logger }
    );

    if (chunks.length === 0) {
      return { inserted: 0, deleted: deletedCount || 0 };
    }

    const docs = chunks.map((c, i) => {
      const embedding = embeddings[i];
      if (!Array.isArray(embedding) || embedding.length !== this.embeddingDimensions) {
        throw new Error(
          `Embedding for chunk "${c.chunkId}" is wrong size ` +
          `(expected ${this.embeddingDimensions}, got ${embedding?.length})`
        );
      }
      return {
        _id: c.chunkId,
        ticketKey: c.ticketKey,
        projectKey: c.projectKey,
        sourceType: c.sourceType,
        chunkIndex: c.chunkIndex,
        text: c.text,
        embedding,
        metadata: c.metadata || {},
        indexedAt: now,
      };
    });

    // `ordered: false` lets insertMany skip duplicates instead of aborting
    // the whole batch. In practice deterministic IDs + prior deletion mean
    // duplicates are rare, but we stay defensive.
    await withRetry(
      () => coll.insertMany(docs, { ordered: false }),
      { label: 'mongo-replace-insert', logger: this.logger }
    );

    return { inserted: docs.length, deleted: deletedCount || 0 };
  }

  /**
   * Runs a MongoDB Atlas `$vectorSearch` aggregation and returns the top
   * results. `numCandidates` is an Atlas-specific hint: the engine first
   * narrows to this many approximate candidates, then scores them exactly.
   * A common rule of thumb is numCandidates = 10 * topK.
   *
   * @param {Object} args
   * @param {number[]} args.embedding Query embedding.
   * @param {number} args.topK How many final results to return.
   * @param {Object} [args.filters] Optional metadata filters (exact matches).
   * @param {string} [args.filters.projectKey]
   * @param {string|string[]} [args.filters.sourceType]
   * @param {string|string[]} [args.filters.ticketKey]
   * @param {string[]} [args.filters.labels] Must include ALL of these labels.
   * @returns {Promise<Array<{chunkId: string, score: number, text: string, ticketKey: string, sourceType: string, metadata: any}>>}
   */
  async vectorSearch({ embedding, topK, filters = {} }) {
    if (!Array.isArray(embedding) || embedding.length !== this.embeddingDimensions) {
      throw new Error(
        `vectorSearch embedding must have ${this.embeddingDimensions} dimensions`
      );
    }

    const coll = await this._coll();
    const vsStage = {
      $vectorSearch: {
        index: this.vectorIndex,
        path: 'embedding',
        queryVector: embedding,
        numCandidates: Math.max(100, topK * 10),
        limit: topK,
      },
    };

    // Translate simple filter shapes into Atlas Vector Search's filter DSL.
    // Only a subset of operators is supported here; filterable fields must
    // be declared in the Atlas index definition.
    const atlasFilter = {};
    if (filters.projectKey) atlasFilter.projectKey = { $eq: filters.projectKey };
    if (filters.sourceType) {
      atlasFilter.sourceType = Array.isArray(filters.sourceType)
        ? { $in: filters.sourceType }
        : { $eq: filters.sourceType };
    }
    if (filters.ticketKey) {
      atlasFilter.ticketKey = Array.isArray(filters.ticketKey)
        ? { $in: filters.ticketKey }
        : { $eq: filters.ticketKey };
    }
    if (filters.labels?.length) {
      atlasFilter['metadata.labels'] = { $all: filters.labels };
    }
    if (Object.keys(atlasFilter).length) {
      vsStage.$vectorSearch.filter = atlasFilter;
    }

    const projectStage = {
      $project: {
        _id: 0,
        chunkId: '$_id',
        ticketKey: 1,
        projectKey: 1,
        sourceType: 1,
        chunkIndex: 1,
        text: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    };

    const results = await withRetry(
      () => coll.aggregate([vsStage, projectStage]).toArray(),
      { label: 'mongo-vector-search', logger: this.logger }
    );
    return results;
  }
}

module.exports = {
  MongoVectorStore,
};
