import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { HostToWebview, WebviewToHost } from '../../src/bridge/messages';
import { applyEdit } from '../../src/md/edits';
import { staleEditAction } from '../../src/host/syncPolicy';
import { uniqueIds } from '../../src/webview/editor/ids';
import { DocModel } from '../../src/webview/editor/model';

/** The extension host side of DocumentSync, without VS Code. `dropStale: false` is the pre-fix policy. */
class FakeHost {
  readonly toWebview: HostToWebview[] = [];
  resets = 0;
  private lastResetVersion = -1;
  constructor(public text: string, public version: number, private readonly dropStale = true) {}

  external(text: string): void {
    this.text = text;
    this.version++;
    this.reset();
  }

  receive(m: WebviewToHost): void {
    if (m.type === 'resync') return this.reset();
    if (m.type !== 'edit') return;
    const action = this.dropStale ? staleEditAction(m.version, this.version, this.lastResetVersion) : m.version === this.version ? 'apply' : 'reset';
    if (action === 'reset') return this.reset();
    if (action === 'drop') return;
    for (const e of m.edits) this.text = applyEdit(this.text, e);
    this.version++;
    this.toWebview.push({ type: 'ack', version: this.version });
  }

  private reset(): void {
    this.resets++;
    this.lastResetVersion = this.version;
    this.toWebview.push({ type: 'reset', text: this.text, version: this.version });
  }
}

/** The webview: a DocModel plus the ProseMirror state it shows. */
function webview(text: string, version: number) {
  const toHost: WebviewToHost[] = [];
  const model = new DocModel(
    (e) => toHost.push({ type: 'edit', version: e.version, edits: e.edits }),
    () => toHost.push({ type: 'resync' }),
  );
  const create = (doc: ReturnType<DocModel['load']>) => EditorState.create({ doc, plugins: [uniqueIds(model.newId)] });
  let state = create(model.load(text, version));
  return {
    toHost,
    model,
    /** Types at the end of the first paragraph and reports the change (as the debounce would). */
    type(s: string) {
      state = state.apply(state.tr.insertText(s, state.doc.child(0).nodeSize - 1));
      model.change(state.doc);
    },
    receive(m: HostToWebview) {
      if (m.type === 'reset') state = create(model.reset(m.text, m.version));
      else if (m.type === 'ack') model.ack(m.version);
    },
    get shown() {
      return state.doc.textContent;
    },
  };
}

/** Delivers everything in flight, both ways, until nothing is left. */
function settle(host: FakeHost, view: ReturnType<typeof webview>) {
  for (let guard = 0; guard < 50 && (host.toWebview.length || view.toHost.length); guard++) {
    while (host.toWebview.length) view.receive(host.toWebview.shift()!);
    while (view.toHost.length) host.receive(view.toHost.shift()!);
  }
}

describe.each([
  ['host drops stale edits once it has sent a reset', true],
  ['host answers every stale edit with a reset (pre-fix host)', false],
])('reset, reset, ack interleaving: %s', (_name, dropStale) => {
  it('the webview and the file end up identical, and later edits land in the right place', () => {
    const host = new FakeHost('Hello\n', 1, dropStale);
    const view = webview(host.text, host.version);

    view.type('X'); // E1 is in flight at v1
    host.external('Other\n'); // someone else writes the file: v2, reset #1
    view.receive(host.toWebview.shift()!); // the webview reloads "Other" at v2 and drops E1
    view.type('Z'); // E2 at v2, in flight
    host.receive(view.toHost.shift()!); // stale E1 (v1)
    host.receive(view.toHost.shift()!); // E2 (v2): valid, applied, acked
    expect(host.text).toBe('OtherZ\n');
    settle(host, view);

    expect(view.model.markdown).toBe(host.text);
    expect(view.shown).toBe(host.text.trimEnd());

    view.type('Y');
    settle(host, view);
    expect(host.text).toBe(`${view.shown}\n`);
    expect(view.model.markdown).toBe(host.text);
    if (dropStale) expect(host.resets).toBe(1);
  });
});

describe('DocModel.ack', () => {
  it('ignores an ack when nothing is in flight and asks for a resync', () => {
    const view = webview('A\n', 4);
    view.receive({ type: 'ack', version: 5 });
    expect(view.toHost).toEqual([{ type: 'resync' }]);
  });

  it('ignores an ack for the wrong version and asks for a resync', () => {
    const view = webview('A\n', 4);
    view.type('b');
    expect(view.toHost).toHaveLength(1);
    view.receive({ type: 'ack', version: 7 });
    expect(view.toHost[1]).toEqual({ type: 'resync' });
    view.type('c'); // nothing is sent while waiting for the resync
    expect(view.toHost).toHaveLength(2);
    view.receive({ type: 'reset', text: 'Ab\n', version: 5 });
    view.type('c');
    expect(view.toHost[2]).toEqual({ type: 'edit', version: 5, edits: [{ start: 2, end: 2, text: 'c' }] });
  });
});

describe('staleEditAction', () => {
  it('applies a current edit, drops a stale one already answered by a reset, resets otherwise', () => {
    expect(staleEditAction(3, 3, -1)).toBe('apply');
    expect(staleEditAction(3, 3, 3)).toBe('apply');
    expect(staleEditAction(2, 3, 3)).toBe('drop');
    expect(staleEditAction(2, 3, 2)).toBe('reset');
    expect(staleEditAction(2, 3, -1)).toBe('reset');
  });
});
