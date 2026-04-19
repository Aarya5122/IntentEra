'use strict';

/**
 * src/chunking/chunker.js
 * -----------------------
 * Converts a NormalizedTicket into a list of retrieval-ready chunks.
 *
 * Chunking philosophy (important — read this!):
 *
 *   Retrieval quality is dominated by the shape of the chunks. Two anti-
 *   patterns are common:
 *     (a) naive fixed-character splits that chop mid-sentence and mix unrelated
 *         content, which hurts embedding similarity,
 *     (b) one giant chunk per ticket, which dilutes embeddings so the top
 *         result is never clearly about any one thing.
 *
 *   Our strategy produces several chunks per ticket, each focused on a single
 *   semantic unit, with metadata that lets retrieval filter precisely:
 *
 *     1. `metadata` chunk — ticket summary, labels, status, priority, dates.
 *        Useful when the user asks "what is PROJ-123 about?".
 *     2. `description` chunks — the body, split on blank-line paragraphs with
 *        a small token overlap to preserve context across split boundaries.
 *     3. `comments` chunks — comments are grouped into windows of up to N
 *        (default 3). Very long comments become their own chunk.
 *     4. `linkedIssues` chunks — one chunk per linked issue summary.
 *     5. `attachment` chunks — one or more per attachment, separate pipeline.
 *     6. `confluence` chunks — separate pipeline, section-aware when possible.
 *
 *   Every chunk has a deterministic ID:
 *         sha256(ticketKey | sourceType | subIndex | contentFingerprint)
 *   So re-running chunking on identical input produces identical IDs,
 *   enabling safe delete-before-upsert behaviour.
 *
 * Token counting:
 *   - We use a cheap approximation: 1 token ≈ 4 characters. This is accurate
 *     enough for budget enforcement without pulling in `tiktoken` (which is
 *     heavy and has native bindings). Chunking hygiene, not precision, is
 *     what matters here.
 */

const crypto = require('crypto');

const TOKENS_PER_CHAR = 1 / 4;

/**
 * @typedef {"metadata"|"description"|"comments"|"linkedIssues"|"attachment"|"confluence"} SourceType
 *
 * @typedef {Object} Chunk
 * @property {string} chunkId Deterministic hash, also used as Mongo _id.
 * @property {string} ticketKey
 * @property {string} projectKey
 * @property {SourceType} sourceType
 * @property {number} chunkIndex
 * @property {string} text The content to embed.
 * @property {Record<string, any>} metadata Extra fields for retrieval filters.
 */

/**
 * Approximates the token count of a string.
 * @param {string} s
 * @returns {number}
 */
function approxTokens(s) {
  return Math.ceil((s || '').length * TOKENS_PER_CHAR);
}

/**
 * Slices a string so it never exceeds `maxTokens` tokens. Strict budget cap.
 * @param {string} s
 * @param {number} maxTokens
 * @returns {string}
 */
function clampTokens(s, maxTokens) {
  const maxChars = Math.max(0, Math.floor(maxTokens / TOKENS_PER_CHAR));
  return s.length <= maxChars ? s : s.slice(0, maxChars);
}

/**
 * Splits text into paragraph-level units, using blank lines as boundaries.
 * Keeps original line breaks within a paragraph for readability.
 * @param {string} text
 * @returns {string[]}
 */
function splitParagraphs(text) {
  if (!text) return [];
  return text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Groups paragraphs into chunks <= maxTokens. Adds a small text overlap
 * (overlapTokens characters) between consecutive chunks so concepts that span
 * a paragraph boundary are still discoverable.
 *
 * @param {string[]} paragraphs
 * @param {number} maxTokens
 * @param {number} overlapTokens
 * @returns {string[]}
 */
function groupParagraphsIntoChunks(paragraphs, maxTokens, overlapTokens) {
  /** @type {string[]} */
  const chunks = [];
  /** @type {string[]} */
  let buffer = [];
  let bufferTokens = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push(buffer.join('\n\n'));
    if (overlapTokens > 0) {
      // Keep the tail of the last chunk as a seed for the next one to
      // preserve continuity. We take tokens from the END of the buffer.
      const tail = buffer.join('\n\n');
      const overlap = tail.slice(-Math.floor(overlapTokens / TOKENS_PER_CHAR));
      buffer = overlap ? [overlap] : [];
      bufferTokens = approxTokens(overlap);
    } else {
      buffer = [];
      bufferTokens = 0;
    }
  };

  for (const para of paragraphs) {
    const paraTokens = approxTokens(para);

    // An outsized paragraph is hard-split on the character budget so we never
    // produce a single chunk larger than the cap.
    if (paraTokens > maxTokens) {
      flush();
      let remaining = para;
      while (remaining.length > 0) {
        const slice = clampTokens(remaining, maxTokens);
        chunks.push(slice);
        remaining = remaining.slice(slice.length);
      }
      continue;
    }

    // If adding this paragraph would overflow, flush first.
    if (bufferTokens + paraTokens > maxTokens && buffer.length > 0) {
      flush();
    }
    buffer.push(para);
    bufferTokens += paraTokens;
  }
  flush();
  return chunks;
}

/**
 * Generates a deterministic chunk ID. sha256 is overkill but very collision-
 * resistant and Node has it built in.
 *
 * The fingerprint includes the actual chunk text so edits (same source + same
 * sub-index but different content) produce NEW chunk IDs, which keeps the
 * delete-before-upsert workflow idempotent across content edits.
 *
 * @param {Object} args
 * @param {string} args.ticketKey
 * @param {string} args.sourceType
 * @param {number|string} args.subIndex
 * @param {string} args.content
 * @returns {string}
 */
function deterministicChunkId({ ticketKey, sourceType, subIndex, content }) {
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${ticketKey}|${sourceType}|${subIndex}|${content}`)
    .digest('hex');
  return fingerprint.slice(0, 32);
}

/**
 * Builds a single chunk object.
 * @param {Object} args
 * @param {string} args.ticketKey
 * @param {string} args.projectKey
 * @param {SourceType} args.sourceType
 * @param {number} args.chunkIndex
 * @param {string} args.text
 * @param {Record<string, any>} [args.metadata]
 * @returns {Chunk}
 */
function makeChunk({ ticketKey, projectKey, sourceType, chunkIndex, text, metadata = {} }) {
  const chunkId = deterministicChunkId({
    ticketKey,
    sourceType,
    subIndex: chunkIndex,
    content: text,
  });
  return {
    chunkId,
    ticketKey,
    projectKey,
    sourceType,
    chunkIndex,
    text,
    metadata,
  };
}

/**
 * Turns a NormalizedTicket into the final list of chunks.
 *
 * @param {Object} args
 * @param {import('../normalization/normalizer').NormalizedTicket} args.ticket
 * @param {import('../../config/appConfig').ChunkingConfig} args.cfg
 * @returns {Chunk[]}
 */
function chunkTicket({ ticket, cfg }) {
  /** @type {Chunk[]} */
  const out = [];
  const common = {
    ticketKey: ticket.key,
    projectKey: ticket.projectKey,
  };
  const baseMeta = {
    summary: ticket.summary,
    status: ticket.status,
    priority: ticket.priority,
    issueType: ticket.issueType,
    labels: ticket.labels,
    updatedAt: ticket.updatedAt,
  };

  // -------------------------------------------------------------------------
  // 1. Metadata chunk: a compact, human-readable summary of the ticket.
  // -------------------------------------------------------------------------
  const metaText =
    `Ticket ${ticket.key} (${ticket.issueType || 'Issue'})\n` +
    `Summary: ${ticket.summary}\n` +
    `Status: ${ticket.status}   Priority: ${ticket.priority}\n` +
    `Assignee: ${ticket.assignee || 'unassigned'}   Reporter: ${ticket.reporter || 'unknown'}\n` +
    `Labels: ${ticket.labels.join(', ') || 'none'}\n` +
    `Created: ${ticket.createdAt}   Updated: ${ticket.updatedAt}`;

  out.push(makeChunk({
    ...common,
    sourceType: 'metadata',
    chunkIndex: 0,
    text: metaText.trim(),
    metadata: { ...baseMeta },
  }));

  // -------------------------------------------------------------------------
  // 2. Description chunks: paragraph-aware grouping with overlap.
  // -------------------------------------------------------------------------
  if (ticket.description) {
    const paragraphs = splitParagraphs(ticket.description);
    const descChunks = groupParagraphsIntoChunks(
      paragraphs,
      cfg.descriptionMaxTokens,
      cfg.descriptionOverlapTokens
    );
    descChunks.forEach((text, idx) => {
      out.push(makeChunk({
        ...common,
        sourceType: 'description',
        chunkIndex: idx,
        text,
        metadata: { ...baseMeta },
      }));
    });
  }

  // -------------------------------------------------------------------------
  // 3. Comment chunks: window of N short comments, long comments solo.
  // -------------------------------------------------------------------------
  const commentChunks = chunkComments(ticket, cfg);
  for (const c of commentChunks) out.push(c);

  // -------------------------------------------------------------------------
  // 4. Linked issues: one chunk each.
  // -------------------------------------------------------------------------
  ticket.linkedIssues.forEach((link, idx) => {
    const text =
      `Linked issue ${link.key} (${link.relationship}): ${link.summary || '(no summary)'}\n` +
      `Status: ${link.status || 'unknown'}`;
    out.push(makeChunk({
      ...common,
      sourceType: 'linkedIssues',
      chunkIndex: idx,
      text,
      metadata: {
        ...baseMeta,
        linkedIssueKey: link.key,
        relationship: link.relationship,
      },
    }));
  });

  // -------------------------------------------------------------------------
  // 5. Attachment chunks: one or more per attachment.
  // -------------------------------------------------------------------------
  ticket.attachments.forEach((att, attIdx) => {
    // Even when extraction failed, emit ONE placeholder chunk so the retrieval
    // layer can still surface "file exists but unreadable".
    if (!att.text) {
      const text =
        `Attachment "${att.fileName}" (${att.fileType || 'unknown'}) — ` +
        `text extraction not available${att.parseError ? ` (${att.parseError})` : ''}.`;
      out.push(makeChunk({
        ...common,
        sourceType: 'attachment',
        chunkIndex: attIdx * 1000, // reserve space for sub-chunks below
        text,
        metadata: {
          ...baseMeta,
          fileName: att.fileName,
          fileType: att.fileType,
          attachmentId: att.id,
          parseError: att.parseError || null,
        },
      }));
      return;
    }
    const paragraphs = splitParagraphs(att.text);
    const attChunks = groupParagraphsIntoChunks(
      paragraphs,
      cfg.attachmentMaxTokens,
      0 // no overlap across attachment chunks — they are typically self-contained
    );
    attChunks.forEach((text, subIdx) => {
      out.push(makeChunk({
        ...common,
        sourceType: 'attachment',
        chunkIndex: attIdx * 1000 + subIdx,
        text,
        metadata: {
          ...baseMeta,
          fileName: att.fileName,
          fileType: att.fileType,
          attachmentId: att.id,
          parseError: null,
        },
      }));
    });
  });

  // -------------------------------------------------------------------------
  // 6. Confluence chunks: one pipeline per linked page.
  // -------------------------------------------------------------------------
  ticket.confluencePages.forEach((page, pageIdx) => {
    if (!page.text) return;
    const paragraphs = splitParagraphs(page.text);
    const pageChunks = groupParagraphsIntoChunks(
      paragraphs,
      cfg.confluenceMaxTokens,
      0
    );
    pageChunks.forEach((text, subIdx) => {
      out.push(makeChunk({
        ...common,
        sourceType: 'confluence',
        chunkIndex: pageIdx * 1000 + subIdx,
        text: `Confluence page "${page.title}":\n${text}`,
        metadata: {
          ...baseMeta,
          pageId: page.pageId,
          pageTitle: page.title,
          pageUrl: page.url,
        },
      }));
    });
  });

  return out;
}

/**
 * Groups comments into windows of up to cfg.commentGroupSize. A comment whose
 * own token count exceeds the window budget is emitted as its own chunk.
 *
 * @param {import('../normalization/normalizer').NormalizedTicket} ticket
 * @param {import('../../config/appConfig').ChunkingConfig} cfg
 * @returns {Chunk[]}
 */
function chunkComments(ticket, cfg) {
  /** @type {Chunk[]} */
  const out = [];
  const common = {
    ticketKey: ticket.key,
    projectKey: ticket.projectKey,
  };
  const baseMeta = {
    summary: ticket.summary,
    status: ticket.status,
    priority: ticket.priority,
    labels: ticket.labels,
    updatedAt: ticket.updatedAt,
  };

  if (!ticket.comments.length) return out;

  const maxTokens = cfg.descriptionMaxTokens; // reuse desc budget for comments
  const windowSize = cfg.commentGroupSize;

  /** @type {typeof ticket.comments} */
  let group = [];
  let groupTokens = 0;
  let chunkIdx = 0;

  const flushGroup = () => {
    if (!group.length) return;
    const text = group
      .map(
        (c) =>
          `[${c.author} on ${c.createdAt}${c.updatedAt !== c.createdAt ? ` (edited ${c.updatedAt})` : ''}]\n${c.text}`
      )
      .join('\n\n---\n\n');
    out.push(makeChunk({
      ...common,
      sourceType: 'comments',
      chunkIndex: chunkIdx++,
      text,
      metadata: {
        ...baseMeta,
        commentIds: group.map((c) => c.id),
        commentAuthors: group.map((c) => c.author),
      },
    }));
    group = [];
    groupTokens = 0;
  };

  for (const comment of ticket.comments) {
    const cTokens = approxTokens(comment.text);
    if (cTokens >= maxTokens) {
      // Long comment — flush any buffered group and emit solo.
      flushGroup();
      out.push(makeChunk({
        ...common,
        sourceType: 'comments',
        chunkIndex: chunkIdx++,
        text: `[${comment.author} on ${comment.createdAt}]\n${clampTokens(comment.text, maxTokens)}`,
        metadata: {
          ...baseMeta,
          commentIds: [comment.id],
          commentAuthors: [comment.author],
        },
      }));
      continue;
    }
    if (group.length >= windowSize || groupTokens + cTokens > maxTokens) {
      flushGroup();
    }
    group.push(comment);
    groupTokens += cTokens;
  }
  flushGroup();
  return out;
}

module.exports = {
  chunkTicket,
  deterministicChunkId,
  splitParagraphs,
  groupParagraphsIntoChunks,
  approxTokens,
};
