import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Paragraph, PhrasingContent } from 'mdast';
import { diffToEdit } from '../../src/md/edits';
import { nodeKey } from '../../src/md/key';
import { updateBlock } from '../../src/md/ops';
import { parseMarkdown } from '../../src/md/parse';
import { serializeBlock } from '../../src/md/serialize';
import { writeMarkdown } from '../../src/md/write';

const dir = fileURLToPath(new URL('../fixtures/roundtrip/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

const appendText = (p: Paragraph, extra: string): Paragraph => ({
  ...p,
  children: [...p.children, { type: 'text', value: extra } as PhrasingContent],
});

describe('round-trip corpus', () => {
  it('has at least 30 fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it.each(files)('%s: open and save is byte-identical', (f) => {
    const src = read(f);
    expect(writeMarkdown(parseMarkdown(src))).toBe(src);
  });

  it.each(files)('%s: editing one paragraph changes only that paragraph', (f) => {
    const src = read(f);
    const doc = parseMarkdown(src);
    const i = doc.blocks.findIndex((b) => b.kind === 'paragraph');
    if (i < 0) return;
    const b = doc.blocks[i]!;
    const before = doc.blocks.slice(0, i).reduce((n, x) => n + x.gapBefore.length + x.original!.length, 0);
    const start = (doc.bom ? 1 : 0) + before + b.gapBefore.length;
    const end = start + b.original!.length;
    const edited = writeMarkdown(updateBlock(doc, b.id, appendText(b.data as Paragraph, ' EDITED')));
    const edit = diffToEdit(src, edited)!;
    expect(edit.start).toBeGreaterThanOrEqual(start);
    expect(edit.end).toBeLessThanOrEqual(end);
  });

  it.each(files)('%s: every editable block re-serializes to the same content', (f) => {
    const doc = parseMarkdown(read(f));
    const defs = doc.blocks
      .filter((b) => b.data.type === 'definition' || b.data.type === 'footnoteDefinition')
      .map((b) => b.original)
      .join('\n\n');
    for (const b of doc.blocks.filter((x) => x.kind !== 'raw')) {
      const text = serializeBlock(b.data, { ...doc.conventions, eol: '\n' });
      const re = parseMarkdown(`${text}\n\n${defs}\n`).blocks[0]!;
      expect(nodeKey(re.data), `${f}: ${b.original}`).toBe(nodeKey(b.data));
    }
  });
});
