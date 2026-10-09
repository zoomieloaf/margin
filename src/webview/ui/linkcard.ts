import type { LinksOpenIn, Mode } from '../../bridge/messages';
import { icon } from './icons';

/** What the link card needs from the app. */
export interface LinkCardHost {
  readonly mode: Mode;
  /** The margin.links.openIn setting: names the other Open button. */
  readonly linksOpenIn: LinksOpenIn;
  /** Follows the link, like a click on it; `otherTab`: like a Ctrl/Cmd+click (the other kind of tab). */
  openHref(href: string, otherTab?: boolean): void;
  /** Selects the link and opens the link editor on it. */
  editLink(a: HTMLAnchorElement): void;
  copyHref(href: string): void;
}

const SHOW_MS = 400;
/** Time to move the pointer from the link to the card (or back) before the card hides. */
const GRACE_MS = 250;

/** A link that opens a file in VS Code (not an in-page #anchor or a web link): it can open in either kind of tab. */
const opensFile = (href: string) => href !== '' && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href);

/** The small card with a link's address and Open · Open in new tab · Edit link · Copy link, shown on hover in Edit mode. */
export class LinkCard {
  readonly el: HTMLDivElement;
  private readonly hrefEl: HTMLElement;
  /** The link the card is shown for, or waiting to show for. */
  private link: HTMLAnchorElement | null = null;
  private showTimer: number | undefined;
  private hideTimer: number | undefined;

  constructor(private readonly host: LinkCardHost, doc: HTMLElement, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pop linkcard';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Link');
    this.el.hidden = true;
    this.el.innerHTML = `
      <span class="lc-href"></span>
      <span class="bsep"></span>
      <button type="button" class="bb" data-act="open" title="Open the link">${icon('file')}Open</button>
      <button type="button" class="bb" data-act="open-other">${icon('newtab')}<span></span></button>
      <button type="button" class="bb" data-act="edit" title="Change the link address">${icon('link')}Edit link</button>
      <button type="button" class="bb" data-act="copy" title="Copy the link address">${icon('copy')}Copy link</button>`;
    parent.append(this.el);
    this.hrefEl = this.el.querySelector('.lc-href')!;

    doc.addEventListener('pointerover', (e) => {
      const a = (e.target as HTMLElement).closest?.('a');
      if (!a || e.pointerType === 'touch' || this.host.mode !== 'edit') return;
      window.clearTimeout(this.hideTimer);
      if (a === this.link) return;
      window.clearTimeout(this.showTimer);
      this.link = a;
      if (this.el.hidden) this.showTimer = window.setTimeout(() => this.show(), SHOW_MS);
      else this.show(); // already showing for a neighbour: move over at once
    });
    doc.addEventListener('pointerout', (e) => {
      if (!this.link || this.link.contains(e.relatedTarget as Node | null)) return;
      if ((e.target as HTMLElement).closest?.('a') !== this.link) return;
      this.hideSoon();
    });
    this.el.addEventListener('pointerenter', () => window.clearTimeout(this.hideTimer));
    this.el.addEventListener('pointerleave', () => this.hideSoon());
    // Keep the editor's focus and selection.
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const a = this.link;
      const href = a?.getAttribute('href');
      if (!btn || !a || href === null || href === undefined) return;
      this.hide();
      if (btn.dataset.act === 'open') this.host.openHref(href);
      else if (btn.dataset.act === 'open-other') this.host.openHref(href, true);
      else if (btn.dataset.act === 'edit') this.host.editLink(a);
      else if (btn.dataset.act === 'copy') this.host.copyHref(href);
    });
  }

  hide(): void {
    window.clearTimeout(this.showTimer);
    window.clearTimeout(this.hideTimer);
    this.link = null;
    this.el.hidden = true;
  }

  private hideSoon(): void {
    window.clearTimeout(this.showTimer);
    window.clearTimeout(this.hideTimer);
    if (this.el.hidden) this.link = null;
    else this.hideTimer = window.setTimeout(() => this.hide(), GRACE_MS);
  }

  private show(): void {
    const a = this.link;
    if (!a || !a.isConnected || this.host.mode !== 'edit') return this.hide();
    const href = a.getAttribute('href') ?? '';
    this.hrefEl.textContent = href;
    this.hrefEl.title = href;
    (this.el.querySelector('[data-act="open"]') as HTMLElement).title = `Open ${href}`;
    // The opposite of margin.links.openIn, like Ctrl/Cmd+click.
    const other = this.el.querySelector<HTMLElement>('[data-act="open-other"]')!;
    const newTab = this.host.linksOpenIn !== 'newTab';
    other.hidden = !opensFile(href);
    other.querySelector('span')!.textContent = newTab ? 'Open in new tab' : 'Open in this tab';
    other.title = newTab ? `Open ${href} in a new tab` : `Open ${href} in the preview tab`;
    this.el.hidden = false;
    // Under the line the pointer is on (a link can wrap), or above it when there's no room.
    const r = a.getClientRects()[0] ?? a.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let y = r.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
    this.el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    this.el.style.top = `${y}px`;
  }
}
