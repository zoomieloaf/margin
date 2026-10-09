import type { TextEdit } from '../md/types';

export type Mode = 'preview' | 'edit' | 'source';

/** The AI actions, in menu order. */
export const AI_ACTIONS = ['improve', 'shorten', 'longer', 'grammar', 'translate', 'summarize', 'continue', 'ask'] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

/** The `margin.ai` setting: which AI runs the actions, or `off` to hide them. */
export const AI_SETTINGS = ['auto', 'editor', 'chatgpt', 'claude', 'off'] as const;
export type AiSetting = (typeof AI_SETTINGS)[number];

/** One AI action on the selection. `markdown`: the selection; `context`: the document before it (Continue writing, Ask AI). */
export interface AiRequest {
  id: string;
  action: AiAction;
  /** The target language (Translate). */
  lang?: string;
  /** The user's instruction (Ask AI). */
  instruction?: string;
  markdown: string;
  context?: string;
}

/** Widths of the text column, narrowest first (the `margin.pageWidth` setting and the per-file choice). */
export const PAGE_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];

/** Menu and quick pick labels. */
export const PAGE_WIDTH_LABEL: Record<PageWidth, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide', full: 'Full width' };

export const isPageWidth = (x: unknown): x is PageWidth => typeof x === 'string' && (PAGE_WIDTHS as readonly string[]).includes(x);

/** The width a page shows at: the file's own choice (`override`) when it has one, otherwise the setting. */
export interface PageWidthState {
  width: PageWidth;
  setting: PageWidth;
  override: PageWidth | null;
}

/** Combines a stored per-file choice and the setting, ignoring values that aren't a width. */
export function resolvePageWidth(override: unknown, setting: unknown): PageWidthState {
  const s = isPageWidth(setting) ? setting : 'normal';
  const o = isPageWidth(override) ? override : null;
  return { width: o ?? s, setting: s, override: o };
}

/** The `margin.links.openIn` setting: linked pages replace the preview tab, or each gets a tab of its own. */
export const LINKS_OPEN_IN = ['sameTab', 'newTab'] as const;
export type LinksOpenIn = (typeof LINKS_OPEN_IN)[number];

export const isLinksOpenIn = (x: unknown): x is LinksOpenIn => typeof x === 'string' && (LINKS_OPEN_IN as readonly string[]).includes(x);

/**
 * Whether a followed link opens in a tab of its own: what the webview asked for (`newTab`, sent for
 * Ctrl/Cmd+click and the hover card's other Open button), otherwise the setting (sameTab when unknown).
 */
export const linkOpensNewTab = (setting: unknown, newTab?: boolean): boolean => newTab ?? setting === 'newTab';

/** The toolbar's Back and Forward, mouse buttons 4 and 5, and Alt+Left: VS Code's Go Back / Go Forward. */
export type NavDirection = 'back' | 'forward';

export interface WebviewSettings {
  outlineVisible: boolean;
  /** The width the page opens at (`pageWidthState` says where it comes from). */
  pageWidth: PageWidth;
  pageWidthState: PageWidthState;
  ai: AiSetting;
  /** The editor offers a language model (Copilot in VS Code): AI actions run in place. */
  aiEditor: boolean;
  /** The `margin.links.openIn` setting (labels the hover card's other Open button). */
  linksOpenIn: LinksOpenIn;
}

/** Messages the webview sends to the extension host. */
export type WebviewToHost =
  | { type: 'ready' }
  /** `seq` numbers the webview's edits; the host echoes it in the ack. */
  | { type: 'edit'; version: number; edits: TextEdit[]; seq?: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'mode'; mode: Mode }
  | { type: 'stats'; words: number }
  /** `newTab`: the user asked for a tab of its own (true) or the preview tab (false); absent: the setting decides. */
  | { type: 'openLink'; href: string; newTab?: boolean }
  /** Runs VS Code's Go Back / Go Forward. */
  | { type: 'navigate'; direction: NavDirection }
  /** Which of these local link targets exist? The host answers with `linkStatus`. */
  | { type: 'checkLinks'; hrefs: string[] }
  | { type: 'exportPdf' }
  | { type: 'exportHtml' }
  | { type: 'copyMarkdown' }
  | { type: 'log'; text: string }
  /** The webview gained or lost keyboard focus (drives the `margin.webviewFocused` context key). */
  | { type: 'focus' }
  | { type: 'blur' }
  /** The webview no longer trusts its copy (an ack didn't match): the host answers with a reset. */
  | { type: 'resync' }
  /** Runs an AI action; the host answers with `aiChunk`s then `aiDone`, or `aiError`, or `aiFallback`. */
  | ({ type: 'ai' } & AiRequest)
  /** Stops that AI action (Stop, Discard, Esc, a mode change, a reset). */
  | { type: 'aiCancel'; id: string }
  /** The user picked a width for this file; null goes back to the `margin.pageWidth` setting. */
  | { type: 'pageWidth'; value: PageWidth | null };

/** Messages the extension host sends to the webview. */
export type HostToWebview =
  /** `anchor`: the `#fragment` of the link that opened this page; the webview scrolls to that heading. */
  | { type: 'init'; text: string; version: number; mode: Mode; settings: WebviewSettings; baseUri: string; anchor?: string }
  | { type: 'ack'; version: number; seq?: number }
  | { type: 'reset'; text: string; version: number }
  | { type: 'setMode'; mode: Mode }
  | { type: 'toast'; text: string; sub?: string }
  /** A link to this already open page was followed: scroll to the heading with that GitHub id. */
  | { type: 'scrollTo'; anchor: string }
  /** Answer to `checkLinks`: the hrefs whose target is missing, and each checked href's path for the hover title. */
  | { type: 'linkStatus'; missing: string[]; paths: Array<[href: string, path: string]> }
  /** The next piece of the AI answer, as Markdown. */
  | { type: 'aiChunk'; id: string; text: string }
  | { type: 'aiDone'; id: string }
  | { type: 'aiError'; id: string; message: string }
  /** The prompt was copied and a chat opened instead: the webview closes the suggestion. */
  | { type: 'aiFallback'; id: string }
  /** Whether the editor offers a language model; `setting` when `margin.ai` changed. */
  | { type: 'aiAvailable'; editor: boolean; setting?: AiSetting }
  /** The page width changed (the file's choice or the `margin.pageWidth` setting). */
  | ({ type: 'setPageWidth' } & PageWidthState)
  /** The `margin.links.openIn` setting changed. */
  | { type: 'linksOpenIn'; value: LinksOpenIn };

/** More links than this in one `checkLinks` is not a document someone wrote by hand: refused. */
export const MAX_CHECKED_LINKS = 2000;

/** Longest selection or context an AI request may carry (characters). */
export const MAX_AI_TEXT = 200_000;

const MODES: readonly string[] = ['preview', 'edit', 'source'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const isOptText = (x: unknown, max: number) => x === undefined || isText(x, max);
const isId = (x: unknown): x is string => isText(x, 100) && x.length > 0;
const isAi = (x: Record<string, unknown>): boolean =>
  isId(x.id) &&
  typeof x.action === 'string' && (AI_ACTIONS as readonly string[]).includes(x.action) &&
  isText(x.markdown, MAX_AI_TEXT) && isOptText(x.context, MAX_AI_TEXT) && isOptText(x.lang, 100) && isOptText(x.instruction, 4000) &&
  // Translate needs a language and Ask AI an instruction.
  (x.action !== 'translate' || (typeof x.lang === 'string' && x.lang.trim() !== '')) &&
  (x.action !== 'ask' || (typeof x.instruction === 'string' && x.instruction.trim() !== ''));
const isEdit = (e: unknown): e is TextEdit =>
  isObj(e) && isInt(e.start) && isInt(e.end) && e.start <= e.end && typeof e.text === 'string';

export function isWebviewMessage(x: unknown): x is WebviewToHost {
  if (!isObj(x) || typeof x.type !== 'string') return false;
  switch (x.type) {
    case 'ready': case 'undo': case 'redo': case 'exportPdf': case 'exportHtml': case 'copyMarkdown':
    case 'focus': case 'blur': case 'resync':
      return true;
    case 'edit':
      return isInt(x.version) && Array.isArray(x.edits) && x.edits.every(isEdit) && (x.seq === undefined || isInt(x.seq));
    case 'mode':
      return typeof x.mode === 'string' && MODES.includes(x.mode);
    case 'stats':
      return isInt(x.words);
    case 'openLink':
      return typeof x.href === 'string' && (x.newTab === undefined || typeof x.newTab === 'boolean');
    case 'navigate':
      return x.direction === 'back' || x.direction === 'forward';
    case 'checkLinks':
      return Array.isArray(x.hrefs) && x.hrefs.length <= MAX_CHECKED_LINKS && x.hrefs.every((h) => typeof h === 'string');
    case 'log':
      return typeof x.text === 'string';
    case 'ai':
      return isAi(x);
    case 'aiCancel':
      return isId(x.id);
    case 'pageWidth':
      return x.value === null || isPageWidth(x.value);
    default:
      return false;
  }
}
