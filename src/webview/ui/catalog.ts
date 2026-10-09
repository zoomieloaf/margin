import { PAGE_WIDTH_LABEL, PAGE_WIDTHS, type AiAction, type PageWidth } from '../../bridge/messages';
import type { BlockType, InsertKind, TableActionId } from '../editor/commands';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  glyph?: string;
  desc?: string;
  /** Markdown syntax shown on the right, so the menu also teaches Markdown. */
  md?: string;
  keys?: string;
  badge?: string;
}

export interface MenuGroup {
  title?: string;
  items: MenuItem[];
}

export const BLOCKS: Array<MenuItem & { id: BlockType }> = [
  { id: 'p', label: 'Text', glyph: 'Aa', desc: 'Plain paragraph', keys: 'paragraph plain' },
  { id: 'h1', label: 'Heading 1', glyph: 'H1', desc: 'Page title', md: '#', keys: 'title big' },
  { id: 'h2', label: 'Heading 2', glyph: 'H2', desc: 'Section heading', md: '##' },
  { id: 'h3', label: 'Heading 3', glyph: 'H3', desc: 'Subsection heading', md: '###' },
  { id: 'ul', label: 'Bulleted list', icon: 'list', desc: 'Simple bullets', md: '-', keys: 'unordered' },
  { id: 'ol', label: 'Numbered list', icon: 'olist', desc: 'Ordered steps', md: '1.', keys: 'ordered' },
  { id: 'task', label: 'To-do list', icon: 'task', desc: 'Track tasks with checkboxes', md: '[ ]', keys: 'todo checkbox checklist' },
  { id: 'blockquote', label: 'Quote', icon: 'quote', desc: 'Quoted text', md: '>' },
  { id: 'callout', label: 'Callout', icon: 'info', desc: 'Note, tip or warning box', md: '[!NOTE]', keys: 'admonition note tip warning' },
  { id: 'code', label: 'Code block', icon: 'codeblock', desc: 'Fenced code with a language', md: '```', keys: 'snippet pre' },
];

export const INSERTS: Array<MenuItem & { id: InsertKind }> = [
  { id: 'table', label: 'Table', icon: 'table', desc: '3 columns, 2 rows', keys: 'grid' },
  { id: 'hr', label: 'Divider', icon: 'minus', desc: 'Horizontal rule', md: '---', keys: 'line rule separator' },
  { id: 'mermaid', label: 'Diagram', icon: 'diagram', desc: 'Mermaid flowchart', keys: 'mermaid chart flow' },
];

export const LABEL: Record<string, string> = Object.fromEntries([...BLOCKS, ...INSERTS].map((b) => [b.id, b.label]));

export const EXPORTS: MenuGroup[] = [
  {
    items: [
      { id: 'pdf', label: 'Export as PDF', icon: 'file', desc: 'Uses Edge or Chrome on this machine' },
      { id: 'html', label: 'Export as HTML', icon: 'globe', desc: 'Single self-contained file' },
    ],
  },
  {
    items: [
      { id: 'rich', label: 'Copy as rich text', icon: 'copy', desc: 'For Slack, email, Confluence' },
      { id: 'md', label: 'Copy as Markdown', icon: 'hash', desc: 'The exact file contents' },
    ],
  },
];

/** The AI actions that rewrite the selection, in menu order (ids are the bridge's AiAction). */
const AI_EDIT: Array<MenuItem & { id: AiAction }> = [
  { id: 'improve', label: 'Improve writing', icon: 'sparkles' },
  { id: 'shorten', label: 'Shorten', icon: 'shorten' },
  { id: 'longer', label: 'Make longer', icon: 'lengthen' },
  { id: 'grammar', label: 'Fix spelling & grammar', icon: 'spell' },
  { id: 'translate', label: 'Translate to…', icon: 'translate' },
  { id: 'summarize', label: 'Summarize', icon: 'list' },
];

/** The AI actions that write new text (they also work with nothing selected). */
const AI_WRITE: Array<MenuItem & { id: AiAction }> = [
  { id: 'continue', label: 'Continue writing', icon: 'pencil', desc: 'AI writes what comes next', keys: 'ai' },
  { id: 'ask', label: 'Ask AI…', icon: 'sparkles', desc: 'Tell AI what to write', keys: 'ai' },
];

/**
 * The AI menu. `selection`: text is selected (otherwise only the writing actions apply).
 * `editor`: the editor's model answers in place; otherwise each action opens a chat.
 */
export function aiGroups({ selection, editor }: { selection: boolean; editor: boolean }): MenuGroup[] {
  const chat = editor ? '' : ' · opens a chat';
  const write = { title: `Write with AI${selection ? '' : chat}`, items: AI_WRITE };
  return selection ? [{ title: `Edit with AI${chat}`, items: AI_EDIT }, write] : [write];
}

export const AI_LANGUAGES = ['English', 'Russian', 'German', 'French', 'Spanish', 'Chinese', 'Japanese'];

/** The Translate to… submenu: item ids are `lang:<Language>`, and `lang:` for Other…. */
export function translateGroups(): MenuGroup[] {
  return [{ title: 'Translate to', items: [...AI_LANGUAGES.map((l) => ({ id: `lang:${l}`, label: l })), { id: 'lang:', label: 'Other…' }] }];
}

/** The toolbar's width menu: the four widths (ids are the bridge's PageWidth), then `default` (the setting, named). */
export function pageWidthGroups(setting: PageWidth): MenuGroup[] {
  return [
    { title: 'Page width', items: PAGE_WIDTHS.map((w) => ({ id: w, label: PAGE_WIDTH_LABEL[w] })) },
    { items: [{ id: 'default', label: `Use default (${PAGE_WIDTH_LABEL[setting]})` }] },
  ];
}

export const BLOCK_ACTIONS: MenuGroup = {
  items: [
    { id: 'dup', label: 'Duplicate', icon: 'copy' },
    { id: 'up', label: 'Move up', icon: 'up' },
    { id: 'down', label: 'Move down', icon: 'down' },
    { id: 'del', label: 'Delete', icon: 'trash' },
  ],
};

export const TABLE_ACTIONS: Array<MenuItem & { id: TableActionId }> = [
  { id: 'addRowAfter', label: 'Add row below', icon: 'plus' },
  { id: 'addColumnAfter', label: 'Add column right', icon: 'plus' },
  { id: 'deleteRow', label: 'Delete row', icon: 'minus' },
  { id: 'deleteColumn', label: 'Delete column', icon: 'minus' },
];

/** The ⋮⋮ block menu for a top-level node of type `nodeType`: tables get row and column actions instead of "Turn into". */
export function blockMenuGroups(nodeType: string): MenuGroup[] {
  return nodeType === 'table'
    ? [{ title: 'Table', items: TABLE_ACTIONS }, BLOCK_ACTIONS]
    : [{ title: 'Turn into', items: BLOCKS }, BLOCK_ACTIONS];
}

/** Slash-menu groups filtered by what the user typed after `/`. `ai`: AI actions are on (slash ids `ai:<action>`). */
export function slashGroups(query: string, ai = false): MenuGroup[] {
  const q = query.toLowerCase();
  const match = (it: MenuItem) => !q || `${it.label} ${it.keys ?? ''} ${it.id}`.toLowerCase().includes(q);
  const groups = [
    { title: 'Basic blocks', items: BLOCKS.filter(match) },
    { title: 'Insert', items: INSERTS.filter(match) },
  ];
  if (!ai) return groups;
  const aiGroup = { title: 'AI', items: AI_WRITE.filter(match).map((it) => ({ ...it, id: `ai:${it.id}` })) };
  // `/ai` also matches "plain" and "mermaid": the AI items come first so Enter runs Continue writing.
  return q.startsWith('ai') ? [aiGroup, ...groups] : [...groups, aiGroup];
}
