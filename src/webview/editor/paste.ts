import { Fragment, Slice, type ResolvedPos } from 'prosemirror-model';
import { parseMarkdown } from '../../md/parse';
import { blockToPm } from './convert';
import { schema } from './schema';

/** A line that starts a Markdown block: heading, list item, quote, fence or table row. */
const BLOCK = /^ {0,3}(?:#{1,6}[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|>[ \t]?\S|```|~~~|\|.*\|[ \t]*$)/m;
/** Unmistakable inline syntax: strong, code, a link, strikethrough or a highlight. */
const INLINE = /\*\*[^*\s][^*\n]*\*\*|__[^_\s][^_\n]*__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|~~[^~\s][^~\n]*~~|==[^=\s][^=\n]*==/;

/** Whether pasted plain text is clearly Markdown (plain prose is pasted as it is). */
export function looksLikeMarkdown(text: string): boolean {
  return BLOCK.test(text) || INLINE.test(text);
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
  const doc = parseMarkdown(text.replace(/\r\n?/g, '\n'));
  // Fresh ids: the parsed ids (b1, b2...) would collide with the document's own blocks.
  const nodes = doc.blocks.map((b) => {
    const node = blockToPm(b);
    return node.type.create({ ...node.attrs, blockId: null }, node.content, node.marks);
  });
  if (!nodes.length) return none;
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
