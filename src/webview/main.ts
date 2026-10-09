import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-tables/style/tables.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import './styles.css';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { DOMSerializer, type Node as PmNode } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { tableEditing } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import {
  isLinksOpenIn, isPageWidth, linkOpensNewTab, MAX_CHECKED_LINKS, resolvePageWidth,
  type AiAction, type AiSetting, type HostToWebview, type LinksOpenIn, type Mode, type NavDirection, type PageWidthState, type WebviewToHost,
} from '../bridge/messages';
import { activeState, clickTask, insertBlock, setBlock, toggleInline, type BlockType, type InsertKind, type MarkName } from './editor/commands';
import { findAnchor } from './editor/anchors';
import { uniqueIds } from './editor/ids';
import { editorKeymaps } from './editor/keymap';
import { linkStatusKey, linkStatusPlugin, localLinks, type LinkStatus } from './editor/linkStatus';
import { markdownTextParser } from './editor/paste';
import { DocModel } from './editor/model';
import { schema } from './editor/schema';
import { AiAssist } from './ui/aibox';
import type { AppApi } from './ui/api';
import { Bubble } from './ui/bubble';
import { aiGroups, BLOCKS, EXPORTS, pageWidthGroups, translateGroups } from './ui/catalog';
import { installTooltips, toast } from './ui/feedback';
import { Handles } from './ui/handles';
import { LinkCard, type LinkCardHost } from './ui/linkcard';
import { Menu, type Rect } from './ui/menu';
import { docStats, Outline } from './ui/outline';
import { Slash } from './ui/slash';
import { isMac } from './ui/icons';
import { isBackKey, osOf, shortcutKey } from './ui/shortcut';
import { Toolbar } from './ui/toolbar';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(s: unknown): void; getState(): unknown };

const vscode = acquireVsCodeApi();
const post = (m: WebviewToHost) => vscode.postMessage(m);
const EDIT_DEBOUNCE_MS = 150;
/** Pause after typing before the host is asked again which link targets exist. */
const LINK_CHECK_MS = 500;
/** A mouse that moved further than this between press and release dragged: no link is opened. */
const CLICK_SLOP_PX = 4;
/** In-page #jumps that Back can undo, at most. */
const MAX_JUMPS = 50;
const OS = osOf(navigator.platform || '');

class App implements AppApi, LinkCardHost {
  mode: Mode = 'preview';
  /** The margin.links.openIn setting. */
  linksOpenIn: LinksOpenIn = 'sameTab';
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
  private readonly linkCard: LinkCard;
  private readonly ai: AiAssist;
  private readonly handles: Handles;
  private readonly wrap: HTMLElement;
  /** The page's width and where it comes from (a per-file choice or the margin.pageWidth setting). */
  private pageWidth: PageWidthState = resolvePageWidth(null, 'normal');
  private linkStatus: LinkStatus = { missing: new Set(), paths: new Map() };
  private linkTimer: number | undefined;
  /** The local links last sent to the host, one per line. */
  private checkedLinks = '';
  /** Where the last mouse press in the document was. */
  private downAt: { x: number; y: number } | null = null;
  private baseUri = '';
  private timer: number | undefined;
  /** Debounce of the Markdown-mode textarea; undefined when nothing is waiting. */
  private sourceTimer: number | undefined;
  private lastWords = -1;
  /**
   * Where the page was scrolled before each in-page #jump, latest last. VS Code's Go Back doesn't
   * know about them: Back undoes these first. Cleared when the document changes.
   */
  private jumps: number[] = [];

  constructor(host: HTMLElement) {
    this.root = host;
    host.className = 'app';
    this.menu = new Menu(document.body);
    this.toolbar = new Toolbar(this);
    this.slash = new Slash(this);
    this.ai = new AiAssist({ view: () => this.view, post, flush: () => this.flushNow() });

    const body = document.createElement('div');
    body.className = 'editor-body';
    this.scroll = document.createElement('div');
    this.scroll.className = 'scroll';
    const wrap = document.createElement('div');
    wrap.className = 'doc-wrap';
    this.wrap = wrap;
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
      // Plain text that looks like Markdown is pasted as formatted blocks.
      clipboardTextParser: markdownTextParser,
      handleKeyDown: (_view, e) => this.slash.handleKey(e) || (e.key === 'Escape' && this.bubble.dismiss()),
      handleClick: (view, _pos, e) => this.click(view, e),
      handleDoubleClick: () => {
        if (this.mode !== 'preview') return false;
        this.setMode('edit');
        return false;
      },
      handleDOMEvents: {
        mousedown: (_view, e) => {
          this.downAt = { x: e.clientX, y: e.clientY };
          return false;
        },
        // Links are followed in handleClick (on mouseup). The click's default would load the link in
        // the webview itself (Preview isn't contenteditable), or a new window with Ctrl/Cmd.
        click: (_view, e) => {
          if ((e.target as HTMLElement).closest('a')) e.preventDefault();
          return false;
        },
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
    this.linkCard = new LinkCard(this, this.view.dom, document.body);
    this.handles = new Handles(this, this.scroll, wrap);
    // The column has its new width: put the bubble back over the selection, regrow the textarea.
    wrap.addEventListener('transitionend', (e) => {
      if (e.target === wrap && e.propertyName === 'max-width') this.widthSettled();
    });
    installTooltips(document.body);

    window.addEventListener('message', (e: MessageEvent<HostToWebview>) => this.receive(e.data));
    window.addEventListener('keydown', (e) => this.globalKey(e), true);
    // The mouse's back and forward buttons (the webview has no browser history of its own).
    window.addEventListener('mousedown', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    }, true);
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      this.navigate(e.button === 3 ? 'back' : 'forward');
    }, true);
    // Drives the margin.webviewFocused context key, which routes Ctrl+Z, Ctrl+B... to Margin.
    window.addEventListener('focus', () => {
      post({ type: 'focus' });
      // Pages may have been created or deleted while VS Code had focus elsewhere.
      this.checkLinks(true);
    });
    window.addEventListener('blur', () => post({ type: 'blur' }));
    this.scroll.addEventListener('scroll', () => {
      this.bubble.update(this.view, false);
      this.linkCard.hide();
    }, { passive: true });
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
        this.ai.plugin(),
        ...editorKeymaps({
          undo: () => this.history('undo'),
          redo: () => this.history('redo'),
          toggleMode: () => this.setMode(this.mode === 'edit' ? 'preview' : 'edit'),
          editLink: () => this.bubble.openLink(),
        }),
        linkStatusPlugin(() => this.linkStatus),
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
    if (docChanged) {
      this.jumps = [];
      this.schedule();
      this.scheduleLinkCheck();
    }
    this.slash.update(this.view);
    this.refreshUi(!before.selection.eq(this.view.state.selection), docChanged);
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.model.change(this.view.state.doc), EDIT_DEBOUNCE_MS);
  }

  private scheduleLinkCheck(): void {
    window.clearTimeout(this.linkTimer);
    this.linkTimer = window.setTimeout(() => this.checkLinks(false), LINK_CHECK_MS);
  }

  /**
   * Asks the host which local link targets exist (the answer marks broken links). `again`: even when
   * the links are the ones already checked, because files may have changed.
   */
  private checkLinks(again: boolean): void {
    window.clearTimeout(this.linkTimer);
    const hrefs = localLinks(this.view.state.doc).slice(0, MAX_CHECKED_LINKS);
    const key = hrefs.join('\n');
    if (!again && key === this.checkedLinks) return;
    this.checkedLinks = key;
    if (!hrefs.length && !this.linkStatus.missing.size && !this.linkStatus.paths.size) return;
    post({ type: 'checkLinks', hrefs });
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
    this.jumps = [];
    const sel = keepSelection ? this.view.state.selection.from : undefined;
    this.view.updateState(this.createState(doc, sel));
    if (this.mode === 'source' && this.source.value !== this.model.markdown) {
      const { selectionStart, selectionEnd } = this.source;
      this.source.value = this.model.markdown;
      this.source.setSelectionRange(selectionStart, selectionEnd);
      this.autoGrow();
    }
    this.refreshUi(true);
    this.scheduleLinkCheck();
  }

  private receive(m: HostToWebview): void {
    switch (m.type) {
      case 'init':
        this.baseUri = m.baseUri;
        this.configureAi(m.settings.ai ?? 'auto', m.settings.aiEditor ?? false);
        this.linksOpenIn = isLinksOpenIn(m.settings.linksOpenIn) ? m.settings.linksOpenIn : 'sameTab';
        this.outline.visible = m.settings.outlineVisible && innerWidth >= 900;
        this.root.dataset.nav = m.settings.navButtons ? 'on' : 'off';
        this.setPageWidth(m.settings.pageWidthState ?? resolvePageWidth(null, m.settings.pageWidth));
        // Animated from now on: the page doesn't visibly resize while it opens.
        void this.wrap.offsetWidth;
        this.root.classList.add('width-anim');
        this.load(this.model.load(m.text, m.version), false);
        this.setMode(m.mode);
        if (m.anchor) {
          const anchor = m.anchor;
          // Opened from a link to one of its headings: start there.
          requestAnimationFrame(() => this.scrollToAnchor(anchor, false));
        }
        this.checkLinks(true);
        break;
      case 'ack':
        this.model.ack(m.version, m.seq);
        break;
      case 'reset': {
        // The suggestion's range may no longer exist: close it (the file was not changed by it).
        this.ai.discard();
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
      case 'scrollTo':
        this.scrollToAnchor(m.anchor);
        break;
      case 'linkStatus':
        this.linkStatus = { missing: new Set(m.missing), paths: new Map(m.paths) };
        // A decoration update only: no document change, so nothing is sent to the file.
        this.view.dispatch(this.view.state.tr.setMeta(linkStatusKey, true));
        break;
      case 'aiChunk':
        this.ai.chunk(m.id, m.text);
        break;
      case 'aiDone':
        this.ai.done(m.id);
        break;
      case 'aiError':
        this.ai.error(m.id, m.message);
        break;
      case 'aiFallback':
        this.ai.fallback(m.id);
        break;
      case 'aiAvailable':
        this.configureAi(m.setting ?? this.ai.setting, m.editor);
        break;
      case 'setPageWidth':
        this.setPageWidth(resolvePageWidth(m.override, m.setting));
        break;
      case 'navButtons':
        this.root.dataset.nav = m.visible ? 'on' : 'off';
        break;
      case 'linksOpenIn':
        this.linksOpenIn = m.value;
        break;
    }
  }

  // ---------------------------------------------------------------- modes

  setMode(mode: Mode): void {
    if (mode === this.mode && this.root.dataset.mode) return;
    const leaving = this.mode;
    this.ai.discard();
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
    this.linkCard.hide();
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
      case 'back': case 'forward':
        this.navigate(action);
        return;
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
      case 'width':
        this.menu.open(at, pageWidthGroups(this.pageWidth.setting), (id) => this.pickPageWidth(id), { anchor, active: this.pageWidth.override ?? 'default' });
        return;
      case 'export':
        this.menu.open(at, EXPORTS, (id) => this.exportAction(id), { rich: true, anchor });
        return;
      case 'ai':
        if (this.mode !== 'edit' || !this.ai.enabled) return;
        this.menu.open(at, aiGroups({ selection: !view.state.selection.empty, editor: this.ai.inPlace }), (id) => this.aiPick(id as AiAction, at), { anchor });
        return;
      case 'ai-run':
        if (arg && this.mode === 'edit') this.aiStart(arg as AiAction);
        return;
    }
    if (this.mode === 'edit') view.focus();
  }

  /** A width from the menu (or `default`): shown at once, and the host keeps it for this file. */
  private pickPageWidth(id: string): void {
    const value = isPageWidth(id) ? id : null;
    this.setPageWidth(resolvePageWidth(value, this.pageWidth.setting));
    post({ type: 'pageWidth', value });
  }

  /** Sets the column width (CSS on .app[data-width]); nothing in the document changes. */
  private setPageWidth(state: PageWidthState): void {
    this.pageWidth = state;
    if (this.root.dataset.width === state.width) return;
    this.root.dataset.width = state.width;
    // Handles and the link card point at where blocks were; they come back on the next hover.
    this.handles.hide();
    this.linkCard.hide();
    // Without a transition (reduced motion, or no change in px) no transitionend comes.
    requestAnimationFrame(() => this.widthSettled());
  }

  private widthSettled(): void {
    this.bubble.update(this.view, false);
    if (this.mode === 'source') this.autoGrow();
  }

  get aiEnabled(): boolean {
    return this.ai.enabled;
  }

  /** The margin.ai setting and whether the editor has a model; `off` hides every AI entry point (CSS on body[data-ai]). */
  private configureAi(setting: AiSetting, editorModel: boolean): void {
    this.ai.configure(setting, editorModel);
    document.body.dataset.ai = this.ai.enabled ? (this.ai.inPlace ? 'editor' : 'chat') : 'off';
  }

  private aiPick(action: AiAction, at: Rect): void {
    if (action !== 'translate') return this.aiStart(action);
    // Translate to… opens the languages; Other… asks for one in the suggestion box.
    this.menu.open(at, translateGroups(), (id) => this.aiStart('translate', id === 'lang:' ? {} : { lang: id.slice('lang:'.length) }));
  }

  private aiStart(action: AiAction, opts: { lang?: string; instruction?: string } = {}): void {
    this.bubble.dismiss();
    this.ai.start(action, opts);
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
    if (a && this.followsClick(e)) {
      const href = a.getAttribute('href');
      // Ctrl+click (Cmd+click on macOS): the other kind of tab than margin.links.openIn says.
      if (href) this.openHref(href, isMac ? e.metaKey : e.ctrlKey);
      e.preventDefault();
      return true;
    }
    return false;
  }

  /**
   * A click on a link opens it, in Preview and in Edit mode alike (Notion style), with or without
   * Ctrl/Cmd (which picks the other kind of tab). Not after a drag or with text selected (that was selecting), and not with Shift or Alt
   * (those extend the selection). To edit a link's text, click just after it or use the arrow keys.
   */
  private followsClick(e: MouseEvent): boolean {
    if (e.button !== 0 || e.shiftKey || e.altKey) return false;
    if (this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > CLICK_SLOP_PX) return false;
    return getSelection()?.isCollapsed ?? true;
  }

  /** `otherTab`: open in the other kind of tab than margin.links.openIn says (Ctrl/Cmd+click, the link card). */
  openHref(href: string, otherTab = false): void {
    if (href.startsWith('#')) this.jumpTo(href.slice(1));
    else post({ type: 'openLink', href, ...(otherTab ? { newTab: !linkOpensNewTab(this.linksOpenIn) } : {}) });
  }

  /** An in-page #link: scrolls to the heading, and Back comes back here. */
  private jumpTo(fragment: string): void {
    const from = this.scroll.scrollTop;
    if (!this.scrollToAnchor(fragment)) return;
    this.jumps.push(from);
    if (this.jumps.length > MAX_JUMPS) this.jumps.shift();
  }

  /** Back undoes the latest in-page jump, otherwise it is VS Code's Go Back; Forward is always Go Forward. */
  private navigate(direction: NavDirection): void {
    const top = direction === 'back' ? this.jumps.pop() : undefined;
    if (top === undefined) {
      post({ type: 'navigate', direction });
      return;
    }
    this.scroll.scrollTo({ top, behavior: this.motion ? 'smooth' : 'auto' });
  }

  private get motion(): boolean {
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Selects the whole link and opens the link editor on it (the link card's Edit link). */
  editLink(a: HTMLAnchorElement): void {
    if (this.mode !== 'edit') return;
    const view = this.view;
    const from = view.posAtDOM(a, 0);
    const to = view.posAtDOM(a, a.childNodes.length);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.focus();
    this.bubble.openLink();
  }

  copyHref(href: string): void {
    navigator.clipboard.writeText(href).then(
      () => toast('Link copied', href),
      () => toast('Copy was blocked here', href),
    );
  }

  /** `#fragment` links scroll to the heading with that GitHub id. False when there is no such heading. */
  private scrollToAnchor(fragment: string, smooth = true): boolean {
    const pos = findAnchor(this.view.state.doc, fragment);
    const dom = pos === null ? null : this.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;
    const top = this.scroll.scrollTop + dom.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 16;
    this.scroll.scrollTo({ top, behavior: smooth && this.motion ? 'smooth' : 'auto' });
    return true;
  }

  private globalKey(e: KeyboardEvent): void {
    this.linkCard.hide();
    const mod = e.ctrlKey || e.metaKey;
    const k = shortcutKey(e);
    const inInput = e.target instanceof HTMLInputElement;
    if (isBackKey(e, OS)) {
      // package.json binds this key to a no-op while Margin has focus, so VS Code doesn't also go back.
      e.preventDefault();
      e.stopPropagation();
      this.navigate('back');
      return;
    }
    if (mod && !e.altKey && inInput && (k === 'z' || k === 'y')) {
      // VS Code's webview swallows Ctrl+Z / Ctrl+Y, so the link field runs its own undo.
      e.preventDefault();
      document.execCommand(k === 'y' || e.shiftKey ? 'redo' : 'undo');
      return;
    }
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
    } else if (e.key === 'Escape' && this.ai.isOpen) {
      // Esc discards the AI suggestion (before ProseMirror or the bubble see the key).
      e.preventDefault();
      e.stopPropagation();
      this.ai.discard(true);
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

