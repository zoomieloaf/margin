import { esc, keyLabel } from './icons';

/** Hover tooltips for any element with `data-tip` (and optional `data-key`). */
export function installTooltips(host: HTMLElement): void {
  const tip = document.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  host.append(tip);
  document.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || e.pointerType === 'touch') return;
    tip.innerHTML = esc(t.dataset.tip ?? '') + (t.dataset.key ? `<span>${esc(keyLabel(t.dataset.key))}</span>` : '');
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let y = r.bottom + 6;
    if (y + h > innerHeight - 4) y = r.top - h - 6;
    tip.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${y}px`;
  });
  document.addEventListener('pointerout', (e) => {
    const t = (e.target as HTMLElement).closest('[data-tip]');
    if (t && !t.contains(e.relatedTarget as Node | null)) tip.hidden = true;
  });
  document.addEventListener('mousedown', () => {
    tip.hidden = true;
  });
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

export function toast(text: string, sub?: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.append(toastEl);
  }
  toastEl.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.hidden = true;
  }, 2800);
}
