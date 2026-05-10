'use strict';

/**
 * src/answer/llmAnswerer.js
 * -------------------------
 * Composes the final non-technical "WHY does this code look like this?"
 * answer + grounded citations from:
 *
 *   - The user's question (and recent conversation history).
 *   - The code attachments they sent (file path / range / content).
 *   - The local commit history extracted from their git tree.
 *   - The merged RAG hits from MongoDB Atlas (Jira tickets + GitHub PRs).
 *
 * Design choices
 * --------------
 *   - JSON-mode output. We ask OpenAI for a strict JSON object with two
 *     fields (`answer`, `citations`). This makes parsing trivial and lets us
 *     validate every cited SHA / ticket key / PR number against the context
 *     we actually supplied — the LLM can't invent a "PROJ-9999" we never
 *     mentioned because we drop unknown citations during validation.
 *   - "Plain English" framing. The system prompt explicitly tells the model
 *     to assume the reader is a product manager or new engineer; no jargon,
 *     no implementation detail, focus on the WHY.
 *   - Per-citation `reasonPlain`. Every cited commit gets a one-sentence
 *     plain-English reason next to it. This is what shows up under
 *     "Commits that shaped this" in the UI.
 *
 * The answerer is intentionally stateless. The orchestrator builds the
 * context object and the answerer just calls OpenAI, validates, returns.
 */

const { OpenAI } = require('openai');
const { withRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

const SYSTEM_PROMPT = `You are IntentEra Chat, an assistant that helps engineers
understand WHY a piece of code looks the way it does, by combining LOCAL git
history with the team's Jira tickets and GitHub pull requests / issues.

Your audience is a developer or PM who is NEW to the codebase. They want a
clear, plain-English explanation of intent. Avoid jargon, avoid line-by-line
walkthroughs, and avoid implementation detail unless it directly explains a
decision. Lead with WHY, follow with WHAT changed.

You will be given:
  - The user's question.
  - Optional code attachments (a file or a selected range).
  - LOCAL_COMMITS:   a list of git commits that touched the attachment(s).
  - RAG_HITS:        Jira tickets and GitHub PRs/issues retrieved from a
                     vector store using the question + commit subjects.

You MUST respond with a single JSON object that matches this exact schema:

{
  "answer": "<plain-English paragraph answering the user's question>",
  "citations": {
    "commits": [
      { "sha": "<full sha from LOCAL_COMMITS>",
        "reasonPlain": "<one-sentence plain-English reason this commit
                        matters for the question>" }
    ],
    "tickets": [
      { "key": "<Jira key like PROJ-123 from RAG_HITS>",
        "reasonPlain": "<one-sentence plain-English summary>" }
    ],
    "prs": [
      { "repo": "<owner/name from RAG_HITS>",
        "number": <pr number from RAG_HITS>,
        "reasonPlain": "<one-sentence plain-English summary>" }
    ]
  }
}

Strict rules:
  1. Cite ONLY commits whose sha appears in LOCAL_COMMITS.
  2. Cite ONLY tickets whose key appears in RAG_HITS.
  3. Cite ONLY PRs whose (repo, number) appears in RAG_HITS.
  4. If you cannot ground a claim in the supplied context, say so in the
     answer field rather than inventing details.
  5. Order citations by relevance (most relevant first). Limit to at most
     6 commits, 5 tickets, 5 PRs.
  6. Keep "reasonPlain" under 25 words; non-technical when possible.
  7. The "answer" field MUST be at least 2 sentences and at most 6.`;

class LlmAnswerer {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.model      e.g. "gpt-4o-mini"
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   * @param {OpenAI} [opts.client]   Override (used in tests).
   */
  constructor({ apiKey, model, logger, client }) {
    if (!apiKey && !client) throw new Error('LlmAnswerer: apiKey or client is required');
    if (!model) throw new Error('LlmAnswerer: model is required');
    this.model = model;
    this.client = client || new OpenAI({ apiKey });
    this.logger = (logger || createLogger()).child({ component: 'llmAnswerer' });
  }

  /**
   * Composes an answer.
   *
   * @param {Object} args
   * @param {string} args.question
   * @param {Array<{file: string, range?: [number, number], content?: string}>} [args.attachments]
   * @param {Array<import('../localGit/client').NormalizedCommit>} [args.commits]
   * @param {Array<any>} [args.hits] Output of MultiQueryRetriever.retrieve().hits
   * @param {Array<{role: 'user'|'assistant', content: string}>} [args.history]
   * @returns {Promise<{
   *   answer: string,
   *   citations: { commits: any[], tickets: any[], prs: any[] },
   *   usage: { promptTokens: number, completionTokens: number },
   * }>}
   */
  async answer({ question, attachments = [], commits = [], hits = [], history = [] }) {
    const userPrompt = buildUserPrompt({ question, attachments, commits, hits, history });
    this.logger.debug('llm answer call', {
      model: this.model,
      commits: commits.length,
      hits: hits.length,
      attachments: attachments.length,
    });

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
      { label: 'openai-chat', logger: this.logger }
    );

    const raw = response.choices?.[0]?.message?.content || '{}';
    /** @type {any} */
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn('llm returned non-JSON; returning a degraded answer', {
        preview: raw.slice(0, 200),
      });
      return {
        answer:
          'I had trouble formatting an answer this time. The retrieved context is included below — try asking a more specific question.',
        citations: { commits: [], tickets: [], prs: [] },
        usage: usageFromResponse(response),
      };
    }

    const validated = validateCitations(parsed, { commits, hits });
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
      citations: validated,
      usage: usageFromResponse(response),
    };
  }
}

/**
 * Composes the user-side prompt by stitching together the question, recent
 * conversation history, attachments, local commits, and RAG hits.
 *
 * Each section is delimited by a clear `### HEADER` so the model can refer
 * to them by name in its reasoning.
 *
 * @param {Object} args
 * @returns {string}
 */
function buildUserPrompt({ question, attachments, commits, hits, history }) {
  const parts = [];

  if (Array.isArray(history) && history.length > 0) {
    parts.push('### CONVERSATION HISTORY');
    for (const turn of history.slice(-6)) {
      const role = turn.role === 'assistant' ? 'assistant' : 'user';
      parts.push(`${role}: ${truncate(turn.content || '', 600)}`);
    }
  }

  parts.push('### USER QUESTION');
  parts.push(question.trim());

  if (attachments.length > 0) {
    parts.push('### CODE ATTACHMENTS');
    attachments.forEach((a, i) => {
      const range = Array.isArray(a.range) ? `[${a.range[0]}-${a.range[1]}]` : 'whole file';
      parts.push(`#${i + 1} ${a.file} ${range}`);
      if (a.content) parts.push(fence(truncate(a.content, 4000)));
    });
  }

  if (commits.length > 0) {
    parts.push('### LOCAL_COMMITS (newest first)');
    commits.forEach((c, i) => {
      parts.push(
        `[#${i + 1}] sha=${c.sha} (${c.shortSha}) date=${c.date} author=${c.author?.name || ''}`
      );
      if (c.subject) parts.push(`subject: ${c.subject}`);
      if (c.body) parts.push(`body: ${truncate(c.body, 600)}`);
      if (c.jiraKeys?.length) parts.push(`jira: ${c.jiraKeys.join(', ')}`);
      if (c.filesChanged?.length) parts.push(`files: ${c.filesChanged.slice(0, 8).join(', ')}`);
      parts.push('');
    });
  }

  if (hits.length > 0) {
    parts.push('### RAG_HITS (vector-search retrieved chunks)');
    hits.forEach((h, i) => {
      const head = h.source === 'jira'
        ? `jira:${h.ticketKey || h.entityKey || '?'}`
        : `github:${h.entityType || 'entity'}:${h.entityKey || '?'}` +
            (h.repoFullName ? ` repo=${h.repoFullName}` : '');
      parts.push(
        `[#${i + 1}] ${head} sourceType=${h.sourceType || ''} score=${(h.score ?? 0).toFixed(3)}`
      );
      if (h.text) parts.push(truncate(h.text, 800));
      parts.push('');
    });
  }

  parts.push(
    '### TASK\nUsing the context above, answer the user question and cite ' +
      'commits / tickets / PRs ONLY from the supplied context. Respond with ' +
      'a single JSON object as specified in the system prompt.'
  );

  return parts.join('\n');
}

/**
 * Drops citations that don't reference something in the supplied context.
 * Also normalises shapes so the handler can return them verbatim.
 *
 * @param {any} parsed
 * @param {{commits: any[], hits: any[]}} ctx
 * @returns {{commits: any[], tickets: any[], prs: any[]}}
 */
function validateCitations(parsed, ctx) {
  const validCommitShas = new Set(ctx.commits.map((c) => c.sha));
  const commitsBySha = new Map(ctx.commits.map((c) => [c.sha, c]));
  const validTicketKeys = new Set(
    ctx.hits.filter((h) => h.source === 'jira').map((h) => h.ticketKey || h.entityKey).filter(Boolean)
  );
  const validPrPairs = new Set(
    ctx.hits
      .filter((h) => h.source === 'github' && h.entityType === 'pullRequest')
      .map((h) => `${h.repoFullName}#${h.metadata?.prNumber ?? extractPrNumber(h.entityKey)}`)
  );
  const prByPair = new Map(
    ctx.hits
      .filter((h) => h.source === 'github' && h.entityType === 'pullRequest')
      .map((h) => [
        `${h.repoFullName}#${h.metadata?.prNumber ?? extractPrNumber(h.entityKey)}`,
        h,
      ])
  );

  const cit = parsed.citations || {};
  const commits = Array.isArray(cit.commits) ? cit.commits : [];
  const tickets = Array.isArray(cit.tickets) ? cit.tickets : [];
  const prs = Array.isArray(cit.prs) ? cit.prs : [];

  const validatedCommits = commits
    .filter((c) => c && validCommitShas.has(c.sha))
    .slice(0, 6)
    .map((c) => {
      const src = commitsBySha.get(c.sha);
      return {
        sha: src.sha,
        shortSha: src.shortSha,
        date: src.date,
        author: src.author,
        subject: src.subject,
        jiraKeys: src.jiraKeys || [],
        filesChanged: src.filesChanged || [],
        reasonPlain: typeof c.reasonPlain === 'string' ? c.reasonPlain : '',
      };
    });

  const ticketHitsByKey = new Map(
    ctx.hits
      .filter((h) => h.source === 'jira')
      .map((h) => [h.ticketKey || h.entityKey, h])
  );
  const validatedTickets = tickets
    .filter((t) => t && validTicketKeys.has(t.key))
    .slice(0, 5)
    .map((t) => {
      const src = ticketHitsByKey.get(t.key);
      return {
        key: t.key,
        summary: src?.metadata?.summary || src?.metadata?.title || '',
        status: src?.metadata?.status || '',
        url: src?.metadata?.url || '',
        snippet: truncate(src?.text || '', 240),
        score: src?.score ?? null,
        reasonPlain: typeof t.reasonPlain === 'string' ? t.reasonPlain : '',
      };
    });

  const validatedPrs = prs
    .filter((p) => p && p.repo && Number.isFinite(Number(p.number)) && validPrPairs.has(`${p.repo}#${Number(p.number)}`))
    .slice(0, 5)
    .map((p) => {
      const src = prByPair.get(`${p.repo}#${Number(p.number)}`);
      return {
        repo: p.repo,
        number: Number(p.number),
        title: src?.metadata?.title || '',
        url: src?.metadata?.url || '',
        snippet: truncate(src?.text || '', 240),
        score: src?.score ?? null,
        reasonPlain: typeof p.reasonPlain === 'string' ? p.reasonPlain : '',
      };
    });

  return { commits: validatedCommits, tickets: validatedTickets, prs: validatedPrs };
}

/**
 * Pulls a PR number from a GitHub entityKey like "pr:42" or "pullRequest:42".
 * @param {string|undefined} entityKey
 * @returns {number|null}
 */
function extractPrNumber(entityKey) {
  if (!entityKey) return null;
  const m = String(entityKey).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * Fenced code block — keeps the LLM from confusing inline content with
 * prompt instructions.
 * @param {string} text
 * @returns {string}
 */
function fence(text) {
  return '```\n' + text + '\n```';
}

/**
 * Truncates a string to `max` characters with an ellipsis if needed.
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Pulls token usage off the OpenAI response in our normalised shape.
 * @param {any} response
 */
function usageFromResponse(response) {
  return {
    promptTokens: response?.usage?.prompt_tokens || 0,
    completionTokens: response?.usage?.completion_tokens || 0,
  };
}

module.exports = {
  LlmAnswerer,
  SYSTEM_PROMPT,
  validateCitations,
  buildUserPrompt,
};
