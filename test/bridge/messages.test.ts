import { describe, expect, it } from 'vitest';
import { AI_ACTIONS, isPageWidth, isWebviewMessage, MAX_AI_TEXT, MAX_CHECKED_LINKS, PAGE_WIDTHS, resolvePageWidth } from '../../src/bridge/messages';

describe('isWebviewMessage', () => {
  it.each([
    { type: 'ready' },
    { type: 'edit', version: 3, edits: [{ start: 0, end: 2, text: 'x' }] },
    { type: 'edit', version: 0, edits: [] },
    { type: 'undo' },
    { type: 'redo' },
    { type: 'mode', mode: 'edit' },
    { type: 'stats', words: 12 },
    { type: 'openLink', href: 'https://x.y' },
    { type: 'exportPdf' },
    { type: 'exportHtml' },
    { type: 'copyMarkdown' },
    { type: 'log', text: 'hi' },
    { type: 'focus' },
    { type: 'blur' },
    { type: 'resync' },
    { type: 'edit', version: 3, edits: [], seq: 7 },
    { type: 'checkLinks', hrefs: [] },
    { type: 'checkLinks', hrefs: ['./a.md', '../b/', 'c.png'] },
  ])('accepts %j', (m) => {
    expect(isWebviewMessage(m)).toBe(true);
  });

  it.each([
    null,
    'ready',
    {},
    { type: 'nope' },
    { type: 'edit', version: -1, edits: [] },
    { type: 'edit', version: 1, edits: [{ start: 3, end: 1, text: '' }] },
    { type: 'edit', version: 1, edits: [{ start: 0, end: 1 }] },
    { type: 'edit', version: 1.5, edits: [] },
    { type: 'mode', mode: 'wysiwyg' },
    { type: 'stats', words: '3' },
    { type: 'openLink' },
    { type: 'edit', version: 1, edits: [], seq: -1 },
    { type: 'edit', version: 1, edits: [], seq: '2' },
    { type: 'checkLinks' },
    { type: 'checkLinks', hrefs: './a.md' },
    { type: 'checkLinks', hrefs: ['a.md', 3] },
  ])('rejects %j', (m) => {
    expect(isWebviewMessage(m)).toBe(false);
  });
});

describe('checkLinks', () => {
  it('rejects an unreasonably long batch', () => {
    expect(isWebviewMessage({ type: 'checkLinks', hrefs: Array.from({ length: MAX_CHECKED_LINKS }, (_, i) => `${i}.md`) })).toBe(true);
    expect(isWebviewMessage({ type: 'checkLinks', hrefs: Array.from({ length: MAX_CHECKED_LINKS + 1 }, (_, i) => `${i}.md`) })).toBe(false);
  });
});

describe('AI messages', () => {
  it.each([
    { type: 'ai', id: 'a1', action: 'improve', markdown: 'Some *text*' },
    { type: 'ai', id: 'a1', action: 'translate', lang: 'German', markdown: 'Hallo' },
    { type: 'ai', id: 'a1', action: 'ask', instruction: 'Make it formal', markdown: '' },
    { type: 'ai', id: 'a1', action: 'continue', markdown: '', context: '# Plan\n\nFirst' },
    { type: 'aiCancel', id: 'a1' },
  ])('accepts %j', (m) => {
    expect(isWebviewMessage(m)).toBe(true);
  });

  it.each([
    { type: 'ai', id: 'a1', action: 'rewrite', markdown: 'x' },
    { type: 'ai', id: '', action: 'improve', markdown: 'x' },
    { type: 'ai', id: 3, action: 'improve', markdown: 'x' },
    { type: 'ai', id: 'a1', action: 'improve' },
    { type: 'ai', id: 'a1', action: 'improve', markdown: 'x', context: 5 },
    { type: 'ai', id: 'a1', action: 'translate', markdown: 'x' },
    { type: 'ai', id: 'a1', action: 'translate', lang: ' ', markdown: 'x' },
    { type: 'ai', id: 'a1', action: 'ask', markdown: 'x' },
    { type: 'ai', id: 'a1', action: 'ask', instruction: '', markdown: 'x' },
    { type: 'aiCancel' },
    { type: 'aiCancel', id: 7 },
  ])('rejects %j', (m) => {
    expect(isWebviewMessage(m)).toBe(false);
  });

  it('every action is accepted, and an oversized selection is refused', () => {
    for (const action of AI_ACTIONS) expect(isWebviewMessage({ type: 'ai', id: 'x', action, lang: 'English', instruction: 'Do it', markdown: 'x' })).toBe(true);
    expect(isWebviewMessage({ type: 'ai', id: 'x', action: 'improve', markdown: 'x'.repeat(MAX_AI_TEXT + 1) })).toBe(false);
  });
});

describe('page width', () => {
  it.each([
    { type: 'pageWidth', value: 'narrow' },
    { type: 'pageWidth', value: 'normal' },
    { type: 'pageWidth', value: 'wide' },
    { type: 'pageWidth', value: 'full' },
    { type: 'pageWidth', value: null },
  ])('accepts %j', (m) => {
    expect(isWebviewMessage(m)).toBe(true);
  });

  it.each([
    { type: 'pageWidth' },
    { type: 'pageWidth', value: 'huge' },
    { type: 'pageWidth', value: 3 },
    { type: 'pageWidth', value: '' },
  ])('rejects %j', (m) => {
    expect(isWebviewMessage(m)).toBe(false);
  });

  it('isPageWidth knows exactly the four widths', () => {
    expect(PAGE_WIDTHS).toEqual(['narrow', 'normal', 'wide', 'full']);
    for (const w of PAGE_WIDTHS) expect(isPageWidth(w)).toBe(true);
    for (const x of [undefined, null, '', 'Normal', 'auto', 760]) expect(isPageWidth(x)).toBe(false);
  });

  it('the per-file choice wins over the setting; anything unknown falls back', () => {
    expect(resolvePageWidth('wide', 'narrow')).toEqual({ width: 'wide', setting: 'narrow', override: 'wide' });
    expect(resolvePageWidth(undefined, 'narrow')).toEqual({ width: 'narrow', setting: 'narrow', override: null });
    expect(resolvePageWidth(null, 'full')).toEqual({ width: 'full', setting: 'full', override: null });
    // A stale or hand-edited value is ignored rather than trusted.
    expect(resolvePageWidth('huge', 'wide')).toEqual({ width: 'wide', setting: 'wide', override: null });
    expect(resolvePageWidth(undefined, 'bogus')).toEqual({ width: 'normal', setting: 'normal', override: null });
    expect(resolvePageWidth('full', 42)).toEqual({ width: 'full', setting: 'normal', override: 'full' });
  });
});
