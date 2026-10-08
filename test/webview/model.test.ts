import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { joinBackward, splitBlock } from 'prosemirror-commands';
import { applyEdit } from '../../src/md/edits';
import { parseMarkdown } from '../../src/md/parse';
import { uniqueIds } from '../../src/webview/editor/ids';
import { DocModel, type OutgoingEdit } from '../../src/webview/editor/model';
import { schema } from '../../src/webview/editor/schema';

/** A tiny host: applies edits to its text and acks with an incremented version. */
function setup(text: string) {
  const sent: OutgoingEdit[] = [];
  const host = { text, version: 1 };
  const model = new DocModel((e) => sent.push(e));
  let state = EditorState.create({ doc: model.load(text, host.version), plugins: [uniqueIds(model.newId)] });
  const apply = (fn: (s: EditorState) => Transaction) => {
    state = state.apply(fn(state)); // apply() also runs appendTransaction plugins (uniqueIds)
  };
  const run = (cmd: (s: EditorState, d: (tr: Transaction) => void) => boolean) => {
    cmd(state, (tr) => {
      state = state.applyTransaction(tr).state;
    });
  };
  const sync = () => {
    model.change(state.doc);
    while (sent.length) {
      const e = sent.shift()!;
      expect(e.version).toBe(host.version);
      for (const ed of e.edits) host.text = applyEdit(host.text, ed);
      host.version++;
      model.ack(host.version);
    }
    return host.text;
  };
  const posIn = (blockIndex: number, offset: number) => {
    let pos = 0;
    for (let i = 0; i < blockIndex; i++) pos += state.doc.child(i).nodeSize;
    return pos + 1 + offset;
  };
  return { get state() { return state; }, apply, run, sync, posIn, host, sent, model };
}

describe('DocModel', () => {
  it('typing in one block changes only that block', () => {
    const src = '# Title\n\nFirst  para.\n\n* keep\n* style\n\nLast _one_.\n';
    const t = setup(src);
    t.apply((s) => s.tr.insertText(' edited', t.posIn(1, 'First  para.'.length)));
    expect(t.sync()).toBe('# Title\n\nFirst  para. edited\n\n* keep\n* style\n\nLast _one_.\n');
  });

  it('sends nothing when nothing changed', () => {
    const t = setup('A\n\nB\n');
    t.apply((s) => s.tr.setMeta('noop', true));
    t.model.change(t.state.doc);
    expect(t.sent).toEqual([]);
  });

  it('Enter splits a paragraph into two blocks; the first keeps its id', () => {
    const t = setup('Hello world\n');
    const firstId = t.state.doc.child(0).attrs.blockId as string;
    t.apply((s) => s.tr.setSelection(TextSelection.create(s.doc, t.posIn(0, 5))));
    t.run(splitBlock);
    expect(t.state.doc.child(0).attrs.blockId).toBe(firstId);
    expect(t.state.doc.child(1).attrs.blockId).not.toBe(firstId);
    expect(t.sync()).toBe('Hello\n\nworld\n');
  });

  it('Backspace at the start of a paragraph joins it with the previous one', () => {
    const t = setup('One\n\nTwo\n\nThree\n');
    t.apply((s) => s.tr.setSelection(TextSelection.create(s.doc, t.posIn(1, 0))));
    t.run(joinBackward);
    expect(t.sync()).toBe('OneTwo\n\nThree\n');
  });

  it('deleting a block removes it and its gap', () => {
    const t = setup('A\n\nB\n\nC\n');
    const from = t.posIn(1, 0) - 1;
    t.apply((s) => s.tr.delete(from, from + s.doc.child(1).nodeSize));
    expect(t.sync()).toBe('A\n\nC\n');
  });

  it('moving a block keeps its bytes', () => {
    const t = setup('A\n\n+ x\n');
    const list = t.state.doc.child(1);
    const at = t.state.doc.child(0).nodeSize;
    t.apply((s) => s.tr.delete(at, at + list.nodeSize).insert(0, list));
    expect(t.sync()).toBe('+ x\n\nA\n');
  });

  it('keeps raw blocks byte-identical next to an edit', () => {
    const src = '---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nPara\n';
    const t = setup(src);
    t.apply((s) => s.tr.insertText('!', t.posIn(2, 4)));
    expect(t.sync()).toBe('---\nt: 1\n---\n\n<div>\n  hi\n</div>\n\nPara!\n');
  });

  it('toggling a task checkbox changes only that list', () => {
    const t = setup('Intro\n\n- [ ] a\n- [x] b\n');
    const listPos = t.state.doc.child(0).nodeSize;
    t.apply((s) => s.tr.setNodeMarkup(listPos + 1, undefined, { checked: true, spread: false }));
    expect(t.sync()).toBe('Intro\n\n- [x] a\n- [x] b\n');
  });

  it('holds further changes until the host acks, then sends them as one edit', () => {
    const sent: OutgoingEdit[] = [];
    const model = new DocModel((e) => sent.push(e));
    let state = EditorState.create({ doc: model.load('Hi\n', 7), plugins: [uniqueIds(model.newId)] });
    state = state.apply(state.tr.insertText('!', 3));
    model.change(state.doc);
    state = state.apply(state.tr.insertText('?', 4));
    model.change(state.doc);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ version: 7, edits: [{ start: 2, end: 2, text: '!' }] });
    model.ack(8);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ version: 8, edits: [{ start: 3, end: 3, text: '?' }] });
  });

  it('whenIdle runs at once when idle, otherwise only after every pending edit is acked', () => {
    const sent: OutgoingEdit[] = [];
    const model = new DocModel((e) => sent.push(e));
    let state = EditorState.create({ doc: model.load('Hi\n', 1), plugins: [uniqueIds(model.newId)] });
    const log: string[] = [];
    model.whenIdle(() => log.push('a'));
    expect(log).toEqual(['a']);
    state = state.apply(state.tr.insertText('!', 3));
    model.change(state.doc);
    state = state.apply(state.tr.insertText('?', 4));
    model.change(state.doc); // held until the first edit is acked
    model.whenIdle(() => log.push('undo'));
    expect(log).toEqual(['a']);
    model.ack(2); // sends the held edit; still busy
    expect(sent).toHaveLength(2);
    expect(log).toEqual(['a']);
    model.ack(3);
    expect(log).toEqual(['a', 'undo']);
  });

  it('whenIdle callbacks also run after a reset', () => {
    const model = new DocModel(() => {});
    const state = EditorState.create({ doc: model.load('A\n', 1) });
    model.change(state.apply(state.tr.insertText('x', 1)).doc);
    const log: string[] = [];
    model.whenIdle(() => log.push('undo'));
    expect(log).toEqual([]);
    model.reset('B\n', 5);
    expect(log).toEqual(['undo']);
  });

  it('reset discards pending changes and reloads', () => {
    const sent: OutgoingEdit[] = [];
    const model = new DocModel((e) => sent.push(e));
    const state = EditorState.create({ doc: model.load('A\n', 1) });
    model.change(state.apply(state.tr.insertText('x', 1)).doc);
    const doc = model.reset('B\n', 5);
    expect(doc.textContent).toBe('B');
    expect(model.markdown).toBe('B\n');
    expect(model.busy).toBe(false);
  });

  it('replaceText (Markdown mode) sends the full-text diff', () => {
    const sent: OutgoingEdit[] = [];
    const model = new DocModel((e) => sent.push(e));
    model.load('# A\n\nB\n', 3);
    const doc = model.replaceText('# A\n\nB changed\n');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.version).toBe(3);
    expect(applyEdit('# A\n\nB\n', sent[0]!.edits[0]!)).toBe('# A\n\nB changed\n');
    expect(doc.childCount).toBe(2);
  });

  it('round-trips a whole corpus file untouched (no edit)', () => {
    const src = '> [!TIP]\n> Try it.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nx\n```\n';
    const t = setup(src);
    expect(parseMarkdown(src).blocks).toHaveLength(3);
    t.model.change(t.state.doc);
    expect(t.sent).toEqual([]);
  });
});
