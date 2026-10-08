import type { Node as PmNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema';

/** What the host said about the local links: which point nowhere, and the path each one points to. */
export interface LinkStatus {
  missing: ReadonlySet<string>;
  paths: ReadonlyMap<string, string>;
}

/** A link to a file the host can check: not an in-page `#anchor` and not `https:`, `mailto:`... */
export const isLocalHref = (href: string): boolean => !!href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href);

/** Each local link target in the document, once, in document order. */
export function localLinks(doc: PmNode): string[] {
  const hrefs = new Set<string>();
  doc.descendants((node) => {
    const href = schema.marks.link!.isInSet(node.marks)?.attrs.href as string | undefined;
    if (href && isLocalHref(href)) hrefs.add(href);
    return true;
  });
  return [...hrefs];
}

/** A transaction with this meta set (to anything) rebuilds the decorations from the current status. */
export const linkStatusKey = new PluginKey<DecorationSet>('linkStatus');

/**
 * Marks links whose target is missing (class `link-missing`) and titles each checked link with its
 * path. Decorations only: the document, and so the file, never changes.
 */
export function linkStatusPlugin(status: () => LinkStatus): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: linkStatusKey,
    state: {
      init: (_config, state) => build(state.doc, status()),
      apply: (tr, set) => (tr.getMeta(linkStatusKey) !== undefined ? build(tr.doc, status()) : tr.docChanged ? set.map(tr.mapping, tr.doc) : set),
    },
    props: { decorations: (state) => linkStatusKey.getState(state) },
  });
}

function build(doc: PmNode, status: LinkStatus): DecorationSet {
  if (!status.missing.size && !status.paths.size) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const href = schema.marks.link!.isInSet(node.marks)?.attrs.href as string | undefined;
    if (!href) return false;
    const path = status.paths.get(href);
    if (status.missing.has(href)) decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'link-missing', title: `${path ?? href} doesn't exist` }));
    else if (path) decos.push(Decoration.inline(pos, pos + node.nodeSize, { title: path }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}
