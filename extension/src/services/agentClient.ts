/**
 * extension/src/services/agentClient.ts
 * -------------------------------------
 * Tiny `fetch`-based client for the local git agent (`src/agent/server.js`
 * in the IntentEra repo). The agent runs on the user's machine on
 * `http://127.0.0.1:8787` by default and is the only way the extension can
 * read the user's local commit history (the Lambda has no filesystem
 * access).
 *
 * We use `globalThis.fetch` (Node 18+, which the VS Code extension host
 * always provides) so we don't bundle an HTTP client.
 */

import type {
  AgentHistoryResponse,
  ChatAttachment,
  NormalizedCommit,
} from '../types';

export class AgentClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Liveness check. Returns true if the agent responded with 200 + the
   * expected service marker. Never throws; returns false on any error so
   * callers can offer a "start the agent" hint.
   */
  async healthz(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`);
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean; service?: string };
      return body.ok === true && body.service === 'intentera-local-git-agent';
    } catch {
      return false;
    }
  }

  /**
   * Asks the agent for the commit history that touched the given attachments
   * inside `projectPath`.
   */
  async getHistory(
    projectPath: string,
    attachments: ChatAttachment[],
    maxCommits?: number
  ): Promise<{ commits: NormalizedCommit[]; skipped: { file: string; reason: string }[] }> {
    const res = await fetch(`${this.baseUrl}/git/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPath,
        attachments: attachments.map(({ file, range }) => ({ file, range })),
        maxCommits,
      }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(`local agent /git/history failed: HTTP ${res.status} ${detail}`);
    }
    const body = (await res.json()) as AgentHistoryResponse;
    return { commits: body.commits || [], skipped: body.skipped || [] };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 240);
  } catch {
    return '';
  }
}
