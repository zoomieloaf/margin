// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DOMSerializer, type Node as PmNode, type ResolvedPos, type Slice } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import * as pmView from 'prosemirror-view';
import { DEFAULT_CONVENTIONS } from '../../src/md/conventions';
import { nodeKey } from '../../src/md/key';
import { serializeBlock } from '../../src/md/serialize';
import { pmToMdast } from '../../src/webview/editor/convert';
import { DocModel } from '../../src/webview/editor/model';
import { schema } from '../../src/webview/editor/schema';

// The real paste path; exported for tests but missing from the typings.
const { EditorView } = pmView;
const __parseFromClipboard = (pmView as unknown as {
  __parseFromClipboard(view: pmView.EditorView, text: string, html: string | null, plain: boolean, $context: ResolvedPos): Slice;
}).__parseFromClipboard;

/** Copies the whole document as ProseMirror would (DOMSerializer → HTML) and pastes it back (the view's clipboard parser). */
function copyPaste(md: string): { before: PmNode[]; after: PmNode[] } {
  const doc = new DocModel(() => {}).load(md, 1);
  const view = new EditorView(document.createElement('div'), { state: EditorState.create({ doc }) });
  const box = document.createElement('div');
  box.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  const slice = __parseFromClipboard(view, '', box.innerHTML, false, doc.resolve(0));
  view.destroy();
  const before: PmNode[] = [];
  const after: PmNode[] = [];
  doc.forEach((n: PmNode) => before.push(n));
  slice.content.forEach((n: PmNode) => after.push(n));
  return { before, after };
}

const write = (node: PmNode) => serializeBlock(pmToMdast(node), DEFAULT_CONVENTIONS);
const shape = (node: PmNode): string => {
  const parts: string[] = [];
  node.descendants((d) => {
    parts.push(d.type.name);
    return true;
  });
  return `${node.type.name}(${parts.join(',')})`;
};

describe('copy and paste inside Margin keeps raw content as written', () => {
  it.each([
    ['raw HTML block', '<div align="center">\n  <b>hi</b>\n</div>\n'],
    ['footnote reference', 'Text with a note[^1].\n\n[^1]: The note.\n'],
    ['inline HTML', 'Press <kbd>Ctrl</kbd> now.\n'],
    ['HTML inside a list item', '- a\n\n  <div>x</div>\n'],
    ['display math', '$$\nx^2\n$$\n'],
    ['frontmatter', '---\ntitle: x\n---\n\nBody\n'],
    ['loose task list', '- [ ] a\n\n- [x] b\n'],
    ['ordered list starting at 3', '3. three\n4. four\n'],
  ])('%s', (_name, md) => {
    const { before, after } = copyPaste(md);
    expect(after.map(shape)).toEqual(before.map(shape));
    after.forEach((node, i) => {
      expect(nodeKey(pmToMdast(node))).toBe(nodeKey(pmToMdast(before[i]!)));
      expect(write(node)).toBe(write(before[i]!));
    });
  });

  it('the raw block keeps its exact source text', () => {
    const { after } = copyPaste('<div>\n  hi\n</div>\n');
    expect(after[0]!.type.name).toBe('raw');
    expect(after[0]!.attrs.source).toBe('<div>\n  hi\n</div>');
  });
});
