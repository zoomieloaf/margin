import type { RootContent } from 'mdast';
import { nodeKey } from './key';
import { kindOf } from './parse';
import { serializeBlock } from './serialize';
import type { MdDocument, SourceBlock } from './types';
import { renderBlocks } from './write';

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
  return { ...doc, blocks };
}

export function moveBlock(doc: MdDocument, id: string, toIndex: number): MdDocument {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return doc;
  if (i === 0 && hasFrontmatter(doc)) return doc;
  const without = removeBlock(doc, id);
  return place(without, doc.blocks[i]!, clamp(without, toIndex));
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
