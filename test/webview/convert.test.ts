import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';
import { blockToPm, pmToMdast } from '../../src/webview/editor/convert';

const roundTrip = (src: string) => {
  const doc = parseMarkdown(src);
  for (const b of doc.blocks) {
    const pm = blockToPm(b);
    pm.check();
    expect(pm.attrs.blockId).toBe(b.id);
    expect(nodeKey(pmToMdast(pm)), b.original ?? '').toBe(nodeKey(b.data));
  }
  return doc;
};

describe('mdast ⇄ ProseMirror', () => {
  it.each([
    ['paragraph with marks', 'Plain **bold** *em* ~~del~~ `code` ==mark== [link](https://x.y "T") end.'],
    ['nested marks, em outside strong', '*a **b***'],
    ['nested marks, strong outside em', '**a *b* c**'],
    ['link with formatted text', '[**bold** link](https://x.y)'],
    ['code inside strong', '**use `npm i`**'],
    ['image and hard break', '![alt](a.png "t")  \nnext line'],
    ['soft line break', 'line one\nline two'],
    ['headings', '# One\n\n### Three'],
    ['nested list', '- a\n  - b\n    - c\n- d'],
    ['ordered list with start', '3. three\n4. four'],
    ['loose list', '- a\n\n- b'],
    ['task list', '- [ ] todo\n- [x] done'],
    ['empty list item', '- \n- b'],
    ['list item starting with code', '- ```js\n  x\n  ```'],
    ['quote with two paragraphs', '> one\n>\n> two'],
    ['callout with label case', '> [!note]\n> Body **bold**.'],
    ['callout without body', '> [!WARNING]'],
    ['code with lang and meta', '```ts title="a.ts"\nconst a = 1;\n```'],
    ['divider', '***'],
    ['table with alignment', '| a | b | c |\n| :- | :-: | -: |\n| 1 | **2** | `3` |'],
    ['link reference', 'See [the guide][g].\n\n[g]: https://x.y'],
    ['footnote reference', 'Text[^1].\n\n[^1]: Note.'],
    ['inline html', 'Press <kbd>Ctrl</kbd> now.'],
    ['inline math', 'Euler $$e^{i\\pi}$$ inline.'],
    ['html inside a list', '- a\n\n  <div>x</div>'],
  ])('round-trips %s', (_name, src) => {
    roundTrip(src + '\n');
  });

  it('keeps raw blocks as atoms with their exact source', () => {
    const doc = parseMarkdown('---\ntitle: x\n---\n\n<div>\n  hi\n</div>\n');
    const pm = blockToPm(doc.blocks[1]!);
    expect(pm.type.name).toBe('raw');
    expect(pm.attrs.source).toBe('<div>\n  hi\n</div>');
    expect(pmToMdast(pm)).toBe(doc.blocks[1]!.data);
  });
});

describe('mdast ⇄ ProseMirror over the round-trip corpus', () => {
  const dir = fileURLToPath(new URL('../fixtures/roundtrip/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  it.each(files)('%s: every block survives the editor model', (f) => {
    roundTrip(readFileSync(join(dir, f), 'utf8'));
  });
});
