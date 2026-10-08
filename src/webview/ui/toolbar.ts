import type { EditorState } from 'prosemirror-state';
import type { Mode } from '../../bridge/messages';
import { activeState } from '../editor/commands';
import type { AppApi } from './api';
import { LABEL } from './catalog';
import { icon } from './icons';

const btn = (act: string, ic: string, tip: string, key = '', extra = '') =>
  `<button type="button" class="tb" data-act="${act}" ${extra} data-tip="${tip}"${key ? ` data-key="${key}"` : ''} aria-label="${tip}">${icon(ic)}</button>`;
const blockBtn = (block: string, ic: string, tip: string) => btn('block', ic, tip, '', `data-block="${block}"`);

const TEMPLATE = `
<div class="seg" role="group" aria-label="View mode">
  <button type="button" data-mode="preview" data-tip="Preview" data-key="Ctrl+E">${icon('eye')}<span>Preview</span></button>
  <button type="button" data-mode="edit" data-tip="Edit" data-key="Ctrl+E">${icon('pencil')}<span>Edit</span></button>
  <button type="button" data-mode="source" data-tip="Markdown source">${icon('hash')}<span>Markdown</span></button>
</div>
<div class="tb-hint hint-preview"><b>Double-click</b> any text to start editing</div>
<div class="tb-hint hint-source">Raw Markdown. Your edits go to the file as you type.</div>
<div class="fmt">
  <span class="vsep"></span>
  ${btn('undo', 'undo', 'Undo', 'Ctrl+Z')}
  ${btn('redo', 'redo', 'Redo', 'Ctrl+Y')}
  <span class="vsep"></span>
  <button type="button" class="tb" data-act="turn" aria-haspopup="menu" data-tip="Block type"><span class="blk-label">Text</span>${icon('chev', 'chev')}</button>
  <span class="vsep"></span>
  ${btn('strong', 'bold', 'Bold', 'Ctrl+B')}
  ${btn('em', 'italic', 'Italic', 'Ctrl+I')}
  ${btn('strike', 'strike', 'Strikethrough', 'Ctrl+Shift+X')}
  ${btn('code', 'code', 'Inline code', 'Ctrl+`')}
  ${btn('mark', 'highlight', 'Highlight', 'Ctrl+Shift+H')}
  ${btn('link', 'link', 'Link', 'Ctrl+K')}
  <span class="vsep"></span>
  ${blockBtn('ul', 'list', 'Bulleted list')}
  ${blockBtn('ol', 'olist', 'Numbered list')}
  ${blockBtn('task', 'task', 'To-do list')}
  ${blockBtn('blockquote', 'quote', 'Quote')}
  ${blockBtn('callout', 'info', 'Callout')}
  ${blockBtn('code', 'codeblock', 'Code block')}
  ${btn('insert', 'table', 'Table', '', 'data-insert="table"')}
  ${btn('insert', 'minus', 'Divider', '', 'data-insert="hr"')}
  <span class="vsep ai-sep"></span>
  <button type="button" class="tb ai" data-act="ai" aria-haspopup="menu" data-tip="AI actions">${icon('sparkles')}<span>AI</span>${icon('chev', 'chev')}</button>
</div>
<div class="tb-spacer"></div>
${btn('outline', 'panel', 'Outline', '', 'aria-pressed="false"')}
<button type="button" class="tb primary" data-act="export" aria-haspopup="menu">${icon('download')}<span>Export</span>${icon('chev', 'chev')}</button>
`;

export class Toolbar {
  readonly el: HTMLDivElement;

  constructor(private readonly app: AppApi) {
    this.el = document.createElement('div');
    this.el.className = 'toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Markdown formatting');
    this.el.innerHTML = TEMPLATE;
    this.el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const mode = target.closest<HTMLElement>('button[data-mode]'); // not the .app root, which also has data-mode
      if (mode) return this.app.setMode(mode.dataset.mode as Mode);
      const b = target.closest<HTMLElement>('[data-act]');
      if (!b) return;
      if (this.app.menu.anchor === b) return this.app.menu.close();
      this.app.act(b.dataset.act!, b, b.dataset.block ?? b.dataset.insert);
    });
  }

  update(state: EditorState, mode: Mode, outlineOpen: boolean): void {
    this.el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    this.el.querySelector('[data-act="outline"]')?.setAttribute('aria-pressed', String(outlineOpen));
    if (mode !== 'edit') return;
    const a = activeState(state);
    for (const name of ['strong', 'em', 'strike', 'code', 'mark', 'link'] as const) {
      this.el.querySelector(`[data-act="${name}"]`)?.setAttribute('aria-pressed', String(a.marks.has(name)));
    }
    this.el.querySelectorAll<HTMLElement>('[data-act="block"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.block === a.block)));
    const label = this.el.querySelector('.blk-label');
    if (label) label.textContent = LABEL[a.block] ?? 'Mixed';
  }
}
