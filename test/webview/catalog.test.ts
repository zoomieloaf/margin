import { describe, expect, it } from 'vitest';
import { AI_ACTIONS } from '../../src/bridge/messages';
import { AI_LANGUAGES, aiGroups, pageWidthGroups, slashGroups, translateGroups } from '../../src/webview/ui/catalog';

const ids = (groups: ReturnType<typeof aiGroups>) => groups.flatMap((g) => g.items.map((i) => i.id));

describe('AI menu', () => {
  it('with a selection: every action, rewrites first', () => {
    expect(ids(aiGroups({ selection: true, editor: true }))).toEqual([...AI_ACTIONS]);
  });

  it('without a selection: only Continue writing and Ask AI', () => {
    expect(ids(aiGroups({ selection: false, editor: true }))).toEqual(['continue', 'ask']);
  });

  it('says when the actions open a chat instead of running in place', () => {
    expect(aiGroups({ selection: true, editor: true }).map((g) => g.title).join(' ')).not.toMatch(/chat/);
    expect(aiGroups({ selection: true, editor: false })[0]!.title).toMatch(/opens a chat/);
  });

  it('Translate to… lists the languages, then Other…', () => {
    const items = translateGroups()[0]!.items;
    expect(AI_LANGUAGES).toEqual(['English', 'Russian', 'German', 'French', 'Spanish', 'Chinese', 'Japanese']);
    expect(items.map((i) => i.label)).toEqual([...AI_LANGUAGES, 'Other…']);
  });
});

describe('slash menu', () => {
  const labels = (q: string, ai: boolean) => slashGroups(q, ai).flatMap((g) => g.items.map((i) => i.label));
  it('/ai offers Continue writing and Ask AI when AI is on', () => {
    // First, so Enter after `/ai` runs Continue writing (`plain`, `mermaid`... also contain "ai").
    expect(labels('ai', true).slice(0, 2)).toEqual(['Continue writing', 'Ask AI…']);
    expect(labels('', true).slice(-2)).toEqual(['Continue writing', 'Ask AI…']);
    expect(labels('ai', false)).not.toContain('Continue writing');
    expect(labels('', false)).not.toContain('Ask AI…');
  });
});

describe('page width menu', () => {
  it('lists the four widths, then Use default naming the setting', () => {
    const groups = pageWidthGroups('wide');
    expect(groups.map((g) => g.items.map((i) => [i.id, i.label]))).toEqual([
      [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['full', 'Full width']],
      [['default', 'Use default (Wide)']],
    ]);
  });
});
