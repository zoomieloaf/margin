import { describe, expect, it } from 'vitest';
import type { Paragraph } from 'mdast';
import { parseMarkdown } from '../../src/md/parse';
import type { Callout } from '../../src/md/types';

const first = (src: string) => parseMarkdown(src).blocks[0]!;

describe('callouts', () => {
  it('turns a [!TIP] blockquote into a callout', () => {
    const b = first('> [!TIP]\n> Try it.\n');
    expect(b.kind).toBe('callout');
    const c = b.data as Callout;
    expect(c.kind).toBe('tip');
    expect((c.children[0] as Paragraph).children).toEqual([expect.objectContaining({ type: 'text', value: 'Try it.' })]);
  });

  it('accepts lowercase kinds and text on the marker line', () => {
    const c = first('> [!note] Same line\n').data as Callout;
    expect(c.kind).toBe('note');
    expect((c.children[0] as Paragraph).children[0]).toMatchObject({ value: 'Same line' });
  });

  it('allows a marker with no body', () => {
    const c = first('> [!WARNING]\n').data as Callout;
    expect(c.type).toBe('callout');
    expect(c.children).toEqual([]);
  });

  it('leaves unknown kinds and plain quotes as quotes', () => {
    expect(first('> [!FOO]\n> x\n').kind).toBe('quote');
    expect(first('> plain\n').kind).toBe('quote');
  });

  it('keeps the original slice untouched', () => {
    expect(first('> [!TIP]\n> Try it.\n').original).toBe('> [!TIP]\n> Try it.');
  });
});

describe('highlights', () => {
  it('splits ==text== into a mark node', () => {
    const p = first('A ==big== deal\n').data as Paragraph;
    expect(p.children.map((c) => c.type)).toEqual(['text', 'mark', 'text']);
    expect(p.children[1]).toMatchObject({ type: 'mark', children: [{ type: 'text', value: 'big' }] });
  });

  it('finds marks inside emphasis', () => {
    const p = first('*a ==b== c*\n').data as Paragraph;
    const em = p.children[0] as { children: Array<{ type: string }> };
    expect(em.children.map((c) => c.type)).toEqual(['text', 'mark', 'text']);
  });

  it('never highlights inside inline code or fenced code', () => {
    const p = first('Use `==x==` here\n').data as Paragraph;
    expect(p.children.some((c) => c.type === 'mark')).toBe(false);
    const code = first('```\n==x==\n```\n');
    expect(code.kind).toBe('code');
    expect(code.data).toMatchObject({ value: '==x==' });
  });
});
