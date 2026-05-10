'use strict';

/**
 * src/utils/wiring.js
 * -------------------
 * Dependency factory. Every entry point (Lambda handler, CLI runner) needs
 * a consistent set of constructed clients. This module is the single place
 * those constructors live so the behaviour of the ingestion and retrieval
 * paths never drifts.
 *
 * Sources
 * -------
 * The project supports TWO ingestion sources today: `jira` and `github`.
 * Each source has its own set of cached clients (vector store pointing at
 * its own Mongo collection, Redis state scoped to its own key) so the two
 * pipelines never share mutable state.
 *
 * Retrieval can target `jira`, `github`, or `both`. For `both` we build
 * BOTH vector store instances so the retrieval handler can fan out queries.
 *
 * Lambda container reuse
 * ----------------------
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
const { GithubClient } = require('../github/client');
const { GithubCommitFetcher } = require('../github/commits/fetcher');
const { GithubPullRequestFetcher } = require('../github/pullRequests/fetcher');
const { GithubIssueFetcher } = require('../github/issues/fetcher');
const { LlmAnswerer } = require('../answer/llmAnswerer');

// ----- Shared singletons -----
let cachedCfg = null;
let cachedEmbedder = null;
let cachedAnswerer = null;

// ----- Jira-scoped singletons -----
let cachedJiraFetcher = null;
let cachedJiraConfluence = null;
let cachedJiraVectorStore = null;
let cachedJiraRedisState = null;

// ----- GitHub-scoped singletons -----
let cachedGithubClient = null;
let cachedGithubCommitFetcher = null;
let cachedGithubPullRequestFetcher = null;
let cachedGithubIssueFetcher = null;
let cachedGithubVectorStore = null;
let cachedGithubRedisState = null;

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
 * Lazy-constructs the OpenAI embedder. Shared between every source so we
 * embed Jira and GitHub chunks with the same model and dimensions.
 * @param {import('../../config/appConfig').AppConfig} cfg
 * @param {ReturnType<typeof createLogger>} logger
 * @returns {Embedder}
 */
function getEmbedder(cfg, logger) {
  if (!cachedEmbedder) {
    cachedEmbedder = new Embedder({
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.embeddingModel,
      dimensions: cfg.openai.embeddingDimensions,
      batchSize: cfg.openai.batchSize,
      logger,
    });
  }
  return cachedEmbedder;
}

/**
 * Builds the Jira-side vector store (collection `rag_chunks`).
 * @param {import('../../config/appConfig').AppConfig} cfg
 * @param {ReturnType<typeof createLogger>} logger
 * @returns {MongoVectorStore}
 */
function getJiraVectorStore(cfg, logger) {
  if (!cachedJiraVectorStore) {
    cachedJiraVectorStore = new MongoVectorStore({
      uri: cfg.mongo.uri,
      database: cfg.mongo.database,
      collection: cfg.mongo.collection,
      vectorIndex: cfg.mongo.vectorIndex,
      embeddingDimensions: cfg.openai.embeddingDimensions,
      partitionField: 'ticketKey',
      source: 'jira',
      logger,
    });
  }
  return cachedJiraVectorStore;
}

/**
 * Builds the GitHub-side vector store (collection `rag_chunks_github`).
 * @param {import('../../config/appConfig').AppConfig} cfg
 * @param {ReturnType<typeof createLogger>} logger
 * @returns {MongoVectorStore}
 */
function getGithubVectorStore(cfg, logger) {
  if (!cachedGithubVectorStore) {
    cachedGithubVectorStore = new MongoVectorStore({
      uri: cfg.mongo.uri,
      database: cfg.mongo.database,
      collection: cfg.mongo.githubCollection,
      vectorIndex: cfg.mongo.githubVectorIndex,
      embeddingDimensions: cfg.openai.embeddingDimensions,
      partitionField: 'entityKey',
      source: 'github',
      logger,
    });
  }
  return cachedGithubVectorStore;
}

/**
 * Builds ingestion deps for JIRA. Kept backward-compatible with earlier
 * callers that did not pass a source.
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
  const logger = createLogger({ app: 'intentera', role: 'ingest', source: 'jira' });

  if (!cachedJiraFetcher) {
    const jiraClient = new JiraClient({
      baseUrl: cfg.jira.baseUrl,
      email: cfg.jira.email,
      apiToken: cfg.jira.apiToken,
      logger,
    });
    cachedJiraFetcher = new JiraFetcher({
      client: jiraClient,
      includeAttachments: cfg.jira.includeAttachments,
      includeLinkedIssues: cfg.jira.includeLinkedIssues,
      includeConfluence: cfg.jira.includeConfluence,
      logger,
    });
  }

  if (!cachedJiraConfluence && cfg.jira.includeConfluence) {
    cachedJiraConfluence = new ConfluenceClient({
      baseUrl: cfg.confluence.baseUrl,
      email: cfg.confluence.email,
      apiToken: cfg.confluence.apiToken,
      logger,
    });
  }

  const embedder = getEmbedder(cfg, logger);
  const vectorStore = getJiraVectorStore(cfg, logger);

  if (!cachedJiraRedisState) {
    cachedJiraRedisState = new RedisState({
      url: cfg.redis.url,
      keyPrefix: cfg.redis.keyPrefix,
      source: 'jira',
      logger,
    });
  }

  return {
    cfg,
    logger,
    fetcher: cachedJiraFetcher,
    confluenceClient: cachedJiraConfluence,
    embedder,
    vectorStore,
    redisState: cachedJiraRedisState,
  };
}

/**
 * Builds ingestion deps for GitHub.
 * @returns {Promise<{
 *   cfg: import('../../config/appConfig').AppConfig,
 *   logger: ReturnType<typeof createLogger>,
 *   githubClient: GithubClient,
 *   commitFetcher: GithubCommitFetcher,
 *   pullRequestFetcher: GithubPullRequestFetcher,
 *   issueFetcher: GithubIssueFetcher,
 *   embedder: Embedder,
 *   vectorStore: MongoVectorStore,
 *   redisState: RedisState,
 * }>}
 */
async function buildGithubIngestionDeps() {
  const cfg = await loadConfig();
  if (!cfg.github.enabled) {
    throw new Error(
      'GitHub ingestion requested but GITHUB_ENABLED is false. ' +
      'Set GITHUB_ENABLED=true and provide GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME.'
    );
  }
  const logger = createLogger({ app: 'intentera', role: 'ingest', source: 'github' });

  if (!cachedGithubClient) {
    cachedGithubClient = new GithubClient({
      token: cfg.github.token,
      repoOwner: cfg.github.repoOwner,
      repoName: cfg.github.repoName,
      restEndpoint: cfg.github.restEndpoint,
      graphqlEndpoint: cfg.github.graphqlEndpoint,
      logger,
    });
  }
  if (!cachedGithubCommitFetcher) {
    cachedGithubCommitFetcher = new GithubCommitFetcher({ client: cachedGithubClient, logger });
  }
  if (!cachedGithubPullRequestFetcher) {
    cachedGithubPullRequestFetcher = new GithubPullRequestFetcher({ client: cachedGithubClient, logger });
  }
  if (!cachedGithubIssueFetcher) {
    cachedGithubIssueFetcher = new GithubIssueFetcher({ client: cachedGithubClient, logger });
  }

  const embedder = getEmbedder(cfg, logger);
  const vectorStore = getGithubVectorStore(cfg, logger);

  if (!cachedGithubRedisState) {
    cachedGithubRedisState = new RedisState({
      url: cfg.redis.url,
      keyPrefix: cfg.redis.keyPrefix,
      source: 'github',
      logger,
    });
  }

  return {
    cfg,
    logger,
    githubClient: cachedGithubClient,
    commitFetcher: cachedGithubCommitFetcher,
    pullRequestFetcher: cachedGithubPullRequestFetcher,
    issueFetcher: cachedGithubIssueFetcher,
    embedder,
    vectorStore,
    redisState: cachedGithubRedisState,
  };
}

/**
 * Builds dependencies for the retrieval path. Unlike ingestion, retrieval
 * can target multiple sources in the same invocation, so we return BOTH
 * vector stores and let the caller decide which to query.
 *
 * `vectorStore` (the Jira one) is preserved as a top-level field for
 * backward-compat with older retrieval code paths.
 *
 * @returns {Promise<{
 *   cfg: import('../../config/appConfig').AppConfig,
 *   logger: ReturnType<typeof createLogger>,
 *   embedder: Embedder,
 *   vectorStore: MongoVectorStore,
 *   jiraVectorStore: MongoVectorStore,
 *   githubVectorStore: MongoVectorStore|null,
 * }>}
 */
async function buildRetrievalDeps() {
  const cfg = await loadConfig();
  const logger = createLogger({ app: 'intentera', role: 'retrieve' });

  const embedder = getEmbedder(cfg, logger);
  const jiraVectorStore = cfg.jira.enabled ? getJiraVectorStore(cfg, logger) : null;
  const githubVectorStore = cfg.github.enabled ? getGithubVectorStore(cfg, logger) : null;

  return {
    cfg,
    logger,
    embedder,
    // Preserve the original shape for existing Jira-only callers.
    vectorStore: jiraVectorStore || githubVectorStore,
    jiraVectorStore,
    githubVectorStore,
  };
}

/**
 * Lazy-constructs the LLM answerer used by the chat handler. Shared so the
 * OpenAI client connection pool is reused across warm invocations.
 *
 * @param {import('../../config/appConfig').AppConfig} cfg
 * @param {ReturnType<typeof createLogger>} logger
 * @returns {LlmAnswerer}
 */
function getAnswerer(cfg, logger) {
  if (!cachedAnswerer) {
    cachedAnswerer = new LlmAnswerer({
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.chatModel,
      logger,
    });
  }
  return cachedAnswerer;
}

/**
 * Builds dependencies for the chat path. Mirrors `buildRetrievalDeps()` but
 * also wires up the LLM answerer. Both vector stores are exposed; the chat
 * orchestrator skips whichever is null/disabled.
 *
 * @returns {Promise<{
 *   cfg: import('../../config/appConfig').AppConfig,
 *   logger: ReturnType<typeof createLogger>,
 *   embedder: Embedder,
 *   jiraVectorStore: MongoVectorStore|null,
 *   githubVectorStore: MongoVectorStore|null,
 *   answerer: LlmAnswerer,
 * }>}
 */
async function buildChatDeps() {
  const cfg = await loadConfig();
  const logger = createLogger({ app: 'intentera', role: 'chat' });

  const embedder = getEmbedder(cfg, logger);
  const jiraVectorStore = cfg.jira.enabled ? getJiraVectorStore(cfg, logger) : null;
  const githubVectorStore = cfg.github.enabled ? getGithubVectorStore(cfg, logger) : null;
  const answerer = getAnswerer(cfg, logger);

  return {
    cfg,
    logger,
    embedder,
    jiraVectorStore,
    githubVectorStore,
    answerer,
  };
}

/**
 * Tears down clients. Useful for the CLI runner so Node can exit cleanly.
 * In Lambda we rely on container shutdown.
 * @returns {Promise<void>}
 */
async function teardown() {
  const tasks = [];
  if (cachedJiraVectorStore) tasks.push(cachedJiraVectorStore.disconnect());
  if (cachedGithubVectorStore) tasks.push(cachedGithubVectorStore.disconnect());
  if (cachedJiraRedisState) tasks.push(cachedJiraRedisState.disconnect());
  if (cachedGithubRedisState) tasks.push(cachedGithubRedisState.disconnect());
  await Promise.allSettled(tasks);

  cachedCfg = null;
  cachedEmbedder = null;
  cachedAnswerer = null;
  cachedJiraFetcher = null;
  cachedJiraConfluence = null;
  cachedJiraVectorStore = null;
  cachedJiraRedisState = null;
  cachedGithubClient = null;
  cachedGithubCommitFetcher = null;
  cachedGithubPullRequestFetcher = null;
  cachedGithubIssueFetcher = null;
  cachedGithubVectorStore = null;
  cachedGithubRedisState = null;
  _resetConfigCache();
}

module.exports = {
  loadConfig,
  buildIngestionDeps,
  buildGithubIngestionDeps,
  buildRetrievalDeps,
  buildChatDeps,
  teardown,
};
