'use strict';

/**
 * src/utils/wiring.js
 * -------------------
 * Dependency factory. Every entry point (Lambda handler, CLI runner) needs
 * a consistent set of constructed clients. This module is the single place
 * those constructors live so the behaviour of the ingestion and retrieval
 * paths never drifts.
 *
 * Lambda container reuse:
 *   - The module-level `cached*` variables persist between warm invocations
 *     within the same Lambda container, which saves connection-setup cost.
 *   - Each builder waits for the first caller to finish initialising and
 *     then reuses the same instance.
 */

const { loadSecretsIfConfigured } = require('../../config/secrets');
const { getConfig, _resetConfigCache } = require('../../config/appConfig');
const { createLogger } = require('./logger');

const { JiraClient } = require('../jira/client');
const { JiraFetcher } = require('../jira/fetcher');
const { ConfluenceClient } = require('../confluence/client');
const { Embedder } = require('../embeddings/embedder');
const { MongoVectorStore } = require('../vectorStore/mongoStore');
const { RedisState } = require('../state/redisState');

let cachedCfg = null;
let cachedEmbedder = null;
let cachedVectorStore = null;
let cachedRedisState = null;
let cachedFetcher = null;
let cachedConfluence = null;

/**
 * Loads secrets (if configured) and returns the validated AppConfig.
 * Subsequent calls reuse the cached result.
 * @returns {Promise<import('../../config/appConfig').AppConfig>}
 */
async function loadConfig() {
  if (cachedCfg) return cachedCfg;
  await loadSecretsIfConfigured();
  cachedCfg = getConfig();
  return cachedCfg;
}

/**
 * Builds dependencies needed for the ingestion path. Shares the Mongo and
 * embedder clients with retrieval so they are only created once per warm
 * container.
 * @returns {Promise<{
 *   cfg: import('../../config/appConfig').AppConfig,
 *   logger: ReturnType<typeof createLogger>,
 *   fetcher: JiraFetcher,
 *   confluenceClient: ConfluenceClient|null,
 *   embedder: Embedder,
 *   vectorStore: MongoVectorStore,
 *   redisState: RedisState,
 * }>}
 */
async function buildIngestionDeps() {
  const cfg = await loadConfig();
  const logger = createLogger({ app: 'intentera', role: 'ingest' });

  if (!cachedFetcher) {
    const jiraClient = new JiraClient({
      baseUrl: cfg.jira.baseUrl,
      email: cfg.jira.email,
      apiToken: cfg.jira.apiToken,
      logger,
    });
    cachedFetcher = new JiraFetcher({
      client: jiraClient,
      includeAttachments: cfg.jira.includeAttachments,
      includeLinkedIssues: cfg.jira.includeLinkedIssues,
      includeConfluence: cfg.jira.includeConfluence,
      logger,
    });
  }

  if (!cachedConfluence && cfg.jira.includeConfluence) {
    cachedConfluence = new ConfluenceClient({
      baseUrl: cfg.confluence.baseUrl,
      email: cfg.confluence.email,
      apiToken: cfg.confluence.apiToken,
      logger,
    });
  }

  if (!cachedEmbedder) {
    cachedEmbedder = new Embedder({
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.embeddingModel,
      dimensions: cfg.openai.embeddingDimensions,
      batchSize: cfg.openai.batchSize,
      logger,
    });
  }
  if (!cachedVectorStore) {
    cachedVectorStore = new MongoVectorStore({
      uri: cfg.mongo.uri,
      database: cfg.mongo.database,
      collection: cfg.mongo.collection,
      vectorIndex: cfg.mongo.vectorIndex,
      embeddingDimensions: cfg.openai.embeddingDimensions,
      logger,
    });
  }
  if (!cachedRedisState) {
    cachedRedisState = new RedisState({
      url: cfg.redis.url,
      keyPrefix: cfg.redis.keyPrefix,
      logger,
    });
  }

  return {
    cfg,
    logger,
    fetcher: cachedFetcher,
    confluenceClient: cachedConfluence,
    embedder: cachedEmbedder,
    vectorStore: cachedVectorStore,
    redisState: cachedRedisState,
  };
}

/**
 * Builds dependencies for the retrieval path. Much lighter than ingestion
 * because we do not need Jira, Confluence, or Redis here.
 *
 * @returns {Promise<{
 *   cfg: import('../../config/appConfig').AppConfig,
 *   logger: ReturnType<typeof createLogger>,
 *   embedder: Embedder,
 *   vectorStore: MongoVectorStore,
 * }>}
 */
async function buildRetrievalDeps() {
  const cfg = await loadConfig();
  const logger = createLogger({ app: 'intentera', role: 'retrieve' });

  if (!cachedEmbedder) {
    cachedEmbedder = new Embedder({
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.embeddingModel,
      dimensions: cfg.openai.embeddingDimensions,
      batchSize: cfg.openai.batchSize,
      logger,
    });
  }
  if (!cachedVectorStore) {
    cachedVectorStore = new MongoVectorStore({
      uri: cfg.mongo.uri,
      database: cfg.mongo.database,
      collection: cfg.mongo.collection,
      vectorIndex: cfg.mongo.vectorIndex,
      embeddingDimensions: cfg.openai.embeddingDimensions,
      logger,
    });
  }

  return {
    cfg,
    logger,
    embedder: cachedEmbedder,
    vectorStore: cachedVectorStore,
  };
}

/**
 * Tears down clients. Useful for the CLI runner so Node can exit cleanly.
 * In Lambda we rely on container shutdown.
 * @returns {Promise<void>}
 */
async function teardown() {
  const tasks = [];
  if (cachedVectorStore) tasks.push(cachedVectorStore.disconnect());
  if (cachedRedisState) tasks.push(cachedRedisState.disconnect());
  await Promise.allSettled(tasks);
  cachedCfg = null;
  cachedEmbedder = null;
  cachedVectorStore = null;
  cachedRedisState = null;
  cachedFetcher = null;
  cachedConfluence = null;
  _resetConfigCache();
}

module.exports = {
  loadConfig,
  buildIngestionDeps,
  buildRetrievalDeps,
  teardown,
};
