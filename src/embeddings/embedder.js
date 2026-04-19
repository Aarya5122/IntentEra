'use strict';

/**
 * src/embeddings/embedder.js
 * --------------------------
 * Thin wrapper around the OpenAI embeddings API.
 *
 * Why OpenAI?
 *   - `text-embedding-3-small` is cheap (~$0.02 / 1M tokens), high quality,
 *     and returns 1536-dimensional vectors that pair perfectly with
 *     MongoDB Atlas Vector Search.
 *   - The SDK is stable and widely used.
 *   - Swapping providers later requires changing only this file and the
 *     vector-index dimensionality.
 *
 * Batching:
 *   - OpenAI accepts many strings per request. We respect
 *     `cfg.openai.batchSize` (default 64) which balances throughput and the
 *     per-request payload size ceiling.
 *
 * Token safety:
 *   - We truncate any single input to ~8000 chars (≈ 2000 tokens) before
 *     sending. OpenAI's embedding model accepts up to 8192 input tokens;
 *     truncating here is a defensive guard against very long pathological
 *     chunks.
 */

const { OpenAI } = require('openai');
const { withRetry } = require('../utils/retry');
const { createLogger } = require('../utils/logger');

const MAX_INPUT_CHARS = 8000;

class Embedder {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.model
   * @param {number} opts.dimensions
   * @param {number} [opts.batchSize=64]
   * @param {ReturnType<typeof createLogger>} [opts.logger]
   */
  constructor({ apiKey, model, dimensions, batchSize = 64, logger }) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
    this.batchSize = batchSize;
    this.logger = (logger || createLogger()).child({ component: 'embedder' });
  }

  /**
   * Embeds a single query string. Used by the retrieval path where batching
   * is pointless.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    const [vec] = await this.embedMany([text]);
    return vec;
  }

  /**
   * Embeds a list of strings, batching under the hood. Returns vectors in
   * the SAME order as the inputs.
   *
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async embedMany(texts) {
    if (!Array.isArray(texts) || texts.length === 0) return [];

    /** @type {number[][]} */
    const out = new Array(texts.length);
    // Slice into batches of this.batchSize so we never exceed OpenAI's
    // per-request input cap.
    for (let start = 0; start < texts.length; start += this.batchSize) {
      const slice = texts.slice(start, start + this.batchSize);
      const sanitized = slice.map((t) => (t || '').slice(0, MAX_INPUT_CHARS));
      const response = await withRetry(
        () =>
          this.client.embeddings.create({
            model: this.model,
            input: sanitized,
            // We explicitly pass dimensions so the returned vectors match the
            // Atlas vector-index definition.
            dimensions: this.dimensions,
          }),
        { label: 'openai-embed', logger: this.logger }
      );
      // The API guarantees `data` is in input order.
      response.data.forEach((item, i) => {
        out[start + i] = item.embedding;
      });
      this.logger.debug('embedding batch complete', {
        batchSize: slice.length,
        tokensUsed: response.usage?.total_tokens,
      });
    }
    return out;
  }
}

module.exports = {
  Embedder,
};
