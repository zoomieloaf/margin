import type { Parent, Parents, PhrasingContent, Root, Text } from 'mdast';
import type { Info, State } from 'mdast-util-to-markdown';
import type { Mark } from './types';

const RE = /==([^=\n]+?)==/g;

export function liftHighlights(tree: Root): void {
  visit(tree);
}

function visit(node: Parent): void {
  let changed = false;
  const out: Parent['children'] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value.includes('==')) {
      const parts = split(child);
      if (parts[0] !== child) changed = true;
      out.push(...parts);
    } else {
      if ('children' in child) visit(child as Parent);
      out.push(child);
    }
  }
  if (changed) node.children = out;
}

function split(t: Text): PhrasingContent[] {
  const res: PhrasingContent[] = [];
  let last = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(t.value); m; m = RE.exec(t.value)) {
    if (m.index > last) res.push({ type: 'text', value: t.value.slice(last, m.index) });
    res.push({ type: 'mark', children: [{ type: 'text', value: m[1]! }] });
    last = m.index + m[0].length;
  }
  if (!res.length) return [t];
  if (last < t.value.length) res.push({ type: 'text', value: t.value.slice(last) });
  return res;
}

export function markHandler(node: Mark, _parent: Parents | undefined, state: State, info: Info): string {
  const tracker = state.createTracker(info);
  let value = tracker.move('==');
  value += tracker.move(state.containerPhrasing(node, { before: value, after: '=', ...tracker.current() }));
  value += tracker.move('==');
  return value;
}
markHandler.peek = (): string => '=';
