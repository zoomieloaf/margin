import type { MenuGroup, MenuItem } from './catalog';
import { esc, icon } from './icons';

export interface MenuOptions {
  /** Show descriptions and bordered icons (slash menu, export menu). */
  rich?: boolean;
  /** Item id to mark with a check. */
  active?: string;
  /** Element that opened the menu; clicks on it toggle the menu instead of reopening. */
  anchor?: HTMLElement;
  /** Highlight the first item immediately (slash menu). */
  highlightFirst?: boolean;
  onClose?: () => void;
}

export interface Rect {
  left: number;
  top: number;
  bottom: number;
}

/** One popover menu shared by the toolbar, bubble, slash menu and block handles. */
export class Menu {
  readonly el: HTMLDivElement;
  private onPick: ((id: string) => void) | null = null;
  private opts: MenuOptions = {};
  private rect: Rect = { left: 0, top: 0, bottom: 0 };
  private index = -1;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pop menu';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    host.append(this.el);
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.mi');
      if (b?.dataset.id) this.pick(b.dataset.id);
    });
    document.addEventListener('mousedown', (e) => {
      if (this.el.hidden) return;
      const t = e.target as Node;
      if (this.el.contains(t) || this.opts.anchor?.contains(t)) return;
      this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  get anchor(): HTMLElement | undefined {
    return this.isOpen ? this.opts.anchor : undefined;
  }

  open(rect: Rect, groups: MenuGroup[], onPick: (id: string) => void, opts: MenuOptions = {}): void {
    this.close();
    this.onPick = onPick;
    this.opts = opts;
    this.rect = rect;
    this.render(groups);
    this.el.hidden = false;
    this.place();
    opts.anchor?.setAttribute('aria-expanded', 'true');
    if (opts.highlightFirst) this.move(1);
  }

  /** Re-renders the items in place (slash filtering). */
  update(groups: MenuGroup[]): void {
    if (!this.isOpen) return;
    this.render(groups);
    this.place();
    this.index = -1;
    if (this.opts.highlightFirst) this.move(1);
  }

  close(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.opts.anchor?.setAttribute('aria-expanded', 'false');
    const done = this.opts.onClose;
    this.onPick = null;
    this.opts = {};
    done?.();
  }

  /** Arrow keys, Enter and Escape while the menu is open. Returns true when handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.key === 'ArrowDown') this.move(1);
    else if (e.key === 'ArrowUp') this.move(-1);
    else if (e.key === 'Escape') this.close();
    else if (e.key === 'Enter' || e.key === 'Tab') {
      const item = this.el.querySelector<HTMLElement>('.mi.kb');
      if (!item?.dataset.id) return false;
      this.pick(item.dataset.id);
    } else return false;
    e.preventDefault();
    return true;
  }

  private pick(id: string): void {
    const fn = this.onPick;
    this.close();
    fn?.(id);
  }

  private move(d: number): void {
    const items = [...this.el.querySelectorAll<HTMLElement>('.mi')];
    if (!items.length) return;
    this.index = (this.index + d + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('kb', i === this.index));
    items[this.index]!.scrollIntoView({ block: 'nearest' });
  }

  private render(groups: MenuGroup[]): void {
    const rich = !!this.opts.rich;
    this.el.classList.toggle('rich', rich);
    const item = (it: MenuItem) => {
      const ic = it.icon ? icon(it.icon) : `<b>${esc(it.glyph ?? '')}</b>`;
      const desc = rich && it.desc ? `<small>${esc(it.desc)}</small>` : '';
      const md = it.md ? `<code class="mi-md">${esc(it.md)}</code>` : '';
      const badge = it.badge ? `<span class="badge">${esc(it.badge)}</span>` : '';
      const check = it.id === this.opts.active ? icon('check', 'ck') : '';
      return `<button type="button" class="mi" role="menuitem" data-id="${esc(it.id)}"><span class="mi-ic">${ic}</span><span class="mi-l">${esc(it.label)}${desc}</span>${md}${badge}${check}</button>`;
    };
    const html = groups
      .filter((g) => g.items.length)
      .map((g) => (g.title ? `<div class="menu-h">${esc(g.title)}</div>` : '') + g.items.map(item).join(''))
      .join('<div class="menu-sep"></div>');
    this.el.innerHTML = html || '<div class="menu-empty">No matching blocks. Press Esc to keep typing.</div>';
  }

  private place(): void {
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, this.rect.left));
    let y = this.rect.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, this.rect.top - h - 6);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
