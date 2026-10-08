import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { categories: string[]; publisher: string };
const readme = readFileSync(new URL('README.md', root), 'utf8');

describe('marketplace listing', () => {
  it('is listed under Other only (Margin is not a formatter)', () => {
    expect(pkg.categories).toEqual(['Other']);
  });

  it('describes network use accurately', () => {
    expect(readme).toContain('Margin makes no network requests of its own. Remote images in your documents load like in VS Code\'s Markdown preview.');
    expect(readme).not.toMatch(/works entirely offline/i);
  });

  it('describes what tables can do', () => {
    expect(readme).toMatch(/Tab in the last cell adds a row/);
    expect(readme).toMatch(/adds a row below or a column on the right, and deletes rows or columns/);
  });
});
