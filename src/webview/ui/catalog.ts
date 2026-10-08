import type { BlockType, InsertKind } from '../editor/commands';

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

export const AI: MenuGroup[] = [
  {
    title: 'AI on selection',
    items: [
      { id: 'improve', label: 'Improve writing', icon: 'sparkles', badge: 'Soon' },
      { id: 'shorter', label: 'Make shorter', icon: 'shorten', badge: 'Soon' },
      { id: 'grammar', label: 'Fix spelling and grammar', icon: 'spell', badge: 'Soon' },
      { id: 'translate', label: 'Translate', icon: 'translate', badge: 'Soon' },
    ],
  },
];

export const BLOCK_ACTIONS: MenuGroup = {
  items: [
    { id: 'dup', label: 'Duplicate', icon: 'copy' },
    { id: 'up', label: 'Move up', icon: 'up' },
    { id: 'down', label: 'Move down', icon: 'down' },
    { id: 'del', label: 'Delete', icon: 'trash' },
  ],
};

/** Slash-menu groups filtered by what the user typed after `/`. */
export function slashGroups(query: string): MenuGroup[] {
  const q = query.toLowerCase();
  const match = (it: MenuItem) => !q || `${it.label} ${it.keys ?? ''} ${it.id}`.toLowerCase().includes(q);
  return [
    { title: 'Basic blocks', items: BLOCKS.filter(match) },
    { title: 'Insert', items: INSERTS.filter(match) },
  ];
}
