'use strict';

/**
 * src/attachments/parser.js
 * -------------------------
 * Extracts plain text from Jira attachment binaries.
 *
 * Supported formats:
 *   - PDF  via `pdf-parse`
 *   - DOCX via `mammoth`    (Word 2007+ Open Office XML only)
 *   - HTML via `cheerio`    (strips tags, keeps text)
 *   - TXT  via Buffer#toString
 *
 * Failure policy:
 *   - A parser failure does NOT throw to the orchestrator. We return
 *     `{ text: "", parseError: "<reason>" }` so the chunker can still emit a
 *     metadata-only attachment chunk (useful for "file exists but could not
 *     be read" queries).
 *   - Unsupported formats are handled the same way so missing text never
 *     becomes a silent data loss.
 *
 * Why lazy-require the heavy libs?
 *   - pdf-parse and mammoth are each several MB. Lambda cold start time
 *     benefits from only loading them when we actually have that file type.
 */

const cheerio = require('cheerio');
const { createLogger } = require('../utils/logger');

const defaultLogger = createLogger({ component: 'attachments' });

const PDF_MIME = /application\/pdf|application\/x-pdf/i;
const DOCX_MIME = /officedocument\.wordprocessingml\.document/i;
const HTML_MIME = /text\/html|application\/xhtml/i;
const TXT_MIME = /^text\/plain/i;

/**
 * @typedef {Object} AttachmentText
 * @property {string} text Extracted plain text ("" if nothing could be read).
 * @property {string|null} parseError Message when extraction failed; null on success.
 * @property {"pdf"|"docx"|"html"|"txt"|"unsupported"} detectedType
 */

/**
 * Classifies an attachment based on its file name and MIME type. We check
 * the MIME type first because file names are not always trustworthy.
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {"pdf"|"docx"|"html"|"txt"|"unsupported"}
 */
function detectType(fileName, mimeType) {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (PDF_MIME.test(mime) || name.endsWith('.pdf')) return 'pdf';
  if (DOCX_MIME.test(mime) || name.endsWith('.docx')) return 'docx';
  if (HTML_MIME.test(mime) || name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (TXT_MIME.test(mime) || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.log')) return 'txt';
  return 'unsupported';
}

/**
 * Extracts text from a PDF. Uses pdf-parse which wraps pdfjs-dist.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function parsePdf(buffer) {
  // Lazy-require inside the function so cold-starts only pay for it when a
  // PDF actually shows up in this sync run.
  // eslint-disable-next-line global-require
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return (result?.text || '').trim();
}

/**
 * Extracts text from a DOCX using mammoth's `extractRawText` function.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function parseDocx(buffer) {
  // eslint-disable-next-line global-require
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || '').trim();
}

/**
 * Extracts text from an HTML document by loading it into cheerio and
 * pulling the body text.
 * @param {Buffer} buffer
 * @returns {string}
 */
function parseHtml(buffer) {
  const html = buffer.toString('utf8');
  const $ = cheerio.load(html);
  // Remove script/style elements whose contents are not real text.
  $('script, style, noscript').remove();
  // Pull text and normalise whitespace.
  const text = $('body').length ? $('body').text() : $.root().text();
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts text from a plain-text attachment.
 * @param {Buffer} buffer
 * @returns {string}
 */
function parseTxt(buffer) {
  // Default to UTF-8 which is the overwhelmingly common encoding. If it looks
  // like the bytes are NOT UTF-8, fall back to latin1 so we at least get
  // SOME readable characters instead of replacement glyphs.
  const utf8 = buffer.toString('utf8');
  if (/\uFFFD/.test(utf8)) return buffer.toString('latin1').trim();
  return utf8.trim();
}

/**
 * Parses an attachment buffer and returns a structured result. Never throws:
 * unsupported formats and extraction errors become `parseError` strings.
 *
 * @param {Object} args
 * @param {Buffer|null} args.buffer Raw bytes. May be null when download failed.
 * @param {string} args.fileName
 * @param {string} [args.mimeType]
 * @param {ReturnType<typeof createLogger>} [args.logger]
 * @returns {Promise<AttachmentText>}
 */
async function extractAttachmentText({ buffer, fileName, mimeType, logger = defaultLogger }) {
  if (!buffer) {
    return { text: '', parseError: 'download failed', detectedType: 'unsupported' };
  }
  const type = detectType(fileName, mimeType || '');

  try {
    switch (type) {
      case 'pdf':  return { text: await parsePdf(buffer),  parseError: null, detectedType: type };
      case 'docx': return { text: await parseDocx(buffer), parseError: null, detectedType: type };
      case 'html': return { text: parseHtml(buffer),       parseError: null, detectedType: type };
      case 'txt':  return { text: parseTxt(buffer),        parseError: null, detectedType: type };
      default:
        return { text: '', parseError: 'unsupported format', detectedType: 'unsupported' };
    }
  } catch (err) {
    logger.warn('attachment parse failed', { fileName, type, error: err?.message });
    return { text: '', parseError: err?.message || 'parse error', detectedType: type };
  }
}

module.exports = {
  extractAttachmentText,
  detectType,
};
