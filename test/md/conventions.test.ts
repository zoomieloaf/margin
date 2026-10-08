import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/md/parse';
import { DEFAULT_CONVENTIONS } from '../../src/md/conventions';

describe('detectConventions', () => {
  it('uses defaults for plain text', () => {
    expect(parseMarkdown('Hello\n').conventions).toEqual(DEFAULT_CONVENTIONS);
  });

  it('detects markers from the first occurrence', () => {
    const c = parseMarkdown('* a\n\n1) one\n\n_em_ and __strong__\n\n~~~\ncode\n~~~\n\n___\n').conventions;
    expect(c).toMatchObject({ bullet: '*', bulletOrdered: ')', emphasis: '_', strong: '_', fence: '~', rule: '_', eol: '\n' });
  });

  it('detects CRLF when it is the majority line ending', () => {
    expect(parseMarkdown('a\r\n\r\nb\r\n').conventions.eol).toBe('\r\n');
    expect(parseMarkdown('a\r\nb\nc\nd\n').conventions.eol).toBe('\n');
  });
});
