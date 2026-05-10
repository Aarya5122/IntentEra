/**
 * extension/src/services/lambdaClient.ts
 * --------------------------------------
 * Tiny `fetch`-based client for the IntentEra `/chat` Lambda. The host
 * forwards the user's question + the local commits (already pulled from the
 * agent) + the attachments and gets back the LLM-composed answer with
 * grounded citations.
 *
 * The URL and optional `x-api-key` are read from VS Code settings so users
 * can point the extension at their own deployment (dev / staging / prod).
 */

import type { ChatAttachment, ChatResponse, ChatTurn, NormalizedCommit } from '../types';
import { log } from './logger';

export interface LambdaChatRequest {
  question: string;
  commits: NormalizedCommit[];
  attachments: ChatAttachment[];
  history: ChatTurn[];
}

export class LambdaClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {}

  /**
   * Sends a chat request. Throws on non-2xx, on network failure, and on
   * timeout (bounded by `timeoutMs`).
   */
  async chat(req: LambdaChatRequest): Promise<ChatResponse> {
    if (!this.url) {
      throw new Error(
        'IntentEra: `intentera.lambdaChatUrl` is not configured. Open settings and paste your /chat endpoint URL.'
      );
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['x-api-key'] = this.apiKey;

      log.info('lambda /chat request', {
        url: this.url,
        timeoutMs: this.timeoutMs,
        questionPreview: req.question.slice(0, 120),
        commits: req.commits.length,
        attachments: req.attachments.length,
        history: req.history.length,
      });

      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });

      const rawText = await res.text();
      log.info('lambda /chat response', {
        status: res.status,
        ok: res.ok,
        bytes: rawText.length,
        preview: rawText.slice(0, 600),
      });

      if (!res.ok) {
        throw new Error(`Lambda /chat failed: HTTP ${res.status} ${rawText.slice(0, 240)}`);
      }

      let parsed: ChatResponse;
      try {
        parsed = JSON.parse(rawText) as ChatResponse;
      } catch (err) {
        log.error('lambda /chat returned non-JSON body', { error: (err as Error).message, preview: rawText.slice(0, 300) });
        throw new Error(`Lambda /chat returned non-JSON body: ${(err as Error).message}`);
      }
      log.info('lambda /chat parsed', {
        hasAnswer: typeof parsed?.answer === 'string',
        answerPreview: typeof parsed?.answer === 'string' ? parsed.answer.slice(0, 200) : null,
        citations: {
          commits: parsed?.citations?.commits?.length ?? 0,
          tickets: parsed?.citations?.tickets?.length ?? 0,
          prs: parsed?.citations?.prs?.length ?? 0,
        },
        retrieved: parsed?.retrieved ?? null,
      });
      return parsed;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError') {
        throw new Error(`Lambda /chat timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

