import { describe, expect, it } from 'vitest';
import type { Link, Paragraph } from 'mdast';
import { withoutLiteralMarks } from '../../src/md/autolink';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';
import { serializeBlock } from '../../src/md/serialize';
import { updateBlock } from '../../src/md/ops';
import { writeMarkdown } from '../../src/md/write';

/** Re-serializes the first block as if it had been edited. */
const again = (src: string) => {
  const d = parseMarkdown(src);
  return serializeBlock(d.blocks[0]!.data, d.conventions);
};

describe('GFM literal autolinks stay literal when their block is rewritten', () => {
  it.each([
    ['www. link (would become [www.example.com](http://www.example.com))', 'Visit www.example.com today.'],
    ['bare https URL (would become <https://x.y/z>)', 'See https://x.y/z?q=1 for more.'],
    ['bare email (would become <a@b.co>)', 'Write to a@b.co please.'],
    ['URL at the start of the paragraph', 'https://x.y is the site.'],
    ['URL inside emphasis', '*see https://x.y*'],
  ])('%s', (_name, src) => {
    expect(again(src + '\n')).toBe(src);
  });

  it.each([
    ['explicit autolink', 'Go to <https://q.r> now.'],
    ['explicit email autolink', 'Mail <a@b.co> now.'],
    ['ordinary link', '[text](https://z)'],
  ])('keeps the written form of an %s', (_name, src) => {
    expect(again(src + '\n')).toBe(src);
  });

  it('marks the literal link in the mdast, and only it', () => {
    const p = parseMarkdown('a www.x.com b <https://y.z> c\n').blocks[0]!.data as Paragraph;
    const links = p.children.filter((c): c is Link => c.type === 'link');
    expect(links.map((l) => l.data)).toEqual([{ literal: true }, undefined]);
  });

  it('falls back to a normal link when the text no longer matches the URL', () => {
    const d = parseMarkdown('Visit www.example.com today.\n');
    const p = structuredClone(d.blocks[0]!.data) as Paragraph;
    ((p.children[1] as Link).children[0] as { value: string }).value = 'the site';
    expect(serializeBlock(p, d.conventions)).toBe('Visit [the site](http://www.example.com) today.');
  });

  it('an edit elsewhere in the paragraph leaves the autolinks as written', () => {
    const d = parseMarkdown('Intro\n\nVisit www.example.com or https://x.y today.\n');
    const p = structuredClone(d.blocks[1]!.data) as Paragraph;
    (p.children[p.children.length - 1] as { value: string }).value = ' today!';
    const out = writeMarkdown(updateBlock(d, d.blocks[1]!.id, p));
    expect(out).toBe('Intro\n\nVisit www.example.com or https://x.y today!\n');
    expect(nodeKey(parseMarkdown(out).blocks[1]!.data)).toBe(nodeKey(p));
  });
});

describe('a literal autolink next to new text is written so it re-parses the same', () => {
  const linkWith = (before: string, after: string) => {
    const d = parseMarkdown('x https://x.y z\n');
    const p = structuredClone(d.blocks[0]!.data) as Paragraph;
    (p.children[0] as { value: string }).value = before;
    (p.children[2] as { value: string }).value = after;
    return { out: serializeBlock(p, d.conventions), p };
  };

  it.each([
    ['text typed right after the URL', 'x ', 'abc'],
    ['text typed right before the URL', 'x', ' z'],
    ['a word joined after trailing punctuation', 'x ', '.com'],
  ])('%s', (_name, before, after) => {
    const { out, p } = linkWith(before, after);
    expect(out).toBe(`${before}<https://x.y>${after}`);
    expect(nodeKey(withoutLiteralMarks(parseMarkdown(out + '\n').blocks[0]!.data))).toBe(nodeKey(withoutLiteralMarks(p)));
  });

  it.each([
    ['a space', ' z'],
    ['a full stop and the end', '.'],
    ['a closing parenthesis', ') z'],
  ])('stays literal when followed by %s', (_name, after) => {
    expect(linkWith('(x ', after).out).toBe(`(x https://x.y${after}`);
  });
});

describe('hard line breaks follow the file', () => {
  it('two trailing spaces stay two trailing spaces', () => {
    expect(again('one  \ntwo\n')).toBe('one  \ntwo');
  });

  it('a backslash break stays a backslash', () => {
    expect(again('one\\\ntwo\n')).toBe('one\\\ntwo');
  });

  it('defaults to two spaces and records the style the file uses', () => {
    expect(parseMarkdown('x\n').conventions.hardBreak).toBe('spaces');
    expect(parseMarkdown('a  \nb\n').conventions.hardBreak).toBe('spaces');
    expect(parseMarkdown('a\\\nb\n\nc  \nd\n').conventions.hardBreak).toBe('backslash');
  });

  it('uses a backslash when the text before the break ends in a space (spaces would be swallowed)', () => {
    const d = parseMarkdown('x\n');
    const p = { type: 'paragraph', children: [{ type: 'text', value: 'a ' }, { type: 'break' }, { type: 'text', value: 'b' }] } as Paragraph;
    const out = serializeBlock(p, d.conventions);
    expect(nodeKey(parseMarkdown(out + '\n').blocks[0]!.data)).toBe(nodeKey(p));
  });
});
