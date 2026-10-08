import type { Node as PmNode } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { AiAction } from '../../bridge/messages';
import { DEFAULT_CONVENTIONS } from '../../md/conventions';
import { serializeBlock } from '../../md/serialize';
import type { Ctx } from './commands';
import { pmToMdast } from './convert';
import { markdownNodes, markdownSlice } from './paste';
import { schema } from './schema';

/**
 * What an AI action works on. `block`: whole top-level blocks from `from` to `to` (a selection
 * across blocks, or one whole paragraph); otherwise text inside one block, or the cursor (`from`
 * = `to`: Continue writing, Ask AI with nothing selected). `markdown`: that text, sent to the AI.
 */
export interface AiRange {
  from: number;
  to: number;
  block: boolean;
  markdown: string;
}

/** Top-level blocks as Markdown, one blank line apart. */
function blocksMarkdown(nodes: PmNode[]): string {
  return nodes
    .map((node) => {
      try {
        return serializeBlock(pmToMdast(node), DEFAULT_CONVENTIONS);
      } catch {
        return node.textContent;
      }
    })
    .filter((md) => md.trim() !== '')
    .join('\n\n');
}

/** The range an AI action applies to, or null when it needs selected text and there is none. */
export function aiRange(state: EditorState, action: AiAction): AiRange | null {
  const { from, to, empty, $from, $to } = state.selection;
  if ($from.parent.type.spec.code || $to.parent.type.spec.code) return null;
  if (action === 'continue') return { from: to, to, block: false, markdown: '' };
  if (empty) return action === 'ask' ? { from, to, block: false, markdown: '' } : null;
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const whole = $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size;
    if (!whole || $from.depth !== 1) {
      const inline = schema.nodes.paragraph!.create(null, $from.parent.content.cut($from.parentOffset, $to.parentOffset));
      return { from, to, block: false, markdown: blocksMarkdown([inline]) };
    }
  }
  const start = $from.depth ? $from.before(1) : from;
  const end = $to.depth ? $to.after(1) : to;
  const nodes: PmNode[] = [];
  state.doc.nodesBetween(start, end, (node) => {
    nodes.push(node);
    return false;
  });
  return { from: start, to: end, block: true, markdown: blocksMarkdown(nodes) };
}

/** The document before `pos` as Markdown: what Continue writing continues. */
export function markdownBefore(doc: PmNode, pos: number): string {
  const nodes: PmNode[] = [];
  doc.cut(0, pos).forEach((node) => nodes.push(node));
  return blocksMarkdown(nodes);
}

/**
 * The answer without one code fence around all of it, which models add despite being asked not
 * to. A fence with a language other than Markdown is content (the user asked for code) and stays.
 */
export function unwrapFence(text: string): string {
  const t = text.trim();
  const m = /^(`{3,}|~{3,})[ \t]*(markdown|md)?[ \t]*\n([\s\S]*)\n(`{3,}|~{3,})$/i.exec(t);
  if (!m || m[4]![0] !== m[1]![0] || m[4]!.length < m[1]!.length) return t;
  // A fence line inside means the answer is several code blocks, not one wrapped answer.
  const inner = m[3]!;
  const closing = new RegExp(`^ {0,3}${m[1]![0] === '`' ? '`' : '~'}{${m[1]!.length},}[ \\t]*$`, 'm');
  return closing.test(inner) ? t : inner.trim();
}

/**
 * Puts an accepted AI answer into the document in one transaction (one edit, one undo step in
 * VS Code): in place of the range (`replace`), or after its top-level block (`below`).
 * Returns false and changes nothing when the answer is empty.
 */
export function acceptSuggestion(ctx: Ctx, range: AiRange, answer: string, where: 'replace' | 'below'): boolean {
  const text = unwrapFence(answer);
  if (!text) return false;
  const { state } = ctx;
  const tr = state.tr;
  if (where === 'below' || range.block) {
    const nodes = markdownNodes(text);
    if (!nodes.length) return false;
    if (where === 'below') {
      const $to = state.doc.resolve(range.to);
      const at = range.block || $to.depth === 0 ? range.to : $to.after(1);
      tr.insert(at, nodes);
    } else {
      tr.replaceWith(range.from, range.to, nodes);
    }
  } else {
    const slice = markdownSlice(text);
    if (!slice) return false;
    let { from, to } = range;
    // Continue writing after a word: the new text starts after a space, like typed text would.
    const before = state.doc.textBetween(Math.max(state.doc.resolve(from).start(), from - 1), from);
    if (from === to && /\S/.test(before) && /^[^\s.,;:!?)]/.test(text)) {
      tr.insertText(' ', from);
      from++;
      to++;
    }
    tr.replaceRange(from, to, slice);
  }
  const end = tr.mapping.map(range.to);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
  ctx.dispatch(tr.scrollIntoView());
  return true;
}
