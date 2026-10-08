import { DOMSerializer, Fragment } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { AiAction, AiRequest, AiSetting, WebviewToHost } from '../../bridge/messages';
import { acceptSuggestion, aiRange, markdownBefore, unwrapFence, type AiRange } from '../editor/ai';
import { markdownNodes } from '../editor/paste';
import { schema } from '../editor/schema';
import { toast } from './feedback';
import { icon } from './icons';

/** What the AI suggestion box needs from the app. */
export interface AiHost {
  view(): EditorView;
  post(m: WebviewToHost): void;
  /** Sends pending typing now: before and after an accepted suggestion, so it is an undo step of its own. */
  flush(): void;
}

/** `ask`: waiting for an instruction or a language; `streaming`: the answer is coming in; `done`: it is complete (or stopped). */
type Phase = 'ask' | 'streaming' | 'done';

/** The range the open suggestion applies to, mapped through edits; null when no suggestion is open. */
const aiKey = new PluginKey<AiRange | null>('ai');

const TITLES: Record<AiAction, string> = {
  improve: 'Improve writing', shorten: 'Shorten', longer: 'Make longer', grammar: 'Fix spelling & grammar',
  translate: 'Translate', summarize: 'Summarize', continue: 'Continue writing', ask: 'Ask AI',
};

const btn = (act: string, ic: string, label: string, cls = '') =>
  `<button type="button" class="ai-b ${cls}" data-ai="${act}">${icon(ic)}<span>${label}</span></button>`;

/** A ```markdown fence still open at the start of a streaming answer is not shown (unwrapFence drops it at the end). */
const OPEN_FENCE = /^\s*(`{3,}|~{3,})[ \t]*(markdown|md)[ \t]*\n/i;

/**
 * The AI suggestion: the selection is highlighted and the answer streams into a box below its
 * block, rendered as formatted Markdown. Both are decorations: the document, and so the file,
 * changes only on Accept (one transaction) or Insert below. Discard, Esc, a mode change and a reset
 * leave everything as it was and cancel the request.
 */
export class AiAssist {
  readonly box: HTMLDivElement;
  setting: AiSetting = 'auto';
  /** The editor offers a language model. */
  editorModel = false;
  private phase: Phase | null = null;
  private request: Omit<AiRequest, 'id'> | null = null;
  private id = '';
  private seq = 0;
  private text = '';
  private frame = 0;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly out: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(private readonly host: AiHost) {
    this.box = document.createElement('div');
    this.box.className = 'ai-box';
    this.box.contentEditable = 'false';
    this.box.setAttribute('role', 'region');
    this.box.setAttribute('aria-label', 'AI suggestion');
    this.box.innerHTML = `
      <form class="ai-ask">
        <span class="ai-ic">${icon('sparkles')}</span>
        <input type="text" autocomplete="off" spellcheck="false" aria-label="Instruction for AI">
        <button type="submit" class="ai-b primary">Go</button>
        ${btn('discard', 'x', 'Cancel')}
      </form>
      <div class="ai-head"><span class="ai-ic">${icon('sparkles')}</span><span class="ai-title"></span><span class="ai-status" aria-live="polite"></span></div>
      <div class="ai-out"></div>
      <div class="ai-actions">
        ${btn('accept', 'check', 'Accept', 'primary')}${btn('below', 'below', 'Insert below')}${btn('retry', 'refresh', 'Try again')}${btn('discard', 'x', 'Discard')}${btn('stop', 'stop', 'Stop')}
      </div>`;
    this.title = this.box.querySelector('.ai-title')!;
    this.status = this.box.querySelector('.ai-status')!;
    this.out = this.box.querySelector('.ai-out')!;
    this.input = this.box.querySelector('input')!;
    this.box.addEventListener('mousedown', (e) => {
      // Keep the focus (and the editor's selection) where it is; the input and the answer's text still take clicks.
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    this.box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ai]');
      if (!b || b.disabled) return;
      switch (b.dataset.ai) {
        case 'accept': return this.accept('replace');
        case 'below': return this.accept('below');
        case 'retry': return this.run();
        case 'stop': return this.stop();
        case 'discard': return this.discard(true);
      }
    });
    this.box.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  /** AI actions are shown (the margin.ai setting isn't `off`). */
  get enabled(): boolean {
    return this.setting !== 'off';
  }

  /** Actions answer in place (the editor's model) instead of opening a chat. */
  get inPlace(): boolean {
    return this.editorModel && (this.setting === 'auto' || this.setting === 'editor');
  }

  get isOpen(): boolean {
    return this.phase !== null;
  }

  configure(setting: AiSetting, editorModel: boolean): void {
    this.setting = setting;
    this.editorModel = editorModel;
    if (!this.enabled) this.discard();
  }

  /** Highlights the range and shows the box below its block. */
  plugin(): Plugin<AiRange | null> {
    return new Plugin<AiRange | null>({
      key: aiKey,
      state: {
        init: () => null,
        apply: (tr, range) => {
          const meta = tr.getMeta(aiKey) as AiRange | null | undefined;
          if (meta !== undefined) return meta;
          if (!range || !tr.docChanged) return range;
          // Text typed at either edge stays outside the range.
          const from = tr.mapping.map(range.from, 1);
          return { ...range, from, to: Math.max(from, tr.mapping.map(range.to, -1)) };
        },
      },
      props: {
        decorations: (state) => {
          const range = aiKey.getState(state);
          if (!range) return null;
          const decos = [Decoration.widget(boxPos(state, range), () => this.box, { key: 'ai-box', side: 1, ignoreSelection: true, stopEvent: () => true })];
          if (range.to > range.from) decos.push(Decoration.inline(range.from, range.to, { class: 'ai-range' }));
          return DecorationSet.create(state.doc, decos);
        },
      },
    });
  }

  /** Runs `action` on the selection (or at the cursor). Ask AI and Translate to Other… first ask for what they need. */
  start(action: AiAction, opts: { lang?: string; instruction?: string } = {}): void {
    if (!this.enabled) return;
    this.discard();
    const view = this.host.view();
    const { state } = view;
    const range = aiRange(state, action);
    if (!range) {
      const inCode = state.selection.$from.parent.type.spec.code;
      toast(inCode ? 'AI actions work on text, not code blocks' : 'Select some text first', inCode ? undefined : 'AI actions work on the selected text');
      return;
    }
    const context = action === 'continue' || (action === 'ask' && !range.markdown) ? markdownBefore(state.doc, range.from) : undefined;
    this.request = { action, markdown: range.markdown, ...(context !== undefined ? { context } : {}), ...opts };
    view.dispatch(state.tr.setMeta(aiKey, range));
    if ((action === 'ask' && !opts.instruction) || (action === 'translate' && !opts.lang)) this.ask(action, range.markdown !== '');
    else this.run();
  }

  private ask(action: AiAction, selection: boolean): void {
    this.setPhase('ask');
    this.input.value = '';
    this.input.placeholder = action === 'translate' ? 'Translate to which language?' : selection ? 'Tell AI what to do with the selection…' : 'Tell AI what to write…';
    this.input.focus();
  }

  private submit(): void {
    const value = this.input.value.trim();
    if (!value || !this.request) return;
    if (this.request.action === 'translate') this.request.lang = value;
    else this.request.instruction = value;
    this.host.view().focus();
    this.run();
  }

  /** Sends the request (again, for Try again) under a new id; the previous answer is dropped. */
  private run(): void {
    if (!this.request) return;
    if (this.phase === 'streaming') this.host.post({ type: 'aiCancel', id: this.id });
    this.id = `ai-${Date.now().toString(36)}-${++this.seq}`;
    this.text = '';
    this.out.replaceChildren();
    const r = this.request;
    this.title.textContent = r.action === 'translate' ? `Translate to ${r.lang}` : r.action === 'ask' ? `Ask AI: ${r.instruction}` : TITLES[r.action];
    this.setPhase('streaming');
    this.host.post({ type: 'ai', id: this.id, ...r });
  }

  chunk(id: string, text: string): void {
    if (id !== this.id || this.phase !== 'streaming') return;
    this.text += text;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render());
  }

  done(id: string): void {
    if (id !== this.id || this.phase !== 'streaming') return;
    this.setPhase('done');
  }

  error(id: string, message: string): void {
    if (id !== this.id) return;
    this.close();
    toast(message);
  }

  /** The host copied the prompt and opened a chat: the answer comes back by paste. */
  fallback(id: string): void {
    if (id === this.id) this.close();
  }

  /** Stop: keeps what came so far. */
  private stop(): void {
    if (this.phase !== 'streaming') return;
    this.host.post({ type: 'aiCancel', id: this.id });
    this.setPhase('done');
  }

  /** Closes the suggestion without touching the document; cancels the request if it is still running. */
  discard(focus = false): void {
    if (!this.phase) return;
    if (this.phase === 'streaming') this.host.post({ type: 'aiCancel', id: this.id });
    this.close();
    if (focus) this.host.view().focus();
  }

  private accept(where: 'replace' | 'below'): void {
    const view = this.host.view();
    const range = aiKey.getState(view.state);
    if (this.phase !== 'done' || !range) return;
    this.host.flush();
    const changed = acceptSuggestion(view, range, this.text, where);
    this.close();
    if (changed) this.host.flush();
    view.focus();
  }

  private close(): void {
    this.phase = null;
    this.request = null;
    this.id = '';
    this.text = '';
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    delete this.box.dataset.phase;
    const view = this.host.view();
    if (aiKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(aiKey, null));
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.box.dataset.phase = phase;
    const streaming = phase === 'streaming';
    this.box.querySelectorAll<HTMLButtonElement>('[data-ai="accept"], [data-ai="below"], [data-ai="retry"]').forEach((b) => {
      b.disabled = streaming;
    });
    if (phase !== 'ask') this.render();
  }

  /** Shows the answer so far as formatted Markdown (plain text if it can't be parsed). */
  private render(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const md = this.phase === 'streaming' ? this.text.replace(OPEN_FENCE, '') : unwrapFence(this.text);
    try {
      this.out.replaceChildren(DOMSerializer.fromSchema(schema).serializeFragment(Fragment.from(markdownNodes(md))));
    } catch {
      this.out.textContent = md;
    }
    const empty = !md.trim();
    this.status.textContent = this.phase === 'streaming' ? 'Writing…' : empty ? 'No answer came back' : '';
    if (this.phase === 'done' && empty) {
      this.box.querySelectorAll<HTMLButtonElement>('[data-ai="accept"], [data-ai="below"]').forEach((b) => {
        b.disabled = true;
      });
    }
  }
}

/** The box goes after the range's top-level block (after the range itself for whole blocks). */
function boxPos(state: EditorState, range: AiRange): number {
  if (range.block) return range.to;
  const $to = state.doc.resolve(range.to);
  return $to.depth ? $to.after(1) : range.to;
}
