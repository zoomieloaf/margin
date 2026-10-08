/** Structural identity of an mdast node, ignoring source positions. */
export function nodeKey(node: unknown): string {
  return JSON.stringify(node, (k, v) => (k === 'position' ? undefined : v));
}
