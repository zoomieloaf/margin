import { describe, expect, it } from 'vitest';
import { isBackKey, NAV_KEYS, osOf } from '../../src/webview/ui/shortcut';

const key = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});

describe('osOf', () => {
  it.each([
    ['Win32', 'windows'],
    ['MacIntel', 'mac'],
    ['iPad', 'mac'],
    ['Linux x86_64', 'linux'],
    ['X11', 'linux'],
    ['', 'windows'],
  ])('%j is %s', (platform, os) => {
    expect(osOf(platform)).toBe(os);
  });
});

describe('isBackKey (VS Code\'s default Go Back key)', () => {
  it('Windows: Alt+Left only', () => {
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft', { altKey: true }), 'windows')).toBe(true);
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft'), 'windows')).toBe(false);
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft', { altKey: true, shiftKey: true }), 'windows')).toBe(false);
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft', { altKey: true, ctrlKey: true }), 'windows')).toBe(false);
    expect(isBackKey(key('ArrowRight', 'ArrowRight', { altKey: true }), 'windows')).toBe(false);
    // Ctrl+- zooms out on Windows.
    expect(isBackKey(key('-', 'Minus', { ctrlKey: true }), 'windows')).toBe(false);
  });

  it('macOS: Ctrl+- (not Cmd+-, which zooms)', () => {
    expect(isBackKey(key('-', 'Minus', { ctrlKey: true }), 'mac')).toBe(true);
    expect(isBackKey(key('-', 'Minus', { metaKey: true }), 'mac')).toBe(false);
    expect(isBackKey(key('_', 'Minus', { ctrlKey: true, shiftKey: true }), 'mac')).toBe(false);
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft', { altKey: true }), 'mac')).toBe(false);
  });

  it('Linux: Ctrl+Alt+-', () => {
    expect(isBackKey(key('-', 'Minus', { ctrlKey: true, altKey: true }), 'linux')).toBe(true);
    expect(isBackKey(key('-', 'Minus', { ctrlKey: true }), 'linux')).toBe(false);
    expect(isBackKey(key('ArrowLeft', 'ArrowLeft', { altKey: true }), 'linux')).toBe(false);
  });

  it('the toolbar names the keys of each platform', () => {
    expect(NAV_KEYS.windows).toEqual({ back: 'Alt+←', forward: 'Alt+→' });
    expect(NAV_KEYS.mac).toEqual({ back: '⌃-', forward: '⌃⇧-' });
    expect(NAV_KEYS.linux).toEqual({ back: 'Ctrl+Alt+-', forward: 'Ctrl+Shift+-' });
  });
});
