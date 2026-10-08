import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { mathToMarkdown } from 'mdast-util-math';
import { toMarkdown, type Options } from 'mdast-util-to-markdown';
import type { RootContent } from 'mdast';
import { breakHandler, hasLiteralLink, linkHandler, withoutLiteralMarks } from './autolink';
import { calloutHandler } from './callout';
import { markHandler, textHandler } from './highlight';
import { nodeKey } from './key';
import { parseTree } from './parse';
import type { Conventions } from './types';

/** `literalLinks`: write GFM literal autolinks back as bare text (see serializeBlock). */
export function markdownOptions(c: Conventions, literalLinks = true): Options {
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
    extensions: [gfmToMarkdown(), frontmatterToMarkdown(['yaml']), mathToMarkdown({ singleDollarTextMath: false })],
    handlers: {
      callout: calloutHandler, mark: markHandler, text: textHandler, link: linkHandler(literalLinks), break: breakHandler(c),
    } as unknown as Options['handlers'],
  };
}

const structure = (md: string) => nodeKey(withoutLiteralMarks(parseTree(md).children));

export function serializeBlock(node: RootContent, c: Conventions): string {
  const write = (literalLinks: boolean) =>
    toMarkdown({ type: 'root', children: [node] }, markdownOptions(c, literalLinks)).replace(/\n+$/, '');
  let out = write(true);
  if (hasLiteralLink(node)) {
    // A bare URL next to text typed against it could grow or stop being a link: keep the
    // literal form only when it reads back exactly like the explicit `<url>` / `[x](url)` form.
    const explicit = write(false);
    if (explicit !== out && structure(out) !== structure(explicit)) out = explicit;
  }
  return out.replace(/\r?\n/g, c.eol);
}
