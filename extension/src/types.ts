/**
 * extension/src/types.ts
 * ----------------------
 * Shared TypeScript types used by the extension host AND the webview.
 *
 * The webview is plain JS today (no bundler), so it imports nothing from
 * here at runtime; these types exist purely for the host code. We keep the
 * wire shapes co-located so the contract between host and webview is a
 * single source of truth.
 */

/** A code attachment the user is asking about. */
export interface ChatAttachment {
  /** Project-relative POSIX path (always forward-slash). */
  file: string;
  /** Optional inclusive 1-based line range. Omit for the whole file. */
  range?: [number, number];
  /** Verbatim file or selection text (so the LLM can read the code). */
  content?: string;
}

/** A normalised commit returned by the local git agent. */
export interface NormalizedCommit {
  sha: string;
  shortSha: string;
  author: { name: string; email: string };
  date: string;
  subject: string;
  body: string;
  filesChanged: string[];
  parentShas: string[];
  jiraKeys: string[];
}

/** A single conversation turn kept locally in the webview. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Response from the local git agent's `/git/history` endpoint. */
export interface AgentHistoryResponse {
  projectPath: string;
  commits: NormalizedCommit[];
  skipped: { file: string; reason: string }[];
}

/** Response from the Lambda `/chat` endpoint. */
export interface ChatResponse {
  answer: string;
  citations: {
    commits: Array<{
      sha: string;
      shortSha: string;
      date: string;
      author: { name: string; email: string };
      subject: string;
      jiraKeys: string[];
      filesChanged: string[];
      reasonPlain: string;
    }>;
    tickets: Array<{
      key: string;
      summary: string;
      status: string;
      url: string;
      snippet: string;
      score: number | null;
      reasonPlain: string;
    }>;
    prs: Array<{
      repo: string;
      number: number;
      title: string;
      url: string;
      snippet: string;
      score: number | null;
      reasonPlain: string;
    }>;
  };
  retrieved: {
    jiraCount: number;
    githubCount: number;
    localCommitCount: number;
    mergedCount: number;
  };
  usage: {
    embeddingTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
}

/** Messages sent FROM the webview TO the extension host. */
export type WebviewToHostMessage =
  | {
      type: 'sendChat';
      requestId: string;
      question: string;
      attachments: ChatAttachment[];
      history: ChatTurn[];
    }
  | { type: 'removeAttachment'; index: number }
  | { type: 'requestConfig' };

/** Messages sent FROM the extension host TO the webview. */
export type HostToWebviewMessage =
  | {
      type: 'addAttachment';
      attachment: ChatAttachment;
    }
  | {
      type: 'config';
      lambdaConfigured: boolean;
      agentUrl: string;
      lambdaUrl: string;
    }
  | {
      type: 'chatResult';
      requestId: string;
      response: ChatResponse;
    }
  | {
      type: 'chatError';
      requestId: string;
      message: string;
    }
  | {
      type: 'agentStatus';
      ok: boolean;
      detail?: string;
    };
