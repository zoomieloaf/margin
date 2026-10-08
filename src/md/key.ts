/** Structural identity of an mdast node, ignoring source positions and CRLF vs LF (serialization re-applies the file EOL). */
export function nodeKey(node: unknown): string {
  return JSON.stringify(node, (k, v: unknown) => {
    if (k === 'position') return undefined;
    return typeof v === 'string' ? v.replace(/\r\n/g, '\n') : v;
  });
}
