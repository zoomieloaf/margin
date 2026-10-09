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

export type Os = 'windows' | 'mac' | 'linux';

/** The platform from `navigator.platform`. */
export const osOf = (platform: string): Os => (/Mac|iPhone|iPad/.test(platform) ? 'mac' : /Linux|X11|CrOS/i.test(platform) ? 'linux' : 'windows');

/** VS Code's default Go Back / Go Forward keys, as the toolbar shows them (on macOS ⌃ is Control, not Cmd). */
export const NAV_KEYS: Record<Os, { back: string; forward: string }> = {
  windows: { back: 'Alt+←', forward: 'Alt+→' },
  mac: { back: '⌃-', forward: '⌃⇧-' },
  linux: { back: 'Ctrl+Alt+-', forward: 'Ctrl+Shift+-' },
};

type Keys = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/** VS Code's default Go Back key on `os`: Alt+Left, Ctrl+- on macOS, Ctrl+Alt+- on Linux. */
export function isBackKey(e: Keys, os: Os): boolean {
  if (e.shiftKey || e.metaKey) return false;
  if (os === 'windows') return e.altKey && !e.ctrlKey && e.key === 'ArrowLeft';
  if (e.code !== 'Minus' || !e.ctrlKey) return false;
  return os === 'mac' ? !e.altKey : e.altKey;
}
