import type { Node as PmNode } from 'prosemirror-model';

/**
 * The id GitHub gives a heading: lower-case, punctuation and symbols dropped, each space turned
 * into `-` (letters, digits, `_` and `-` are kept; spaces are not collapsed).
 */
export function githubSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

/**
 * Position of the heading a `#fragment` link points to, using GitHub's ids (a repeated heading
 * gets `-1`, `-2`... in document order), or null.
 */
export function findAnchor(doc: PmNode, fragment: string): number | null {
  let wanted: string;
  try {
    wanted = decodeURIComponent(fragment).toLowerCase();
  } catch {
    return null;
  }
  const used = new Map<string, number>();
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'heading') return true;
    const base = githubSlug(node.textContent);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    if ((n ? `${base}-${n}` : base) === wanted) found = pos;
    return false;
  });
  return found;
}
