'use strict';

/**
 * config/appConfig.js
 * -------------------
 * Single source of truth for application configuration.
 *
 * Philosophy:
 *   - All modules read config from the object returned by `getConfig()`.
 *   - `getConfig()` reads from `process.env`. By the time it is called,
 *     `config/secrets.js` should already have merged Secrets Manager values
 *     into process.env.
 *   - This module validates required fields and fails LOUDLY with a clear
 *     message if anything is missing or malformed. Silent fallbacks would
 *     make production issues much harder to diagnose.
 *
 * Caching:
 *   - We memoise the resolved config. Lambda containers live for a while and
 *     we do not want to re-parse env on every invocation.
 *   - Call `_resetConfigCache()` in tests if you need to rebuild.
 */

/** @type {AppConfig | null} */
let cached = null;

/**
 * @typedef {Object} JiraConfig
 * @property {string} baseUrl
 * @property {string} email
 * @property {string} apiToken
 * @property {string[]} projectKeys - empty array means "all projects"
 * @property {string[]} issueTypes
 * @property {string[]} statuses
 * @property {string[]} labels
 * @property {boolean} includeLinkedIssues
 * @property {boolean} includeAttachments
 * @property {boolean} includeConfluence
 */

/**
 * @typedef {Object} ConfluenceConfig
 * @property {string} baseUrl
 * @property {string} email
 * @property {string} apiToken
 */

/**
 * @typedef {Object} MongoConfig
 * @property {string} uri
 * @property {string} database
 * @property {string} collection
 * @property {string} vectorIndex
 */

/**
 * @typedef {Object} RedisConfig
 * @property {string} url
 * @property {string} keyPrefix
 */

/**
 * @typedef {Object} OpenAIConfig
 * @property {string} apiKey
 * @property {string} embeddingModel
 * @property {number} embeddingDimensions
 * @property {number} batchSize
 */

/**
 * @typedef {Object} ChunkingConfig
 * @property {number} descriptionMaxTokens
 * @property {number} descriptionOverlapTokens
 * @property {number} commentGroupSize
 * @property {number} attachmentMaxTokens
 * @property {number} confluenceMaxTokens
 */

/**
 * @typedef {Object} RetrievalConfig
 * @property {number} defaultTopK
 * @property {number} maxTopK
 */

/**
 * @typedef {Object} AppConfig
 * @property {"incremental"|"full"} defaultMode
 * @property {string} nodeEnv
 * @property {string} logLevel
 * @property {number} incrementalLookbackMinutes
 * @property {JiraConfig} jira
 * @property {ConfluenceConfig} confluence
 * @property {MongoConfig} mongo
 * @property {RedisConfig} redis
 * @property {OpenAIConfig} openai
 * @property {ChunkingConfig} chunking
 * @property {RetrievalConfig} retrieval
 */

/**
 * Reads a string env var. Throws if it is missing when `required` is true.
 * @param {string} name
 * @param {{ required?: boolean, fallback?: string }} [opts]
 * @returns {string}
 */
function readString(name, opts = {}) {
  const { required = false, fallback = '' } = opts;
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      throw new Error(`Missing required env var "${name}"`);
    }
    return fallback;
  }
  return raw;
}

/**
 * Reads a list env var (comma-separated). Empty string yields [].
 * @param {string} name
 * @returns {string[]}
 */
function readList(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Reads a boolean env var.
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

/**
 * Reads a numeric env var. Throws if the value is non-numeric.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Env var "${name}" must be numeric, got "${raw}"`);
  }
  return parsed;
}

/**
 * Builds the full configuration object.
 * Call this LAZILY (after secrets have been loaded) via `getConfig()`.
 * @returns {AppConfig}
 */
function buildConfig() {
  // Normalise defaultMode, rejecting anything unexpected.
  const rawMode = (process.env.SYNC_MODE || 'incremental').toLowerCase();
  if (rawMode !== 'incremental' && rawMode !== 'full') {
    throw new Error(
      `SYNC_MODE must be "incremental" or "full", got "${rawMode}"`
    );
  }

  /** @type {AppConfig} */
  const cfg = {
    defaultMode: /** @type {"incremental"|"full"} */ (rawMode),
    nodeEnv: readString('NODE_ENV', { fallback: 'production' }),
    logLevel: readString('LOG_LEVEL', { fallback: 'info' }).toLowerCase(),

    incrementalLookbackMinutes: readNumber('INCREMENTAL_LOOKBACK_MINUTES', 60),

    jira: {
      baseUrl: readString('JIRA_BASE_URL', { required: true }).replace(/\/+$/, ''),
      email: readString('JIRA_EMAIL', { required: true }),
      apiToken: readString('JIRA_API_TOKEN', { required: true }),
      projectKeys: readList('JIRA_PROJECT_KEYS'),
      issueTypes: readList('JIRA_ISSUE_TYPES'),
      statuses: readList('JIRA_STATUSES'),
      labels: readList('JIRA_LABELS'),
      includeLinkedIssues: readBool('JIRA_INCLUDE_LINKED_ISSUES', true),
      includeAttachments: readBool('JIRA_INCLUDE_ATTACHMENTS', true),
      includeConfluence: readBool('JIRA_INCLUDE_CONFLUENCE', true),
    },

    confluence: {
      // Fall back to Jira creds when Confluence-specific ones are not set,
      // because Atlassian Cloud commonly reuses the same credentials.
      baseUrl: (
        readString('CONFLUENCE_BASE_URL') ||
        `${readString('JIRA_BASE_URL')}/wiki`
      ).replace(/\/+$/, ''),
      email: readString('CONFLUENCE_EMAIL') || readString('JIRA_EMAIL'),
      apiToken:
        readString('CONFLUENCE_API_TOKEN') || readString('JIRA_API_TOKEN'),
    },

    mongo: {
      uri: readString('MONGODB_URI', { required: true }),
      database: readString('MONGODB_DATABASE', { fallback: 'intentera' }),
      collection: readString('MONGODB_COLLECTION', { fallback: 'rag_chunks' }),
      vectorIndex: readString('MONGODB_VECTOR_INDEX', { fallback: 'vector_index' }),
    },

    redis: {
      url: readString('REDIS_URL', { required: true }),
      keyPrefix: readString('REDIS_KEY_PREFIX', { fallback: 'intentera:sync:' }),
    },

    openai: {
      apiKey: readString('OPENAI_API_KEY', { required: true }),
      embeddingModel: readString('OPENAI_EMBEDDING_MODEL', {
        fallback: 'text-embedding-3-small',
      }),
      embeddingDimensions: readNumber('OPENAI_EMBEDDING_DIMENSIONS', 1536),
      batchSize: readNumber('OPENAI_EMBEDDING_BATCH_SIZE', 64),
    },

    chunking: {
      descriptionMaxTokens: readNumber('CHUNK_DESCRIPTION_MAX_TOKENS', 500),
      descriptionOverlapTokens: readNumber('CHUNK_DESCRIPTION_OVERLAP_TOKENS', 50),
      commentGroupSize: readNumber('CHUNK_COMMENT_GROUP_SIZE', 3),
      attachmentMaxTokens: readNumber('CHUNK_ATTACHMENT_MAX_TOKENS', 500),
      confluenceMaxTokens: readNumber('CHUNK_CONFLUENCE_MAX_TOKENS', 600),
    },

    retrieval: {
      defaultTopK: readNumber('RETRIEVAL_DEFAULT_TOP_K', 8),
      maxTopK: readNumber('RETRIEVAL_MAX_TOP_K', 25),
    },
  };

  // ---- Cross-field sanity checks ------------------------------------------
  if (cfg.incrementalLookbackMinutes < 0) {
    throw new Error('INCREMENTAL_LOOKBACK_MINUTES must be >= 0');
  }
  if (cfg.openai.embeddingDimensions <= 0) {
    throw new Error('OPENAI_EMBEDDING_DIMENSIONS must be > 0');
  }
  if (cfg.retrieval.defaultTopK > cfg.retrieval.maxTopK) {
    throw new Error(
      'RETRIEVAL_DEFAULT_TOP_K must be <= RETRIEVAL_MAX_TOP_K'
    );
  }

  return cfg;
}

/**
 * Returns the validated, memoised application config.
 * @returns {AppConfig}
 */
function getConfig() {
  if (cached) return cached;
  cached = buildConfig();
  return cached;
}

/**
 * Clears the cached config. Tests only.
 */
function _resetConfigCache() {
  cached = null;
}

module.exports = {
  getConfig,
  _resetConfigCache,
};
