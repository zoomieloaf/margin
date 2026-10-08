import { baseKeymap, chainCommands, exitCode, toggleMark } from 'prosemirror-commands';
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { TextSelection, type Command, type Plugin } from 'prosemirror-state';
import { goToNextCell } from 'prosemirror-tables';
import { tableEnter, tableTabAddRow } from './commands';
import { schema } from './schema';

const n = schema.nodes;
const m = schema.marks;

export interface KeyHandlers {
  undo(): void;
  redo(): void;
  toggleMode(): void;
  editLink(): void;
}

const call = (fn: () => void): Command => () => {
  fn();
  return true;
};

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(n.hard_break!.create()).scrollIntoView());
  return true;
};

const notInCode = (cmd: Command): Command => (state, dispatch, view) =>
  state.selection.$from.parent.type === n.code_block ? false : cmd(state, dispatch, view);

/** `[ ] ` or `[x] ` at the start of a list item (or a plain paragraph) makes it a task. */
const taskRule = new InputRule(/^\[( |x|X)?\]\s$/, (state, match, start, end) => {
  const checked = (match[1] ?? ' ').toLowerCase() === 'x';
  const $start = state.doc.resolve(start);
  const tr = state.tr.delete(start, end);
  for (let d = $start.depth; d > 0; d--) {
    if ($start.node(d).type === n.list_item) {
      tr.setNodeMarkup($start.before(d), undefined, { ...$start.node(d).attrs, checked });
      return tr;
    }
  }
  if ($start.parent.type !== n.paragraph) return null;
  const range = tr.doc.resolve(tr.mapping.map(start)).blockRange();
  if (!range) return null;
  tr.wrap(range, [{ type: n.bullet_list! }, { type: n.list_item!, attrs: { checked } }]);
  return tr;
});

/** `---` + space on an empty line becomes a divider. */
const ruleRule = new InputRule(/^(?:---|\*\*\*|___)\s$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.depth !== 1 || $start.parent.type !== n.paragraph) return null;
  const from = $start.before(1);
  const to = $start.after(1);
  if (end !== to - 1) return null;
  const tr = state.tr.replaceWith(from, to, [n.horizontal_rule!.create(), n.paragraph!.create()]);
  return tr.setSelection(TextSelection.create(tr.doc, from + 2));
});

export function editorKeymaps(h: KeyHandlers): Plugin[] {
  return [
    inputRules({
      rules: [
        textblockTypeInputRule(/^(#{1,6})\s$/, n.heading!, (match) => ({ level: match[1]!.length })),
        textblockTypeInputRule(/^```([\w+-]*)\s$/, n.code_block!, (match) => ({ lang: match[1] || null })),
        wrappingInputRule(/^\s*>\s$/, n.blockquote!),
        wrappingInputRule(/^\s*([-*+])\s$/, n.bullet_list!),
        wrappingInputRule(
          /^(\d+)[.)]\s$/,
          n.ordered_list!,
          (match) => ({ start: Number(match[1]) }),
          (match, node) => node.childCount + (node.attrs.start as number) === Number(match[1]),
        ),
        taskRule,
        ruleRule,
      ],
    }),
    keymap({
      'Mod-z': call(h.undo),
      'Mod-y': call(h.redo),
      'Shift-Mod-z': call(h.redo),
      'Mod-e': call(h.toggleMode),
      'Mod-k': call(h.editLink),
      'Mod-b': notInCode(toggleMark(m.strong!)),
      'Mod-i': notInCode(toggleMark(m.em!)),
      'Shift-Mod-x': notInCode(toggleMark(m.strike!)),
      'Shift-Mod-h': notInCode(toggleMark(m.mark!)),
      'Mod-`': notInCode(toggleMark(m.code!)),
      Enter: chainCommands(tableEnter, splitListItem(n.list_item!)),
      'Shift-Enter': chainCommands(exitCode, insertHardBreak),
      Tab: chainCommands(goToNextCell(1), tableTabAddRow, sinkListItem(n.list_item!)),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(n.list_item!)),
    }),
    keymap(baseKeymap),
  ];
}
