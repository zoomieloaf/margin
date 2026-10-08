import type { RootContent } from 'mdast';
import { nodeKey } from './key';
import { kindOf, parseTree } from './parse';
import { serializeBlock } from './serialize';
import type { MdDocument, SourceBlock } from './types';
import { markerOf, renderBlocks } from './write';

const separator = (doc: MdDocument) => doc.conventions.eol + doc.conventions.eol;

/** A block is clean when its data is structurally the parsed original or serializes to exactly the original text. */
function isDirty(b: SourceBlock, data: RootContent, doc: MdDocument): boolean {
  if (b.originalKey === null || b.original === null) return true;
  if (nodeKey(data) === b.originalKey) return false;
  return serializeBlock(data, doc.conventions) !== b.original;
}

export function updateBlock(doc: MdDocument, id: string, data: RootContent): MdDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => (b.id !== id ? b : { ...b, data, kind: kindOf(data), dirty: isDirty(b, data, doc) })),
  };
}

function place(doc: MdDocument, block: SourceBlock, index: number): MdDocument {
  const blocks = doc.blocks.slice();
  let trailing = doc.trailing;
  let placed: SourceBlock;
  if (blocks.length === 0) {
    placed = { ...block, gapBefore: '' };
    if (trailing === '') trailing = doc.conventions.eol;
  } else if (index === 0) {
    const first = blocks[0]!;
    placed = { ...block, gapBefore: first.gapBefore };
    blocks[0] = { ...first, gapBefore: separator(doc) };
  } else {
    placed = { ...block, gapBefore: separator(doc) };
  }
  blocks.splice(index, 0, placed);
  return { ...doc, blocks, trailing };
}

const hasFrontmatter = (doc: MdDocument) => doc.blocks[0]?.data.type === 'yaml';

/** Clamps to [0, length]; a leading frontmatter block always stays first. */
const clamp = (doc: MdDocument, i: number) =>
  Math.max(hasFrontmatter(doc) ? 1 : 0, Math.min(i, doc.blocks.length));

export function insertBlock(doc: MdDocument, index: number, data: RootContent, id: string): MdDocument {
  const block: SourceBlock = {
    id, kind: kindOf(data), original: null, originalKey: null, gapBefore: '', data, dirty: true,
  };
  return place(doc, block, clamp(doc, index));
}

export function removeBlock(doc: MdDocument, id: string): MdDocument {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return doc;
  const blocks = doc.blocks.slice();
  const [gone] = blocks.splice(i, 1);
  if (i === 0 && blocks.length) blocks[0] = { ...blocks[0]!, gapBefore: gone!.gapBefore };
  return guardListMerge({ ...doc, blocks }, i);
}

const untouchedList = (b: SourceBlock | undefined): b is SourceBlock =>
  b !== undefined && b.data.type === 'list' && !b.dirty && b.original !== null;

/**
 * Two untouched lists of the same kind and marker that become neighbours (after a removal or
 * a move) would merge into one list on re-parse. Marking the later one dirty lets the writer
 * give it a different marker.
 */
function guardListMerge(doc: MdDocument, ...indices: number[]): MdDocument {
  let blocks = doc.blocks;
  for (const i of indices) {
    const prev = blocks[i - 1];
    const cur = blocks[i];
    if (!untouchedList(prev) || !untouchedList(cur)) continue;
    const sameKind = (prev.data as { ordered?: boolean | null }).ordered === (cur.data as { ordered?: boolean | null }).ordered;
    if (!sameKind || markerOf(prev.original!) !== markerOf(cur.original!)) continue;
    blocks = blocks.slice();
    blocks[i] = { ...cur, dirty: true };
  }
  return blocks === doc.blocks ? doc : { ...doc, blocks };
}

export function moveBlock(doc: MdDocument, id: string, toIndex: number): MdDocument {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return doc;
  if (i === 0 && hasFrontmatter(doc)) return doc;
  const without = removeBlock(doc, id);
  const to = clamp(without, toIndex);
  return guardListMerge(place(without, doc.blocks[i]!, to), to, to + 1);
}

type MdNode = { type: string; children?: MdNode[]; checked?: boolean | null; position?: { start: { offset?: number }; end: { offset?: number } } };

/** The node at `path` (child indices) below `node`, if it is a list item. */
function itemAt(node: MdNode | undefined, path: number[]): MdNode | null {
  let cur = node;
  for (const i of path) cur = cur?.children?.[i];
  return cur?.type === 'listItem' ? cur : null;
}

/**
 * Ticks or unticks the task item at `path` inside block `id` by changing the one character
 * between its brackets in the block's source, so a checkbox click never rewrites the rest of
 * the list (numbering, indents, marker spacing, escaping). Returns null when that can't be
 * done (no source, the block was edited, no such task item); the caller then updates the
 * block's data the ordinary way.
 */
export function toggleTask(doc: MdDocument, id: string, path: number[]): MdDocument | null {
  const index = doc.blocks.findIndex((b) => b.id === id);
  const block = doc.blocks[index];
  if (!block || block.dirty || block.original === null) return null;
  const data = structuredClone(block.data) as MdNode;
  const item = itemAt(data, path);
  if (!item || typeof item.checked !== 'boolean') return null;
  // Positions come from parsing the block's own source; the list structure doesn't depend on context.
  const parsed = itemAt(parseTree(block.original).children[0] as MdNode | undefined, path);
  const start = parsed?.position?.start.offset;
  const end = parsed?.children?.[0]?.position?.start.offset ?? parsed?.position?.end.offset;
  if (!parsed || parsed.checked !== item.checked || start === undefined || end === undefined) return null;
  const box = /\[([ xX])\]/.exec(block.original.slice(start, end));
  if (!box) return null;
  const at = start + box.index + 1;
  const original = block.original.slice(0, at) + (item.checked ? ' ' : 'x') + block.original.slice(at + 1);
  item.checked = !item.checked;
  const blocks = doc.blocks.slice();
  blocks[index] = { ...block, original, data: data as RootContent, originalKey: nodeKey(data) };
  return { ...doc, blocks };
}

/** Makes the written text the new baseline: originals, keys and gaps become exactly what writeMarkdown emits. */
export function commit(doc: MdDocument): MdDocument {
  const rendered = renderBlocks(doc);
  return {
    ...doc,
    blocks: doc.blocks.map((b, i) => {
      const r = rendered[i]!;
      if (b.dirty || b.original === null) {
        return { ...b, gapBefore: r.gap, original: r.text, originalKey: nodeKey(b.data), dirty: false };
      }
      return r.gap === b.gapBefore ? b : { ...b, gapBefore: r.gap };
    }),
  };
}
