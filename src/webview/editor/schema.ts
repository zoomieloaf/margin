import { Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

/** Every top-level node carries the id of the SourceBlock it renders (null until assigned). */
const blockId = { blockId: { default: null } };

const tables = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || null,
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `text-align:${String(value)}`;
      },
    },
  },
});

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { ...blockId },
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { level: { default: 1 }, ...blockId },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${String(node.attrs.level)}`, 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { ...blockId },
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },

  callout: {
    group: 'block',
    content: 'block*',
    defining: true,
    attrs: { kind: { default: 'note' }, label: { default: null }, ...blockId },
    parseDOM: [{ tag: 'div.callout', getAttrs: (dom) => ({ kind: (dom as HTMLElement).dataset.kind ?? 'note' }) }],
    toDOM: (node) => ['div', { class: 'callout', 'data-kind': node.attrs.kind as string }, 0],
  },

  code_block: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { lang: { default: null }, meta: { default: null }, ...blockId },
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: (node) => {
      const lang = node.attrs.lang as string | null;
      return ['pre', lang ? { 'data-lang': lang } : {}, ['code', 0]];
    },
  },

  horizontal_rule: {
    group: 'block',
    attrs: { ...blockId },
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },

  bullet_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { spread: { default: null }, ...blockId },
    parseDOM: [{ tag: 'ul' }],
    toDOM: (node) => (node.firstChild?.attrs.checked != null ? ['ul', { class: 'tasks' }, 0] : ['ul', 0]),
  },

  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { start: { default: 1 }, spread: { default: null }, ...blockId },
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ start: Number((dom as HTMLElement).getAttribute('start') ?? 1) }) }],
    toDOM: (node) => ['ol', node.attrs.start === 1 ? {} : { start: String(node.attrs.start) }, 0],
  },

  list_item: {
    content: 'block+',
    defining: true,
    attrs: { checked: { default: null }, spread: { default: null } },
    parseDOM: [{ tag: 'li' }],
    toDOM: (node): DOMOutputSpec => {
      const checked = node.attrs.checked as boolean | null;
      if (checked === null) return ['li', 0];
      return [
        'li',
        { class: checked ? 'task done' : 'task' },
        ['span', { class: checked ? 'cb on' : 'cb', contenteditable: 'false', role: 'checkbox', 'aria-checked': String(checked) }],
        ['div', { class: 'task-body' }, 0],
      ];
    },
  },

  table: { ...tables.table, attrs: { ...blockId } },
  table_row: tables.table_row,
  table_header: tables.table_header,
  table_cell: tables.table_cell,

  /** A top-level block kept verbatim (frontmatter, HTML, footnote definitions, math, ragged tables...). */
  raw: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { source: { default: '' }, mdast: { default: null }, ...blockId },
    toDOM: (node) => ['pre', { class: 'raw', contenteditable: 'false' }, node.attrs.source as string],
  },

  /** A nested block we have no editor for (inside a list item or quote); kept as its mdast. */
  block_raw: {
    group: 'block',
    atom: true,
    attrs: { mdast: { default: null }, text: { default: '' }, ...blockId },
    toDOM: (node) => ['pre', { class: 'raw', contenteditable: 'false' }, node.attrs.text as string],
  },

  text: { group: 'inline' },

  hard_break: {
    group: 'inline',
    inline: true,
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { src: { default: '' }, alt: { default: null }, title: { default: null } },
    parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => ({ src: (dom as HTMLElement).getAttribute('src'), alt: (dom as HTMLElement).getAttribute('alt'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM: (node) => ['img', { src: node.attrs.src as string, alt: (node.attrs.alt as string | null) ?? '', title: (node.attrs.title as string | null) ?? undefined }],
  },

  /** Inline syntax we don't edit (link/footnote references, inline HTML, inline math); kept as its mdast. */
  inline_raw: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { mdast: { default: null }, text: { default: '' } },
    toDOM: (node) => ['span', { class: 'inline-raw', contenteditable: 'false' }, node.attrs.text as string],
  },
};

/** Order matters: it is the nesting order used when writing Markdown (outermost first). */
const marks: Record<string, MarkSpec> = {
  link: {
    /** `outside`: formatting marks that wrapped this link in the source (`**[x](y)**` → ['strong']). */
    attrs: { href: {}, title: { default: null }, outside: { default: [] } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM: (mark) => ['a', { href: mark.attrs.href as string, title: (mark.attrs.title as string | null) ?? undefined }, 0],
  },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
  mark: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', 0] },
  code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
};

export const schema = new Schema({ nodes, marks });
