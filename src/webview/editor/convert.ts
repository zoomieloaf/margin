import type {
  BlockContent, DefinitionContent, Link, List, ListItem, PhrasingContent, RootContent, Table, TableCell,
} from 'mdast';
import type { Mark as PmMark, Node as PmNode } from 'prosemirror-model';
import { DEFAULT_CONVENTIONS } from '../../md/conventions';
import { serializeBlock } from '../../md/serialize';
import type { Callout, SourceBlock } from '../../md/types';
import { schema } from './schema';

type FlowContent = BlockContent | DefinitionContent;
type InlineParent = { children: PhrasingContent[] };

const n = schema.nodes;
const m = schema.marks;

const display = (node: RootContent): string => {
  try {
    return serializeBlock(node, DEFAULT_CONVENTIONS);
  } catch {
    return `[${node.type}]`;
  }
};
const inlineDisplay = (node: PhrasingContent): string =>
  display({ type: 'paragraph', children: [node] });

// ---------------------------------------------------------------- mdast → ProseMirror

export function blockToPm(block: SourceBlock): PmNode {
  if (block.kind === 'raw') {
    return n.raw!.create({ blockId: block.id, source: block.original ?? display(block.data), mdast: block.data });
  }
  const node = flowToPm(block.data);
  return node.type.create({ ...node.attrs, blockId: block.id }, node.content, node.marks);
}

function flowToPm(node: RootContent): PmNode {
  switch (node.type) {
    case 'paragraph':
      return n.paragraph!.create(null, inlineToPm(node.children));
    case 'heading':
      return n.heading!.create({ level: node.depth }, inlineToPm(node.children));
    case 'blockquote':
      return n.blockquote!.create(null, flowChildren(node.children, true));
    case 'callout':
      return n.callout!.create({ kind: node.kind, label: node.label ?? null }, flowChildren(node.children, false));
    case 'code':
      return n.code_block!.create({ lang: node.lang ?? null, meta: node.meta ?? null }, node.value ? schema.text(node.value) : null);
    case 'thematicBreak':
      return n.horizontal_rule!.create();
    case 'list':
      return listToPm(node);
    case 'table':
      return tableToPm(node);
    default:
      return n.block_raw!.create({ mdast: node, text: display(node) });
  }
}

function flowChildren(children: FlowContent[], nonEmpty: boolean): PmNode[] {
  const out = children.map((c) => flowToPm(c));
  return out.length || !nonEmpty ? out : [n.paragraph!.create()];
}

function listToPm(list: List): PmNode {
  const items = list.children.map((item: ListItem) =>
    n.list_item!.create(
      { checked: item.checked ?? null, spread: item.spread ?? null },
      item.children.length ? item.children.map((c) => flowToPm(c)) : [n.paragraph!.create()],
    ),
  );
  return list.ordered
    ? n.ordered_list!.create({ start: list.start ?? 1, spread: list.spread ?? null }, items)
    : n.bullet_list!.create({ spread: list.spread ?? null }, items);
}

function tableToPm(table: Table): PmNode {
  const rows = table.children.map((row, ri) =>
    n.table_row!.create(
      null,
      row.children.map((cell: TableCell, ci) =>
        (ri === 0 ? n.table_header! : n.table_cell!).create({ align: table.align?.[ci] ?? null }, inlineToPm(cell.children)),
      ),
    ),
  );
  return n.table!.create(null, rows);
}

function inlineToPm(nodes: PhrasingContent[], marks: readonly PmMark[] = []): PmNode[] {
  const out: PmNode[] = [];
  const add = (type: keyof typeof m, children: PhrasingContent[], attrs?: Record<string, unknown>) =>
    out.push(...inlineToPm(children, m[type]!.create(attrs).addToSet(marks)));
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if (node.value) out.push(schema.text(node.value, marks));
        break;
      case 'strong': add('strong', node.children); break;
      case 'emphasis': add('em', node.children); break;
      case 'delete': add('strike', node.children); break;
      case 'mark': add('mark', node.children); break;
      case 'link':
        add('link', node.children, { href: node.url, title: node.title ?? null, outside: marks.map((mk) => mk.type.name) });
        break;
      case 'inlineCode':
        if (node.value) out.push(schema.text(node.value, m.code!.create().addToSet(marks)));
        break;
      case 'break':
        out.push(n.hard_break!.create(null, null, marks));
        break;
      case 'image':
        out.push(n.image!.create({ src: node.url, alt: node.alt ?? null, title: node.title ?? null }, null, marks));
        break;
      default:
        out.push(n.inline_raw!.create({ mdast: node, text: inlineDisplay(node) }, null, marks));
    }
  }
  return out;
}

// ---------------------------------------------------------------- ProseMirror → mdast

export function pmToMdast(node: PmNode): RootContent {
  switch (node.type.name) {
    case 'raw':
    case 'block_raw':
      return node.attrs.mdast as RootContent;
    case 'paragraph':
      return { type: 'paragraph', children: trimEdges(inlineFromPm(node)) };
    case 'heading':
      return { type: 'heading', depth: node.attrs.level as 1, children: trimEdges(inlineFromPm(node)) };
    case 'blockquote':
      return { type: 'blockquote', children: flowFromPm(node) };
    case 'callout': {
      const c: Callout = { type: 'callout', kind: node.attrs.kind as Callout['kind'], children: flowFromPm(node) };
      if (node.attrs.label) c.label = node.attrs.label as string;
      return c;
    }
    case 'code_block':
      return { type: 'code', lang: node.attrs.lang as string | null, meta: node.attrs.meta as string | null, value: node.textContent };
    case 'horizontal_rule':
      return { type: 'thematicBreak' };
    case 'bullet_list':
    case 'ordered_list':
      return listFromPm(node);
    case 'table':
      return tableFromPm(node);
    default:
      throw new Error(`Margin: no Markdown mapping for ${node.type.name}`);
  }
}

function flowFromPm(node: PmNode): FlowContent[] {
  const out: FlowContent[] = [];
  node.forEach((child) => out.push(pmToMdast(child) as FlowContent));
  return out;
}

const isEmptyParagraph = (node: PmNode) => node.type === n.paragraph && node.content.size === 0;

function listFromPm(node: PmNode): List {
  const ordered = node.type === n.ordered_list;
  const children: ListItem[] = [];
  node.forEach((item) => {
    const only = item.childCount === 1 ? item.firstChild : null;
    children.push({
      type: 'listItem',
      checked: item.attrs.checked as boolean | null,
      spread: item.attrs.spread as boolean | null,
      children: only && isEmptyParagraph(only) ? [] : flowFromPm(item),
    });
  });
  return {
    type: 'list',
    ordered,
    start: ordered ? (node.attrs.start as number) : null,
    spread: node.attrs.spread as boolean | null,
    children,
  };
}

function tableFromPm(node: PmNode): Table {
  const align: Table['align'] = [];
  node.firstChild?.forEach((cell) => align.push((cell.attrs.align as 'left' | 'right' | 'center' | null) ?? null));
  const children: Table['children'] = [];
  node.forEach((row) => {
    const cells: TableCell[] = [];
    row.forEach((cell) => cells.push({ type: 'tableCell', children: trimEdges(inlineFromPm(cell)) }));
    children.push({ type: 'tableRow', children: cells });
  });
  return { type: 'table', align, children };
}

function wrapperFor(mark: PmMark): PhrasingContent & InlineParent {
  switch (mark.type.name) {
    case 'strong': return { type: 'strong', children: [] };
    case 'em': return { type: 'emphasis', children: [] };
    case 'strike': return { type: 'delete', children: [] };
    case 'mark': return { type: 'mark', children: [] };
    case 'link': {
      const link: Link = { type: 'link', url: mark.attrs.href as string, title: mark.attrs.title as string | null, children: [] };
      return link;
    }
    default:
      throw new Error(`Margin: unexpected mark ${mark.type.name}`);
  }
}

function leafFor(node: PmNode): PhrasingContent {
  if (node.isText) {
    const text = node.text ?? '';
    return node.marks.some((mk) => mk.type === m.code) ? { type: 'inlineCode', value: text } : { type: 'text', value: text };
  }
  switch (node.type.name) {
    case 'hard_break': return { type: 'break' };
    case 'image':
      return { type: 'image', url: node.attrs.src as string, alt: node.attrs.alt as string | null, title: node.attrs.title as string | null };
    case 'inline_raw': return node.attrs.mdast as PhrasingContent;
    default: throw new Error(`Margin: unexpected inline node ${node.type.name}`);
  }
}

/**
 * Markdown can't express spaces at the start or end of a paragraph (they'd be written as
 * `&#x20;`), so text typed there — e.g. after splitting "Hello| world" — is trimmed on save.
 */
function trimEdges(children: PhrasingContent[]): PhrasingContent[] {
  const edge = (list: PhrasingContent[], first: boolean): void => {
    const node = first ? list[0] : list[list.length - 1];
    if (!node) return;
    if (node.type === 'text') {
      node.value = first ? node.value.replace(/^[ \t]+/, '') : node.value.replace(/[ \t]+$/, '');
      if (!node.value) {
        if (first) list.shift();
        else list.pop();
        edge(list, first);
      }
    } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'mark') {
      edge(node.children as PhrasingContent[], first);
    }
  };
  edge(children, true);
  edge(children, false);
  return children;
}

/** Default tie-break when two marks cover exactly the same run. */
const OPEN_ORDER: Record<string, number> = { link: 0, strong: 1, em: 2, strike: 3, mark: 4 };

/** Negative when `a` should be the outer node. A link remembers which marks wrapped it in the source. */
function tieOrder(a: PmMark, b: PmMark): number {
  const outside = (link: PmMark, other: PmMark) => (link.attrs.outside as string[]).includes(other.type.name);
  if (a.type === m.link && b.type !== m.link) return outside(a, b) ? 1 : -1;
  if (b.type === m.link && a.type !== m.link) return outside(b, a) ? -1 : 1;
  return OPEN_ORDER[a.type.name]! - OPEN_ORDER[b.type.name]!;
}

/**
 * Rebuilds nested mdast phrasing from flat PM marks. Marks already open stay open while the
 * next node still has them; new marks open longest-run first, so the outer mark is the one
 * that spans more of the following text (`[**bold** link](u)` keeps the link outside).
 */
function inlineFromPm(parent: PmNode): PhrasingContent[] {
  const kids: PmNode[] = [];
  parent.forEach((c) => kids.push(c));
  const runLength = (mark: PmMark, from: number) => {
    let i = from;
    while (i < kids.length && mark.isInSet(kids[i]!.marks)) i++;
    return i - from;
  };

  const root: PhrasingContent[] = [];
  const stack: Array<{ mark: PmMark; children: PhrasingContent[] }> = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.children : root);
  kids.forEach((child, index) => {
    const marks = child.marks.filter((mk) => mk.type !== m.code);
    let keep = 0;
    while (keep < stack.length && stack[keep]!.mark.isInSet(marks)) keep++;
    stack.length = keep;
    const opening = marks
      .filter((mark) => !stack.some((s) => s.mark.eq(mark)))
      .map((mark) => ({ mark, run: runLength(mark, index) }))
      .sort((a, b) => b.run - a.run || tieOrder(a.mark, b.mark));
    for (const { mark } of opening) {
      const wrapper = wrapperFor(mark);
      top().push(wrapper);
      stack.push({ mark, children: wrapper.children });
    }
    top().push(leafFor(child));
  });
  return root;
}
