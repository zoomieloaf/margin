import * as vscode from 'vscode';
import { isPageWidth, isWebviewMessage, PAGE_WIDTH_LABEL, PAGE_WIDTHS, type PageWidth } from '../bridge/messages';
import type { TextEdit } from '../md/types';
import { copyMarkdown, exportHtml, exportPdf } from './export/commands';
import { MarginEditorProvider, VIEW_TYPE, type Session } from './provider';
import { shouldOfferDefault } from './firstRun';

const ASKED_KEY = 'margin.askedDefaultEditor';

export function activate(context: vscode.ExtensionContext): void {
  const testing = process.env.MARGIN_TEST === '1';
  const provider = new MarginEditorProvider(context, testing);
  context.subscriptions.push(
    provider.ai,
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
    // The toolbar's width menu as a quick pick. `value` (a width, or 'default') skips the pick.
    vscode.commands.registerCommand('margin.changePageWidth', async (value?: unknown) => {
      const s = provider.active;
      if (!s) {
        void vscode.window.showWarningMessage('Open a Markdown file in Margin first.');
        return;
      }
      const uri = s.document.uri;
      if (value === 'default' || value === null) return provider.setPageWidth(uri, null);
      if (isPageWidth(value)) return provider.setPageWidth(uri, value);
      const state = provider.pageWidth(uri);
      const items: Array<vscode.QuickPickItem & { value: PageWidth | null }> = [
        ...PAGE_WIDTHS.map((w) => ({ label: PAGE_WIDTH_LABEL[w], value: w, description: state.override === w ? '$(check)' : undefined })),
        { label: '', kind: vscode.QuickPickItemKind.Separator, value: null },
        { label: `Use default (${PAGE_WIDTH_LABEL[state.setting]})`, value: null, description: state.override === null ? '$(check)' : undefined },
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Page width for this file', placeHolder: `Now: ${PAGE_WIDTH_LABEL[state.width]}` });
      if (pick) await provider.setPageWidth(uri, pick.value);
    }),
    vscode.commands.registerCommand('margin.exportPdf', withDocument(exportPdf)),
    vscode.commands.registerCommand('margin.exportHtml', withDocument(exportHtml)),
    vscode.commands.registerCommand('margin.copyMarkdown', withDocument(copyMarkdown)),
    // VS Code forwards every key pressed in a webview to the workbench, even when the webview
    // already handled it. While a Margin webview has focus, package.json binds Ctrl+Z, Ctrl+B,
    // Ctrl+E, Ctrl+K... to these commands, which win over the core bindings and do nothing:
    // the webview handles the key itself. For undo/redo it first flushes its pending edit and
    // waits for the ack, then posts one `undo`/`redo` message, so one key press = one undo step.
    vscode.commands.registerCommand('margin.undo', () => undefined),
    vscode.commands.registerCommand('margin.redo', () => undefined),
    vscode.commands.registerCommand('margin.webviewKey', () => undefined),
  );

  // ---------------------------------------------------------------- test hooks (integration tests only)
  if (testing) {
    const warnings: Array<{ message: string; items: string[] }> = [];
    const aiCalls = { clipboard: [] as string[], opened: [] as string[], asked: [] as string[] };
    const sessionFor = (uri: vscode.Uri | string) => {
      const s = provider.sessionsFor(typeof uri === 'string' ? vscode.Uri.parse(uri) : uri)[0];
      if (!s) throw new Error(`No Margin editor is open for ${uri.toString()}`);
      return s;
    };
    context.subscriptions.push(
      // An edit as the webview would send it, at the document's current version, through the session's queue.
      vscode.commands.registerCommand('margin._test.postEdit', (uri: vscode.Uri | string, edits: TextEdit[]) => {
        const s = sessionFor(uri);
        return s.receive({ type: 'edit', version: s.document.version, edits });
      }),
      // Any webview message, queued like a real one (used to check the queue's ordering).
      vscode.commands.registerCommand('margin._test.postMessage', (uri: vscode.Uri | string, message: unknown) => {
        if (!isWebviewMessage(message)) throw new Error('Not a webview message');
        return sessionFor(uri).receive(message);
      }),
      // Follows a link from that editor and resolves when it is done (a webview `openLink` isn't awaited).
      // `newTab` as the webview would send it (Ctrl/Cmd+click, the hover card).
      vscode.commands.registerCommand('margin._test.openLink', (uri: vscode.Uri | string, href: string, newTab?: boolean) =>
        provider.followLink(sessionFor(uri), href, newTab),
      ),
      // What the host posted to that editor's webview.
      // The page width stored for that file and the setting.
      vscode.commands.registerCommand('margin._test.pageWidth', (uri: vscode.Uri | string) =>
        provider.pageWidth(typeof uri === 'string' ? vscode.Uri.parse(uri) : uri),
      ),
      vscode.commands.registerCommand('margin._test.posted', (uri: vscode.Uri | string) => sessionFor(uri).posted ?? []),
      // From now on, warnings are answered with `answer` instead of shown, and recorded.
      vscode.commands.registerCommand('margin._test.answerWarnings', (answer?: string) => {
        provider.warn = (message, ...items) => {
          warnings.push({ message, items });
          // Like a click: only on a button the warning has.
          return Promise.resolve(answer !== undefined && items.includes(answer) ? answer : undefined);
        };
      }),
      vscode.commands.registerCommand('margin._test.warnings', () => [...warnings]),
      // From now on the AI actions see no model, record instead of using the clipboard and the browser,
      // and answer the first-use notice with `consent`. `chatView`: the editor has a chat command, which fails.
      vscode.commands.registerCommand('margin._test.stubAi', ({ consent, chatView = false }: { consent: boolean; chatView?: boolean }) => {
        aiCalls.clipboard.length = aiCalls.opened.length = aiCalls.asked.length = 0;
        provider.ai.env = {
          models: () => Promise.resolve([]),
          hasChatCommand: () => Promise.resolve(chatView),
          openChat: () => Promise.reject(new Error('no chat view')),
          openExternal: (url) => (aiCalls.opened.push(url), Promise.resolve(true)),
          clipboard: (text) => (aiCalls.clipboard.push(text), Promise.resolve()),
          confirm: (where) => (aiCalls.asked.push(where), Promise.resolve(consent)),
        };
      }),
      vscode.commands.registerCommand('margin._test.aiCalls', () => structuredClone(aiCalls)),
      // Forgets which places the user agreed to send text to.
      vscode.commands.registerCommand('margin._test.resetAiConsent', () => context.globalState.update('margin.ai.consent', undefined)),
    );
  }

  // ---------------------------------------------------------------- first run
  const maybeAsk = async (editor: vscode.TextEditor | undefined) => {
    if (!editor) return;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const offer = shouldOfferDefault({
      languageId: editor.document.languageId,
      scheme: editor.document.uri.scheme,
      inDiff: tab?.input instanceof vscode.TabInputTextDiff,
      associations: vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations'),
      asked: context.globalState.get<boolean>(ASKED_KEY) === true,
    });
    if (!offer) return;
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
