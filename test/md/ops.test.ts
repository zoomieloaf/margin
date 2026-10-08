import { describe, expect, it } from 'vitest';
import type { List, Paragraph, RootContent } from 'mdast';
import { commit, insertBlock, moveBlock, removeBlock, updateBlock } from '../../src/md/ops';
import { parseMarkdown } from '../../src/md/parse';
import { writeMarkdown } from '../../src/md/write';
import { expectReparseStable } from './helpers';

const para = (value: string): Paragraph => ({ type: 'paragraph', children: [{ type: 'text', value }] });
const list = (ordered: boolean, ...items: string[]): List => ({
  type: 'list',
  ordered,
  start: ordered ? 1 : null,
  spread: false,
  children: items.map((v) => ({ type: 'listItem', spread: false, checked: null, children: [para(v)] })),
});
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
    expectReparseStable(next);
  });

  it('is a no-op for an indented code block given without lang/meta', () => {
    const src = 'Intro\n\n    x\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[1]!.id, { type: 'code', value: 'x' } as RootContent);
    expect(next.blocks[1]!.dirty).toBe(false);
    expect(writeMarkdown(next)).toBe(src);
    expectReparseStable(next);
  });

  it('is a no-op when the data differs structurally but serializes to the original', () => {
    // Not re-parse checked: the extra mdast `data` field is editor-side and never reaches Markdown.
    const src = '# T\n';
    const doc = parseMarkdown(src);
    const b = doc.blocks[0]!;
    const next = updateBlock(doc, b.id, { ...structuredClone(b.data), data: { editorId: 'x' } } as RootContent);
    expect(next.blocks[0]!.dirty).toBe(false);
    expect(writeMarkdown(next)).toBe(src);
  });

  it('is dirty after a real text change', () => {
    const doc = parseMarkdown('A\n');
    const next = updateBlock(doc, doc.blocks[0]!.id, para('B'));
    expect(next.blocks[0]!.dirty).toBe(true);
    expectReparseStable(next);
  });

  it('rewrites only the edited block and keeps odd gaps', () => {
    const src = 'First  para.\n\n\n\nSecond\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[1]!.id, para('Second edited'));
    expect(writeMarkdown(next)).toBe('First  para.\n\n\n\nSecond edited\n');
    expectReparseStable(next);
  });

  it('keeps the style of untouched blocks', () => {
    const src = '* a\n\n_b_ and __c__\n\nPara\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[2]!.id, para('Para 2'));
    expect(writeMarkdown(next)).toBe('* a\n\n_b_ and __c__\n\nPara 2\n');
    expectReparseStable(next);
  });

  it('leaves frontmatter, HTML and footnotes byte-identical (raw neighbours untouched)', () => {
    const src = '---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nPara[^1]\n\n[^1]:   Spaced   note.\n';
    const doc = parseMarkdown(src);
    const p = doc.blocks.find((b) => b.kind === 'paragraph')!;
    const next = updateBlock(doc, p.id, para('Edited'));
    expect(writeMarkdown(next)).toBe('---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nEdited\n\n[^1]:   Spaced   note.\n');
    expectReparseStable(next);
  });

  it('separates an edited block from a neighbour joined by a single newline', () => {
    const src = 'Para\n- x\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'list']);
    const next = updateBlock(doc, doc.blocks[1]!.id, para('y'));
    expect(writeMarkdown(next)).toBe('Para\n\ny\n');
    expectReparseStable(next);
  });

  it('keeps single-newline gaps between untouched blocks', () => {
    const src = '# T\nPara\n\nLast\n';
    const doc = parseMarkdown(src);
    const next = updateBlock(doc, doc.blocks[2]!.id, para('Last 2'));
    expect(writeMarkdown(next)).toBe('# T\nPara\n\nLast 2\n');
    expectReparseStable(next);
  });

  it('writes an edited list with the other bullet when it touches a same-bullet list', () => {
    const src = '- a\n\n* b\n';
    const doc = parseMarkdown(src);
    expect(doc.blocks.length).toBe(2);
    const next = updateBlock(doc, doc.blocks[1]!.id, list(false, 'b2'));
    expect(writeMarkdown(next)).toBe('- a\n\n* b2\n');
    expectReparseStable(next);
  });
});

describe('insertBlock', () => {
  it('appends after the last block', () => {
    const next = insertBlock(parseMarkdown('A\n'), 1, para('B'), 'n1');
    expect(writeMarkdown(next)).toBe('A\n\nB\n');
    expectReparseStable(next);
  });

  it('inserts before the first block and keeps the leading gap', () => {
    const next = insertBlock(parseMarkdown('# T\n'), 0, para('Intro'), 'n1');
    expect(writeMarkdown(next)).toBe('Intro\n\n# T\n');
    expectReparseStable(next);
  });

  it('adds a final newline when inserting into an empty file', () => {
    const next = insertBlock(parseMarkdown(''), 0, para('X'), 'n1');
    expect(writeMarkdown(next)).toBe('X\n');
    expectReparseStable(next);
  });

  it('does not add a final newline the file never had', () => {
    const next = insertBlock(parseMarkdown('A'), 1, para('B'), 'n1');
    expect(writeMarkdown(next)).toBe('A\n\nB');
    expectReparseStable(next);
  });

  it('uses CRLF in CRLF files (insert into CRLF file)', () => {
    const next = insertBlock(parseMarkdown('A\r\n'), 1, para('B'), 'n1');
    expect(writeMarkdown(next)).toBe('A\r\n\r\nB\r\n');
    expectReparseStable(next);
  });

  it('marks new blocks dirty with no original', () => {
    const next = insertBlock(parseMarkdown('A\n'), 1, para('B'), 'n1');
    const b = next.blocks[1]!;
    expect(b).toMatchObject({ id: 'n1', kind: 'paragraph', original: null, originalKey: null, dirty: true });
    expectReparseStable(next);
  });

  it('keeps a new list separate from a same-bullet list', () => {
    const next = insertBlock(parseMarkdown('- a\n'), 1, list(false, 'b'), 'n1');
    expect(writeMarkdown(next)).toBe('- a\n\n* b\n');
    expectReparseStable(next);
  });

  it('keeps a new list separate from a following same-bullet list', () => {
    const next = insertBlock(parseMarkdown('- a\n'), 0, list(false, 'b'), 'n1');
    expect(writeMarkdown(next)).toBe('* b\n\n- a\n');
    expectReparseStable(next);
  });

  it('picks a bullet free on both sides between two lists', () => {
    const next = insertBlock(parseMarkdown('- a\n\n* c\n'), 1, list(false, 'b'), 'n1');
    expect(writeMarkdown(next)).toBe('- a\n\n+ b\n\n* c\n');
    expectReparseStable(next);
  });

  it('keeps a new ordered list separate by switching the delimiter', () => {
    const next = insertBlock(parseMarkdown('1. a\n'), 1, list(true, 'b'), 'n1');
    expect(writeMarkdown(next)).toBe('1. a\n\n1) b\n');
    expectReparseStable(next);
  });

  it('two new same-bullet lists side by side stay separate', () => {
    const doc = insertBlock(insertBlock(parseMarkdown('A\n'), 1, list(false, 'x'), 'n1'), 2, list(false, 'y'), 'n2');
    expect(writeMarkdown(doc)).toBe('A\n\n- x\n\n* y\n');
    expectReparseStable(doc);
  });

  it('never inserts before leading frontmatter', () => {
    const next = insertBlock(parseMarkdown('---\nt: 1\n---\n\n# T\n'), 0, para('Intro'), 'n1');
    expect(writeMarkdown(next)).toBe('---\nt: 1\n---\n\nIntro\n\n# T\n');
    expect(next.blocks[1]!.id).toBe('n1');
    expectReparseStable(next);
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
    const moved = moveBlock(parseMarkdown(src), idOf(src, 2), 0);
    expect(writeMarkdown(moved)).toBe('C\n\nA\n\nB\n');
    expectReparseStable(moved);
  });

  it('keeps the moved block byte-identical', () => {
    const src = 'A\n\n+ x\n';
    const doc = parseMarkdown(src);
    const moved = moveBlock(doc, doc.blocks[1]!.id, 0);
    expect(writeMarkdown(moved)).toBe('+ x\n\nA\n');
    expect(moved.blocks[0]!.dirty).toBe(false);
    expectReparseStable(moved);
  });

  it('does not mutate the input document', () => {
    const doc = parseMarkdown('A\n\nB\n');
    const before = JSON.stringify(doc);
    const moved = moveBlock(doc, doc.blocks[1]!.id, 0);
    expect(JSON.stringify(doc)).toBe(before);
    expectReparseStable(moved);
  });

  it('never moves a block before leading frontmatter', () => {
    const src = '---\nt: 1\n---\n\nA\n\nB\n';
    const moved = moveBlock(parseMarkdown(src), idOf(src, 2), 0);
    expect(writeMarkdown(moved)).toBe('---\nt: 1\n---\n\nB\n\nA\n');
    expectReparseStable(moved);
  });

  it('keeps leading frontmatter in place when asked to move it', () => {
    const src = '---\nt: 1\n---\n\nA\n\nB\n';
    const moved = moveBlock(parseMarkdown(src), idOf(src, 0), 2);
    expect(writeMarkdown(moved)).toBe(src);
    expectReparseStable(moved);
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
    expectReparseStable(edited);
    expectReparseStable(done);
  });

  it('keeps widened gaps and switched bullets after commit', () => {
    const doc = parseMarkdown('Para\n- x\n');
    const edited = insertBlock(updateBlock(doc, doc.blocks[1]!.id, list(false, 'y')), 2, list(false, 'z'), 'n1');
    const text = writeMarkdown(edited);
    expect(text).toBe('Para\n\n- y\n\n* z\n');
    const done = commit(edited);
    expect(writeMarkdown(done)).toBe(text);
    expectReparseStable(done);
  });
});
