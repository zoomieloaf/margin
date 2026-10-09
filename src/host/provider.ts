import * as vscode from 'vscode';
import { isWebviewMessage, resolvePageWidth, type HostToWebview, type Mode, type PageWidth, type PageWidthState, type WebviewToHost } from '../bridge/messages';
import { copyMarkdown, exportHtml, exportPdf } from './export/commands';
import { AiService, AiSession } from './ai/service';
import { checkLinks, followLink, type Pages } from './navigate';
import { SerialQueue } from './queue';
import { DocumentSync } from './sync';
import { webviewHtml } from './webviewHtml';

export const VIEW_TYPE = 'margin.editor';
/** True while the active Margin editor's webview has keyboard focus (see the keybindings in package.json). */
export const FOCUS_CONTEXT = 'margin.webviewFocused';
/** True while the active Margin editor is in Edit mode: only then does it use the formatting shortcuts. */
export const EDITING_CONTEXT = 'margin.editing';

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
  /** Everything posted to the webview; kept only for the integration tests. */
  posted?: HostToWebview[];
}

/** How a page opened from a link starts, until its editor is created. */
interface PendingOpen {
  mode: Mode;
  anchor?: string;
  at: number;
}

/** workspaceState key prefix of a file's own page width (followed by the document URI). */
const PAGE_WIDTH_KEY = 'margin.pageWidth:';

/** A pending open older than this belongs to an editor that never came (the open failed). */
const PENDING_MS = 30_000;

export class MarginEditorProvider implements vscode.CustomTextEditorProvider, Pages {
  private readonly sessions = new Set<Session>();
  private activeSession: Session | undefined;
  private focusContext: boolean | undefined;
  private editingContext: boolean | undefined;
  private readonly changed = new vscode.EventEmitter<Session | undefined>();
  /** Fires when the active Margin editor, its mode or its word count changes. */
  readonly onDidChangeActive = this.changed.event;
  private readonly pending = new Map<string, PendingOpen>();
  /** Runs the AI actions of every Margin editor (dispose it with the extension). */
  readonly ai: AiService;

  /** `record`: keep what each session posts (integration tests). */
  constructor(private readonly context: vscode.ExtensionContext, private readonly record = false) {
    this.ai = new AiService(context.globalState);
  }

  warn = (message: string, ...items: string[]): Thenable<string | undefined> => vscode.window.showWarningMessage(message, ...items);

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
    // Opened by following a link: starts in that link's mode and scrolls to its heading once.
    const opened = this.takePending(document.uri);
    let anchor = opened?.anchor;
    // One message at a time, in order: an edit is applied before a following undo runs.
    const queue = new SerialQueue();
    const posted: HostToWebview[] | undefined = this.record ? [] : undefined;
    const session: Session = {
      document,
      panel,
      mode: opened?.mode ?? config.get<Mode>('defaultMode', 'preview'),
      words: 0,
      focused: false,
      posted,
      post: (m) => {
        posted?.push(m);
        void panel.webview.postMessage(m);
      },
      receive: (m) => queue.push(() => handle(m)),
    };
    const sync = new DocumentSync(document, session.post);
    const ai = new AiSession(this.ai, session.post);
    this.sessions.add(session);
    if (panel.active) this.setActive(session);

    const handle = async (m: WebviewToHost): Promise<void> => {
      switch (m.type) {
        case 'ready': {
          const width = this.pageWidth(document.uri);
          session.post({
            type: 'init',
            text: document.getText(),
            version: document.version,
            mode: session.mode,
            settings: {
              outlineVisible: vscode.workspace.getConfiguration('margin').get('outline.visible', true),
              pageWidth: width.width,
              pageWidthState: width,
              ai: this.ai.setting,
              aiEditor: this.ai.available,
            },
            baseUri: panel.webview.asWebviewUri(docDir).toString() + '/',
            ...(anchor ? { anchor } : {}),
          });
          anchor = undefined;
          // Answered with aiAvailable (models may have appeared since the last check).
          void this.ai.refresh();
          break;
        }
        case 'edit':
          try {
            await sync.applyEdit(m.version, m.edits, m.seq);
          } catch (err) {
            // No ack would come and the webview would hold every later edit: resend the file instead.
            report(err);
            sync.reset();
          }
          break;
        case 'resync':
          sync.reset();
          break;
        case 'undo':
        case 'redo':
          // The webview sends this once per key press, after its pending edits were acked.
          // If the user moved to another editor meanwhile, the command would undo there: skip it.
          if (this.activeSession === session) await vscode.commands.executeCommand(m.type);
          break;
        case 'mode':
          // The webview discards its suggestion on a mode change; stop paying for the answer too.
          ai.cancelAll();
          session.mode = m.mode;
          this.updateFocusContext();
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
        // Started in order (they read the document before their first await) but not awaited:
        // printing, or a notification waiting for a click, must not hold up the edits behind them.
        case 'openLink':
          void followLink(document, m.href, this).catch(report);
          break;
        case 'checkLinks':
          void checkLinks(document, m.hrefs)
            .then((status) => session.post({ type: 'linkStatus', ...status }))
            .catch(report);
          break;
        case 'exportPdf':
          void exportPdf(document).catch(report);
          break;
        case 'exportHtml':
          void exportHtml(document).catch(report);
          break;
        case 'copyMarkdown':
          void copyMarkdown(document).catch(report);
          break;
        case 'ai':
          void ai.start(m);
          break;
        case 'aiCancel':
          ai.cancel(m.id);
          break;
        case 'pageWidth':
          await this.setPageWidth(document.uri, m.value);
          break;
        case 'log':
          console.log(`[margin] ${m.text}`);
          break;
      }
    };

    const subs: vscode.Disposable[] = [
      sync,
      ai,
      this.ai.onDidChangeAvailable((editor) => session.post({ type: 'aiAvailable', editor })),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('margin.ai')) session.post({ type: 'aiAvailable', editor: this.ai.available, setting: this.ai.setting });
        // Pages with their own width keep it; the new default still shows in their width menu.
        if (e.affectsConfiguration('margin.pageWidth')) session.post({ type: 'setPageWidth', ...this.pageWidth(document.uri) });
      }),
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

  /** Opens `uri` in Margin, or reveals the Margin editor already showing it, and scrolls to `anchor`. */
  async openPage(uri: vscode.Uri, opts: { mode: Mode; anchor?: string }): Promise<void> {
    const open = this.sessionsFor(uri);
    const s = open.find((x) => x.panel.active) ?? open.find((x) => x.panel.visible) ?? open[0];
    if (s) {
      // Already open: keep its mode (the user may be editing there), just bring it up.
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, { viewColumn: s.panel.viewColumn, preserveFocus: false });
      if (opts.anchor) s.post({ type: 'scrollTo', anchor: opts.anchor });
      return;
    }
    this.pending.set(uri.toString(), { ...opts, at: Date.now() });
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  }

  /** The width `uri` shows at: its own choice, otherwise the `margin.pageWidth` setting. */
  pageWidth(uri: vscode.Uri): PageWidthState {
    return resolvePageWidth(
      this.context.workspaceState.get(PAGE_WIDTH_KEY + uri.toString()),
      vscode.workspace.getConfiguration('margin').get('pageWidth'),
    );
  }

  /**
   * Gives `uri` its own width (null: back to the setting) and updates every Margin editor showing it.
   * Kept in workspaceState, never in the file: the document doesn't change or become dirty.
   */
  async setPageWidth(uri: vscode.Uri, value: PageWidth | null): Promise<void> {
    await this.context.workspaceState.update(PAGE_WIDTH_KEY + uri.toString(), value ?? undefined);
    const state = this.pageWidth(uri);
    for (const s of this.sessionsFor(uri)) s.post({ type: 'setPageWidth', ...state });
  }

  private takePending(uri: vscode.Uri): PendingOpen | undefined {
    const p = this.pending.get(uri.toString());
    this.pending.delete(uri.toString());
    return p && Date.now() - p.at < PENDING_MS ? p : undefined;
  }

  /** Follows a link as if it was clicked in the Margin editor showing `document` (integration tests). */
  followLink(document: vscode.TextDocument, href: string): Promise<void> {
    return followLink(document, href, this);
  }

  private setActive(session: Session | undefined): void {
    this.activeSession = session;
    void vscode.commands.executeCommand('setContext', 'margin.active', session !== undefined);
    this.updateFocusContext();
    this.changed.fire(session);
  }

  /** Keeps the context keys the keybindings in package.json depend on in step with the active editor. */
  private updateFocusContext(): void {
    const focused = this.activeSession?.focused === true;
    if (focused !== this.focusContext) {
      this.focusContext = focused;
      void vscode.commands.executeCommand('setContext', FOCUS_CONTEXT, focused);
    }
    const editing = this.activeSession?.mode === 'edit';
    if (editing !== this.editingContext) {
      this.editingContext = editing;
      void vscode.commands.executeCommand('setContext', EDITING_CONTEXT, editing);
    }
  }

  toggleMode(): void {
    const s = this.activeSession;
    if (!s) return;
    s.mode = s.mode === 'edit' ? 'preview' : 'edit';
    s.post({ type: 'setMode', mode: s.mode });
    this.updateFocusContext();
    this.changed.fire(s);
  }
}

const report = (err: unknown) => console.error('[margin]', err);
