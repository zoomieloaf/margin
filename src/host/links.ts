export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'none' }
  /** `path`: decoded, without the fragment; `rooted`: started with `/` (resolved against the workspace folder). */
  | { kind: 'file'; path: string; rooted: boolean };

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
  const file = href.split('#')[0] ?? '';
  if (!file) return { kind: 'none' };
  const rooted = file.startsWith('/');
  return { kind: 'file', path: decode(rooted ? file.replace(/^\/+/, '') : file), rooted };
}
