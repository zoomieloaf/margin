import * as vscode from 'vscode';
import { isWebviewMessage, type HostToWebview, type Mode, type WebviewToHost } from '../bridge/messages';
import { copyMarkdown, exportHtml, exportPdf } from './export/commands';
import { linkTarget } from './links';
import { SerialQueue } from './queue';
import { DocumentSync } from './sync';
import { webviewHtml } from './webviewHtml';

export const VIEW_TYPE = 'margin.editor';
/** True while the active Margin editor's webview has keyboard focus (see the keybindings in package.json). */
export const FOCUS_CONTEXT = 'margin.webviewFocused';

export interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  mode: Mode;
  words: number;
  /** The webview reported keyboard focus and hasn't reported losing it. */
  focused: boolean;
  post(message: HostToWebview): void;
  /** Handles a message as if the webview sent it, after every message already queued. */
  receive(message: WebviewToHost): Promise<void>;
}

export class MarginEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Set<Session>();
  private activeSession: Session | undefined;
  private focusContext: boolean | undefined;
  private readonly changed = new vscode.EventEmitter<Session | undefined>();
  /** Fires when the active Margin editor, its mode or its word count changes. */
  readonly onDidChangeActive = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get active(): Session | undefined {
    return this.activeSession;
  }

  /** The open Margin editors showing `uri`. */
  sessionsFor(uri: vscode.Uri): Session[] {
    return [...this.sessions].filter((s) => s.document.uri.toString() === uri.toString());
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
    // One message at a time, in order: an edit is applied before a following undo runs.
    const queue = new SerialQueue();
    const session: Session = {
      document,
      panel,
      mode: config.get<Mode>('defaultMode', 'preview'),
      words: 0,
      focused: false,
      post: (m) => void panel.webview.postMessage(m),
      receive: (m) => queue.push(() => handle(m)),
    };
    const sync = new DocumentSync(document, session.post);
    this.sessions.add(session);
    if (panel.active) this.setActive(session);

    const handle = async (m: WebviewToHost): Promise<void> => {
      switch (m.type) {
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
          await sync.applyEdit(m.version, m.edits, m.seq);
          break;
        case 'resync':
          sync.reset();
          break;
        case 'undo':
        case 'redo':
          // The webview sends this once per key press, after its pending edits were acked.
          await vscode.commands.executeCommand(m.type);
          break;
        case 'mode':
          session.mode = m.mode;
          this.changed.fire(this.activeSession);
          break;
        case 'stats':
          session.words = m.words;
          if (this.activeSession === session) this.changed.fire(session);
          break;
        case 'focus':
        case 'blur':
          session.focused = m.type === 'focus';
          this.updateFocusContext();
          break;
        case 'openLink':
          await openLink(document, m.href);
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
          console.log(`[margin] ${m.text}`);
          break;
      }
    };

    const subs: vscode.Disposable[] = [
      sync,
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        if (isWebviewMessage(raw)) void session.receive(raw);
      }),
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          this.setActive(session);
        } else {
          // The webview posts `focus` again when it gets focus back.
          session.focused = false;
          if (this.activeSession === session) this.setActive(undefined);
        }
        this.updateFocusContext();
      }),
    ];
    panel.onDidDispose(() => {
      subs.forEach((s) => s.dispose());
      session.focused = false;
      this.sessions.delete(session);
      if (this.activeSession === session) this.setActive(undefined);
      this.updateFocusContext();
    });
  }

  private setActive(session: Session | undefined): void {
    this.activeSession = session;
    void vscode.commands.executeCommand('setContext', 'margin.active', session !== undefined);
    this.updateFocusContext();
    this.changed.fire(session);
  }

  private updateFocusContext(): void {
    const focused = this.activeSession?.focused === true;
    if (focused === this.focusContext) return;
    this.focusContext = focused;
    void vscode.commands.executeCommand('setContext', FOCUS_CONTEXT, focused);
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
  const target = linkTarget(href);
  if (target.kind === 'external') {
    await vscode.env.openExternal(vscode.Uri.parse(target.href));
    return;
  }
  if (target.kind !== 'file') return;
  // `/docs/a.md` is relative to the workspace folder (like on GitHub, where it's the repository root).
  const root = target.rooted
    ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.joinPath(document.uri, '..')
    : vscode.Uri.joinPath(document.uri, '..');
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(root, target.path));
}
