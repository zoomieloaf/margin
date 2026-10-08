import { describe, expect, it } from 'vitest';
import type { Paragraph } from 'mdast';
import { updateBlock } from '../../src/md/ops';
import { parseMarkdown } from '../../src/md/parse';
import { writeMarkdown } from '../../src/md/write';
import type { MdDocument } from '../../src/md/types';

const join = (d: MdDocument) =>
  (d.bom ? '﻿' : '') + d.blocks.map((b) => b.gapBefore + b.original).join('') + d.trailing;

describe('parseMarkdown', () => {
  it('splits top-level blocks and assigns kinds', () => {
    const src = '# Title\n\nPara one.\n\n- a\n- b\n\n```js\nx\n```\n\n***\n\n| a |\n| - |\n| 1 |\n\n> quote\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'code', 'divider', 'table', 'quote']);
    expect(join(doc)).toBe(src);
  });

  it('keeps exact gaps and trailing text', () => {
    const src = '\n\n# A\n\n\nB  \n\n\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks[0]!.gapBefore).toBe('\n\n');
    expect(doc.blocks[0]!.original).toBe('# A');
    expect(doc.blocks[1]!.original!.startsWith('B')).toBe(true);
    expect(join(doc)).toBe(src);
  });

  it('handles CRLF offsets exactly', () => {
    const src = 'a\r\n\r\n- x\r\n- y\r\n\r\nb\r\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks[1]!.gapBefore).toBe('\r\n\r\n');
    expect(doc.blocks[1]!.original).toBe('- x\r\n- y');
    expect(join(doc)).toBe(src);
  });

  it('strips a BOM into doc.bom (BOM)', () => {
    const src = '﻿# T\n';
    const doc = parseMarkdown(src);
    expect(doc.bom).toBe(true);
    expect(doc.blocks[0]!.original).toBe('# T');
    expect(doc.blocks[0]!.gapBefore).toBe('');
    expect(join(doc)).toBe(src);
  });

  it('handles empty and whitespace-only files', () => {
    expect(parseMarkdown('').blocks).toEqual([]);
    expect(parseMarkdown('').trailing).toBe('');
    const ws = parseMarkdown('\n\n');
    expect(ws.blocks).toEqual([]);
    expect(ws.trailing).toBe('\n\n');
  });

  it('marks unsupported constructs as raw', () => {
    const src = '---\ntitle: x\n---\n\n<div>hi</div>\n\n[ref]: https://x.y\n\nText[^1]\n\n[^1]: Note.\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks.map((b) => b.kind)).toEqual(['raw', 'raw', 'raw', 'paragraph', 'raw']);
    expect(join(doc)).toBe(src);
  });

  it('assigns ids from the injected generator and stores a structural key', () => {
    let n = 0;
    const doc = parseMarkdown('A\n\nB\n', () => `id${++n}`);
    expect(doc.blocks.map((b) => b.id)).toEqual(['id1', 'id2']);
    expect(doc.blocks.every((b) => !b.dirty && typeof b.originalKey === 'string')).toBe(true);
    expect(doc.blocks[0]!.originalKey).not.toContain('position');
  });
});

describe('kindOf table rule', () => {
  it('keeps a ragged table (row wider than the header) raw so it is written back verbatim', () => {
    const doc = parseMarkdown('| a | b |\n|---|---|\n| `x|y` | 1 |\n');
    expect(doc.blocks[0]!.kind).toBe('raw');
  });
  it('keeps a rectangular table editable', () => {
    expect(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n').blocks[0]!.kind).toBe('table');
  });
});

describe('math', () => {
  const block = '$$\n\{a\}\\b\n$$';

  it('keeps a $$ block raw and byte-identical when a neighbour is edited', () => {
    const src = `Before\n\n${block}\n\nAfter\n`;
    const doc = parseMarkdown(src);
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'raw', 'paragraph']);
    expect(doc.blocks[1]!.data.type).toBe('math');
    expect(doc.blocks[1]!.original).toBe(block);
    const p: Paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'After 2' }] };
    const out = writeMarkdown(updateBlock(doc, doc.blocks[2]!.id, p));
    expect(out).toBe(`Before\n\n${block}\n\nAfter 2\n`);
  });
});
