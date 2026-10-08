/**
 * Canonical structural identity of an mdast node. Ignores source positions, property order,
 * null vs undefined vs missing properties, how text is split into adjacent text nodes, and
 * CRLF vs LF in strings (serialization re-applies the file EOL). A lone `\r` is kept.
 */
export function nodeKey(node: unknown): string {
  return JSON.stringify(canonical(node));
}

function canonical(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\r\n/g, '\n');
  if (Array.isArray(v)) return mergeText(v).map((x) => (x === undefined ? null : canonical(x)));
  if (v === null || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (k === 'position' || x === null || x === undefined) continue;
    out[k] = canonical(x);
  }
  return out;
}

const isText = (x: unknown): x is { type: 'text'; value: string } =>
  typeof x === 'object' && x !== null && (x as { type?: unknown }).type === 'text' &&
  typeof (x as { value?: unknown }).value === 'string';

function mergeText(arr: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const x of arr) {
    const prev = out[out.length - 1];
    if (isText(x) && isText(prev)) out[out.length - 1] = { ...prev, value: prev.value + x.value };
    else out.push(x);
  }
  return out;
}
