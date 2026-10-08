import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown, type Options } from 'mdast-util-to-markdown';
import type { RootContent } from 'mdast';
import { calloutHandler } from './callout';
import { markHandler } from './highlight';
import type { Conventions } from './types';

export function markdownOptions(c: Conventions): Options {
  return {
    bullet: c.bullet,
    bulletOther: c.bullet === '-' ? '*' : '-',
    bulletOrdered: c.bulletOrdered,
    emphasis: c.emphasis,
    strong: c.strong,
    fence: c.fence,
    fences: true,
    rule: c.rule,
    listItemIndent: 'one',
    incrementListMarker: true,
    extensions: [gfmToMarkdown(), frontmatterToMarkdown(['yaml'])],
    handlers: { callout: calloutHandler, mark: markHandler } as unknown as Options['handlers'],
  };
}

export function serializeBlock(node: RootContent, c: Conventions): string {
  const out = toMarkdown({ type: 'root', children: [node] }, markdownOptions(c)).replace(/\n+$/, '');
  return c.eol === '\n' ? out : out.replace(/\n/g, '\r\n');
}
