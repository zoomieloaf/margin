import { describe, expect, it } from 'vitest';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';

describe('nodeKey', () => {
  it('ignores positions and CRLF vs LF in text', () => {
    const lf = parseMarkdown('a\nb\n').blocks[0]!.data;
    const crlf = parseMarkdown('a\r\nb\r\n').blocks[0]!.data;
    expect(nodeKey(crlf)).toBe(nodeKey(lf));
  });

  it('ignores property order', () => {
    expect(nodeKey({ type: 'code', lang: 'js', value: 'x' })).toBe(nodeKey({ value: 'x', lang: 'js', type: 'code' }));
    expect(nodeKey({ type: 'p', children: [{ value: 'a', type: 'text' }] })).toBe(
      nodeKey({ children: [{ type: 'text', value: 'a' }], type: 'p' }),
    );
  });

  it('treats null, undefined and missing properties as the same', () => {
    const parsed = parseMarkdown('    x\n').blocks[0]!.data;
    expect(parsed).toMatchObject({ type: 'code', lang: null, meta: null });
    expect(nodeKey({ type: 'code', value: 'x' })).toBe(nodeKey(parsed));
    expect(nodeKey({ type: 'code', value: 'x', lang: undefined })).toBe(nodeKey(parsed));
  });

  it('keeps nulls inside arrays (table align)', () => {
    expect(nodeKey({ type: 'table', align: [null, 'left'] })).not.toBe(nodeKey({ type: 'table', align: ['left'] }));
  });

  it('merges adjacent text nodes before keying', () => {
    const merged = { type: 'paragraph', children: [{ type: 'text', value: 'ab' }] };
    const split = { type: 'paragraph', children: [{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }] };
    expect(nodeKey(split)).toBe(nodeKey(merged));
  });

  it('changes when the text really changes', () => {
    const a = { type: 'paragraph', children: [{ type: 'text', value: 'ab' }] };
    const b = { type: 'paragraph', children: [{ type: 'text', value: 'ac' }] };
    expect(nodeKey(a)).not.toBe(nodeKey(b));
  });

  it('keeps a lone \\r distinct from \\n', () => {
    expect(nodeKey({ type: 'text', value: 'a\rb' })).not.toBe(nodeKey({ type: 'text', value: 'a\nb' }));
    expect(nodeKey({ type: 'text', value: 'a\r\nb' })).toBe(nodeKey({ type: 'text', value: 'a\nb' }));
  });
});
