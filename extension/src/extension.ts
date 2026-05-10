/**
 * extension/src/extension.ts
 * --------------------------
 * Entry point for the IntentEra Chat extension. Three responsibilities:
 *
 *   1. Register the chat view provider so VS Code / Cursor can render the
 *      sidebar webview at `intentera.chatView`.
 *   2. Register the user-visible commands:
 *        - `intentera.openChat`             → focus the chat panel.
 *        - `intentera.askAboutSelection`    → push the active editor's
 *          selection (path + range + text) into the chat as an attachment.
 *        - `intentera.askAboutFile`         → push the active editor file
 *          (or right-clicked explorer file) as a whole-file attachment.
 *   3. Convert URIs into project-relative POSIX paths because the local git
 *      agent only understands paths relative to the workspace root.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ChatViewProvider } from './chatViewProvider';
import type { ChatAttachment } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('intentera.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.intentera');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('intentera.askAboutSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage('IntentEra: select some code first.');
        return;
      }
      const attachment = buildSelectionAttachment(editor);
      if (!attachment) return;
      await provider.addAttachment(attachment);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('intentera.askAboutFile', async (resource?: vscode.Uri) => {
      const target = resource || vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showInformationMessage('IntentEra: open or right-click a file first.');
        return;
      }
      const attachment = await buildFileAttachment(target);
      if (!attachment) return;
      await provider.addAttachment(attachment);
    })
  );
}

export function deactivate(): void {
  // No explicit teardown required: subscriptions are released by VS Code.
}

/**
 * Builds a `{file, range, content}` attachment from the active editor's
 * current selection. Lines are 1-based inclusive to match git's `-L` syntax.
 */
function buildSelectionAttachment(editor: vscode.TextEditor): ChatAttachment | null {
  const file = projectRelativePath(editor.document.uri);
  if (!file) {
    vscode.window.showWarningMessage(
      'IntentEra: selection must come from a file inside the open workspace folder.'
    );
    return null;
  }
  const sel = editor.selection;
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;
  const range = new vscode.Range(
    new vscode.Position(sel.start.line, 0),
    new vscode.Position(sel.end.line, editor.document.lineAt(sel.end.line).range.end.character)
  );
  const content = editor.document.getText(range);
  return { file, range: [startLine, endLine], content };
}

/**
 * Builds a whole-file attachment. Reads the file's text via
 * `workspace.openTextDocument` so we don't need fs and we get whatever
 * encoding VS Code already negotiated.
 */
async function buildFileAttachment(uri: vscode.Uri): Promise<ChatAttachment | null> {
  const file = projectRelativePath(uri);
  if (!file) {
    vscode.window.showWarningMessage(
      'IntentEra: file must live inside the open workspace folder.'
    );
    return null;
  }
  let content = '';
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    content = doc.getText();
  } catch (err) {
    vscode.window.showWarningMessage(`IntentEra: could not read ${file}: ${(err as Error).message}`);
    return null;
  }
  // Truncate enormous files client-side to keep the payload small; the
  // Lambda will still see the file path so commits can be pulled either way.
  const MAX = 60_000;
  if (content.length > MAX) {
    content = `${content.slice(0, MAX)}\n…[truncated by IntentEra extension]`;
  }
  return { file, content };
}

/**
 * Returns a POSIX-style path of `uri` relative to the FIRST workspace
 * folder, or null if the uri isn't inside one.
 */
function projectRelativePath(uri: vscode.Uri): string | null {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  const rel = path.relative(folder.uri.fsPath, uri.fsPath);
  if (!rel || rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}
