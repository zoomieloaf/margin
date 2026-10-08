import { describe, expect, it } from 'vitest';
import type { Paragraph, RootContent } from 'mdast';
import { commit, insertBlock, moveBlock, removeBlock, updateBlock } from '../../src/md/ops';
import { parseMarkdown } from '../../src/md/parse';
import { writeMarkdown } from '../../src/md/write';

const para = (value: string): Paragraph => ({ type: 'paragraph', children: [{ type: 'text', value }] });
const idOf = (src: string, i: number) => parseMarkdown(src).blocks[i]!.id;

describe('writeMarkdown', () => {
  it('reproduces an untouched document exactly', () => {
    const src = '# T\n\n\n* a\n\n_b_\n';
    expect(writeMarkdown(parseMarkdown(src))).toBe(src);
  });
});

describe('updateBlock', () => {
  it('is a no-op when content is structurally unchanged', () => {
    const doc = parseMarkdown('A  *b*\n');
    const b = doc.blocks[0]!;
    const next = updateBlock(doc, b.id, structuredClone(b.data));
    expect(next.blocks[0]!.dirty).toBe(false);
    expect(writeMarkdown(next)).toBe('A  *b*\n');
  });

  it('is a no-op for an indented code block given without lang/meta', () => {
    const src = 'Intro\n\n    x\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[1]!.id, { type: 'code', value: 'x' } as RootContent);
    expect(next.blocks[1]!.dirty).toBe(false);
    expect(writeMarkdown(next)).toBe(src);
  });

  it('is a no-op when the data differs structurally but serializes to the original', () => {
    const src = '# T\n';
    const doc = parseMarkdown(src);
    const b = doc.blocks[0]!;
    const next = updateBlock(doc, b.id, { ...structuredClone(b.data), data: { editorId: 'x' } } as RootContent);
    expect(next.blocks[0]!.dirty).toBe(false);
    expect(writeMarkdown(next)).toBe(src);
  });

  it('is dirty after a real text change', () => {
    const doc = parseMarkdown('A\n');
    expect(updateBlock(doc, doc.blocks[0]!.id, para('B')).blocks[0]!.dirty).toBe(true);
  });

  it('rewrites only the edited block and keeps odd gaps', () => {
    const src = 'First  para.\n\n\n\nSecond\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[1]!.id, para('Second edited'));
    expect(writeMarkdown(next)).toBe('First  para.\n\n\n\nSecond edited\n');
  });

  it('keeps the style of untouched blocks', () => {
    const src = '* a\n\n_b_ and __c__\n\nPara\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[2]!.id, para('Para 2'));
    expect(writeMarkdown(next)).toBe('* a\n\n_b_ and __c__\n\nPara 2\n');
  });

  it('leaves frontmatter, HTML and footnotes byte-identical (raw neighbours untouched)', () => {
    const src = '---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nPara[^1]\n\n[^1]:   Spaced   note.\n';
    const doc = parseMarkdown(src);
    const p = doc.blocks.find((b) => b.kind === 'paragraph')!;
    const next = updateBlock(doc, p.id, para('Edited'));
    expect(writeMarkdown(next)).toBe('---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nEdited\n\n[^1]:   Spaced   note.\n');
  });
});

describe('insertBlock', () => {
  it('appends after the last block', () => {
    expect(writeMarkdown(insertBlock(parseMarkdown('A\n'), 1, para('B'), 'n1'))).toBe('A\n\nB\n');
  });

  it('inserts before the first block and keeps the leading gap', () => {
    expect(writeMarkdown(insertBlock(parseMarkdown('# T\n'), 0, para('Intro'), 'n1'))).toBe('Intro\n\n# T\n');
  });

  it('adds a final newline when inserting into an empty file', () => {
    expect(writeMarkdown(insertBlock(parseMarkdown(''), 0, para('X'), 'n1'))).toBe('X\n');
  });

  it('does not add a final newline the file never had', () => {
    expect(writeMarkdown(insertBlock(parseMarkdown('A'), 1, para('B'), 'n1'))).toBe('A\n\nB');
  });

  it('uses CRLF in CRLF files (insert into CRLF file)', () => {
    expect(writeMarkdown(insertBlock(parseMarkdown('A\r\n'), 1, para('B'), 'n1'))).toBe('A\r\n\r\nB\r\n');
  });

  it('marks new blocks dirty with no original', () => {
    const b = insertBlock(parseMarkdown('A\n'), 1, para('B'), 'n1').blocks[1]!;
    expect(b).toMatchObject({ id: 'n1', kind: 'paragraph', original: null, originalKey: null, dirty: true });
  });
});

describe('removeBlock', () => {
  it('removes a middle block', () => {
    const src = 'A\n\nB\n\nC\n';
    expect(writeMarkdown(removeBlock(parseMarkdown(src), idOf(src, 1)))).toBe('A\n\nC\n');
  });

  it('removes the first block and keeps the file-leading gap', () => {
    const src = '\nA\n\nB\n';
    expect(writeMarkdown(removeBlock(parseMarkdown(src), idOf(src, 0)))).toBe('\nB\n');
  });

  it('removes the last block', () => {
    const src = 'A\n\nB\n';
    expect(writeMarkdown(removeBlock(parseMarkdown(src), idOf(src, 1)))).toBe('A\n');
  });
});

describe('moveBlock', () => {
  it('moves a block to the top', () => {
    const src = 'A\n\nB\n\nC\n';
    expect(writeMarkdown(moveBlock(parseMarkdown(src), idOf(src, 2), 0))).toBe('C\n\nA\n\nB\n');
  });

  it('keeps the moved block byte-identical', () => {
    const src = 'A\n\n+ x\n';
    const doc = parseMarkdown(src);
    const moved = moveBlock(doc, doc.blocks[1]!.id, 0);
    expect(writeMarkdown(moved)).toBe('+ x\n\nA\n');
    expect(moved.blocks[0]!.dirty).toBe(false);
  });

  it('does not mutate the input document', () => {
    const doc = parseMarkdown('A\n\nB\n');
    const before = JSON.stringify(doc);
    moveBlock(doc, doc.blocks[1]!.id, 0);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('commit', () => {
  it('turns dirty blocks into clean originals without changing output', () => {
    const doc = parseMarkdown('A\n\nB\n');
    const edited = insertBlock(updateBlock(doc, doc.blocks[1]!.id, para('B2')), 2, para('C'), 'n1');
    const text = writeMarkdown(edited);
    const done = commit(edited);
    expect(done.blocks.every((b) => !b.dirty && b.original !== null && b.originalKey !== null)).toBe(true);
    expect(writeMarkdown(done)).toBe(text);
    expect(updateBlock(done, 'n1', para('C')).blocks[2]!.dirty).toBe(false);
  });
});
