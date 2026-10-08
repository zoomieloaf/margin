import type { Break, Link, Nodes, Parents, Root } from 'mdast';
import { defaultHandlers, type Info, type State } from 'mdast-util-to-markdown';
import type { Conventions } from './types';

/** Margin's mark on a link written as a bare GFM autolink literal (`www.x.com`, `https://x`, `a@b.co`). */
export interface LiteralLinkData {
  literal?: boolean;
}

/**
 * Marks GFM literal autolinks: links whose source is just their text (no `<` or `[`). Without
 * the mark, rewriting the block turns `www.x.com` into `[www.x.com](http://www.x.com)` and
 * `https://x` into `<https://x>`.
 */
export function markLiteralAutolinks(tree: Root, src: string): void {
  const visit = (node: Nodes): void => {
    if (node.type === 'link') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const text = literalText(node);
      if (start !== undefined && end !== undefined && text !== null && src.slice(start, end) === text) {
        node.data = { ...node.data, literal: true } as Link['data'];
      }
    }
    if ('children' in node) for (const child of node.children) visit(child as Nodes);
  };
  visit(tree);
}

/** The link's text when the link can be written as that text alone (a GFM literal), else null. */
function literalText(node: Link): string | null {
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type !== 'text' || node.title) return null;
  const v = only.value;
  return node.url === v || node.url === `http://${v}` || node.url === `mailto:${v}` ? v : null;
}

const isLiteral = (node: Link) => (node.data as LiteralLinkData | undefined)?.literal === true && literalText(node) !== null;

/** True when `node` contains a link marked literal. */
export function hasLiteralLink(node: Nodes): boolean {
  if (node.type === 'link' && isLiteral(node)) return true;
  return 'children' in node && node.children.some((c) => hasLiteralLink(c as Nodes));
}

/** Deep copy of `value` without the literal marks (to compare structure regardless of how links were written). */
export function withoutLiteralMarks<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (k, v: unknown) => (k === 'literal' ? undefined : k === 'data' && isEmpty(v) ? undefined : v))) as T;
}
const isEmpty = (v: unknown) => typeof v === 'object' && v !== null && Object.keys(v).every((k) => k === 'literal');

/**
 * Links: a literal autolink is written back as its bare text when `literal` is on. The caller
 * (serializeBlock) checks the result re-parses the same, since new text typed right next to a
 * bare URL could otherwise extend or break it.
 */
export function linkHandler(literal: boolean) {
  const handle = (node: Link, parent: Parents | undefined, state: State, info: Info): string =>
    literal && isLiteral(node) ? literalText(node)! : defaultHandlers.link(node, parent, state, info);
  handle.peek = (node: Link, parent: Parents | undefined, state: State): string =>
    literal && isLiteral(node) ? literalText(node)!.charAt(0) : defaultHandlers.link.peek!(node, parent, state);
  return handle;
}

/** Hard breaks in the file's style: two trailing spaces (the default) or a backslash. */
export function breakHandler(c: Conventions) {
  return (node: Break, parent: Parents | undefined, state: State, info: Info): string => {
    const out = defaultHandlers.break(node, parent, state, info);
    // Two spaces after a space or tab would merge into it and lose that text on re-parse.
    if (out !== '\\\n' || c.hardBreak !== 'spaces' || /[ \t]$/.test(info.before)) return out;
    return '  \n';
  };
}
