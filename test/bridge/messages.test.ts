import { describe, expect, it } from 'vitest';
import { isWebviewMessage, MAX_CHECKED_LINKS } from '../../src/bridge/messages';

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
