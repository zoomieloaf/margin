import { posix } from 'node:path';

export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'none' }
  /**
   * `path`: decoded, with `/` separators, without the query and fragment; `rooted`: started with
   * `/` (resolved against the workspace folder); `fragment`: the part after `#`, as written.
   */
  | { kind: 'file'; path: string; rooted: boolean; fragment?: string };

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a stray `%` isn't an escape: keep the path as written
  }
};

/** What clicking a link in Margin does on the host. In-page `#anchors` are handled by the webview. */
export function linkTarget(href: string): LinkTarget {
  if (/^(https?|mailto):/i.test(href)) return { kind: 'external', href };
  if (href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'none' };
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? '' : href.slice(hash + 1);
  // `?plain=1` and the like mean nothing for a local file. Backslashes come from Windows paths.
  const file = (hash < 0 ? href : href.slice(0, hash)).split('?')[0]!.replace(/\\/g, '/');
  if (!file) return { kind: 'none' };
  const rooted = file.startsWith('/');
  const target: LinkTarget = { kind: 'file', path: decode(rooted ? file.replace(/^\/+/, '') : file), rooted };
  if (fragment) target.fragment = fragment;
  return target;
}

/** `rel` (a link path) joined to the folder path `base` (a URI path), normalized, without a trailing `/`. */
export function joinLinkPath(base: string, rel: string): string {
  const joined = posix.join(base, rel);
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

export const isMarkdownPath = (p: string): boolean => /\.(md|markdown)$/i.test(p);

/** The heading a new page starts with: `setup-guide.md` → "Setup guide". */
export function pageTitle(fileName: string): string {
  const base = posix.basename(fileName).replace(/\.(md|markdown)$/i, '');
  const words = base.replace(/[-_\s]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Untitled';
}

const INDEX_NAMES = ['README.md', 'index.md', 'readme.md'];

/**
 * The page a link to a folder opens: README.md, then index.md, then readme.md. An exact name wins;
 * otherwise the first of those that matches ignoring case (`Readme.MD`).
 */
export function folderIndex(names: readonly string[]): string | undefined {
  for (const want of INDEX_NAMES) if (names.includes(want)) return want;
  for (const want of INDEX_NAMES) {
    const found = names.find((n) => n.toLowerCase() === want.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

/** `L10` or `L10-L20` (GitHub's line links) → 10; anything else → null. */
export function lineFragment(fragment: string): number | null {
  const m = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment);
  const line = m ? Number(m[1]) : 0;
  return line > 0 ? line : null;
}
