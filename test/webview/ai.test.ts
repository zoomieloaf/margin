import { describe, expect, it } from 'vitest';
import type { Node as PmNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { applyEdit } from '../../src/md/edits';
import { acceptSuggestion, aiRange, markdownBefore, unwrapFence } from '../../src/webview/editor/ai';
import { uniqueIds } from '../../src/webview/editor/ids';
import { DocModel, type OutgoingEdit } from '../../src/webview/editor/model';

/** An editor (state + dispatch, like the view) on `md`, with a DocModel talking to a fake host. */
function setup(md: string) {
  const sent: OutgoingEdit[] = [];
  const model = new DocModel((e) => sent.push(e));
  const host = { text: md, version: 1 };
  let dispatched = 0;
  const ctx = {
    state: EditorState.create({ doc: model.load(md, 1), plugins: [uniqueIds(model.newId)] }),
    dispatch(tr: Transaction) {
      dispatched++;
      this.state = this.state.apply(tr);
    },
  };
  /** Where `text` (in one text node) starts, first occurrence. */
  const find = (text: string) => {
    let at = -1;
    ctx.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
      return at < 0;
    });
    if (at < 0) throw new Error(`no ${text}`);
    return at;
  };
  /** Selects from the start of `text` to the end of `until` (default: `text`). */
  const select = (text: string, until = text) => {
    const to = find(until) + until.length;
    ctx.state = ctx.state.apply(ctx.state.tr.setSelection(TextSelection.create(ctx.state.doc, find(text), to)));
  };
  /** Sends the editor's document through the model and the host; returns the edits the host got. */
  const sync = () => {
    const edits: OutgoingEdit[] = [];
    model.change(ctx.state.doc);
    while (sent.length) {
      const e = sent.shift()!;
      edits.push(e);
      for (const x of e.edits) host.text = applyEdit(host.text, x);
      model.ack(++host.version);
    }
    return edits;
  };
  return { ctx, model, host, select, sync, dispatched: () => dispatched };
}

const MD = '# Keep  this   *exactly*\n\nSome  *odd*   text here, as written.\n\n* other\n* list  item\n\nLast   para.\n';

describe('aiRange', () => {
  it('inside one paragraph: just the selected text, as inline Markdown', () => {
    const t = setup('Some **bold** text and more.\n');
    t.select('bold', ' text');
    const r = aiRange(t.ctx.state, 'improve')!;
    expect(r.block).toBe(false);
    expect(r.markdown).toBe('**bold** text');
  });

  it('across blocks: whole top-level blocks', () => {
    const t = setup(MD);
    const { doc } = t.ctx.state;
    // From "text" in the paragraph to "list" in the list.
    let a = -1;
    let b = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text!.includes('text here')) a = pos + n.text!.indexOf('text');
      if (n.isText && n.text!.includes('list')) b = pos + 2;
      return true;
    });
    t.ctx.state = t.ctx.state.apply(t.ctx.state.tr.setSelection(TextSelection.create(doc, a, b)));
    const r = aiRange(t.ctx.state, 'improve')!;
    expect(r.block).toBe(true);
    expect(r.from).toBe(doc.child(0).nodeSize);
    expect(r.to).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize);
    expect(r.markdown).toMatch(/^Some +\*odd\* +text here, as written\.\n\n[-*] other\n[-*] list +item$/);
  });

  it('a whole paragraph is a block', () => {
    const t = setup('One.\n\nTwo **b**.\n');
    const start = t.ctx.state.doc.child(0).nodeSize + 1;
    t.ctx.state = t.ctx.state.apply(t.ctx.state.tr.setSelection(TextSelection.create(t.ctx.state.doc, start, start + 'Two b.'.length)));
    const r = aiRange(t.ctx.state, 'improve')!;
    expect(r.block).toBe(true);
    expect(r.markdown).toBe('Two **b**.');
  });

  it('nothing selected: null for rewrites; Continue writing and Ask AI work at the cursor', () => {
    const t = setup('# Plan\n\nFirst we\n');
    const end = t.ctx.state.doc.content.size - 1;
    t.ctx.state = t.ctx.state.apply(t.ctx.state.tr.setSelection(TextSelection.create(t.ctx.state.doc, end)));
    expect(aiRange(t.ctx.state, 'improve')).toBeNull();
    const c = aiRange(t.ctx.state, 'continue')!;
    expect([c.from, c.to, c.markdown, c.block]).toEqual([end, end, '', false]);
    expect(aiRange(t.ctx.state, 'ask')!.markdown).toBe('');
  });

  it('Continue writing with a selection continues after it', () => {
    const t = setup('Alpha beta gamma.\n');
    t.select('beta');
    const r = aiRange(t.ctx.state, 'continue')!;
    expect(r.from).toBe(r.to);
    expect(r.to).toBe(t.ctx.state.selection.to);
  });
});

describe('markdownBefore', () => {
  it('is the document up to the position, as Markdown', () => {
    const t = setup('# Plan\n\n- one\n- two\n\nFirst we go\n');
    t.select('go');
    expect(markdownBefore(t.ctx.state.doc, t.ctx.state.selection.from)).toBe('# Plan\n\n- one\n- two\n\nFirst we');
  });
});

describe('unwrapFence', () => {
  it('drops one fence around the whole answer, and the blank lines around it', () => {
    expect(unwrapFence('```markdown\n# A\n\nB\n```\n')).toBe('# A\n\nB');
    expect(unwrapFence('\n\n```md\nx\n```')).toBe('x');
    expect(unwrapFence('````\n```js\ncode\n```\n````')).toBe('```js\ncode\n```');
  });
  it('leaves other answers alone (a code block among text is content)', () => {
    expect(unwrapFence('Run:\n\n```sh\nnpm i\n```')).toBe('Run:\n\n```sh\nnpm i\n```');
    expect(unwrapFence('```js\nx\n```')).toBe('```js\nx\n```');
    expect(unwrapFence('  plain  ')).toBe('plain');
  });
});

/** The host text's blocks other than the one at `index` (paragraph-separated). */
const blocksExcept = (text: string, keep: number[]) => text.split('\n\n').filter((_, i) => keep.includes(i));

describe('acceptSuggestion', () => {
  it('replaces the selected text in one transaction and one edit; every other block stays byte-identical', () => {
    const t = setup(MD);
    t.select('text here');
    const r = aiRange(t.ctx.state, 'improve')!;
    expect(acceptSuggestion(t.ctx, r, 'words **here**', 'replace')).toBe(true);
    expect(t.dispatched()).toBe(1);
    const edits = t.sync();
    expect(edits).toHaveLength(1);
    expect(edits[0]!.edits).toHaveLength(1);
    expect(t.host.text).toBe('# Keep  this   *exactly*\n\nSome  *odd*   words **here**, as written.\n\n* other\n* list  item\n\nLast   para.\n');
    // The edit stays inside the paragraph that held the selection.
    const e = edits[0]!.edits[0]!;
    const para = MD.indexOf('Some');
    expect(e.start).toBeGreaterThanOrEqual(para);
    expect(e.end).toBeLessThanOrEqual(MD.indexOf('\n\n* other'));
    expect(blocksExcept(t.host.text, [0, 2, 3])).toEqual(blocksExcept(MD, [0, 2, 3]));
  });

  it('a multi-block answer for whole blocks replaces exactly those blocks', () => {
    const t = setup(MD);
    const { doc } = t.ctx.state;
    const from = doc.child(0).nodeSize + 1;
    const to = from + doc.child(1).nodeSize + doc.child(2).nodeSize - 3;
    t.ctx.state = t.ctx.state.apply(t.ctx.state.tr.setSelection(TextSelection.create(doc, from, to)));
    const r = aiRange(t.ctx.state, 'shorten')!;
    expect(r.block).toBe(true);
    acceptSuggestion(t.ctx, r, '```markdown\n## Short\n\n1. one\n2. two\n```', 'replace');
    expect(t.dispatched()).toBe(1);
    expect(t.sync()).toHaveLength(1);
    expect(t.host.text).toBe('# Keep  this   *exactly*\n\n## Short\n\n1. one\n2. two\n\nLast   para.\n');
  });

  it('Insert below adds the answer after the block and changes nothing else', () => {
    const t = setup(MD);
    t.select('text here');
    const r = aiRange(t.ctx.state, 'summarize')!;
    acceptSuggestion(t.ctx, r, 'A *summary*.', 'below');
    expect(t.dispatched()).toBe(1);
    expect(t.sync()).toHaveLength(1);
    expect(t.host.text).toBe('# Keep  this   *exactly*\n\nSome  *odd*   text here, as written.\n\nA *summary*.\n\n* other\n* list  item\n\nLast   para.\n');
  });

  it('Continue writing inserts at the cursor, with a space after the last word', () => {
    const t = setup('# Plan\n\nFirst we\n');
    const end = t.ctx.state.doc.content.size - 1;
    t.ctx.state = t.ctx.state.apply(t.ctx.state.tr.setSelection(TextSelection.create(t.ctx.state.doc, end)));
    acceptSuggestion(t.ctx, aiRange(t.ctx.state, 'continue')!, 'plan, then **build**.\n\nAnd ship.', 'replace');
    t.sync();
    expect(t.host.text).toBe('# Plan\n\nFirst we plan, then **build**.\n\nAnd ship.\n');
  });

  it('an empty answer changes nothing', () => {
    const t = setup(MD);
    t.select('text here');
    expect(acceptSuggestion(t.ctx, aiRange(t.ctx.state, 'improve')!, '  \n', 'replace')).toBe(false);
    expect(t.dispatched()).toBe(0);
    expect(t.sync()).toEqual([]);
    expect(t.host.text).toBe(MD);
  });

  it('the new blocks get fresh ids', () => {
    const t = setup('One\n\nTwo\n');
    t.select('One');
    acceptSuggestion(t.ctx, aiRange(t.ctx.state, 'longer')!, 'Uno\n\nDos', 'replace');
    const ids = new Set<string>();
    t.ctx.state.doc.forEach((n: PmNode) => ids.add(n.attrs.blockId as string));
    expect(ids.size).toBe(t.ctx.state.doc.childCount);
  });
});
