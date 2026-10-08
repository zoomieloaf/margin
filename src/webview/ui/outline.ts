import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { esc } from './icons';

export interface DocStats {
  words: number;
  minutes: number;
  tasks: number;
  done: number;
}

export function docStats(doc: PmNode): DocStats {
  const words = (doc.textBetween(0, doc.content.size, ' ', ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
  let tasks = 0;
  let done = 0;
  doc.descendants((node) => {
    if (node.type.name === 'list_item' && node.attrs.checked !== null) {
      tasks++;
      if (node.attrs.checked) done++;
    }
    return true;
  });
  return { words, minutes: Math.max(1, Math.round(words / 230)), tasks, done };
}

/** Headings of the document with the current section highlighted, plus reading stats. */
export class Outline {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly stats: HTMLElement;
  private headings: number[] = [];

  constructor(private readonly view: () => EditorView, private readonly scroll: HTMLElement) {
    this.el = document.createElement('aside');
    this.el.className = 'outline';
    this.el.setAttribute('aria-label', 'Outline');
    this.el.innerHTML = '<div class="ol-h">Outline</div><nav class="ol-list"></nav><dl class="stats"></dl>';
    this.list = this.el.querySelector('.ol-list')!;
    this.stats = this.el.querySelector('.stats')!;
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.ol-i');
      if (!b) return;
      const dom = this.view().nodeDOM(this.headings[Number(b.dataset.i)]!);
      if (dom instanceof HTMLElement) {
        const top = this.scroll.scrollTop + dom.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - 16;
        this.scroll.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
    scroll.addEventListener('scroll', () => this.highlight(), { passive: true });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
    if (v) this.render(this.view().state.doc);
  }

  render(doc: PmNode): void {
    if (this.el.hidden) return;
    this.headings = [];
    const items: string[] = [];
    doc.forEach((node, offset) => {
      if (node.type.name !== 'heading') return;
      const level = Math.min(3, node.attrs.level as number);
      items.push(`<button type="button" class="ol-i l${level}" data-i="${this.headings.length}">${esc(node.textContent.trim() || 'Untitled')}</button>`);
      this.headings.push(offset);
    });
    this.list.innerHTML = items.join('') || '<p class="ol-empty">Add a heading to see it here.</p>';
    const s = docStats(doc);
    this.stats.innerHTML = `<dt>Words</dt><dd>${s.words}</dd><dt>Reading time</dt><dd>${s.minutes} min</dd>${
      s.tasks ? `<dt>Tasks done</dt><dd>${s.done} of ${s.tasks}</dd><div class="bar"><i style="width:${(s.done / s.tasks) * 100}%"></i></div>` : ''
    }`;
    this.highlight();
  }

  private highlight(): void {
    if (this.el.hidden) return;
    const view = this.view();
    const top = this.scroll.getBoundingClientRect().top + 70;
    let current = 0;
    this.headings.forEach((pos, i) => {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement && dom.getBoundingClientRect().top <= top) current = i;
    });
    this.list.querySelectorAll('.ol-i').forEach((b, i) => b.classList.toggle('on', i === current));
  }
}
