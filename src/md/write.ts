import type { List } from 'mdast';
import { serializeBlock } from './serialize';
import type { Conventions, MdDocument, SourceBlock } from './types';

const BOM = '\uFEFF';
const LIST_MARKER = /^[ \t]*(?:([-*+])|\d{1,9}([.)]))/;
const BULLETS: ReadonlyArray<Conventions['bullet']> = ['-', '*', '+'];
const DELIMITERS: ReadonlyArray<Conventions['bulletOrdered']> = ['.', ')'];

/** Text of a block on its own: the original slice when untouched, otherwise serialized with the file conventions. */
export function blockText(b: SourceBlock, c: Conventions): string {
  return !b.dirty && b.original !== null ? b.original : serializeBlock(b.data, c);
}

export interface RenderedBlock {
  /** Text written before the block. */
  gap: string;
  /** Text written for the block. */
  text: string;
}

const touched = (b: SourceBlock) => b.dirty || b.original === null;
const lineBreaks = (s: string) => s.match(/\r\n|\r|\n/g)?.length ?? 0;
const isList = (b: SourceBlock | undefined): b is SourceBlock & { data: List } => b?.data.type === 'list';
const markerOf = (text: string): string | null => {
  const m = LIST_MARKER.exec(text);
  return m ? (m[1] ?? m[2] ?? null) : null;
};

/**
 * A touched list next to a list of the same kind and marker would merge with it on re-parse,
 * so it is written with a marker neither neighbour uses (the file's preferred one first).
 */
function listText(data: List, c: Conventions, avoid: Array<string | null>): string {
  const ordered = data.ordered === true;
  const preferred = ordered ? c.bulletOrdered : c.bullet;
  const pool: readonly string[] = ordered ? DELIMITERS : BULLETS;
  const candidates = [preferred, ...pool.filter((m) => m !== preferred)];
  const texts = candidates.map((m) =>
    serializeBlock(data, ordered ? { ...c, bulletOrdered: m as Conventions['bulletOrdered'] } : { ...c, bullet: m as Conventions['bullet'] }),
  );
  const free = (n: number) => texts.findIndex((t) => avoid.slice(0, n).every((a) => a === null || markerOf(t) !== a));
  const best = free(avoid.length);
  return texts[best >= 0 ? best : Math.max(free(1), 0)]!;
}

/**
 * What writeMarkdown emits for each block. Untouched blocks and the gap between two untouched
 * blocks are exact. A gap next to a touched block is widened to a blank line when it has fewer
 * than two line breaks, so the blocks stay separate on re-parse.
 */
export function renderBlocks(doc: MdDocument): RenderedBlock[] {
  const c = doc.conventions;
  const out: RenderedBlock[] = [];
  doc.blocks.forEach((b, i) => {
    const prev = doc.blocks[i - 1];
    const next = doc.blocks[i + 1];
    let text: string;
    if (!touched(b)) {
      text = b.original!;
    } else if (isList(b)) {
      const sameKind = (o: SourceBlock | undefined): o is SourceBlock & { data: List } =>
        isList(o) && (o.data.ordered === true) === (b.data.ordered === true);
      const before = sameKind(prev) ? markerOf(out[i - 1]!.text) : null;
      const after = sameKind(next) && !touched(next) ? markerOf(next.original!) : null;
      text = listText(b.data, c, [before, after]);
    } else {
      text = serializeBlock(b.data, c);
    }
    const widen = prev !== undefined && (touched(b) || touched(prev)) && lineBreaks(b.gapBefore) < 2;
    out.push({ gap: widen ? c.eol + c.eol : b.gapBefore, text });
  });
  return out;
}

export function writeMarkdown(doc: MdDocument): string {
  const body = renderBlocks(doc).map((r) => r.gap + r.text).join('');
  return (doc.bom ? BOM : '') + body + doc.trailing;
}
