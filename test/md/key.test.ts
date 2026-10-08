import { describe, expect, it } from 'vitest';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';

describe('nodeKey', () => {
  it('ignores positions and CRLF vs LF in text', () => {
    const lf = parseMarkdown('a\nb\n').blocks[0]!.data;
    const crlf = parseMarkdown('a\r\nb\r\n').blocks[0]!.data;
    expect(nodeKey(crlf)).toBe(nodeKey(lf));
  });
});
