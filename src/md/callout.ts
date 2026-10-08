import type { Blockquote, Paragraph, Parents, Root } from 'mdast';
import type { Info, State } from 'mdast-util-to-markdown';
import type { Callout, CalloutKind } from './types';

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/i;

export function liftCallouts(tree: Root): void {
  tree.children = tree.children.map((n) => (n.type === 'blockquote' ? toCallout(n) ?? n : n));
}

function toCallout(bq: Blockquote): Callout | null {
  const para = bq.children[0];
  if (!para || para.type !== 'paragraph') return null;
  const head = para.children[0];
  if (!head || head.type !== 'text') return null;
  const m = MARKER.exec(head.value);
  if (!m) return null;
  const rest = head.value.slice(m[0].length);
  const inline = rest ? [{ ...head, value: rest }, ...para.children.slice(1)] : para.children.slice(1);
  const body: Paragraph | null = inline.length ? { ...para, children: inline } : null;
  return {
    type: 'callout',
    kind: m[1]!.toLowerCase() as CalloutKind,
    children: body ? [body, ...bq.children.slice(1)] : bq.children.slice(1),
    position: bq.position,
  };
}

export function calloutHandler(node: Callout, _parent: Parents | undefined, state: State, info: Info): string {
  const exit = state.enter('blockquote');
  const tracker = state.createTracker(info);
  tracker.move('> ');
  tracker.shift(2);
  const body = state.containerFlow(node as unknown as Blockquote, tracker.current());
  exit();
  const head = `[!${node.kind.toUpperCase()}]`;
  return state.indentLines(body ? `${head}\n${body}` : head, (line, _i, blank) => '>' + (blank ? '' : ' ') + line);
}
