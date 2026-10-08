import type { Nodes, Root } from 'mdast';
import type { Conventions } from './types';

export const DEFAULT_CONVENTIONS: Conventions = {
  eol: '\n', bullet: '-', bulletOrdered: '.', emphasis: '*', strong: '*', fence: '`', rule: '-', hardBreak: 'spaces',
};

export function detectConventions(src: string, tree: Root): Conventions {
  const c: Conventions = { ...DEFAULT_CONVENTIONS };
  const crlf = src.split('\r\n').length - 1;
  const lf = src.split('\n').length - 1 - crlf;
  if (crlf > lf) c.eol = '\r\n';

  const found = new Set<keyof Conventions>();
  const set = <K extends keyof Conventions>(k: K, v: Conventions[K]) => {
    if (!found.has(k)) { c[k] = v; found.add(k); }
  };

  const visit = (node: Nodes): void => {
    const at = node.position?.start.offset;
    if (at !== undefined) {
      const ch = src[at];
      if (node.type === 'list') {
        const m = /^[ \t]*(?:([-*+])|\d{1,9}([.)]))/.exec(src.slice(at, at + 16));
        if (m?.[1]) set('bullet', m[1] as Conventions['bullet']);
        if (m?.[2]) set('bulletOrdered', m[2] as Conventions['bulletOrdered']);
      } else if (node.type === 'emphasis' && (ch === '*' || ch === '_')) set('emphasis', ch);
      else if (node.type === 'strong' && (ch === '*' || ch === '_')) set('strong', ch);
      else if (node.type === 'code' && (ch === '`' || ch === '~')) set('fence', ch);
      else if (node.type === 'break') set('hardBreak', ch === '\\' ? 'backslash' : 'spaces');
      else if (node.type === 'thematicBreak' && (ch === '-' || ch === '*' || ch === '_')) set('rule', ch);
    }
    if ('children' in node) for (const child of node.children) visit(child as Nodes);
  };
  visit(tree);
  return c;
}
