// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Node as PmNode, ResolvedPos, Slice } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import * as pmView from 'prosemirror-view';
import { applyEdit } from '../../src/md/edits';
import { uniqueIds } from '../../src/webview/editor/ids';
import { DocModel, type OutgoingEdit } from '../../src/webview/editor/model';
import { looksLikeMarkdown, markdownTextParser } from '../../src/webview/editor/paste';

const parseFromClipboard = (pmView as unknown as {
  __parseFromClipboard(view: pmView.EditorView, text: string, html: string | null, plain: boolean, $context: ResolvedPos): Slice;
}).__parseFromClipboard;

/** Pastes `text` as plain text (no HTML on the clipboard) at `pos` in a document made from `md`, as the app's view would. */
function paste(md: string, text: string, pos: (doc: PmNode) => number, plain = false) {
  const sent: OutgoingEdit[] = [];
  const model = new DocModel((e) => sent.push(e));
  const host = { text: md, version: 1 };
  let state = EditorState.create({ doc: model.load(md, 1), plugins: [uniqueIds(model.newId)] });
  const view = new pmView.EditorView(document.createElement('div'), {
    state,
    clipboardTextParser: markdownTextParser,
    dispatchTransaction: (tr) => {
      state = state.apply(tr);
      view.updateState(state);
    },
  });
  const at = pos(state.doc);
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
  const slice = parseFromClipboard(view, text, null, plain, state.doc.resolve(at));
  view.dispatch(state.tr.replaceSelection(slice));
  model.change(state.doc);
  while (sent.length) {
    for (const e of sent.shift()!.edits) host.text = applyEdit(host.text, e);
    model.ack(++host.version);
  }
  const doc = state.doc;
  view.destroy();
  return { doc, text: host.text };
}

const end = (doc: PmNode) => doc.content.size - 1; // end of the last textblock
const types = (doc: PmNode) => {
  const out: string[] = [];
  doc.forEach((n) => out.push(n.type.name));
  return out;
};

describe('looksLikeMarkdown', () => {
  it.each(['# Title', 'a\n\n- item', '1. one', '> quote', '```js\nx\n```', 'see **this**', 'use `npm i`', 'a [link](https://x.y)', '| a | b |\n| - | - |'])(
    'yes: %j', (t) => expect(looksLikeMarkdown(t)).toBe(true),
  );
  it.each(['plain words', '2 * 3 * 4', 'snake_case_name', 'C# is fine', 'price: $5', 'a > b'])(
    'no: %j', (t) => expect(looksLikeMarkdown(t)).toBe(false),
  );
});

describe('pasting Markdown text', () => {
  it('becomes real blocks, written back as that Markdown, without touching the other blocks', () => {
    const md = 'Keep  *this*   exactly.\n\nLast word\n';
    // Between "Last" and " word": the paragraph is split around the pasted blocks.
    const r = paste(md, '# Pasted\n\nSome **bold** text.\n\n- a\n- b', (d) => d.child(0).nodeSize + 5);
    expect(types(r.doc)).toEqual(['paragraph', 'paragraph', 'heading', 'paragraph', 'bullet_list', 'paragraph']);
    expect(r.text).toBe('Keep  *this*   exactly.\n\nLast\n\n# Pasted\n\nSome **bold** text.\n\n- a\n- b\n\nword\n');
  });

  it('inline Markdown pasted inside a paragraph stays in that paragraph', () => {
    const r = paste('Hello world\n', 'very **bold** ', (d) => 1 + 'Hello '.length);
    expect(types(r.doc)).toEqual(['paragraph']);
    expect(r.text).toBe('Hello very **bold** world\n');
  });

  it('pasted blocks get fresh ids (an existing block is never mistaken for them)', () => {
    const r = paste('First\n\nSecond  two spaces\n', '## A\n\n## B', (d) => 1);
    const ids = new Set<string>();
    r.doc.forEach((n) => ids.add(n.attrs.blockId as string));
    expect(ids.size).toBe(r.doc.childCount);
    expect(r.text).toContain('Second  two spaces');
  });

  it('plain text, "paste as plain text" and code blocks are left alone', () => {
    expect(paste('Hi\n', 'just words', end).text).toBe('Hijust words\n');
    expect(paste('Hi\n', '**not bold**', end, true).text).toBe('Hi\\*\\*not bold\\*\\*\n');
    expect(paste('```\ncode\n```\n', '# not a heading', end).text).toBe('```\ncode# not a heading\n```\n');
  });
});
