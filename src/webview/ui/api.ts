import type { EditorView } from 'prosemirror-view';
import type { Mode } from '../../bridge/messages';
import type { Menu } from './menu';

/** What the UI components need from the app. */
export interface AppApi {
  readonly view: EditorView;
  readonly menu: Menu;
  readonly mode: Mode;
  /** Runs a named action (toolbar button, bubble button, menu item). */
  act(action: string, anchor?: HTMLElement, arg?: string): void;
  setMode(mode: Mode): void;
}
