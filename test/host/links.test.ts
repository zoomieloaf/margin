import { describe, expect, it } from 'vitest';
import { linkTarget } from '../../src/host/links';

describe('linkTarget', () => {
  it.each(['https://x.y/a', 'HTTP://x.y', 'mailto:a@b.co'])('opens %s externally', (href) => {
    expect(linkTarget(href)).toEqual({ kind: 'external', href });
  });

  it.each(['#section', 'vscode:extension/x', 'javascript:alert(1)', ''])('ignores %j on the host (anchors scroll in the webview)', (href) => {
    expect(linkTarget(href)).toEqual({ kind: 'none' });
  });

  it('resolves a relative file next to the document, without the fragment', () => {
    expect(linkTarget('docs/guide.md#install')).toEqual({ kind: 'file', path: 'docs/guide.md', rooted: false });
  });

  it('decodes %-escapes', () => {
    expect(linkTarget('my%20notes.md')).toEqual({ kind: 'file', path: 'my notes.md', rooted: false });
  });

  it('keeps a malformed %-escape as written instead of throwing', () => {
    expect(linkTarget('100%25%zz.md')).toEqual({ kind: 'file', path: '100%25%zz.md', rooted: false });
  });

  it('marks /paths as rooted (resolved against the workspace folder)', () => {
    expect(linkTarget('/docs/a.md')).toEqual({ kind: 'file', path: 'docs/a.md', rooted: true });
  });
});
