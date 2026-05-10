/**
 * extension/src/chatViewProvider.ts
 * ---------------------------------
 * The webview view provider that hosts the chat UI in the IntentEra
 * sidebar. Acts as the bridge between the webview (HTML/CSS/JS in
 * `media/`) and the rest of the extension host:
 *
 *   webview --postMessage--> ChatViewProvider --> AgentClient + LambdaClient
 *                                              <-- ChatResponse
 *   webview <-postMessage-- ChatViewProvider
 *
 * The provider is also the point that COMMANDS use to push attachments
 * into the webview. `extension.ts` resolves the active editor's selection
 * or active file, calls `provider.addAttachment(...)`, and the provider
 * relays that to the webview as an `addAttachment` message which renders
 * a chip the user can review/remove before sending.
 */

import * as vscode from 'vscode';
import { AgentClient } from './services/agentClient';
import { LambdaClient } from './services/lambdaClient';
import { log } from './services/logger';
import type {
  ChatAttachment,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from './types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'intentera.chatView';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Posts an attachment chip into the webview, opening the panel first if
   * necessary so the user actually sees what was added.
   */
  public async addAttachment(attachment: ChatAttachment): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.intentera');
    if (this.view) this.view.show(true);
    this.postToWebview({ type: 'addAttachment', attachment });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToHostMessage) => {
      try {
        await this.handleWebviewMessage(msg);
      } catch (err) {
        vscode.window.showErrorMessage(`IntentEra: ${(err as Error).message}`);
      }
    });

    // Push initial config so the webview can warn about missing setup.
    this.sendConfigUpdate();
    // Also report the agent status once on open.
    void this.checkAgentAndReport();
  }

  private async handleWebviewMessage(msg: WebviewToHostMessage): Promise<void> {
    if (msg.type === 'requestConfig') {
      this.sendConfigUpdate();
      void this.checkAgentAndReport();
      return;
    }
    if (msg.type === 'sendChat') {
      await this.handleSendChat(msg);
      return;
    }
    // `removeAttachment` is a webview-local concern; nothing to do here yet.
  }

  /**
   * Top-level send pipeline: ask the local agent for git history, then call
   * the Lambda for the answer. We always use the first workspace folder as
   * the project root because attachments are stored project-relative.
   */
  private async handleSendChat(
    msg: Extract<WebviewToHostMessage, { type: 'sendChat' }>
  ): Promise<void> {
    const requestId = msg.requestId || `${Date.now()}`;
    const cfg = vscode.workspace.getConfiguration('intentera');
    const lambdaUrl = (cfg.get<string>('lambdaChatUrl') || '').trim();
    const apiKey = (cfg.get<string>('lambdaApiKey') || '').trim();
    const agentUrl = (cfg.get<string>('agentUrl') || 'http://127.0.0.1:8787').trim();
    const maxLocalCommits = cfg.get<number>('maxLocalCommits') || 50;
    const timeoutMs = cfg.get<number>('requestTimeoutMs') || 60000;

    const projectPath = this.firstWorkspaceFolderPath();
    if (!projectPath) {
      this.postToWebview({
        type: 'chatError',
        requestId,
        message: 'Open a folder in VS Code first so IntentEra can read its git history.',
      });
      return;
    }

    const agent = new AgentClient(agentUrl);
    const lambda = new LambdaClient(lambdaUrl, apiKey, timeoutMs);

    let commits: Awaited<ReturnType<AgentClient['getHistory']>>['commits'] = [];
    if (msg.attachments.length > 0) {
      try {
        const result = await agent.getHistory(projectPath, msg.attachments, maxLocalCommits);
        commits = result.commits;
        if (result.skipped.length) {
          // Surface skipped files to the user via VS Code, not the chat.
          vscode.window.showWarningMessage(
            `IntentEra agent skipped ${result.skipped.length} file(s): ${result.skipped
              .slice(0, 3)
              .map((s) => s.file)
              .join(', ')}`
          );
        }
      } catch (err) {
        this.postToWebview({
          type: 'chatError',
          requestId,
          message: `Local git agent unreachable at ${agentUrl}. Start it with \`npm run agent\` in the IntentEra repo. (${
            (err as Error).message
          })`,
        });
        return;
      }
    }

    try {
      const response = await lambda.chat({
        question: msg.question,
        commits,
        attachments: msg.attachments,
        history: msg.history,
      });
      log.info('host posting chatResult to webview', {
        requestId,
        hasAnswer: typeof response?.answer === 'string',
        answerLen: response?.answer?.length ?? 0,
      });
      this.postToWebview({ type: 'chatResult', requestId, response });
    } catch (err) {
      log.error('host posting chatError to webview', {
        requestId,
        message: (err as Error).message,
      });
      this.postToWebview({
        type: 'chatError',
        requestId,
        message: (err as Error).message,
      });
    }
  }

  private sendConfigUpdate(): void {
    const cfg = vscode.workspace.getConfiguration('intentera');
    const lambdaUrl = (cfg.get<string>('lambdaChatUrl') || '').trim();
    const agentUrl = (cfg.get<string>('agentUrl') || 'http://127.0.0.1:8787').trim();
    this.postToWebview({
      type: 'config',
      lambdaConfigured: lambdaUrl.length > 0,
      lambdaUrl,
      agentUrl,
    });
  }

  private async checkAgentAndReport(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('intentera');
    const agentUrl = (cfg.get<string>('agentUrl') || 'http://127.0.0.1:8787').trim();
    const ok = await new AgentClient(agentUrl).healthz();
    this.postToWebview({
      type: 'agentStatus',
      ok,
      detail: ok ? agentUrl : `not reachable at ${agentUrl}`,
    });
  }

  private firstWorkspaceFolderPath(): string | null {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;
    if (folder.uri.scheme !== 'file') return null;
    return folder.uri.fsPath;
  }

  private postToWebview(message: HostToWebviewMessage): void {
    this.view?.webview.postMessage(message);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    // Single-page HTML; the dynamic UI lives in main.js.
    return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>IntentEra Chat</title>
</head>
<body>
  <div id="status" class="status hidden"></div>
  <main id="transcript" aria-live="polite"></main>
  <section id="attachments" aria-label="Attached context"></section>
  <form id="composer">
    <textarea id="question" placeholder="Ask why this code looks the way it does..." rows="3"></textarea>
    <div class="composer-row">
      <span class="hint">Add context with right-click \u2192 "IntentEra: Ask about selection / file"</span>
      <button id="send" type="submit">Send</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let out = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
