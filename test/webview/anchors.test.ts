import { describe, expect, it } from 'vitest';
import { DocModel } from '../../src/webview/editor/model';
import { findAnchor, githubSlug } from '../../src/webview/editor/anchors';

describe('githubSlug', () => {
  it.each([
    ['Getting Started', 'getting-started'],
    ["What's new?", 'whats-new'],
    ['C++ & Rust', 'c--rust'],
    ['API v2.0 (beta)', 'api-v20-beta'],
    ['snake_case and kebab-case', 'snake_case-and-kebab-case'],
    ['Übersicht', 'übersicht'],
    ['  Trim me ', '--trim-me-'],
  ])('%j → %j', (text, slug) => {
    expect(githubSlug(text)).toBe(slug);
  });
});

describe('findAnchor', () => {
  const doc = new DocModel(() => {}).load('# Intro\n\nText\n\n## Setup\n\n## Setup\n\n- ### In a list\n\n## Café\n', 1);
  const headingAt = (pos: number | null) => (pos === null ? null : doc.nodeAt(pos)?.textContent);

  it('finds a heading by its slug', () => {
    expect(headingAt(findAnchor(doc, 'intro'))).toBe('Intro');
  });

  it('numbers duplicates like GitHub (setup, setup-1)', () => {
    const first = findAnchor(doc, 'setup');
    const second = findAnchor(doc, 'setup-1');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).toBeGreaterThan(first!);
  });

  it('decodes the fragment, matches case-insensitively and finds nested headings', () => {
    expect(headingAt(findAnchor(doc, 'caf%C3%A9'))).toBe('Café');
    expect(headingAt(findAnchor(doc, 'INTRO'))).toBe('Intro');
    expect(headingAt(findAnchor(doc, 'in-a-list'))).toBe('In a list');
  });

  it('returns null for an unknown or malformed fragment', () => {
    expect(findAnchor(doc, 'nope')).toBeNull();
    expect(findAnchor(doc, '%E0%A4%A')).toBeNull();
  });
});
