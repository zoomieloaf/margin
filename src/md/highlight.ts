import type { Parent, Parents, PhrasingContent, Root, Text } from 'mdast';
import type { Info, State } from 'mdast-util-to-markdown';
import type { Mark } from './types';

/** `==x==`: content never starts or ends with whitespace or `=`, and the run is not part of a longer `=` run. */
const RE = /(?<!=)==(?=[^\s=])([^=\n]*?[^\s=])==(?!=)/g;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const ENTITY = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{0,31}));/;

export function liftHighlights(tree: Root, src?: string): void {
  visit(tree, src);
}

function visit(node: Parent, src: string | undefined): void {
  let changed = false;
  const out: Parent['children'] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value.includes('==')) {
      const parts = split(child, src);
      if (parts[0] !== child) changed = true;
      out.push(...parts);
    } else {
      if ('children' in child) visit(child as Parent, src);
      out.push(child);
    }
  }
  if (changed) node.children = out;
}

/**
 * For each `=` in the text value, in order: true when it was written literally in the source,
 * false when it came from a backslash escape or a character reference. Null when unknown.
 */
function literalEquals(t: Text, src: string | undefined): boolean[] | null {
  const start = t.position?.start.offset;
  const end = t.position?.end.offset;
  if (src === undefined || start === undefined || end === undefined) return null;
  const raw = src.slice(start, end);
  const flags: boolean[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '\\' && i + 1 < raw.length && ASCII_PUNCT.test(raw[i + 1]!)) {
      if (raw[i + 1] === '=') flags.push(false);
      i++;
    } else if (ch === '&') {
      const m = ENTITY.exec(raw.slice(i));
      if (m) {
        const code = m[1] ? Number(m[1]) : m[2] ? parseInt(m[2], 16) : undefined;
        if (code === 61 || m[3] === 'equals') flags.push(false);
        i += m[0].length - 1;
      }
    } else if (ch === '=') flags.push(true);
  }
  const count = t.value.split('=').length - 1;
  return flags.length === count ? flags : null;
}

function split(t: Text, src: string | undefined): PhrasingContent[] {
  const literal = literalEquals(t, src);
  const eqIndex: number[] = [];
  for (let i = 0; i < t.value.length; i++) if (t.value[i] === '=') eqIndex.push(i);
  const isLiteral = (at: number) => literal === null || literal[eqIndex.indexOf(at)] === true;

  const res: PhrasingContent[] = [];
  let last = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(t.value); m; m = RE.exec(t.value)) {
    const end = m.index + m[0].length;
    if (![m.index, m.index + 1, end - 2, end - 1].every(isLiteral)) {
      RE.lastIndex = m.index + 1;
      continue;
    }
    if (m.index > last) res.push({ type: 'text', value: t.value.slice(last, m.index) });
    res.push({ type: 'mark', children: [{ type: 'text', value: m[1]! }] });
    last = end;
  }
  if (!res.length) return [t];
  if (last < t.value.length) res.push({ type: 'text', value: t.value.slice(last) });
  return res;
}

/** Escapes the opening `==` of any run in serialized text that would otherwise re-parse as a highlight. */
export function textHandler(node: Text, _parent: Parents | undefined, state: State, info: Info): string {
  const value = state.safe(node.value, info);
  return value.replace(RE, (whole) => '\\' + whole);
}

export function markHandler(node: Mark, _parent: Parents | undefined, state: State, info: Info): string {
  const tracker = state.createTracker(info);
  let value = tracker.move('==');
  value += tracker.move(state.containerPhrasing(node, { before: value, after: '=', ...tracker.current() }));
  value += tracker.move('==');
  return value;
}
markHandler.peek = (): string => '=';
