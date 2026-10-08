import { Plugin, type Transaction } from 'prosemirror-state';

/**
 * Keeps every top-level node's `blockId` present and unique. When a block is split (Enter),
 * both halves inherit the id; the first keeps it and the second gets a fresh one.
 */
export function uniqueIds(newId: () => string): Plugin {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      state.doc.forEach((node, offset) => {
        const id = node.attrs.blockId as string | null | undefined;
        if (id && !seen.has(id)) {
          seen.add(id);
          return;
        }
        const fresh = newId();
        seen.add(fresh);
        tr = (tr ?? state.tr).setNodeMarkup(offset, undefined, { ...node.attrs, blockId: fresh });
      });
      return tr ? (tr as Transaction).setMeta('addToHistory', false) : null;
    },
  });
}
