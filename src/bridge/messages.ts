import type { TextEdit } from '../md/types';

export type Mode = 'preview' | 'edit' | 'source';

export interface WebviewSettings {
  outlineVisible: boolean;
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
  | { type: 'openLink'; href: string }
  | { type: 'exportPdf' }
  | { type: 'exportHtml' }
  | { type: 'copyMarkdown' }
  | { type: 'log'; text: string }
  /** The webview gained or lost keyboard focus (drives the `margin.webviewFocused` context key). */
  | { type: 'focus' }
  | { type: 'blur' }
  /** The webview no longer trusts its copy (an ack didn't match): the host answers with a reset. */
  | { type: 'resync' };

/** Messages the extension host sends to the webview. */
export type HostToWebview =
  | { type: 'init'; text: string; version: number; mode: Mode; settings: WebviewSettings; baseUri: string }
  | { type: 'ack'; version: number; seq?: number }
  | { type: 'reset'; text: string; version: number }
  | { type: 'setMode'; mode: Mode }
  | { type: 'toast'; text: string; sub?: string };

const MODES: readonly string[] = ['preview', 'edit', 'source'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
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
      return typeof x.href === 'string';
    case 'log':
      return typeof x.text === 'string';
    default:
      return false;
  }
}
