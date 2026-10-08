/**
 * The letter a shortcut was typed with. On non-Latin layouts (Russian, Greek...) `e.key` is the
 * local letter, so fall back to the physical key, as VS Code and prosemirror-keymap do.
 */
export function shortcutKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) return k;
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1]!.toLowerCase() : k;
}
