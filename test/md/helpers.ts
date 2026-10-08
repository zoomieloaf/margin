import { expect } from 'vitest';
import { nodeKey } from '../../src/md/key';
import { parseMarkdown } from '../../src/md/parse';
import type { MdDocument } from '../../src/md/types';
import { writeMarkdown } from '../../src/md/write';

/** The written file re-parses into the same blocks: same count and same nodeKey per block (ids and originals ignored). */
export function expectReparseStable(doc: MdDocument): void {
  const text = writeMarkdown(doc);
  const re = parseMarkdown(text);
  expect(re.blocks.length, `block count after re-parse of ${JSON.stringify(text)}`).toBe(doc.blocks.length);
  re.blocks.forEach((b, i) => {
    expect(nodeKey(b.data), `block ${i} of ${JSON.stringify(text)}`).toBe(nodeKey(doc.blocks[i]!.data));
  });
}
