/**
 * extension/src/services/logger.ts
 * --------------------------------
 * Single shared OutputChannel used by every host-side module so users can
 * see what IntentEra is doing in Cursor's "Output" panel:
 *
 *   View → Output → IntentEra (in the dropdown)
 *
 * `console.log` from the extension host is essentially invisible in normal
 * usage; an OutputChannel is the right place to surface diagnostics.
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('IntentEra');
  }
  return channel;
}

function ts(): string {
  return new Date().toISOString();
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const log = {
  info(label: string, payload?: unknown): void {
    const line = `[${ts()}] [info]  ${label}`;
    getChannel().appendLine(payload === undefined ? line : `${line} ${format(payload)}`);
  },
  warn(label: string, payload?: unknown): void {
    const line = `[${ts()}] [warn]  ${label}`;
    getChannel().appendLine(payload === undefined ? line : `${line} ${format(payload)}`);
  },
  error(label: string, payload?: unknown): void {
    const line = `[${ts()}] [error] ${label}`;
    getChannel().appendLine(payload === undefined ? line : `${line} ${format(payload)}`);
  },
  show(): void {
    getChannel().show(true);
  },
};
