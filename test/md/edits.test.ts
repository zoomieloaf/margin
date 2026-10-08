import { describe, expect, it } from 'vitest';
import { applyEdit, diffToEdit } from '../../src/md/edits';

describe('diffToEdit', () => {
  it('returns null for identical text', () => {
    expect(diffToEdit('abc', 'abc')).toBeNull();
  });

  it('finds an insertion', () => {
    expect(diffToEdit('ac', 'abc')).toEqual({ start: 1, end: 1, text: 'b' });
  });

  it('finds a deletion', () => {
    expect(diffToEdit('abc', 'ac')).toEqual({ start: 1, end: 2, text: '' });
  });

  it('finds a replacement', () => {
    expect(diffToEdit('# Old title\n', '# New title\n')).toEqual({ start: 2, end: 5, text: 'New' });
  });

  it('never splits a surrogate pair', () => {
    expect(diffToEdit('a😀b', 'a😃b')).toEqual({ start: 1, end: 3, text: '😃' });
  });

  it('never splits a CRLF pair', () => {
    const e = diffToEdit('a\r\nb', 'a\rX\nb')!;
    expect(e.start).toBeLessThanOrEqual(1);
    expect(applyEdit('a\r\nb', e)).toBe('a\rX\nb');
  });

  it('round-trips through applyEdit for many pairs', () => {
    const samples = ['', 'a', 'Hello\n', 'Hello\r\nWorld\r\n', '😀😃', '- a\n- b\n', 'xx\n\nyy\n'];
    for (const a of samples) for (const b of samples) {
      const e = diffToEdit(a, b);
      expect(e ? applyEdit(a, e) : a).toBe(b);
    }
  });
});
