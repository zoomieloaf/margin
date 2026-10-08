import { describe, expect, it } from 'vitest';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';
import { serializeBlock } from '../../src/md/serialize';

const again = (src: string) => {
  const d = parseMarkdown(src);
  return serializeBlock(d.blocks[0]!.data, d.conventions);
};

describe('serializeBlock', () => {
  it('writes inline formatting with default markers', () => {
    expect(again('**a** and *b*\n')).toBe('**a** and *b*');
  });

  it('follows the file emphasis and strong markers', () => {
    expect(again('_x_ and __y__\n')).toBe('_x_ and __y__');
  });

  it('follows the file bullet marker', () => {
    expect(again('* a\n* b\n')).toBe('* a\n* b');
  });

  it('writes task lists', () => {
    expect(again('- [ ] a\n- [x] b\n')).toBe('- [ ] a\n- [x] b');
  });

  it('writes callouts and highlights', () => {
    expect(again('> [!TIP]\n> Try it.\n')).toBe('> [!TIP]\n> Try it.');
    expect(again('A ==big== deal\n')).toBe('A ==big== deal');
  });

  it('follows the fence marker', () => {
    expect(again('~~~js\nx\n~~~\n')).toBe('~~~js\nx\n~~~');
  });

  it('uses CRLF for CRLF files (CRLF serialize)', () => {
    const out = again('- a\r\n- b\r\n\r\n```\r\nx\r\ny\r\n```\r\n');
    expect(out).toBe('- a\r\n- b');
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('CRLF file with a multi-line fenced code block first has clean line endings', () => {
    const out = again('```\r\nx\r\ny\r\n```\r\n');
    expect(out).toBe('```\r\nx\r\ny\r\n```');
    expect(out.includes('\r\r')).toBe(false);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('CRLF file with a multi-line paragraph first has clean line endings', () => {
    const out = again('first\r\nsecond\r\nthird\r\n\r\n- a\r\n');
    expect(out).toBe('first\r\nsecond\r\nthird');
    expect(out.includes('\r\r')).toBe(false);
    expect(/(?<!\r)\n/.test(out)).toBe(false);
  });

  it('LF file never gets CR from node values', () => {
    const d = parseMarkdown('```\nx\n```\n');
    const node = { type: 'code', lang: null, meta: null, value: 'x\r\ny' } as never;
    expect(serializeBlock(node, d.conventions)).toBe('```\nx\ny\n```');
  });

  it.each([
    '# Heading',
    'Para with **bold**, *em*, ~~del~~, `code`, [link](https://x.y) and ==mark==.',
    '- a\n  - nested\n- b',
    '1. one\n2. two',
    '- [ ] todo\n- [x] done',
    '> quote\n> more',
    '> [!WARNING]\n> Careful.',
    '```ts\nconst x = 1;\n```',
    '| a | b |\n| :- | -: |\n| 1 | 2 |',
    '***',
  ])('re-parses to the same content: %s', (src) => {
    const d = parseMarkdown(src + '\n');
    const b = d.blocks[0]!;
    const re = parseMarkdown(serializeBlock(b.data, d.conventions) + '\n').blocks[0]!;
    expect(nodeKey(re.data)).toBe(nodeKey(b.data));
  });
});
