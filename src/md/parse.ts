import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import type { Root, RootContent, Table } from 'mdast';
import { detectConventions } from './conventions';
import { liftCallouts } from './callout';
import { liftHighlights } from './highlight';
import { createIdGenerator } from './ids';
import { nodeKey } from './key';
import type { BlockKind, MdDocument, SourceBlock } from './types';

export function parseTree(src: string): Root {
  const tree = fromMarkdown(src, {
    extensions: [gfm(), frontmatter(['yaml']), math({ singleDollarTextMath: false })],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml']), mathFromMarkdown()],
  });
  liftCallouts(tree);
  liftHighlights(tree, src);
  return tree;
}

/** A table whose rows differ in cell count cannot be re-serialized faithfully (it would be padded), so it stays raw. */
function isRectangular(table: Table): boolean {
  const width = table.children[0]?.children.length ?? 0;
  return table.children.every((row) => row.children.length === width);
}

export function kindOf(node: RootContent): BlockKind {
  switch (node.type) {
    case 'paragraph': return 'paragraph';
    case 'heading': return 'heading';
    case 'list': return 'list';
    case 'blockquote': return 'quote';
    case 'callout': return 'callout';
    case 'code': return 'code';
    case 'table': return isRectangular(node) ? 'table' : 'raw';
    case 'thematicBreak': return 'divider';
    case 'math': return 'raw'; // display math is kept verbatim
    default: return 'raw';
  }
}

export function parseMarkdown(text: string, nextId: () => string = createIdGenerator()): MdDocument {
  const bom = text.charCodeAt(0) === 0xfeff;
  const src = bom ? text.slice(1) : text;
  const tree = parseTree(src);
  const blocks: SourceBlock[] = [];
  let cursor = 0;
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < cursor) {
      throw new Error(`Margin: unexpected position for ${node.type} block at offset ${String(start)}`);
    }
    blocks.push({
      id: nextId(),
      kind: kindOf(node),
      original: src.slice(start, end),
      originalKey: nodeKey(node),
      gapBefore: src.slice(cursor, start),
      data: node,
      dirty: false,
    });
    cursor = end;
  }
  return { bom, blocks, trailing: src.slice(cursor), conventions: detectConventions(src, tree) };
}
