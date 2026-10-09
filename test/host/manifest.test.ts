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

describe('the margin.ai setting', () => {
  const props = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[]; enumDescriptions?: string[]; default?: unknown }> } };
  }).contributes.configuration.properties;

  it('offers auto, editor, chatgpt, claude and off, each described, auto by default', () => {
    const ai = props['margin.ai']!;
    expect(ai.enum).toEqual(['auto', 'editor', 'chatgpt', 'claude', 'off']);
    expect(ai.enumDescriptions).toHaveLength(5);
    expect(ai.default).toBe('auto');
  });

  it('the README says when and where text is sent', () => {
    expect(readme).toMatch(/only when you run an AI action/);
    for (const where of ['GitHub Copilot', 'chatgpt.com', 'claude.ai']) expect(readme).toContain(where);
  });
});

describe('the margin.pageWidth setting', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    contributes: {
      configuration: { properties: Record<string, { enum?: string[]; enumDescriptions?: string[]; default?: unknown }> };
      commands: Array<{ command: string; title: string; category?: string }>;
      menus: { commandPalette: Array<{ command: string; when?: string }> };
    };
  };

  it('offers narrow, normal, wide and full, each described, normal by default', () => {
    const w = manifest.contributes.configuration.properties['margin.pageWidth']!;
    expect(w.enum).toEqual(['narrow', 'normal', 'wide', 'full']);
    expect(w.enumDescriptions).toHaveLength(4);
    expect(w.default).toBe('normal');
  });

  it('has a Change Page Width command, in the palette only for a Margin editor', () => {
    const cmd = manifest.contributes.commands.find((c) => c.command === 'margin.changePageWidth');
    expect(cmd).toMatchObject({ title: 'Change Page Width', category: 'Margin' });
    expect(manifest.contributes.menus.commandPalette.find((c) => c.command === 'margin.changePageWidth')?.when).toBe("activeCustomEditorId == 'margin.editor'");
  });

  it('the README lists the setting', () => {
    expect(readme).toMatch(/\| `margin\.pageWidth` \| `normal` \|/);
  });
});

describe('the margin.links.openIn setting', () => {
  const props = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { enum?: string[]; enumDescriptions?: string[]; default?: unknown }> } };
  }).contributes.configuration.properties;

  it('offers sameTab (the default) and newTab, each described', () => {
    const p = props['margin.links.openIn']!;
    expect(p.enum).toEqual(['sameTab', 'newTab']);
    expect(p.enumDescriptions).toEqual([
      'Linked pages open in the preview tab, which the next page replaces (follows workbench.editor.enablePreview)',
      'Every linked page opens in its own tab',
    ]);
    expect(p.default).toBe('sameTab');
  });

  it('the README lists the setting', () => {
    expect(readme).toMatch(/\| `margin\.links\.openIn` \| `sameTab` \|/);
  });
});
