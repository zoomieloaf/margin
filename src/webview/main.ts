import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-tables/style/tables.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import './styles.css';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { DOMSerializer, type Node as PmNode } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import type { HostToWebview, Mode, WebviewToHost } from '../bridge/messages';
import { activeState, clickTask, insertBlock, setBlock, toggleInline, type BlockType, type InsertKind, type MarkName } from './editor/commands';
import { findAnchor } from './editor/anchors';
import { uniqueIds } from './editor/ids';
import { editorKeymaps } from './editor/keymap';
import { DocModel } from './editor/model';
import { schema } from './editor/schema';
import type { AppApi } from './ui/api';
import { Bubble } from './ui/bubble';
import { AI, BLOCKS, EXPORTS } from './ui/catalog';
import { installTooltips, toast } from './ui/feedback';
import { Handles } from './ui/handles';
import { Menu } from './ui/menu';
import { docStats, Outline } from './ui/outline';
import { Slash } from './ui/slash';
import { Toolbar } from './ui/toolbar';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(s: unknown): void; getState(): unknown };

const vscode = acquireVsCodeApi();
const post = (m: WebviewToHost) => vscode.postMessage(m);
const EDIT_DEBOUNCE_MS = 150;

class App implements AppApi {
  mode: Mode = 'preview';
  readonly menu: Menu;
  readonly view: EditorView;
  private readonly model = new DocModel(
    (e, seq) => post({ type: 'edit', version: e.version, edits: e.edits, seq }),
    () => post({ type: 'resync' }),
  );
  private readonly root: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly source: HTMLTextAreaElement;
  private readonly toolbar: Toolbar;
  private readonly bubble: Bubble;
  private readonly slash: Slash;
  private readonly outline: Outline;
  private baseUri = '';
  private timer: number | undefined;
  /** Debounce of the Markdown-mode textarea; undefined when nothing is waiting. */
  private sourceTimer: number | undefined;
  private lastWords = -1;

  constructor(host: HTMLElement) {
    this.root = host;
    host.className = 'app';
    this.menu = new Menu(document.body);
    this.toolbar = new Toolbar(this);
    this.slash = new Slash(this);

    const body = document.createElement('div');
    body.className = 'editor-body';
    this.scroll = document.createElement('div');
    this.scroll.className = 'scroll';
    const wrap = document.createElement('div');
    wrap.className = 'doc-wrap';
    const mount = document.createElement('div');
    this.source = document.createElement('textarea');
    this.source.className = 'source';
    this.source.spellcheck = false;
    this.source.setAttribute('aria-label', 'Markdown source');
    this.source.hidden = true;
    this.source.addEventListener('input', () => {
      this.autoGrow();
      this.scheduleSource();
    });
    this.source.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        this.history(e.inputType === 'historyUndo' ? 'undo' : 'redo');
      }
    });
    wrap.append(mount, this.source);
    this.scroll.append(wrap);
    this.outline = new Outline(() => this.view, this.scroll);
    body.append(this.scroll, this.outline.el);
    host.append(this.toolbar.el, body);

    this.view = new EditorView(mount, {
      state: this.createState(schema.nodes.doc!.create(null, schema.nodes.paragraph!.create())),
      editable: () => this.mode === 'edit',
      attributes: { class: 'doc', spellcheck: 'true' },
      dispatchTransaction: (tr) => this.dispatch(tr),
      nodeViews: { image: (node) => this.imageView(node) },
      handleKeyDown: (_view, e) => this.slash.handleKey(e) || (e.key === 'Escape' && this.bubble.dismiss()),
      handleClick: (view, _pos, e) => this.click(view, e),
      handleDoubleClick: () => {
        if (this.mode !== 'preview') return false;
        this.setMode('edit');
        return false;
      },
      handleDOMEvents: {
        beforeinput: (_view, e) => {
          const type = (e as InputEvent).inputType;
          if (type === 'historyUndo' || type === 'historyRedo') {
            e.preventDefault();
            this.history(type === 'historyUndo' ? 'undo' : 'redo');
            return true;
          }
          return false;
        },
        focus: () => {
          this.bubble.update(this.view, true);
          return false;
        },
        blur: () => {
          window.setTimeout(() => this.bubble.update(this.view, false));
          return false;
        },
      },
    });
    this.bubble = new Bubble(this, document.body);
    new Handles(this, this.scroll, wrap);
    installTooltips(document.body);

    window.addEventListener('message', (e: MessageEvent<HostToWebview>) => this.receive(e.data));
    window.addEventListener('keydown', (e) => this.globalKey(e), true);
    // Drives the margin.webviewFocused context key, which routes Ctrl+Z, Ctrl+B... to Margin.
    window.addEventListener('focus', () => post({ type: 'focus' }));
    window.addEventListener('blur', () => post({ type: 'blur' }));
    this.scroll.addEventListener('scroll', () => this.bubble.update(this.view, false), { passive: true });
    window.addEventListener('resize', () => this.menu.close());
    // Don't keep typing back when the tab is hidden or the webview goes away.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushNow();
    });
    window.addEventListener('pagehide', () => this.flushNow());
    post({ type: 'ready' });
    if (document.hasFocus()) post({ type: 'focus' });
  }

  // ---------------------------------------------------------------- state & sync

  private createState(doc: PmNode, selection?: number): EditorState {
    const state = EditorState.create({
      doc,
      plugins: [
        uniqueIds(this.model.newId),
        this.slash.plugin(),
        ...editorKeymaps({
          undo: () => this.history('undo'),
          redo: () => this.history('redo'),
          toggleMode: () => this.setMode(this.mode === 'edit' ? 'preview' : 'edit'),
          editLink: () => this.bubble.openLink(),
        }),
        tableEditing(),
        dropCursor({ color: 'var(--m-accent)', width: 2 }),
        gapCursor(),
      ],
    });
    if (selection === undefined) return state;
    const pos = Math.max(0, Math.min(selection, doc.content.size));
    return state.apply(state.tr.setSelection(Selection.near(doc.resolve(pos))));
  }

  private dispatch(tr: Transaction): void {
    const before = this.view.state;
    this.slash.map(tr);
    this.view.updateState(before.apply(tr));
    const docChanged = this.view.state.doc !== before.doc;
    if (docChanged) this.schedule();
    this.slash.update(this.view);
    this.refreshUi(!before.selection.eq(this.view.state.selection), docChanged);
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.model.change(this.view.state.doc), EDIT_DEBOUNCE_MS);
  }

  /** Markdown mode: textarea changes reach the file after the same short pause as editor changes. */
  private scheduleSource(): void {
    window.clearTimeout(this.sourceTimer);
    this.sourceTimer = window.setTimeout(() => {
      this.sourceTimer = undefined;
      this.model.sourceChanged(this.source.value);
    }, EDIT_DEBOUNCE_MS);
  }

  /** Sends anything still waiting for the debounce (mode switch, undo, export, hiding the page...). */
  private flushNow(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.mode === 'source') {
      window.clearTimeout(this.sourceTimer);
      this.sourceTimer = undefined;
      this.model.sourceChanged(this.source.value);
    } else {
      this.model.change(this.view.state.doc);
    }
  }

  /**
   * Undo/redo go to VS Code's history. Pending typing is sent first and acknowledged, so the
   * undo step VS Code takes is exactly the latest edit. One call = one message = one step.
   */
  private history(kind: 'undo' | 'redo'): void {
    this.flushNow();
    this.model.whenIdle(() => post({ type: kind }));
  }

  private load(doc: PmNode, keepSelection: boolean): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.sourceTimer);
    this.timer = this.sourceTimer = undefined;
    const sel = keepSelection ? this.view.state.selection.from : undefined;
    this.view.updateState(this.createState(doc, sel));
    if (this.mode === 'source' && this.source.value !== this.model.markdown) {
      const { selectionStart, selectionEnd } = this.source;
      this.source.value = this.model.markdown;
      this.source.setSelectionRange(selectionStart, selectionEnd);
      this.autoGrow();
    }
    this.refreshUi(true);
  }

  private receive(m: HostToWebview): void {
    switch (m.type) {
      case 'init':
        this.baseUri = m.baseUri;
        this.outline.visible = m.settings.outlineVisible && innerWidth >= 900;
        this.load(this.model.load(m.text, m.version), false);
        this.setMode(m.mode);
        break;
      case 'ack':
        this.model.ack(m.version, m.seq);
        break;
      case 'reset': {
        // Markdown mode: the file's text wins over textarea edits not yet sent (the safer
        // choice: re-applying them could silently undo the change that caused the reset).
        const unsent = this.mode === 'source' && (this.sourceTimer !== undefined || this.model.busy);
        this.load(this.model.reset(m.text, m.version), true);
        if (unsent) toast('The file changed while you were typing', 'Margin is showing the file as it is now; check your last edit');
        break;
      }
      case 'setMode':
        this.setMode(m.mode);
        break;
      case 'toast':
        toast(m.text, m.sub);
        break;
    }
  }

  // ---------------------------------------------------------------- modes

  setMode(mode: Mode): void {
    if (mode === this.mode && this.root.dataset.mode) return;
    const leaving = this.mode;
    if (leaving === 'source' && mode !== 'source') {
      this.flushNow(); // still in source mode here: sends the textarea
      const doc = this.model.leaveSource();
      if (doc) this.load(doc, true);
    }
    if (mode === 'source') {
      this.flushNow();
      this.source.value = this.model.markdown;
    }
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.view.setProps({ editable: () => this.mode === 'edit' });
    this.view.dom.hidden = mode === 'source';
    this.source.hidden = mode !== 'source';
    if (mode === 'source') {
      this.autoGrow();
      this.source.focus();
    } else if (mode === 'edit') {
      this.view.focus();
    }
    this.menu.close();
    this.refreshUi(true);
    post({ type: 'mode', mode });
  }

  private autoGrow(): void {
    this.source.style.height = 'auto';
    this.source.style.height = `${Math.max(this.source.scrollHeight, this.scroll.clientHeight * 0.6)}px`;
  }

  // ---------------------------------------------------------------- actions

  act(action: string, anchor?: HTMLElement, arg?: string): void {
    const view = this.view;
    const rect = anchor?.getBoundingClientRect();
    const at = rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : this.caretRect();
    switch (action) {
      case 'strong': case 'em': case 'strike': case 'code': case 'mark':
        toggleInline(view, action as MarkName);
        break;
      case 'link':
        this.bubble.openLink();
        return;
      case 'undo': case 'redo':
        this.history(action);
        break;
      case 'block':
        if (arg) setBlock(view, arg as BlockType);
        break;
      case 'insert':
        if (arg) insertBlock(view, arg as InsertKind);
        break;
      case 'turn':
        this.menu.open(at, [{ title: 'Turn into', items: BLOCKS }], (id) => { setBlock(view, id as BlockType); view.focus(); }, { active: activeState(view.state).block, anchor });
        return;
      case 'outline':
        this.outline.visible = !this.outline.visible;
        this.refreshUi(false);
        return;
      case 'export':
        this.menu.open(at, EXPORTS, (id) => this.exportAction(id), { rich: true, anchor });
        return;
      case 'ai':
        this.menu.open(at, AI, () => toast('AI actions are planned for a later release', 'They will use the AI model already set up in VS Code or Cursor'), { anchor });
        return;
    }
    if (this.mode === 'edit') view.focus();
  }

  private caretRect() {
    const c = this.view.coordsAtPos(this.view.state.selection.head);
    return { left: c.left, top: c.top, bottom: c.bottom };
  }

  private exportAction(id: string): void {
    if (id === 'rich') {
      void this.copyRich();
      return;
    }
    const type = id === 'pdf' ? 'exportPdf' : id === 'html' ? 'exportHtml' : id === 'md' ? 'copyMarkdown' : null;
    if (!type) return;
    // These read the file on the host: send the typing first and wait until it is applied.
    this.flushNow();
    this.model.whenIdle(() => post({ type }));
  }

  private async copyRich(): Promise<void> {
    const box = document.createElement('div');
    box.append(DOMSerializer.fromSchema(schema).serializeFragment(this.view.state.doc.content));
    box.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    // Margin-only attributes (raw Markdown for copy/paste inside Margin) aren't for other apps.
    box.querySelectorAll('[data-margin-raw]').forEach((el) => el.removeAttribute('data-margin-raw'));
    const html = box.innerHTML;
    const text = box.innerText || this.view.state.doc.textContent;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
      ]);
      toast('Copied with formatting', 'Paste into Slack, email or Confluence');
    } catch {
      box.style.position = 'fixed';
      box.style.left = '-9999px';
      document.body.append(box);
      const range = document.createRange();
      range.selectNodeContents(box);
      const s = getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const ok = document.execCommand('copy');
      s?.removeAllRanges();
      box.remove();
      toast(ok ? 'Copied with formatting' : 'Copy was blocked here', ok ? 'Paste into Slack, email or Confluence' : 'Use Copy as Markdown instead');
    }
  }

  // ---------------------------------------------------------------- events

  private click(view: EditorView, e: MouseEvent): boolean {
    const target = e.target as HTMLElement;
    const cb = target.closest('.cb');
    if (cb) {
      const li = cb.closest('li');
      if (li) {
        const pos = view.posAtDOM(li, 0) - 1;
        // The model flips the one character in the source (no list rewrite); it must be current first.
        this.flushNow();
        clickTask(view, pos, this.model);
        return true;
      }
    }
    const a = target.closest('a');
    if (a && (this.mode !== 'edit' || e.ctrlKey || e.metaKey)) {
      const href = a.getAttribute('href');
      if (href?.startsWith('#')) this.scrollToAnchor(href.slice(1));
      else if (href) post({ type: 'openLink', href });
      e.preventDefault();
      return true;
    }
    return false;
  }

  /** `#fragment` links scroll to the heading with that GitHub id. */
  private scrollToAnchor(fragment: string): void {
    const pos = findAnchor(this.view.state.doc, fragment);
    const dom = pos === null ? null : this.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    const top = this.scroll.scrollTop + dom.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 16;
    this.scroll.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  private globalKey(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inInput = e.target instanceof HTMLInputElement; // the link field keeps its own undo
    if (mod && !e.altKey && !inInput && (k === 'z' || (k === 'y' && !e.shiftKey))) {
      // Everywhere in the webview (document, Markdown textarea, toolbar): VS Code's history.
      // preventDefault also keeps ProseMirror's keymap from seeing the key a second time.
      e.preventDefault();
      this.history(k === 'y' || e.shiftKey ? 'redo' : 'undo');
    } else if (mod && !e.shiftKey && !e.altKey && k === 's') {
      // VS Code saves (the key is forwarded to it): send the typing still waiting for the debounce first.
      this.flushNow();
    } else if (mod && !e.shiftKey && k === 'e') {
      e.preventDefault();
      this.setMode(this.mode === 'edit' ? 'preview' : 'edit');
    } else if (this.menu.isOpen && !this.slash.isOpen && this.menu.handleKey(e)) {
      e.stopPropagation();
    }
  }

  private imageView(node: PmNode) {
    const img = document.createElement('img');
    const src = node.attrs.src as string;
    try {
      img.src = this.baseUri && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? new URL(src, this.baseUri).toString() : src;
    } catch {
      img.src = src;
    }
    img.alt = (node.attrs.alt as string | null) ?? '';
    if (node.attrs.title) img.title = node.attrs.title as string;
    return { dom: img };
  }

  private refreshUi(selectionChanged: boolean, docChanged = true): void {
    this.toolbar.update(this.view.state, this.mode, this.outline.visible);
    this.bubble.update(this.view, selectionChanged);
    if (!docChanged) return;
    this.outline.render(this.view.state.doc);
    const words = docStats(this.view.state.doc).words;
    if (words !== this.lastWords) {
      this.lastWords = words;
      post({ type: 'stats', words });
    }
  }
}

new App(document.getElementById('app')!);
