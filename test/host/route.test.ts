import { describe, expect, it } from 'vitest';
import { AI_SETTINGS } from '../../src/bridge/messages';
import { aiSetting, chatUrl, chooseRoute, destination, MAX_URL, pickModel, type RouteInput } from '../../src/host/ai/route';

const input = (over: Partial<RouteInput>): RouteInput => ({ setting: 'auto', hasModel: false, appName: 'Visual Studio Code', hasChatCommand: false, ...over });

describe('chooseRoute', () => {
  it('auto: the editor model first', () => {
    expect(chooseRoute(input({ hasModel: true, hasChatCommand: true }))).toEqual({ kind: 'model' });
  });

  it("auto without a model: the editor's chat when it has one, chatgpt.com otherwise", () => {
    expect(chooseRoute(input({ hasChatCommand: true }))).toEqual({ kind: 'chat', target: 'editor' });
    expect(chooseRoute(input({ hasChatCommand: false }))).toEqual({ kind: 'chat', target: 'chatgpt' });
  });

  it("auto in Cursor: never Cursor's chat command (it doesn't take a query), chatgpt.com instead", () => {
    expect(chooseRoute(input({ appName: 'Cursor', hasChatCommand: true }))).toEqual({ kind: 'chat', target: 'chatgpt' });
  });

  it('editor: the model, or nothing when there is none', () => {
    expect(chooseRoute(input({ setting: 'editor', hasModel: true }))).toEqual({ kind: 'model' });
    expect(chooseRoute(input({ setting: 'editor', hasChatCommand: true }))).toEqual({ kind: 'none' });
  });

  it('chatgpt and claude: always that site, even with a model', () => {
    expect(chooseRoute(input({ setting: 'chatgpt', hasModel: true, hasChatCommand: true }))).toEqual({ kind: 'chat', target: 'chatgpt' });
    expect(chooseRoute(input({ setting: 'claude', hasModel: true }))).toEqual({ kind: 'chat', target: 'claude' });
  });

  it('off: nothing', () => {
    expect(chooseRoute(input({ setting: 'off', hasModel: true }))).toEqual({ kind: 'off' });
  });
});

describe('chatUrl', () => {
  it('puts the prompt in ?q=', () => {
    expect(chatUrl('chatgpt', 'Fix this & that?')).toBe('https://chatgpt.com/?q=Fix%20this%20%26%20that%3F');
    expect(chatUrl('claude', 'Hi\n```markdown\nx\n```')).toBe('https://claude.ai/new?q=Hi%0A%60%60%60markdown%0Ax%0A%60%60%60');
  });

  it('opens the bare site when the URL would be too long', () => {
    const fits = 'a'.repeat(MAX_URL - 'https://chatgpt.com/?q='.length - 1);
    expect(chatUrl('chatgpt', fits)).toBe(`https://chatgpt.com/?q=${fits}`);
    expect(chatUrl('chatgpt', `${fits}a`)).toBe('https://chatgpt.com/');
    // Encoded length counts: 300 spaces are 900 characters in the URL.
    expect(chatUrl('claude', ' '.repeat(600))).toBe('https://claude.ai/new');
  });
});

describe('destination', () => {
  it('names where the text goes', () => {
    expect(destination({ kind: 'model' }, 'copilot', 'Visual Studio Code')).toBe('GitHub Copilot via Visual Studio Code');
    expect(destination({ kind: 'model' }, 'acme', 'VSCodium')).toBe('the acme model via VSCodium');
    expect(destination({ kind: 'chat', target: 'chatgpt' })).toBe('chatgpt.com');
    expect(destination({ kind: 'chat', target: 'claude' })).toBe('claude.ai');
    expect(destination({ kind: 'chat', target: 'editor' }, undefined, 'Visual Studio Code')).toBe("Visual Studio Code's chat (or chatgpt.com)");
  });
});

describe('aiSetting', () => {
  it('reads the setting, defaulting to auto', () => {
    for (const s of AI_SETTINGS) expect(aiSetting(s)).toBe(s);
    expect(aiSetting(undefined)).toBe('auto');
    expect(aiSetting('gemini')).toBe('auto');
  });
});

describe('pickModel', () => {
  const m = (family: string) => ({ family, vendor: 'copilot' });
  it("prefers a gpt-4o or claude family, otherwise the first model", () => {
    expect(pickModel([m('gpt-3.5-turbo'), m('gpt-4o-mini'), m('claude-3.5-sonnet')])?.family).toBe('gpt-4o-mini');
    expect(pickModel([m('o1'), m('claude-sonnet-4')])?.family).toBe('claude-sonnet-4');
    expect(pickModel([m('o1'), m('gemini')])?.family).toBe('o1');
    expect(pickModel([])).toBeUndefined();
  });
});
