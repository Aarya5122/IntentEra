'use strict';

/**
 * src/chat/orchestrator.js
 * ------------------------
 * Lambda-side chat orchestrator.
 *
 * Responsibilities (in order):
 *   1. Validate the request shape (question is required; commits + attachments
 *      are optional but capped).
 *   2. Run the multi-query RAG fan-out across the configured vector stores.
 *   3. Ask the LLM to compose the non-technical "WHY" answer with grounded
 *      citations.
 *   4. Shape the response so the extension can render commits / tickets / PRs
 *      directly without further normalisation.
 *
 * Local commits arrive in the request payload (the local git agent on the
 * user's machine extracted them and the extension forwarded them to us).
 * We do NOT re-fetch them server-side: the Lambda has no access to the
 * user's filesystem.
 *
 * Note on graceful degradation: if neither vector store is configured
 * (Jira disabled AND GitHub disabled) we still answer using just the local
 * commits + attachments. The LLM will simply have no RAG_HITS to cite.
 */

const { MultiQueryRetriever } = require('./multiQueryRetriever');
const { createLogger } = require('../utils/logger');

class ChatOrchestrator {
  /**
   * @param {Object} deps
   * @param {import('../embeddings/embedder').Embedder} deps.embedder
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.jiraVectorStore]
   * @param {import('../vectorStore/mongoStore').MongoVectorStore|null} [deps.githubVectorStore]
   * @param {import('../answer/llmAnswerer').LlmAnswerer} deps.answerer
   * @param {import('../../config/appConfig').AppConfig} deps.cfg
   * @param {ReturnType<typeof createLogger>} [deps.logger]
   */
  constructor({ embedder, jiraVectorStore, githubVectorStore, answerer, cfg, logger }) {
    if (!embedder) throw new Error('ChatOrchestrator: embedder is required');
    if (!answerer) throw new Error('ChatOrchestrator: answerer is required');
    if (!cfg) throw new Error('ChatOrchestrator: cfg is required');
    this.cfg = cfg;
    this.answerer = answerer;
    this.logger = (logger || createLogger()).child({ component: 'chatOrchestrator' });
    this.retriever = new MultiQueryRetriever({
      embedder,
      jiraVectorStore,
      githubVectorStore,
      chatCfg: cfg.chat,
      logger: this.logger,
    });
  }

  /**
   * Main entry point.
   *
   * @param {Object} args
   * @param {string} args.question
   * @param {Array<import('../localGit/client').NormalizedCommit>} [args.commits]
   * @param {Array<{file: string, range?: [number, number], content?: string}>} [args.attachments]
   * @param {Array<{role: 'user'|'assistant', content: string}>} [args.history]
   * @param {Object} [args.filters] Optional vector-store filter overrides.
   * @returns {Promise<{
   *   answer: string,
   *   citations: { commits: any[], tickets: any[], prs: any[] },
   *   retrieved: { jiraCount: number, githubCount: number, localCommitCount: number, mergedCount: number },
   *   usage: { embeddingTokens: number, completionTokens: number, promptTokens: number },
   * }>}
   */
  async chat({ question, commits = [], attachments = [], history = [], filters = {} }) {
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error('question must be a non-empty string');
    }

    const cappedCommits = Array.isArray(commits)
      ? commits.slice(0, this.cfg.chat.maxLocalCommits)
      : [];

    this.logger.info('chat request', {
      questionPreview: question.slice(0, 80),
      commits: cappedCommits.length,
      attachments: attachments.length,
      historyTurns: Array.isArray(history) ? history.length : 0,
    });

    const { hits } = await this.retriever.retrieve({
      question,
      commits: cappedCommits,
      filters,
    });

    const jiraHits = hits.filter((h) => h.source === 'jira');
    const githubHits = hits.filter((h) => h.source === 'github');

    const llmResult = await this.answerer.answer({
      question,
      attachments,
      commits: cappedCommits,
      hits,
      history,
    });

    return {
      answer: llmResult.answer,
      citations: llmResult.citations,
      retrieved: {
        jiraCount: jiraHits.length,
        githubCount: githubHits.length,
        localCommitCount: cappedCommits.length,
        mergedCount: hits.length,
      },
      usage: {
        // Embedding token usage isn't surfaced by the embedder today; we
        // expose the field so the response shape stays stable when we add it.
        embeddingTokens: 0,
        promptTokens: llmResult.usage.promptTokens,
        completionTokens: llmResult.usage.completionTokens,
      },
    };
  }
}

module.exports = {
  ChatOrchestrator,
};
