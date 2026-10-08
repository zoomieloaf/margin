import { describe, expect, it } from 'vitest';
import { isWebviewMessage } from '../../src/bridge/messages';

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
  ])('rejects %j', (m) => {
    expect(isWebviewMessage(m)).toBe(false);
  });
});
