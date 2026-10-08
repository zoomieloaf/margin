import { TextSelection } from 'prosemirror-state';
import {
  deleteTopBlock, duplicateTopBlock, moveTopBlock, selectTopBlockStart, setBlock, tableAction, type BlockType, type TableActionId,
} from '../editor/commands';
import { schema } from '../editor/schema';
import type { AppApi } from './api';
import { blockMenuGroups, TABLE_ACTIONS } from './catalog';
import { icon } from './icons';

/** `+` and `⋮⋮` handles beside the hovered top-level block: add below, drag to move, click for options. */
export class Handles {
  private readonly gutter: HTMLDivElement;
  private readonly dropLine: HTMLDivElement;
  private readonly grip: HTMLButtonElement;
  private index = -1;
  private drag: { from: number; y0: number; moved: boolean; to: number } | null = null;

  constructor(private readonly app: AppApi, private readonly scroll: HTMLElement, private readonly wrap: HTMLElement) {
    this.gutter = document.createElement('div');
    this.gutter.className = 'gutter';
    this.gutter.hidden = true;
    this.gutter.innerHTML = `
      <button type="button" class="g-add" data-tip="Add a block below" aria-label="Add a block below">${icon('plus')}</button>
      <button type="button" class="g-grip" data-tip="Drag to move · click for options" aria-label="Block options">${icon('grip')}</button>`;
    this.dropLine = document.createElement('div');
    this.dropLine.className = 'dropline';
    this.dropLine.hidden = true;
    wrap.append(this.gutter, this.dropLine);
    this.grip = this.gutter.querySelector('.g-grip')!;

    this.gutter.addEventListener('mousedown', (e) => e.preventDefault());
    this.gutter.querySelector('.g-add')!.addEventListener('click', () => this.addBelow());
    scroll.addEventListener('mousemove', (e) => this.hover(e));
    scroll.addEventListener('mouseleave', () => {
      if (!this.drag) this.hide();
    });
    this.grip.addEventListener('pointerdown', (e) => this.dragStart(e));
    this.grip.addEventListener('pointermove', (e) => this.dragMove(e));
    this.grip.addEventListener('pointerup', () => this.dragEnd());
  }

  hide(): void {
    this.gutter.hidden = true;
    this.index = -1;
  }

  /** DOM of each top-level block, in order. */
  private blocks(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const view = this.app.view;
    let pos = 0;
    view.state.doc.forEach((node) => {
      const dom = view.nodeDOM(pos);
      if (dom instanceof HTMLElement) out.push(dom);
      pos += node.nodeSize;
    });
    return out;
  }

  private hover(e: MouseEvent): void {
    if (this.app.mode !== 'edit' || this.drag || this.gutter.contains(e.target as Node)) return;
    const blocks = this.blocks();
    const i = blocks.findIndex((dom) => {
      const r = dom.getBoundingClientRect();
      return e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
    });
    if (i < 0) return;
    if (i === this.index && !this.gutter.hidden) return;
    this.index = i;
    const dom = blocks[i]!;
    const wrapRect = this.wrap.getBoundingClientRect();
    const r = dom.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(dom).lineHeight) || 26;
    const pad = dom.tagName === 'PRE' || dom.classList.contains('callout') ? 10 : 0;
    this.gutter.style.top = `${r.top - wrapRect.top + pad + (Math.min(line, 44) - 24) / 2}px`;
    this.gutter.style.left = `${r.left - wrapRect.left - 50}px`;
    this.gutter.hidden = false;
  }

  private addBelow(): void {
    if (this.index < 0) return;
    const view = this.app.view;
    let pos = 0;
    for (let k = 0; k <= this.index; k++) pos += view.state.doc.child(k).nodeSize;
    const tr = view.state.tr.insert(pos, schema.nodes.paragraph!.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    view.dispatch(tr);
    view.focus();
    this.hide();
    // Typing "/" through the input path opens the slash menu just like the keyboard does.
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, '/', () => view.state.tr.insertText('/', from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText('/', from, to));
  }

  private dragStart(e: PointerEvent): void {
    if (this.index < 0) return;
    e.preventDefault();
    this.drag = { from: this.index, y0: e.clientY, moved: false, to: this.index };
    this.grip.setPointerCapture(e.pointerId);
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    const blocks = this.blocks();
    blocks[d.from]?.classList.add('dragging');
    let to = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        to = i;
        break;
      }
    }
    d.to = to;
    const wrapRect = this.wrap.getBoundingClientRect();
    const ref = blocks[Math.min(to, blocks.length - 1)]!.getBoundingClientRect();
    const y = to < blocks.length ? ref.top - 4 : ref.bottom + 4;
    this.dropLine.style.top = `${y - wrapRect.top}px`;
    this.dropLine.style.left = `${ref.left - wrapRect.left}px`;
    this.dropLine.style.width = `${ref.width}px`;
    this.dropLine.hidden = false;
    const sr = this.scroll.getBoundingClientRect();
    if (e.clientY < sr.top + 40) this.scroll.scrollTop -= 12;
    else if (e.clientY > sr.bottom - 40) this.scroll.scrollTop += 12;
  }

  private dragEnd(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dropLine.hidden = true;
    this.blocks().forEach((b) => b.classList.remove('dragging'));
    if (d.moved) {
      if (d.to !== d.from && d.to !== d.from + 1) moveTopBlock(this.app.view, d.from, d.to);
      this.hide();
    } else {
      this.openMenu(d.from);
    }
  }

  private openMenu(index: number): void {
    const view = this.app.view;
    const r = this.grip.getBoundingClientRect();
    this.app.menu.open(
      { left: r.left, top: r.top, bottom: r.bottom },
      blockMenuGroups(view.state.doc.child(index).type.name),
      (id) => {
        if (TABLE_ACTIONS.some((a) => a.id === id)) tableAction(view, index, id as TableActionId);
        else if (id === 'dup') duplicateTopBlock(view, index);
        else if (id === 'up') moveTopBlock(view, index, index - 1);
        else if (id === 'down') moveTopBlock(view, index, index + 2);
        else if (id === 'del') deleteTopBlock(view, index);
        else {
          selectTopBlockStart(view, index);
          setBlock(view, id as BlockType);
        }
        view.focus();
        this.hide();
      },
      { anchor: this.grip },
    );
  }
}
