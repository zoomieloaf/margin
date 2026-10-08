import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { DocModel } from '../../src/webview/editor/model';
import { isLocalHref, linkStatusKey, linkStatusPlugin, localLinks, type LinkStatus } from '../../src/webview/editor/linkStatus';

const load = (md: string) => new DocModel(() => {}).load(md, 1);

describe('isLocalHref', () => {
  it.each([
    ['./a.md', true], ['../b/c.md#x', true], ['docs/', true], ['/docs/a.md', true], ['a%20b.md', true],
    ['#top', false], ['https://x.y', false], ['mailto:a@b.co', false], ['vscode:x', false], ['', false],
  ])('%j → %s', (href, local) => {
    expect(isLocalHref(href)).toBe(local);
  });
});

describe('localLinks', () => {
  it('lists each local link target once, in document order', () => {
    const doc = load('[a](./a.md) [web](https://x.y) [b](b.md#x)\n\n- [again](./a.md)\n- [top](#top)\n\n> [c](../c/)\n');
    expect(localLinks(doc)).toEqual(['./a.md', 'b.md#x', '../c/']);
  });

  it('is empty without links', () => {
    expect(localLinks(load('# Title\n\nText\n'))).toEqual([]);
  });
});

describe('linkStatusPlugin', () => {
  const doc = load('See [setup](./setup.md) and [home](./README.md) and [web](https://x.y).\n');
  let status: LinkStatus = { missing: new Set(), paths: new Map() };
  const state = () => EditorState.create({ doc, plugins: [linkStatusPlugin(() => status)] });
  const decorations = (s: EditorState) =>
    linkStatusKey.getState(s)!.find().map((d) => ({ text: s.doc.textBetween(d.from, d.to), attrs: (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs }));

  it('has no decorations before the host answers', () => {
    expect(decorations(state())).toEqual([]);
  });

  it('marks missing targets and titles every checked link with its path, on a status update', () => {
    let s = state();
    status = { missing: new Set(['./setup.md']), paths: new Map([['./setup.md', 'docs/setup.md'], ['./README.md', 'docs/README.md']]) };
    s = s.apply(s.tr.setMeta(linkStatusKey, true));
    expect(decorations(s)).toEqual([
      { text: 'setup', attrs: { class: 'link-missing', title: "docs/setup.md doesn't exist" } },
      { text: 'home', attrs: { title: 'docs/README.md' } },
    ]);
  });

  it('never changes the document', () => {
    const s = state();
    const next = s.apply(s.tr.setMeta(linkStatusKey, true));
    expect(next.doc).toBe(s.doc);
  });

  it('keeps the marks in place while typing before the link', () => {
    status = { missing: new Set(['./setup.md']), paths: new Map() };
    let s = state();
    s = s.apply(s.tr.insertText('Please ', 1));
    expect(decorations(s)[0]?.text).toBe('setup');
  });
});
