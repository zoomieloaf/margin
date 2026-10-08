export type EditAction = 'apply' | 'drop' | 'reset';

/**
 * What DocumentSync does with an edit the webview based on `editVersion` while the document is
 * at `docVersion`. A stale edit is answered with a reset, unless a reset for the current
 * version was already sent: the webview will reload from that one and drop the edit itself,
 * and a second reset would make it drop its newer, valid edits too.
 */
export function staleEditAction(editVersion: number, docVersion: number, lastResetVersion: number): EditAction {
  if (editVersion === docVersion) return 'apply';
  return lastResetVersion === docVersion ? 'drop' : 'reset';
}
