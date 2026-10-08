import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import type { Mark, Node as PmNode, NodeType, ResolvedPos } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { addColumnAfter, addRow, addRowAfter, deleteColumn, deleteRow, isInTable, selectedRect, TableMap } from 'prosemirror-tables';
import { schema } from './schema';

/** Anything that has a current state and can dispatch: an EditorView, or a test harness. */
export interface Ctx {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

export type MarkName = 'strong' | 'em' | 'strike' | 'code' | 'mark';
export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'callout' | 'code' | 'ul' | 'ol' | 'task';
export type InsertKind = 'table' | 'hr' | 'mermaid';

const n = schema.nodes;
const run = (ctx: Ctx, cmd: Command): boolean => cmd(ctx.state, (tr) => ctx.dispatch(tr));

// ---------------------------------------------------------------- inline

export function toggleInline(ctx: Ctx, name: MarkName): boolean {
  if (insideCode(ctx.state)) return false;
  return run(ctx, toggleMark(schema.marks[name]!));
}

/** Range of the link mark around the cursor, or null. */
function linkRange(state: EditorState): { from: number; to: number; mark: Mark } | null {
  const { $from } = state.selection;
  const mark = schema.marks.link!.isInSet($from.marks()) ?? schema.marks.link!.isInSet($from.nodeAfter?.marks ?? []);
  if (!mark) return null;
  const start = $from.start();
  const pos = $from.pos;
  let segStart = -1;
  let found: { from: number; to: number; mark: Mark } | null = null;
  $from.parent.forEach((child, offset) => {
    const a = start + offset;
    const b = a + child.nodeSize;
    if (!mark.isInSet(child.marks)) {
      segStart = -1;
      return;
    }
    if (segStart < 0) segStart = a;
    if (found && found.to === a) found.to = b;
    else if (!found && a <= pos && pos <= b) found = { from: segStart, to: b, mark };
  });
  return found;
}

export function currentLink(state: EditorState): string | null {
  return (linkRange(state)?.mark.attrs.href as string | undefined) ?? null;
}

/** Sets (or with null, removes) a link on the selection, or on the link under the cursor. */
export function setLink(ctx: Ctx, href: string | null): boolean {
  const { state } = ctx;
  let { from, to, empty } = state.selection;
  if (empty) {
    const r = linkRange(state);
    if (!r) return false;
    ({ from, to } = r);
  }
  const tr = state.tr.removeMark(from, to, schema.marks.link);
  if (href) tr.addMark(from, to, schema.marks.link!.create({ href }));
  ctx.dispatch(tr);
  return true;
}

// ---------------------------------------------------------------- blocks

function ancestor($pos: ResolvedPos, types: NodeType[]): { node: PmNode; depth: number } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (types.includes(node.type)) return { node, depth: d };
  }
  return null;
}

const listTypes = [n.bullet_list!, n.ordered_list!];
const insideCode = (state: EditorState) => state.selection.$from.parent.type === n.code_block;

export function blockTypeAt(state: EditorState): BlockType | 'other' {
  const { $from } = state.selection;
  const list = ancestor($from, listTypes);
  if (list) {
    if (list.node.type === n.ordered_list) return 'ol';
    return list.node.firstChild?.attrs.checked != null ? 'task' : 'ul';
  }
  if (ancestor($from, [n.callout!])) return 'callout';
  if (ancestor($from, [n.blockquote!])) return 'blockquote';
  const parent = $from.parent;
  if (parent.type === n.code_block) return 'code';
  if (parent.type === n.heading) {
    const level = parent.attrs.level as number;
    return level <= 3 ? (`h${level}` as BlockType) : 'other';
  }
  if (parent.type === n.paragraph) return 'p';
  return 'other';
}

/** Lifts the cursor's block out of lists, quotes and callouts. */
function unwrapAll(ctx: Ctx): void {
  for (let guard = 0; guard < 20; guard++) {
    const { $from } = ctx.state.selection;
    if (ancestor($from, listTypes)) {
      if (!run(ctx, liftListItem(n.list_item!))) return;
    } else if (ancestor($from, [n.blockquote!, n.callout!])) {
      if (!run(ctx, lift)) return;
    } else return;
  }
}

function setTaskFlags(ctx: Ctx, checked: boolean | null): void {
  const list = ancestor(ctx.state.selection.$from, listTypes);
  if (!list) return;
  const start = ctx.state.selection.$from.before(list.depth);
  const tr = ctx.state.tr;
  list.node.forEach((item, offset) => {
    const value = checked === null ? null : item.attrs.checked ?? checked;
    tr.setNodeMarkup(start + 1 + offset, undefined, { ...item.attrs, checked: value });
  });
  ctx.dispatch(tr);
}

/** Turns the block at the cursor into `type` (toggles off when it already is one, for wrappers). */
export function setBlock(ctx: Ctx, type: BlockType): boolean {
  const current = blockTypeAt(ctx.state);
  switch (type) {
    case 'p':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'code': {
      unwrapAll(ctx);
      const nodeType = type === 'p' ? n.paragraph! : type === 'code' ? n.code_block! : n.heading!;
      const attrs = type.startsWith('h') ? { level: Number(type[1]) } : null;
      return run(ctx, setBlockType(nodeType, attrs));
    }
    case 'blockquote':
    case 'callout': {
      if (current === type) return run(ctx, lift);
      unwrapAll(ctx);
      if (blockTypeAt(ctx.state) !== 'p') run(ctx, setBlockType(n.paragraph!));
      return run(ctx, wrapIn(type === 'callout' ? n.callout! : n.blockquote!, type === 'callout' ? { kind: 'note' } : null));
    }
    case 'ul':
    case 'ol':
    case 'task': {
      if (current === type) {
        unwrapAll(ctx);
        return true;
      }
      const list = ancestor(ctx.state.selection.$from, listTypes);
      if (list) {
        const pos = ctx.state.selection.$from.before(list.depth);
        const target = type === 'ol' ? n.ordered_list! : n.bullet_list!;
        if (list.node.type !== target) {
          ctx.dispatch(ctx.state.tr.setNodeMarkup(pos, target, type === 'ol' ? { ...list.node.attrs, start: 1 } : { spread: list.node.attrs.spread, blockId: list.node.attrs.blockId }));
        }
        setTaskFlags(ctx, type === 'task' ? false : null);
        return true;
      }
      unwrapAll(ctx);
      if (blockTypeAt(ctx.state) !== 'p') run(ctx, setBlockType(n.paragraph!));
      if (!run(ctx, wrapInList(type === 'ol' ? n.ordered_list! : n.bullet_list!))) return false;
      if (type === 'task') setTaskFlags(ctx, false);
      return true;
    }
  }
}

function newBlock(kind: InsertKind): PmNode {
  switch (kind) {
    case 'hr':
      return n.horizontal_rule!.create();
    case 'mermaid':
      return n.code_block!.create({ lang: 'mermaid' }, schema.text('flowchart LR\n  Draft --> Review --> Publish'));
    case 'table': {
      const header = n.table_row!.create(null, [0, 1, 2].map(() => n.table_header!.create(null, schema.text('Column'))));
      const row = () => n.table_row!.create(null, [0, 1, 2].map(() => n.table_cell!.create()));
      return n.table!.create(null, [header, row(), row()]);
    }
  }
}

/** Index of the top-level block containing the selection. */
export function topIndex(state: EditorState): number {
  return state.selection.$from.index(0);
}

/** Inserts a block after the current one, or in place of it when it's an empty paragraph. */
export function insertBlock(ctx: Ctx, kind: InsertKind): boolean {
  const { state } = ctx;
  const i = topIndex(state);
  const current = state.doc.child(i);
  let pos = 0;
  for (let k = 0; k < i; k++) pos += state.doc.child(k).nodeSize;
  const replaceEmpty = current.type === n.paragraph && current.content.size === 0;
  const node = newBlock(kind);
  const at = replaceEmpty ? pos : pos + current.nodeSize;
  const tr = replaceEmpty ? state.tr.replaceWith(pos, pos + current.nodeSize, node) : state.tr.insert(at, node);
  const after = at + node.nodeSize;
  if (after >= tr.doc.content.size || kind === 'hr') {
    if (tr.doc.nodeAt(after)?.type !== n.paragraph) tr.insert(after, n.paragraph!.create());
  }
  if (kind === 'table') tr.setSelection(TextSelection.create(tr.doc, at + 3, at + 3 + 'Column'.length));
  else if (kind === 'hr') tr.setSelection(TextSelection.create(tr.doc, after + 1));
  else tr.setSelection(TextSelection.create(tr.doc, at + node.nodeSize - 1));
  ctx.dispatch(tr.scrollIntoView());
  return true;
}

// ---------------------------------------------------------------- tables

/** Puts the cursor at the end of the cell at (row, col) of the table starting at `tableStart` (inside the table node). */
function selectCell(tr: Transaction, tableStart: number, row: number, col: number): Transaction {
  const table = tr.doc.nodeAt(tableStart - 1)!;
  const cellStart = tableStart + TableMap.get(table).positionAt(row, col, table);
  return tr.setSelection(TextSelection.create(tr.doc, cellStart + 1 + tr.doc.nodeAt(cellStart)!.content.size));
}

/** Enter in a table cell: go to the cell below, adding a row when in the last one. */
export const tableEnter: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (dispatch) {
    const tr = state.tr;
    if (rect.bottom >= rect.map.height) addRow(tr, rect, rect.map.height);
    dispatch(selectCell(tr, rect.tableStart, rect.bottom, rect.left).scrollIntoView());
  }
  return true;
};

/** Tab in the last cell of a table: add a row and go to its first cell. */
export const tableTabAddRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (rect.bottom !== rect.map.height || rect.right !== rect.map.width) return false;
  if (dispatch) {
    const tr = state.tr;
    addRow(tr, rect, rect.map.height);
    dispatch(selectCell(tr, rect.tableStart, rect.map.height, 0).scrollIntoView());
  }
  return true;
};

export type TableActionId = 'addRowAfter' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn';
const TABLE_COMMANDS: Record<TableActionId, Command> = { addRowAfter, addColumnAfter, deleteRow, deleteColumn };

/**
 * A table action from the block menu of top-level block `index`. It applies at the cursor
 * when the cursor is in that table, otherwise at its last cell (new row at the bottom, new
 * column on the right, or the last row / column deleted).
 */
export function tableAction(ctx: Ctx, index: number, action: TableActionId): boolean {
  const { doc, selection } = ctx.state;
  const table = doc.child(index);
  if (table.type !== n.table) return false;
  const start = topPos(doc, index);
  if (!(selection.from > start && selection.to < start + table.nodeSize)) {
    const map = TableMap.get(table);
    const lastCell = start + 1 + map.map[map.map.length - 1]!;
    ctx.dispatch(ctx.state.tr.setSelection(TextSelection.create(doc, lastCell + 1)));
  }
  return run(ctx, TABLE_COMMANDS[action]);
}

// ---------------------------------------------------------------- whole top-level blocks

function topPos(doc: PmNode, index: number): number {
  let pos = 0;
  for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize;
  return pos;
}

export function moveTopBlock(ctx: Ctx, from: number, to: number): boolean {
  const { doc } = ctx.state;
  if (from === to || from < 0 || from >= doc.childCount) return false;
  const node = doc.child(from);
  const start = topPos(doc, from);
  const tr = ctx.state.tr.delete(start, start + node.nodeSize);
  const target = Math.max(0, Math.min(to > from ? to - 1 : to, tr.doc.childCount));
  const at = topPos(tr.doc, target);
  tr.insert(at, node);
  tr.setSelection(NodeSelection.create(tr.doc, at));
  ctx.dispatch(tr.scrollIntoView());
  return true;
}

export function duplicateTopBlock(ctx: Ctx, index: number): boolean {
  const { doc } = ctx.state;
  const node = doc.child(index);
  const at = topPos(doc, index) + node.nodeSize;
  ctx.dispatch(ctx.state.tr.insert(at, node.type.create({ ...node.attrs, blockId: null }, node.content, node.marks)));
  return true;
}

export function deleteTopBlock(ctx: Ctx, index: number): boolean {
  const { doc } = ctx.state;
  const start = topPos(doc, index);
  const tr = ctx.state.tr.delete(start, start + doc.child(index).nodeSize);
  if (tr.doc.childCount === 0) tr.insert(0, n.paragraph!.create());
  ctx.dispatch(tr);
  return true;
}

/** Puts the cursor at the start of top-level block `index` (used before "Turn into" from the block menu). */
export function selectTopBlockStart(ctx: Ctx, index: number): void {
  const pos = topPos(ctx.state.doc, index);
  ctx.dispatch(ctx.state.tr.setSelection(TextSelection.near(ctx.state.doc.resolve(pos + 1))));
}

/**
 * The task item at `pos` as the Markdown model addresses it: the id of its top-level block and
 * the child indices from that block down to the item (the same path in the mdast).
 */
export function taskTarget(state: EditorState, pos: number): { blockId: string; path: number[] } | null {
  const item = state.doc.nodeAt(pos);
  if (!item || item.type !== n.list_item || item.attrs.checked === null) return null;
  const $pos = state.doc.resolve(pos);
  if ($pos.depth < 1) return null;
  const blockId = $pos.node(1).attrs.blockId as string | null;
  if (!blockId) return null;
  const path: number[] = [];
  for (let d = 1; d <= $pos.depth; d++) path.push($pos.index(d));
  return { blockId, path };
}

/**
 * A checkbox click: lets the Markdown model flip the one character in the source and swaps in
 * the block node it returns; falls back to toggleTask() when the model can't.
 */
export function clickTask(ctx: Ctx, pos: number, model: { toggleTask(blockId: string, path: number[]): PmNode | null }): boolean {
  const target = taskTarget(ctx.state, pos);
  const block = target ? model.toggleTask(target.blockId, target.path) : null;
  if (!block) return toggleTask(ctx, pos);
  const start = ctx.state.doc.resolve(pos).before(1);
  const tr = ctx.state.tr.replaceWith(start, start + ctx.state.doc.nodeAt(start)!.nodeSize, block);
  ctx.dispatch(tr);
  return true;
}

/** Flips the checkbox of the list item at `pos` (works in Preview, where the view is read-only). */
export function toggleTask(ctx: Ctx, pos: number): boolean {
  const item = ctx.state.doc.nodeAt(pos);
  if (!item || item.type !== n.list_item || item.attrs.checked === null) return false;
  ctx.dispatch(ctx.state.tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: !item.attrs.checked }));
  return true;
}

// ---------------------------------------------------------------- state for toolbar and bubble

export interface ActiveState {
  marks: Set<MarkName | 'link'>;
  block: BlockType | 'other';
  inCode: boolean;
  inTable: boolean;
}

export function activeState(state: EditorState): ActiveState {
  const marks = new Set<MarkName | 'link'>();
  const { from, to, empty, $from } = state.selection;
  const names: Array<MarkName | 'link'> = ['strong', 'em', 'strike', 'code', 'mark', 'link'];
  for (const name of names) {
    const type = schema.marks[name]!;
    const on = empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
    if (on) marks.add(name);
  }
  return {
    marks,
    block: blockTypeAt(state),
    inCode: $from.parent.type === n.code_block,
    inTable: !!ancestor($from, [n.table!]),
  };
}
