// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { nodeKey } from '../../src/md/key';
import { pmToMdast } from '../../src/webview/editor/convert';
import {
  activeState, currentLink, deleteTopBlock, duplicateTopBlock, insertBlock, moveTopBlock, setBlock, setLink, tableAction, tableEnter,
  tableTabAddRow, toggleInline, toggleTask, type Ctx,
} from '../../src/webview/editor/commands';
import { uniqueIds } from '../../src/webview/editor/ids';
import { editorKeymaps } from '../../src/webview/editor/keymap';
import { DocModel } from '../../src/webview/editor/model';
import { serializeBlock } from '../../src/md/serialize';
import { DEFAULT_CONVENTIONS } from '../../src/md/conventions';
import { blockMenuGroups } from '../../src/webview/ui/catalog';

function make(md: string) {
  const model = new DocModel(() => {});
  const doc = model.load(md, 1);
  let state = EditorState.create({ doc, plugins: [uniqueIds(model.newId)] });
  const ctx: Ctx = {
    get state() { return state; },
    dispatch: (tr) => { state = state.apply(tr); },
  };
  const select = (from: number, to = from) => ctx.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const md2 = () => {
    const parts: string[] = [];
    state.doc.forEach((node) => parts.push(serializeBlock(pmToMdast(node), DEFAULT_CONVENTIONS)));
    return parts.join('\n\n');
  };
  return { ctx, select, md: md2, get state() { return state; } };
}

describe('inline commands', () => {
  it('bold across two paragraphs bolds only the selected parts', () => {
    const t = make('First paragraph\n\nSecond paragraph\n');
    t.select(7, 25); // "paragraph" in p1 … "Second " in p2
    toggleInline(t.ctx, 'strong');
    expect(t.md()).toBe('First **paragraph**\n\n**Second** paragraph');
  });

  it.each([
    ['em', '*b*'], ['strike', '~~b~~'], ['code', '`b`'], ['mark', '==b=='],
  ] as const)('toggles %s', (name, out) => {
    const t = make('a b c\n');
    t.select(3, 4);
    toggleInline(t.ctx, name);
    expect(t.md()).toBe(`a ${out} c`);
    expect(activeState(t.state).marks.has(name)).toBe(true);
    toggleInline(t.ctx, name);
    expect(t.md()).toBe('a b c');
  });

  it('sets, reads and removes a link', () => {
    const t = make('see docs here\n');
    t.select(5, 9);
    setLink(t.ctx, 'https://x.y');
    expect(t.md()).toBe('see [docs](https://x.y) here');
    t.select(6);
    expect(currentLink(t.state)).toBe('https://x.y');
    setLink(t.ctx, null);
    expect(t.md()).toBe('see docs here');
  });
});

describe('block commands', () => {
  it.each([
    ['h1', '# Text'], ['h2', '## Text'], ['h3', '### Text'], ['code', '```\nText\n```'],
    ['blockquote', '> Text'], ['callout', '> [!NOTE]\n> Text'], ['ul', '- Text'], ['ol', '1. Text'], ['task', '- [ ] Text'],
  ] as const)('turns a paragraph into %s and reports it', (type, out) => {
    const t = make('Text\n');
    t.select(2);
    setBlock(t.ctx, type);
    expect(t.md()).toBe(out);
    expect(activeState(t.state).block).toBe(type);
  });

  it('turns a list item back into a paragraph', () => {
    const t = make('- one\n');
    t.select(4);
    setBlock(t.ctx, 'p');
    expect(t.md()).toBe('one');
  });

  it('switches a bullet list to numbered and to tasks', () => {
    const t = make('- a\n- b\n');
    t.select(4);
    setBlock(t.ctx, 'ol');
    expect(t.md()).toBe('1. a\n2. b');
    setBlock(t.ctx, 'task');
    expect(t.md()).toBe('- [ ] a\n- [ ] b');
    setBlock(t.ctx, 'ul');
    expect(t.md()).toBe('- a\n- b');
  });

  it('toggles a quote off', () => {
    const t = make('> q\n');
    t.select(3);
    setBlock(t.ctx, 'blockquote');
    expect(t.md()).toBe('q');
  });

  it('inserts a table after the current block and selects the first header', () => {
    const t = make('Intro\n');
    t.select(3);
    insertBlock(t.ctx, 'table');
    expect(t.md()).toContain('| Column | Column | Column |');
    expect(t.state.doc.textBetween(t.state.selection.from, t.state.selection.to)).toBe('Column');
    expect(activeState(t.state).inTable).toBe(true);
  });

  it('replaces an empty paragraph with a divider and keeps a paragraph after it', () => {
    const t = make('A\n');
    t.ctx.dispatch(t.state.tr.insert(t.state.doc.content.size, t.state.schema.nodes.paragraph!.create()));
    t.select(t.state.doc.content.size - 1);
    insertBlock(t.ctx, 'hr');
    expect(t.state.doc.child(1).type.name).toBe('horizontal_rule');
    expect(t.state.doc.lastChild!.type.name).toBe('paragraph');
  });

  it('moves, duplicates and deletes top-level blocks', () => {
    const t = make('A\n\nB\n\nC\n');
    moveTopBlock(t.ctx, 2, 0);
    expect(t.md()).toBe('C\n\nA\n\nB');
    duplicateTopBlock(t.ctx, 0);
    expect(t.md()).toBe('C\n\nC\n\nA\n\nB');
    expect(t.state.doc.child(0).attrs.blockId).not.toBe(t.state.doc.child(1).attrs.blockId);
    deleteTopBlock(t.ctx, 3);
    expect(t.md()).toBe('C\n\nC\n\nA');
  });

  it('toggles a task checkbox by position', () => {
    const t = make('- [ ] a\n');
    toggleTask(t.ctx, 1);
    expect(t.md()).toBe('- [x] a');
  });
});

describe('input rules (typing Markdown)', () => {
  function typed(prefix: string) {
    const model = new DocModel(() => {});
    const state = EditorState.create({ doc: model.load('\n', 1), plugins: [uniqueIds(model.newId), ...editorKeymaps({ undo() {}, redo() {}, toggleMode() {}, editLink() {} })] });
    const view = new EditorView(document.createElement('div'), { state });
    for (const ch of prefix) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    const first = view.state.doc.child(0);
    view.destroy();
    return first;
  }

  it.each([
    ['## ', { type: 'heading', depth: 2 }],
    ['- ', { type: 'list', ordered: false }],
    ['3. ', { type: 'list', ordered: true, start: 3 }],
    ['> ', { type: 'blockquote' }],
    ['```ts ', { type: 'code', lang: 'ts' }],
  ])('"%s" converts the line', (prefix, expected) => {
    expect(pmToMdast(typed(prefix))).toMatchObject(expected);
  });

  it('"[] " makes a task', () => {
    const node = typed('[] ');
    expect(node.type.name).toBe('bullet_list');
    expect(node.firstChild!.attrs.checked).toBe(false);
  });

  it('"---" + space makes a divider', () => {
    expect(typed('--- ').type.name).toBe('horizontal_rule');
  });
});

it('a paragraph run through the commands still has a stable key', () => {
  const t = make('Hello\n');
  const before = nodeKey(pmToMdast(t.state.doc.child(0)));
  t.select(2, 4);
  toggleInline(t.ctx, 'strong');
  toggleInline(t.ctx, 'strong');
  expect(nodeKey(pmToMdast(t.state.doc.child(0)))).toBe(before);
});

describe('tables grow from the keyboard and the block menu', () => {
  const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n';
  /** Position inside the text of the cell at (row, col). */
  const cellPos = (state: EditorState, row: number, col: number) => {
    let found = -1;
    let r = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'table_row') {
        r++;
        let c = 0;
        node.forEach((_cell, offset) => {
          if (r === row && c === col) found = pos + 1 + offset + 1;
          c++;
        });
        return false;
      }
      return true;
    });
    return found;
  };
  const cellAt = (state: EditorState) => {
    const $from = state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table_row') return { row: $from.index(d - 1), col: $from.index(d) };
    }
    return null;
  };

  it('Enter moves to the cell below', () => {
    const t = make('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n');
    t.select(cellPos(t.state, 1, 1));
    expect(tableEnter(t.state, t.ctx.dispatch)).toBe(true);
    expect(cellAt(t.state)).toEqual({ row: 2, col: 1 });
    expect(t.md()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
  });

  it('Enter in the last row adds a row and moves into it', () => {
    const t = make(TABLE);
    t.select(cellPos(t.state, 1, 1));
    expect(tableEnter(t.state, t.ctx.dispatch)).toBe(true);
    expect(cellAt(t.state)).toEqual({ row: 2, col: 1 });
    expect(t.md()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |');
  });

  it('Enter outside a table is not handled', () => {
    const t = make('Text\n');
    t.select(2);
    expect(tableEnter(t.state, t.ctx.dispatch)).toBe(false);
  });

  it('Tab in the last cell adds a row and moves to its first cell', () => {
    const t = make(TABLE);
    t.select(cellPos(t.state, 1, 1));
    expect(tableTabAddRow(t.state, t.ctx.dispatch)).toBe(true);
    expect(cellAt(t.state)).toEqual({ row: 2, col: 0 });
    expect(t.md()).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |');
  });

  it('Tab elsewhere in the table is left to the move-to-next-cell command', () => {
    const t = make(TABLE);
    t.select(cellPos(t.state, 1, 0));
    expect(tableTabAddRow(t.state, t.ctx.dispatch)).toBe(false);
  });

  it('the editor keymap binds Enter and Tab in a table to these', () => {
    const model = new DocModel(() => {});
    const state = EditorState.create({ doc: model.load(TABLE, 1), plugins: [uniqueIds(model.newId), ...editorKeymaps({ undo() {}, redo() {}, toggleMode() {}, editLink() {} })] });
    const view = new EditorView(document.createElement('div'), { state });
    const press = (key: string) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key })));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view.state, 1, 1))));
    press('Enter');
    expect(cellAt(view.state)).toEqual({ row: 2, col: 1 });
    press('Tab');
    expect(cellAt(view.state)).toEqual({ row: 3, col: 0 });
    expect(view.state.doc.child(0).childCount).toBe(4);
    view.destroy();
  });

  it.each([
    ['addRowAfter', '| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |'],
    ['addColumnAfter', '| a | b |   |\n| - | - | - |\n| 1 | 2 |   |'],
    ['deleteRow', '| a | b |\n| - | - |'],
    ['deleteColumn', '| a |\n| - |\n| 1 |'],
  ] as const)('block menu: %s (selection outside the table → last row / column)', (action, out) => {
    const t = make(`Intro\n\n${TABLE}`);
    t.select(2);
    expect(tableAction(t.ctx, 1, action)).toBe(true);
    expect(t.md()).toBe(`Intro\n\n${out}`);
  });

  it('block menu actions apply at the cursor when it is in the table', () => {
    const t = make('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n');
    t.select(cellPos(t.state, 1, 0));
    expect(tableAction(t.ctx, 0, 'deleteRow')).toBe(true);
    expect(t.md()).toBe('| a | b |\n| - | - |\n| 3 | 4 |');
  });

  it('the block menu offers the table actions only for tables', () => {
    expect(blockMenuGroups('table').flatMap((g) => g.items.map((i) => i.id))).toEqual(
      expect.arrayContaining(['addRowAfter', 'addColumnAfter', 'deleteRow', 'deleteColumn']),
    );
    expect(blockMenuGroups('paragraph').flatMap((g) => g.items.map((i) => i.id))).not.toContain('addRowAfter');
  });
});
