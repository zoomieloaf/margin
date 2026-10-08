import type { TextEdit } from './types';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export function diffToEdit(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  if (start > 0 && (isHigh(oldText.charCodeAt(start - 1)) || (oldText[start - 1] === '\r' && oldText[start] === '\n'))) start--;

  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  if (endOld < oldText.length && (isLow(oldText.charCodeAt(endOld)) || (oldText[endOld] === '\n' && oldText[endOld - 1] === '\r'))) {
    endOld++;
    endNew++;
  }
  return { start, end: endOld, text: newText.slice(start, endNew) };
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.start) + edit.text + text.slice(edit.end);
}
