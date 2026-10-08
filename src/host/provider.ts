import * as vscode from 'vscode';
import { isWebviewMessage, type HostToWebview, type Mode } from '../bridge/messages';
import { copyMarkdown, exportHtml, exportPdf } from './export/commands';
import { DocumentSync } from './sync';
import { webviewHtml } from './webviewHtml';

export const VIEW_TYPE = 'margin.editor';

export interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  mode: Mode;
  words: number;
  post(message: HostToWebview): void;
}

export class MarginEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<Session>();
  private activeSession: Session | undefined;
  private readonly changed = new vscode.EventEmitter<Session | undefined>();
  /** Fires when the active Margin editor, its mode or its word count changes. */
  readonly onDidChangeActive = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get active(): Session | undefined {
    return this.activeSession;
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const docDir = vscode.Uri.joinPath(document.uri, '..');
    const roots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
    ];
    if (document.uri.scheme === 'file') roots.push(docDir);
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri);

    const config = vscode.workspace.getConfiguration('margin');
    const session: Session = {
      document,
      panel,
      mode: config.get<Mode>('defaultMode', 'preview'),
      words: 0,
      post: (m) => void panel.webview.postMessage(m),
    };
    const sync = new DocumentSync(document, session.post);
    this.sessions.add(session);
    if (panel.active) this.setActive(session);

    const subs: vscode.Disposable[] = [
      sync,
      panel.webview.onDidReceiveMessage(async (raw: unknown) => {
        if (!isWebviewMessage(raw)) return;
        switch (raw.type) {
          case 'ready':
            session.post({
              type: 'init',
              text: document.getText(),
              version: document.version,
              mode: session.mode,
              settings: { outlineVisible: vscode.workspace.getConfiguration('margin').get('outline.visible', true) },
              baseUri: panel.webview.asWebviewUri(docDir).toString() + '/',
            });
            break;
          case 'edit':
            await sync.applyEdit(raw.version, raw.edits);
            break;
          case 'undo':
          case 'redo':
            await vscode.commands.executeCommand(raw.type);
            break;
          case 'mode':
            session.mode = raw.mode;
            this.changed.fire(this.activeSession);
            break;
          case 'stats':
            session.words = raw.words;
            if (this.activeSession === session) this.changed.fire(session);
            break;
          case 'openLink':
            await openLink(document, raw.href);
            break;
          case 'exportPdf':
            await exportPdf(document);
            break;
          case 'exportHtml':
            await exportHtml(document);
            break;
          case 'copyMarkdown':
            await copyMarkdown(document);
            break;
          case 'log':
            console.log(`[margin] ${raw.text}`);
            break;
        }
      }),
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) this.setActive(session);
        else if (this.activeSession === session) this.setActive(undefined);
      }),
    ];
    panel.onDidDispose(() => {
      subs.forEach((s) => s.dispose());
      this.sessions.delete(session);
      if (this.activeSession === session) this.setActive(undefined);
    });
  }

  private setActive(session: Session | undefined): void {
    this.activeSession = session;
    void vscode.commands.executeCommand('setContext', 'margin.active', session !== undefined);
    this.changed.fire(session);
  }

  toggleMode(): void {
    const s = this.activeSession;
    if (!s) return;
    s.mode = s.mode === 'edit' ? 'preview' : 'edit';
    s.post({ type: 'setMode', mode: s.mode });
    this.changed.fire(s);
  }
}

async function openLink(document: vscode.TextDocument, href: string): Promise<void> {
  if (/^(https?|mailto):/i.test(href)) {
    await vscode.env.openExternal(vscode.Uri.parse(href));
    return;
  }
  if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
  const [file] = href.split('#');
  if (!file) return;
  const target = vscode.Uri.joinPath(document.uri, '..', decodeURIComponent(file));
  await vscode.commands.executeCommand('vscode.open', target);
}
