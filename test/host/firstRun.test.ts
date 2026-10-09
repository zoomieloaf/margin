import { describe, expect, it } from 'vitest';
import { shouldOfferDefault, type FirstRunInput } from '../../src/host/firstRun';

const input = (over: Partial<FirstRunInput>): FirstRunInput => ({ languageId: 'markdown', scheme: 'file', inDiff: false, associations: {}, asked: false, ...over });

describe('the one-time "open Markdown in Margin by default?" offer', () => {
  it('is made for a Markdown file opened as text, with no editor chosen, once', () => {
    expect(shouldOfferDefault(input({}))).toBe(true);
    expect(shouldOfferDefault(input({ asked: true }))).toBe(false);
  });

  it('is never made from a diff (Source Control, Timeline)', () => {
    expect(shouldOfferDefault(input({ inDiff: true }))).toBe(false);
  });

  it('is not made when Markdown files already open in Margin or another chosen editor', () => {
    expect(shouldOfferDefault(input({ associations: { '*.md': 'margin.editor' } }))).toBe(false);
    expect(shouldOfferDefault(input({ associations: { '*.markdown': 'other.editor' } }))).toBe(false);
    expect(shouldOfferDefault(input({ associations: { '*.png': 'imagePreview.previewEditor' } }))).toBe(true);
  });

  it('is only made for files on disk and Markdown', () => {
    expect(shouldOfferDefault(input({ scheme: 'git' }))).toBe(false);
    expect(shouldOfferDefault(input({ languageId: 'plaintext' }))).toBe(false);
  });
});
