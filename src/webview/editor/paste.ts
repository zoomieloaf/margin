import { Fragment, Slice, type Node as PmNode, type ResolvedPos } from 'prosemirror-model';
import { parseMarkdown } from '../../md/parse';
import { blockToPm } from './convert';
import { schema } from './schema';

const HEADING = /^ {0,3}#{1,6}[ \t]+\S/;
const BULLET = /^ {0,3}[-*+][ \t]+\S/;
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+\S/;
const QUOTE = /^ {0,3}>[ \t]?\S/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * Whether some line clearly starts a Markdown block. Stricter than Markdown itself, so common
 * plain text isn't converted: a heading must stand alone (shell `# comments` don't), a list must
 * start after a blank line (YAML `key:` then `- item` doesn't), and an ordered list must start at
 * 1 or have a second item ("2024. It was..." doesn't).
 */
function hasBlockSyntax(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const blank = (l: string | undefined) => l === undefined || l.trim() === '';
  const isItem = (l: string | undefined) => l !== undefined && (BULLET.test(l) || ORDERED.test(l));
  return lines.some((line, i) => {
    const prev = lines[i - 1];
    const next = lines[i + 1];
    if (FENCE.test(line) || QUOTE.test(line)) return true;
    if (HEADING.test(line)) return blank(next);
    if (TABLE_ROW.test(line)) return next !== undefined && TABLE_DELIMITER.test(next) && next.includes('-');
    const startsList = blank(prev) || isItem(prev);
    if (BULLET.test(line)) return startsList;
    const n = ORDERED.exec(line);
    return n !== null && startsList && (Number(n[1]) === 1 || (next !== undefined && ORDERED.test(next)));
  });
}

/** Unmistakable inline syntax: strong, code, a link, strikethrough or a highlight. */
const INLINE = /\*\*[^*\s][^*\n]*\*\*|__[^_\s][^_\n]*__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|~~[^~\s][^~\n]*~~|==[^=\s][^=\n]*==/;

/** Whether pasted plain text is clearly Markdown (plain prose is pasted as it is). */
export function looksLikeMarkdown(text: string): boolean {
  return hasBlockSyntax(text) || INLINE.test(text);
}

/**
 * ProseMirror's `clipboardTextParser`: plain text that looks like Markdown is pasted as the
 * blocks it describes. Returns null (ProseMirror's own plain-text paste) for "paste as plain
 * text", inside tables (cells hold inline content only) and for text that isn't Markdown.
 * Code blocks never get here: ProseMirror pastes into them as plain text first.
 */
export function markdownTextParser(text: string, $context: ResolvedPos, plain: boolean): Slice {
  const none = null as unknown as Slice;
  if (plain || !looksLikeMarkdown(text)) return none;
  for (let d = $context.depth; d > 0; d--) if ($context.node(d).type.spec.tableRole) return none;
  return markdownSlice(text) ?? none;
}

/** The blocks Markdown `text` describes, with fresh ids. */
export function markdownNodes(text: string): PmNode[] {
  const doc = parseMarkdown(text.replace(/\r\n?/g, '\n'));
  // Fresh ids: the parsed ids (b1, b2...) would collide with the document's own blocks.
  return doc.blocks.map((b) => {
    // Frontmatter only means frontmatter at the top of a file: pasted elsewhere, it's shown as code.
    if (b.data.type === 'yaml') return schema.nodes.code_block!.create({ lang: 'yaml' }, b.data.value ? schema.text(b.data.value) : null);
    const node = blockToPm(b);
    return node.type.create({ ...node.attrs, blockId: null }, node.content, node.marks);
  });
}

/**
 * Markdown `text` as a slice to put at the cursor (paste, an accepted AI suggestion); null when
 * it has no blocks. A single paragraph is inline content.
 */
export function markdownSlice(text: string): Slice | null {
  const nodes = markdownNodes(text);
  if (!nodes.length) return null;
  const p = schema.nodes.paragraph!;
  if (nodes.length === 1 && nodes[0]!.type === p) {
    // Inline paste: keep the spaces around it, which Markdown parsing trims off a paragraph.
    const lead = /^[ \t]*/.exec(text)![0];
    const trail = /[ \t]*$/.exec(text.replace(/[\r\n]+$/, ''))![0];
    const inline = [...(lead ? [schema.text(lead)] : []), ...nodes[0]!.content.content, ...(trail ? [schema.text(trail)] : [])];
    return new Slice(Fragment.from(p.create(null, inline)), 1, 1);
  }
  // The slice is open at both ends through a paragraph: the text around the cursor joins the
  // first / last pasted paragraph (or an empty one), and headings, lists... stay whole blocks.
  if (nodes[0]!.type !== p) nodes.unshift(p.create());
  if (nodes[nodes.length - 1]!.type !== p) nodes.push(p.create());
  return new Slice(Fragment.from(nodes), 1, 1);
}
