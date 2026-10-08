import * as vscode from 'vscode';
import { copyMarkdown, exportHtml, exportPdf } from './export/commands';
import { MarginEditorProvider, VIEW_TYPE, type Session } from './provider';

const ASKED_KEY = 'margin.askedDefaultEditor';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MarginEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );

  // ---------------------------------------------------------------- status bar
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'margin.toggleMode';
  const renderStatus = (s: Session | undefined) => {
    if (!s) {
      status.hide();
      return;
    }
    const icon = s.mode === 'edit' ? '$(edit)' : s.mode === 'source' ? '$(markdown)' : '$(eye)';
    const name = s.mode === 'edit' ? 'Edit' : s.mode === 'source' ? 'Markdown' : 'Preview';
    const minutes = Math.max(1, Math.round(s.words / 230));
    status.text = `${icon} Margin: ${name}  ·  ${s.words} words · ${minutes} min`;
    status.tooltip = 'Click to switch between Preview and Edit (Ctrl+E)';
    status.show();
  };
  context.subscriptions.push(status, provider.onDidChangeActive(renderStatus));

  // ---------------------------------------------------------------- commands
  const markdownDocument = (): vscode.TextDocument | undefined => {
    if (provider.active) return provider.active.document;
    const doc = vscode.window.activeTextEditor?.document;
    return doc?.languageId === 'markdown' ? doc : undefined;
  };
  const withDocument = (fn: (d: vscode.TextDocument) => Promise<unknown>) => async () => {
    const doc = markdownDocument();
    if (doc) await fn(doc);
    else void vscode.window.showWarningMessage('Open a Markdown file first.');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('margin.openInMargin', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('margin.reopenAsText', async () => {
      const doc = provider.active?.document;
      if (doc) await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
    }),
    vscode.commands.registerCommand('margin.toggleMode', () => provider.toggleMode()),
    vscode.commands.registerCommand('margin.exportPdf', withDocument(exportPdf)),
    vscode.commands.registerCommand('margin.exportHtml', withDocument(exportHtml)),
    vscode.commands.registerCommand('margin.copyMarkdown', withDocument(copyMarkdown)),
  );

  // ---------------------------------------------------------------- first run
  const maybeAsk = async (editor: vscode.TextEditor | undefined) => {
    if (!editor || editor.document.languageId !== 'markdown' || editor.document.uri.scheme !== 'file') return;
    if (context.globalState.get<boolean>(ASKED_KEY)) return;
    await context.globalState.update(ASKED_KEY, true);
    const choice = await vscode.window.showInformationMessage(
      'Open Markdown files in Margin by default? You can always switch back with "Reopen in Text Editor".',
      'Yes',
      'Just this file',
      'Not now',
    );
    if (choice === 'Yes') {
      const config = vscode.workspace.getConfiguration('workbench');
      const associations = { ...(config.get<Record<string, string>>('editorAssociations') ?? {}), '*.md': VIEW_TYPE, '*.markdown': VIEW_TYPE };
      await config.update('editorAssociations', associations, vscode.ConfigurationTarget.Global);
    }
    if (choice === 'Yes' || choice === 'Just this file') {
      await vscode.commands.executeCommand('vscode.openWith', editor.document.uri, VIEW_TYPE);
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((e) => void maybeAsk(e)));
  void maybeAsk(vscode.window.activeTextEditor);
}

export function deactivate(): void {}
