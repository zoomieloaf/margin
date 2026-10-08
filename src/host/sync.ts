import * as vscode from 'vscode';
import type { HostToWebview } from '../bridge/messages';
import type { TextEdit } from '../md/types';

/**
 * Keeps one Margin webview and its TextDocument in step. The document is the source of truth:
 * the webview proposes edits against a version; stale edits are refused with a reset, and any
 * change that isn't ours (undo, git, another editor, an AI agent) also resets the webview.
 */
export class DocumentSync implements vscode.Disposable {
  private applying = 0;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly post: (message: HostToWebview) => void,
  ) {
    this.subscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== document || e.contentChanges.length === 0 || this.applying > 0) return;
      this.reset();
    });
  }

  reset(): void {
    this.post({ type: 'reset', text: this.document.getText(), version: this.document.version });
  }

  async applyEdit(version: number, edits: TextEdit[]): Promise<void> {
    if (version !== this.document.version) {
      this.reset();
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(e.start), this.document.positionAt(e.end)), e.text);
    }
    this.applying++;
    let ok = false;
    try {
      ok = await vscode.workspace.applyEdit(edit);
    } finally {
      this.applying--;
    }
    // Exactly one version step means nothing else changed the document while we applied.
    if (ok && this.document.version === version + 1) this.post({ type: 'ack', version: this.document.version });
    else this.reset();
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
