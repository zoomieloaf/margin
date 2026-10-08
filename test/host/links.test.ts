import { describe, expect, it } from 'vitest';
import { folderIndex, isMarkdownPath, joinLinkPath, lineFragment, linkTarget, pageTitle } from '../../src/host/links';

describe('linkTarget', () => {
  it.each(['https://x.y/a', 'HTTP://x.y', 'mailto:a@b.co'])('opens %s externally', (href) => {
    expect(linkTarget(href)).toEqual({ kind: 'external', href });
  });

  it.each(['#section', 'vscode:extension/x', 'javascript:alert(1)', ''])('ignores %j on the host (anchors scroll in the webview)', (href) => {
    expect(linkTarget(href)).toEqual({ kind: 'none' });
  });

  it('resolves a relative file next to the document, without the fragment', () => {
    expect(linkTarget('docs/guide.md#install')).toEqual({ kind: 'file', path: 'docs/guide.md', rooted: false, fragment: 'install' });
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

  it('drops a ?query, before or with a fragment', () => {
    expect(linkTarget('setup.md?plain=1')).toEqual({ kind: 'file', path: 'setup.md', rooted: false });
    expect(linkTarget('./setup.md?plain=1#install')).toEqual({ kind: 'file', path: './setup.md', rooted: false, fragment: 'install' });
  });

  it('turns Windows backslashes into slashes', () => {
    expect(linkTarget('..\\guides\\setup.md')).toEqual({ kind: 'file', path: '../guides/setup.md', rooted: false });
    expect(linkTarget('\\docs\\a.md')).toEqual({ kind: 'file', path: 'docs/a.md', rooted: true });
  });

  it('keeps the fragment as written (the webview decodes it when it looks for the heading)', () => {
    expect(linkTarget('a.md#caf%C3%A9')).toEqual({ kind: 'file', path: 'a.md', rooted: false, fragment: 'caf%C3%A9' });
  });

  it('is none for a ?query alone', () => {
    expect(linkTarget('?x=1')).toEqual({ kind: 'none' });
  });
});

describe('joinLinkPath', () => {
  it.each([
    ['/w/docs', './setup.md', '/w/docs/setup.md'],
    ['/w/docs', 'setup.md', '/w/docs/setup.md'],
    ['/w/docs', '../a/b.md', '/w/a/b.md'],
    ['/w/docs', 'guides/', '/w/docs/guides'],
    ['/w/docs', '.', '/w/docs'],
    ['/c:/work/repo', 'docs/x.md', '/c:/work/repo/docs/x.md'],
    ['/w', '../../x.md', '/x.md'],
    ['/w/docs', 'my notes.md', '/w/docs/my notes.md'],
  ])('%s + %s → %s', (base, rel, out) => {
    expect(joinLinkPath(base, rel)).toBe(out);
  });
});

describe('isMarkdownPath', () => {
  it.each([['a.md', true], ['/x/A.MD', true], ['b.markdown', true], ['c.mdx', false], ['d.txt', false], ['md', false]])('%s → %s', (p, md) => {
    expect(isMarkdownPath(p)).toBe(md);
  });
});

describe('pageTitle', () => {
  it.each([
    ['setup-guide.md', 'Setup guide'],
    ['/w/docs/getting_started.markdown', 'Getting started'],
    ['API.md', 'API'],
    ['notes', 'Notes'],
    ['--.md', 'Untitled'],
    ['my  page--draft.md', 'My page draft'],
  ])('%s → %j', (name, title) => {
    expect(pageTitle(name)).toBe(title);
  });
});

describe('folderIndex', () => {
  it('prefers README.md, then index.md, then readme.md', () => {
    expect(folderIndex(['index.md', 'README.md', 'readme.md'])).toBe('README.md');
    expect(folderIndex(['readme.md', 'index.md'])).toBe('index.md');
    expect(folderIndex(['a.md', 'readme.md'])).toBe('readme.md');
  });

  it('matches names case-insensitively', () => {
    expect(folderIndex(['Readme.MD', 'other.md'])).toBe('Readme.MD');
    expect(folderIndex(['Index.md'])).toBe('Index.md');
  });

  it('is undefined when the folder has no page', () => {
    expect(folderIndex(['a.md', 'README.txt'])).toBeUndefined();
    expect(folderIndex([])).toBeUndefined();
  });
});

describe('lineFragment', () => {
  it.each([['L10', 10], ['L3-L7', 3], ['l2', 2], ['L0', null], ['install', null], ['L1x', null]])('%s → %s', (f, line) => {
    expect(lineFragment(f)).toBe(line);
  });
});
