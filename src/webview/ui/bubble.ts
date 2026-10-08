import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { activeState, currentLink, setLink } from '../editor/commands';
import type { AppApi } from './api';
import { LABEL } from './catalog';
import { icon } from './icons';

const b = (act: string, ic: string, tip: string, key: string) =>
  `<button type="button" class="bb" data-act="${act}" data-tip="${tip}" data-key="${key}" aria-label="${tip}">${icon(ic)}</button>`;

/** The Notion-style menu that floats above a text selection in Edit mode. */
export class Bubble {
  readonly el: HTMLDivElement;
  private readonly main: HTMLElement;
  private readonly linkRow: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private linking = false;
  private suppressed = false;

  constructor(private readonly app: AppApi, host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pop bubble';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Format selection');
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="row bubble-main">
        <button type="button" class="bb" data-act="turn" aria-haspopup="menu" data-tip="Turn into"><span class="blk-label">Text</span>${icon('chev', 'chev')}</button>
        <span class="bsep"></span>
        ${b('strong', 'bold', 'Bold', 'Ctrl+B')}${b('em', 'italic', 'Italic', 'Ctrl+I')}${b('strike', 'strike', 'Strikethrough', 'Ctrl+Shift+X')}
        ${b('code', 'code', 'Inline code', 'Ctrl+`')}${b('mark', 'highlight', 'Highlight', 'Ctrl+Shift+H')}${b('link', 'link', 'Link', 'Ctrl+K')}
        <span class="bsep ai-sep"></span>
        <button type="button" class="bb ai" data-act="ai" aria-haspopup="menu" data-tip="AI actions">${icon('sparkles')}AI</button>
      </div>
      <form class="row linkrow" hidden>
        <input type="text" placeholder="Paste or type a link" aria-label="Link address" autocomplete="off">
        <button type="submit" class="bb">Apply</button>
        <button type="button" class="bb" data-unlink>Remove</button>
      </form>`;
    host.append(this.el);
    this.main = this.el.querySelector('.bubble-main')!;
    this.linkRow = this.el.querySelector('.linkrow')!;
    this.input = this.linkRow.querySelector('input')!;

    this.el.addEventListener('mousedown', (e) => {
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
    });
    this.main.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      if (this.app.menu.anchor === btn) return this.app.menu.close();
      if (btn.dataset.act === 'link') return this.openLink();
      this.app.act(btn.dataset.act!, btn);
    });
    this.linkRow.addEventListener('submit', (e) => {
      e.preventDefault();
      this.applyLink(this.input.value);
    });
    this.linkRow.querySelector('[data-unlink]')!.addEventListener('click', () => this.applyLink(''));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeLink();
        this.app.view.focus();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (this.linking && !this.el.contains(e.target as Node)) {
        this.closeLink();
        this.el.hidden = true;
      }
    });
  }

  /** Esc hides the bubble until the selection changes. */
  dismiss(): boolean {
    if (this.el.hidden) return false;
    this.el.hidden = true;
    this.suppressed = true;
    return true;
  }

  update(view: EditorView, selectionChanged: boolean): void {
    if (this.linking) return;
    if (selectionChanged) this.suppressed = false;
    const sel = view.state.selection;
    const a = activeState(view.state);
    const show = this.app.mode === 'edit' && !this.suppressed && sel instanceof TextSelection && !sel.empty && !a.inCode && view.hasFocus();
    if (!show) {
      this.el.hidden = true;
      return;
    }
    for (const name of ['strong', 'em', 'strike', 'code', 'mark', 'link'] as const) {
      this.el.querySelector(`[data-act="${name}"]`)?.setAttribute('aria-pressed', String(a.marks.has(name)));
    }
    const label = this.el.querySelector('.blk-label');
    if (label) label.textContent = LABEL[a.block] ?? 'Mixed';
    this.el.hidden = false;
    this.place(view);
  }

  private place(view: EditorView): void {
    const { from, to } = view.state.selection;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    const left = start.top === end.top ? (start.left + end.right) / 2 : (start.left + end.left) / 2;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, left - w / 2));
    let y = top - h - 10;
    if (y < 8) y = bottom + 10;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  /** Opens the inline link editor for the current selection (Ctrl+K or the link button). */
  openLink(): void {
    const view = this.app.view;
    if (this.app.mode !== 'edit') return;
    if (view.state.selection.empty && !currentLink(view.state)) return;
    this.update(view, true);
    if (this.el.hidden) {
      this.el.hidden = false;
      this.place(view);
    }
    this.linking = true;
    this.main.hidden = true;
    this.linkRow.hidden = false;
    const href = currentLink(view.state);
    this.input.value = href ?? '';
    (this.linkRow.querySelector('[data-unlink]') as HTMLElement).hidden = !href;
    this.input.focus();
    this.input.select();
  }

  private applyLink(raw: string): void {
    let href = raw.trim();
    if (href && !/^([a-z][a-z0-9+.-]*:|#|\/|\.)/i.test(href)) href = `https://${href}`;
    this.closeLink();
    const view = this.app.view;
    view.focus();
    setLink(view, href || null);
  }

  private closeLink(): void {
    this.linking = false;
    this.linkRow.hidden = true;
    this.main.hidden = false;
  }
}
