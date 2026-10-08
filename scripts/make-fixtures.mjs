import { mkdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../test/fixtures/roundtrip/', import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name, text) => writeFileSync(new URL(name, dir), Buffer.from(text, 'utf8'));

const basic = [
  '# Project title', '',
  'A paragraph with **bold**, *italic*, `code` and a [link](https://example.com).', '',
  '- one', '- two', '  - nested', '',
  '1. first', '2. second', '',
  '```js', 'const answer = 42;', '```', '',
  '> A quote', '> over two lines', '',
  '---', '',
  'Last line.', '',
].join('\n');

write('01-basic.md', basic);
write('02-crlf.md', basic.replace(/\n/g, '\r\n'));
write('03-bom.md', '﻿# BOM file\n\nText after a byte order mark.\n');
write('04-frontmatter-html.md', [
  '---', 'title: "Docs"', 'tags: [a, b]', '---', '',
  '<p align="center">', '  <img src="logo.png" width="120">', '</p>', '',
  'Inline <kbd>Ctrl</kbd>+<kbd>C</kbd> and <!-- a comment --> here.', '',
  '<!-- block comment -->', '',
].join('\n'));
write('05-footnotes-defs.md', [
  'See the spec[^spec] and [the guide][guide].', '',
  '[^spec]: The   spec, with odd   spacing.', '',
  '[guide]: https://example.com/guide "Guide title"', '',
].join('\n'));
write('06-nested-lists.md', [
  '* star item', '* another', '    * deep (4 spaces)', '', '',
  '1) paren one', '2) paren two', '',
  '- loose item', '', '- loose item two', '',
  '- [ ] task', '  - [x] nested done', '',
].join('\n'));
write('07-tables.md', [
  '| Left | Center | Right |', '|:-----|:------:|------:|', '| `a|b` escaped \\| pipe | **b** | 3 |', '| x |  | z |', '',
  'Text between tables.', '',
  'a | b', '--|--', '1 | 2', '',
].join('\n'));
write('08-callouts-highlight.md', [
  '> [!NOTE]', '> Useful information.', '',
  '> [!warning] Lowercase with same-line text', '> and more.', '',
  '> [!TIP]', '', 'A ==highlight== and `==not one==`.', '',
].join('\n'));
write('09-setext-indented.md', [
  'Setext title', '============', '',
  'Subtitle', '--------', '',
  '    indented code', '    block', '',
  'Hard break with spaces  ', 'and backslash\\', 'end. <https://example.com> www.example.com', '',
].join('\n'));
write('10-no-final-newline.md', '# No final newline\n\nThe file ends here.');
write('11-tabs-and-spacing.md', '-\ttab item\n-\ttab item\n\n\n\nParagraph with trailing spaces   \n\n\n');
console.log('wrote 11 handcrafted fixtures');
