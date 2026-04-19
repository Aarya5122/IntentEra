'use strict';

/**
 * src/vectorStore/mongoStore.js
 * -----------------------------
 * MongoDB Atlas Vector Search wrapper.
 *
 * The Jira and GitHub ingestion paths each own a DIFFERENT instance of this
 * class pointing at a DIFFERENT collection + Atlas vector index. That lets
 * each source's chunks live in their own physical partition so the
 * `$vectorSearch` query for one source can never pull in the other's
 * documents.
 *
 * Document shapes
 * ---------------
 * Jira chunk (partitionField = "ticketKey"):
 *   {
 *     _id:        <chunkId>,
 *     ticketKey:  "PROJ-123",
 *     projectKey: "PROJ",
 *     sourceType: "description" | ... ,
 *     chunkIndex: 0,
 *     text:       "...",
 *     embedding:  [1536 floats],
 *     metadata:   { ... },
 *     indexedAt:  ISO8601
 *   }
 *
 * GitHub chunk (partitionField = "entityKey"):
 *   {
 *     _id:          <chunkId>,
 *     entityKey:    "commit:<sha>" | "pr:<num>" | "issue:<num>",
 *     entityType:   "commit" | "pullRequest" | "issue",
 *     repoFullName: "owner/name",
 *     sourceType:   "metadata" | "body" | "message" | "files" | "review" | "conversation" | "comments",
 *     chunkIndex:   0,
 *     text:         "...",
 *     embedding:    [1536 floats],
 *     metadata:     { ... },
 *     indexedAt:    ISO8601
 *   }
 *
 * The constructor takes a `partitionField` option that governs how we group
 * a chunk set for `delete-then-insert` operations. The default is
 * `"ticketKey"` so every Jira caller continues to work unchanged.
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
   * @param {string} [opts.partitionField="ticketKey"] Field name used to group chunks for replace/delete.
   * @param {"jira"|"github"} [opts.source="jira"] Logical source label (for logs + retrieval tagging).
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({
    uri,
    database,
    collection,
    vectorIndex,
    embeddingDimensions,
    partitionField = 'ticketKey',
    source = 'jira',
    logger,
  }) {
    this.uri = uri;
    this.databaseName = database;
    this.collectionName = collection;
    this.vectorIndex = vectorIndex;
    this.embeddingDimensions = embeddingDimensions;
    this.partitionField = partitionField;
    this.source = source;
    this.logger = (logger || createLogger()).child({
      component: 'mongoStore',
      source,
      collection,
    });

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
   * Ensures helper b-tree indexes exist. Atlas Vector Search indexes must
   * still be created in the Atlas UI — see docs/mongodb-atlas-setup.md.
   * @returns {Promise<void>}
   */
  async ensureIndexes() {
    const coll = await this._coll();
    // Partition field is the hot lookup path for both "delete by partition"
    // and "fetch chunks for this entity" operations.
    await coll.createIndex({ [this.partitionField]: 1 });
    // Secondary indexes tuned to each source's common filter axes.
    if (this.source === 'github') {
      await coll.createIndex({ repoFullName: 1, entityType: 1 });
    } else {
      await coll.createIndex({ projectKey: 1, sourceType: 1 });
    }
    await coll.createIndex({ indexedAt: 1 });
    this.logger.info('helper indexes ensured');
  }

  // ---------------------------------------------------------------------------
  // Generic "entity" methods — operate on the configured partitionField.
  // ---------------------------------------------------------------------------

  /**
   * Deletes every chunk that belongs to a single entity (by partition key).
   * @param {string} entityKey
   * @returns {Promise<number>} deletedCount
   */
  async deleteEntity(entityKey) {
    const coll = await this._coll();
    const filter = { [this.partitionField]: entityKey };
    const { deletedCount } = await withRetry(
      () => coll.deleteMany(filter),
      { label: 'mongo-delete-entity', logger: this.logger }
    );
    this.logger.debug('entity chunks deleted', { entityKey, deletedCount });
    return deletedCount || 0;
  }

  /**
   * Deletes chunks for a batch of entities.
   * @param {string[]} entityKeys
   * @returns {Promise<number>} deletedCount
   */
  async deleteEntities(entityKeys) {
    if (!entityKeys?.length) return 0;
    const coll = await this._coll();
    const filter = { [this.partitionField]: { $in: entityKeys } };
    const { deletedCount } = await withRetry(
      () => coll.deleteMany(filter),
      { label: 'mongo-delete-entities', logger: this.logger }
    );
    this.logger.info('bulk entity chunks deleted', {
      count: entityKeys.length,
      deletedCount,
    });
    return deletedCount || 0;
  }

  /**
   * Replaces every chunk for an entity with the new set (delete-then-insert).
   *
   * @param {string} entityKey
   * @param {Array<{chunkId: string, text: string, chunkIndex: number, sourceType: string, metadata?: Record<string, any>} & Record<string, any>>} chunks
   *   Chunk objects. Every chunk may carry any number of extra fields; those
   *   fields are stored on the Mongo document verbatim. The chunker's own
   *   entity-shaped fields (ticketKey / projectKey / entityKey / entityType /
   *   repoFullName) are preserved automatically — we simply shallow-copy the
   *   chunk and add `_id`, `embedding`, and `indexedAt`.
   * @param {number[][]} embeddings Parallel array to `chunks`.
   * @returns {Promise<{inserted: number, deleted: number}>}
   */
  async replaceEntityChunks(entityKey, chunks, embeddings) {
    if (chunks.length !== embeddings.length) {
      throw new Error(
        `chunks (${chunks.length}) and embeddings (${embeddings.length}) length mismatch`
      );
    }
    const coll = await this._coll();
    const now = new Date().toISOString();
    const filter = { [this.partitionField]: entityKey };

    const { deletedCount } = await withRetry(
      () => coll.deleteMany(filter),
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
      // Strip fields we'll reassign, then spread the rest into the doc so
      // chunker-specific fields (e.g. entityType, repoFullName) survive.
      const { chunkId, ...rest } = c;
      return {
        _id: chunkId,
        ...rest,
        embedding,
        indexedAt: now,
      };
    });

    // `ordered: false` lets insertMany skip duplicates instead of aborting
    // the whole batch. Deterministic IDs plus the prior deletion make
    // duplicates a rare edge case.
    await withRetry(
      () => coll.insertMany(docs, { ordered: false }),
      { label: 'mongo-replace-insert', logger: this.logger }
    );

    return { inserted: docs.length, deleted: deletedCount || 0 };
  }

  // ---------------------------------------------------------------------------
  // Jira-flavoured aliases so existing Jira callers do not change.
  // ---------------------------------------------------------------------------

  /**
   * Alias for `deleteEntity` that reads naturally in Jira code.
   * @param {string} ticketKey
   * @returns {Promise<number>}
   */
  async deleteTicket(ticketKey) { return this.deleteEntity(ticketKey); }

  /**
   * Alias for `deleteEntities`.
   * @param {string[]} ticketKeys
   * @returns {Promise<number>}
   */
  async deleteTickets(ticketKeys) { return this.deleteEntities(ticketKeys); }

  /**
   * Alias for `replaceEntityChunks` — preserves the original Jira API shape.
   * @param {string} ticketKey
   * @param {import('../chunking/chunker').Chunk[]} chunks
   * @param {number[][]} embeddings
   * @returns {Promise<{inserted: number, deleted: number}>}
   */
  async replaceTicketChunks(ticketKey, chunks, embeddings) {
    return this.replaceEntityChunks(ticketKey, chunks, embeddings);
  }

  // ---------------------------------------------------------------------------
  // Retrieval-side API.
  // ---------------------------------------------------------------------------

  /**
   * Runs a MongoDB Atlas `$vectorSearch` aggregation and returns the top
   * results. `numCandidates` is an Atlas-specific hint: the engine first
   * narrows to this many approximate candidates, then scores them exactly.
   *
   * @param {Object} args
   * @param {number[]} args.embedding Query embedding.
   * @param {number} args.topK How many final results to return.
   * @param {Object} [args.filters] Optional metadata filters (exact matches).
   *   Jira filter keys:
   *     - projectKey, sourceType, ticketKey, labels
   *   GitHub filter keys:
   *     - repoFullName, entityType, entityKey, sourceType
   *     - branches (must include one of), filePaths (must include one of),
   *       prNumber, issueNumber, commitSha
   *   Shared keys work on either collection when the field is declared in
   *   that collection's Atlas index definition.
   * @returns {Promise<Array<{chunkId: string, score: number, text: string, metadata: any} & Record<string, any>>>}
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

    const atlasFilter = this._buildAtlasFilter(filters);
    if (Object.keys(atlasFilter).length) {
      vsStage.$vectorSearch.filter = atlasFilter;
    }

    // Project everything but the raw embedding (embeddings are huge and the
    // caller never needs them back).
    const projectStage = {
      $project: {
        _id: 0,
        chunkId: '$_id',
        ticketKey: 1,
        projectKey: 1,
        entityKey: 1,
        entityType: 1,
        repoFullName: 1,
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

  /**
   * Translates our simple filter objects into the Atlas Vector Search
   * filter DSL. Unknown filter keys are silently ignored so a caller can
   * safely pass both Jira-only and GitHub-only keys at once.
   * @private
   * @param {Record<string, any>} filters
   * @returns {Record<string, any>}
   */
  _buildAtlasFilter(filters) {
    const out = {};
    const eq = (v) => (Array.isArray(v) ? { $in: v } : { $eq: v });

    // Shared.
    if (filters.sourceType) out.sourceType = eq(filters.sourceType);

    // Jira-shaped filters.
    if (filters.projectKey) out.projectKey = eq(filters.projectKey);
    if (filters.ticketKey) out.ticketKey = eq(filters.ticketKey);
    if (filters.labels?.length) out['metadata.labels'] = { $all: filters.labels };

    // GitHub-shaped filters.
    if (filters.repoFullName) out.repoFullName = eq(filters.repoFullName);
    if (filters.entityType) out.entityType = eq(filters.entityType);
    if (filters.entityKey) out.entityKey = eq(filters.entityKey);
    if (filters.branches?.length) {
      // The chunk stores metadata.branches as a string[]; `$in` matches when
      // at least one requested branch is present.
      out['metadata.branches'] = { $in: filters.branches };
    }
    if (filters.filePaths?.length) {
      out['metadata.filePaths'] = { $in: filters.filePaths };
    }
    if (filters.prNumber != null) out['metadata.prNumber'] = { $eq: Number(filters.prNumber) };
    if (filters.issueNumber != null) out['metadata.issueNumber'] = { $eq: Number(filters.issueNumber) };
    if (filters.commitSha) out['metadata.sha'] = { $eq: String(filters.commitSha) };

    return out;
  }
}

module.exports = {
  MongoVectorStore,
};
