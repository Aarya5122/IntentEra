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
 * @property {boolean} enabled
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
 * @property {string} collection                Jira chunks collection.
 * @property {string} vectorIndex               Atlas vector index for jira collection.
 * @property {string} githubCollection          GitHub chunks collection (separate partition).
 * @property {string} githubVectorIndex         Atlas vector index for github collection.
 */

/**
 * @typedef {Object} GithubConfig
 * @property {boolean} enabled          Top-level on/off switch for GitHub ingestion.
 * @property {string}  token            PAT used for REST + GraphQL calls.
 * @property {string}  repoOwner        e.g. "octocat".
 * @property {string}  repoName         e.g. "hello-world".
 * @property {boolean} includeCommits
 * @property {boolean} includePullRequests
 * @property {boolean} includeIssues
 * @property {number}  staleBranchDays  A branch is "active" when its tip commit is newer than this many days.
 * @property {number}  maxBranches      Safety cap on how many active branches we iterate per run.
 * @property {number}  commitMessageMaxTokens
 * @property {number}  commitFilesMaxTokens
 * @property {number}  prBodyMaxTokens
 * @property {number}  prBodyOverlapTokens
 * @property {number}  prReviewMaxTokens
 * @property {number}  prCommentGroupSize
 * @property {number}  issueBodyMaxTokens
 * @property {number}  issueCommentGroupSize
 * @property {string}  graphqlEndpoint  Usually https://api.github.com/graphql.
 * @property {string}  restEndpoint     Usually https://api.github.com.
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
 * @property {string} chatModel  Chat completions model used by the chat handler.
 */

/**
 * @typedef {Object} ChatConfig
 * @property {number} perVectorTopK     Per-query topK in the multi-query RAG fan-out.
 * @property {number} mergedTopN        Cap on merged hits returned to the LLM.
 * @property {number} maxLocalCommits   Cap on commits the Lambda accepts per request.
 * @property {number} agentPort         Port the local git agent listens on.
 * @property {string[]} allowedProjectRoots
 *           Optional allowlist of absolute path prefixes the local agent will accept.
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
 * @property {"jira"|"github"} defaultSource
 * @property {string} nodeEnv
 * @property {string} logLevel
 * @property {number} incrementalLookbackMinutes
 * @property {JiraConfig} jira
 * @property {ConfluenceConfig} confluence
 * @property {GithubConfig} github
 * @property {MongoConfig} mongo
 * @property {RedisConfig} redis
 * @property {OpenAIConfig} openai
 * @property {ChunkingConfig} chunking
 * @property {RetrievalConfig} retrieval
 * @property {ChatConfig} chat
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

  // Resolve default SOURCE too: which source the ingest Lambda / CLI assumes
  // when the event does not explicitly specify one. Defaults to "jira" to
  // preserve backward compatibility with the original project.
  const rawSource = (process.env.SYNC_SOURCE || 'jira').toLowerCase();
  if (rawSource !== 'jira' && rawSource !== 'github') {
    throw new Error(
      `SYNC_SOURCE must be "jira" or "github", got "${rawSource}"`
    );
  }

  // Each source has an `enabled` flag. This controls whether its credentials
  // are validated at config-load time. GitHub-only deployments can switch
  // JIRA_ENABLED=false and never supply Jira credentials, and vice versa.
  const jiraEnabled = readBool('JIRA_ENABLED', true);
  const githubEnabled = readBool('GITHUB_ENABLED', false);

  /** @type {AppConfig} */
  const cfg = {
    defaultMode: /** @type {"incremental"|"full"} */ (rawMode),
    defaultSource: /** @type {"jira"|"github"} */ (rawSource),
    nodeEnv: readString('NODE_ENV', { fallback: 'production' }),
    logLevel: readString('LOG_LEVEL', { fallback: 'info' }).toLowerCase(),

    incrementalLookbackMinutes: readNumber('INCREMENTAL_LOOKBACK_MINUTES', 60),

    jira: {
      enabled: jiraEnabled,
      // Credentials are only required when the source is enabled. This keeps
      // GitHub-only deployments from needing Jira creds and vice versa.
      baseUrl: readString('JIRA_BASE_URL', { required: jiraEnabled }).replace(/\/+$/, ''),
      email: readString('JIRA_EMAIL', { required: jiraEnabled }),
      apiToken: readString('JIRA_API_TOKEN', { required: jiraEnabled }),
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
        (readString('JIRA_BASE_URL') ? `${readString('JIRA_BASE_URL')}/wiki` : '')
      ).replace(/\/+$/, ''),
      email: readString('CONFLUENCE_EMAIL') || readString('JIRA_EMAIL'),
      apiToken:
        readString('CONFLUENCE_API_TOKEN') || readString('JIRA_API_TOKEN'),
    },

    github: {
      enabled: githubEnabled,
      // The PAT is required only when GitHub ingestion is enabled. We keep it
      // in Secrets Manager in production.
      token: readString('GITHUB_TOKEN', { required: githubEnabled }),
      repoOwner: readString('GITHUB_REPO_OWNER', { required: githubEnabled }),
      repoName: readString('GITHUB_REPO_NAME', { required: githubEnabled }),
      includeCommits: readBool('GITHUB_INCLUDE_COMMITS', true),
      includePullRequests: readBool('GITHUB_INCLUDE_PULL_REQUESTS', true),
      includeIssues: readBool('GITHUB_INCLUDE_ISSUES', true),
      // "Active" = branch tip committed within this many days. GitHub has no
      // first-class "stale" flag so we derive it from the tip's commit date.
      staleBranchDays: readNumber('GITHUB_STALE_BRANCH_DAYS', 90),
      // Safety cap so a misconfigured monorepo with thousands of branches
      // cannot blow up a Lambda run.
      maxBranches: readNumber('GITHUB_MAX_BRANCHES', 50),
      // Chunking knobs for GitHub entities — separate from Jira knobs because
      // GitHub content (short commit messages, long PR conversations) has
      // different shape.
      commitMessageMaxTokens: readNumber('GITHUB_COMMIT_MESSAGE_MAX_TOKENS', 400),
      commitFilesMaxTokens: readNumber('GITHUB_COMMIT_FILES_MAX_TOKENS', 400),
      prBodyMaxTokens: readNumber('GITHUB_PR_BODY_MAX_TOKENS', 500),
      prBodyOverlapTokens: readNumber('GITHUB_PR_BODY_OVERLAP_TOKENS', 50),
      prReviewMaxTokens: readNumber('GITHUB_PR_REVIEW_MAX_TOKENS', 600),
      prCommentGroupSize: readNumber('GITHUB_PR_COMMENT_GROUP_SIZE', 3),
      issueBodyMaxTokens: readNumber('GITHUB_ISSUE_BODY_MAX_TOKENS', 500),
      issueCommentGroupSize: readNumber('GITHUB_ISSUE_COMMENT_GROUP_SIZE', 3),
      // Endpoints are overridable so enterprise GitHub can be supported later.
      graphqlEndpoint: readString('GITHUB_GRAPHQL_ENDPOINT', {
        fallback: 'https://api.github.com/graphql',
      }),
      restEndpoint: readString('GITHUB_REST_ENDPOINT', {
        fallback: 'https://api.github.com',
      }),
    },

    mongo: {
      uri: readString('MONGODB_URI', { required: true }),
      database: readString('MONGODB_DATABASE', { fallback: 'intentera' }),
      collection: readString('MONGODB_COLLECTION', { fallback: 'rag_chunks' }),
      vectorIndex: readString('MONGODB_VECTOR_INDEX', { fallback: 'vector_index' }),
      // Separate collection + vector index for GitHub so Jira and GitHub
      // chunks never get mixed in a single `$vectorSearch` call. Each index
      // must be created manually in the Atlas UI; we just reference the
      // chosen names here.
      githubCollection: readString('MONGODB_GITHUB_COLLECTION', {
        fallback: 'rag_chunks_github',
      }),
      githubVectorIndex: readString('MONGODB_GITHUB_VECTOR_INDEX', {
        fallback: 'vector_index_github',
      }),
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
      // Chat completions model used by the chat handler. gpt-4o-mini is a
      // strong default: cheap, supports JSON-mode output, fast.
      chatModel: readString('OPENAI_CHAT_MODEL', { fallback: 'gpt-4o-mini' }),
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

    chat: {
      // Multi-query RAG fan-out: each commit subject + the user question is
      // embedded and used as a separate vector-search query. Keep this small
      // because the total work is perVectorTopK * (1 + commitCount) hits.
      perVectorTopK: readNumber('CHAT_PER_VECTOR_TOP_K', 3),
      // Cap on the merged, de-duplicated hit list passed to the LLM.
      mergedTopN: readNumber('CHAT_MERGED_TOP_N', 12),
      // Defensive cap on how many local commits a single chat request may
      // include; protects the Lambda from oversized payloads.
      maxLocalCommits: readNumber('CHAT_MAX_LOCAL_COMMITS', 50),
      // Local-only: the git agent reads this; the Lambda happily ignores it.
      agentPort: readNumber('AGENT_PORT', 8787),
      // Optional safety allowlist used by the local git agent. Empty array =
      // any absolute path containing a .git directory is acceptable.
      allowedProjectRoots: readList('AGENT_ALLOWED_PROJECT_ROOTS'),
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
  if (cfg.chat.perVectorTopK <= 0) {
    throw new Error('CHAT_PER_VECTOR_TOP_K must be > 0');
  }
  if (cfg.chat.mergedTopN <= 0) {
    throw new Error('CHAT_MERGED_TOP_N must be > 0');
  }
  if (cfg.chat.maxLocalCommits <= 0) {
    throw new Error('CHAT_MAX_LOCAL_COMMITS must be > 0');
  }
  if (cfg.chat.agentPort <= 0 || cfg.chat.agentPort > 65535) {
    throw new Error('AGENT_PORT must be between 1 and 65535');
  }
  if (cfg.github.enabled) {
    if (cfg.github.staleBranchDays <= 0) {
      throw new Error('GITHUB_STALE_BRANCH_DAYS must be > 0');
    }
    if (cfg.github.maxBranches <= 0) {
      throw new Error('GITHUB_MAX_BRANCHES must be > 0');
    }
    if (!cfg.github.includeCommits && !cfg.github.includePullRequests && !cfg.github.includeIssues) {
      throw new Error(
        'GitHub ingestion is enabled but all entity types ' +
        '(GITHUB_INCLUDE_COMMITS, GITHUB_INCLUDE_PULL_REQUESTS, GITHUB_INCLUDE_ISSUES) ' +
        'are disabled — nothing to index'
      );
    }
  }
  // If the default source is github but github is disabled, fail fast —
  // otherwise the ingest Lambda would later throw a less obvious error.
  if (cfg.defaultSource === 'github' && !cfg.github.enabled) {
    throw new Error(
      'SYNC_SOURCE=github but GITHUB_ENABLED is false. ' +
      'Set GITHUB_ENABLED=true or change SYNC_SOURCE.'
    );
  }
  if (cfg.defaultSource === 'jira' && !cfg.jira.enabled) {
    throw new Error(
      'SYNC_SOURCE=jira but JIRA_ENABLED is false. ' +
      'Set JIRA_ENABLED=true or change SYNC_SOURCE.'
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
