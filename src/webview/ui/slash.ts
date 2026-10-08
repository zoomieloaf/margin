import { Plugin, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { AppApi } from './api';
import { BLOCKS, slashGroups } from './catalog';

/**
 * Typing `/` at the start of a block (or after a space) opens the block menu. The typed text
 * after the slash filters it; picking an item deletes `/query` and applies the block.
 */
export class Slash {
  private pendingAt: number | null = null;
  private start: number | null = null;
  /** Keeps the slash position (mapped through edits) available to the pick callback. */
  private tracker: (() => void) | null = null;

  constructor(private readonly app: AppApi) {}

  get isOpen(): boolean {
    return this.start !== null;
  }

  plugin(): Plugin {
    return new Plugin({
      props: {
        handleTextInput: (view, from, _to, text) => {
          if (text !== '/' || this.app.mode !== 'edit') return false;
          const $from = view.state.doc.resolve(from);
          if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
          if (before === '' || /\s$/.test(before)) this.pendingAt = from;
          return false;
        },
      },
    });
  }

  /** Called by the app for every transaction, before the UI updates. */
  map(tr: Transaction): void {
    if (this.start !== null) this.start = tr.mapping.map(this.start, -1);
    this.tracker?.();
  }

  /** Called after the view updated. Opens, filters or closes the menu. */
  update(view: EditorView): void {
    if (this.pendingAt !== null) {
      const at = this.pendingAt;
      this.pendingAt = null;
      if (view.state.doc.textBetween(at, at + 1) === '/') this.open(view, at);
      return;
    }
    if (this.start === null) return;
    const query = this.query(view);
    if (query === null) this.close();
    else this.app.menu.update(slashGroups(query, this.app.aiEnabled));
  }

  handleKey(e: KeyboardEvent): boolean {
    return this.isOpen && this.app.menu.handleKey(e);
  }

  private query(view: EditorView): string | null {
    const start = this.start!;
    const { head, empty } = view.state.selection;
    if (!empty || head <= start) return null;
    const $start = view.state.doc.resolve(start);
    if (head > $start.end()) return null;
    const text = view.state.doc.textBetween(start, head);
    if (!text.startsWith('/') || /\s/.test(text) || text.length > 21) return null;
    return text.slice(1);
  }

  private open(view: EditorView, at: number): void {
    this.start = at;
    const c = view.coordsAtPos(at + 1);
    // The menu clears this.start when it closes, which happens just before the pick callback.
    let picked: number | null = at;
    const track = () => (picked = this.start ?? picked);
    this.tracker = track;
    this.app.menu.open({ left: c.left, top: c.top, bottom: c.bottom }, slashGroups('', this.app.aiEnabled), (id) => this.pick(id, picked), {
      rich: true,
      highlightFirst: true,
      onClose: () => {
        this.start = null;
      },
    });
  }

  private close(): void {
    this.app.menu.close();
    this.start = null;
  }

  private pick(id: string, start: number | null): void {
    const view = this.app.view;
    this.start = null;
    this.tracker = null;
    if (start !== null) {
      const head = view.state.selection.head;
      if (head > start) view.dispatch(view.state.tr.delete(start, head));
    }
    // `/ai`: Continue writing or Ask AI at the cursor.
    if (id.startsWith('ai:')) return this.app.act('ai-run', undefined, id.slice(3));
    const isBlock = BLOCKS.some((b) => b.id === id);
    this.app.act(isBlock ? 'block' : 'insert', undefined, id);
  }
}
