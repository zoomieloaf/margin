import { describe, expect, it } from 'vitest';
import { AI_ACTIONS } from '../../src/bridge/messages';
import { aiPrompt, chatPrompt, fenced, MAX_CONTEXT } from '../../src/host/ai/prompts';

const sel = 'Some **bold** text with a [link](https://x.y).';

describe('aiPrompt', () => {
  it.each(AI_ACTIONS.filter((a) => a !== 'continue'))('%s: asks for Markdown only, no preamble, keeping formatting and links', (action) => {
    const p = aiPrompt({ action, markdown: sel, lang: 'German', instruction: 'Make it formal' });
    expect(p.instructions).toMatch(/Return only the (rewritten|resulting) Markdown/);
    expect(p.instructions).toMatch(/no preamble/i);
    expect(p.instructions).toMatch(/Keep the Markdown formatting and links/);
    expect(p.text).toContain(sel);
  });

  it('keeps the original language unless translating', () => {
    expect(aiPrompt({ action: 'improve', markdown: sel }).instructions).toMatch(/Keep the original language/);
    const t = aiPrompt({ action: 'translate', markdown: sel, lang: 'Japanese' });
    expect(t.instructions).toMatch(/Translate the text into Japanese/);
    expect(t.instructions).not.toMatch(/Keep the original language/);
  });

  it('each action says what to do', () => {
    const task = (action: (typeof AI_ACTIONS)[number]) => aiPrompt({ action, markdown: sel, lang: 'French', instruction: 'Add an example' }).instructions;
    expect(task('improve')).toMatch(/Improve the writing/);
    expect(task('shorten')).toMatch(/shorter/);
    expect(task('longer')).toMatch(/longer/);
    expect(task('grammar')).toMatch(/Fix the spelling and grammar/);
    expect(task('summarize')).toMatch(/Summarize/);
    expect(task('ask')).toContain('Add an example');
  });

  it('puts the selection in a fenced block that its own backticks cannot close', () => {
    const md = 'Run:\n\n```sh\nnpm i\n```';
    const p = aiPrompt({ action: 'improve', markdown: md });
    expect(p.text).toContain('````markdown\nRun:\n\n```sh\nnpm i\n```\n````');
    expect(fenced('a ````` b')).toBe('``````markdown\na ````` b\n``````');
  });

  it('Continue writing sends the text before the cursor and asks for the new text only', () => {
    const p = aiPrompt({ action: 'continue', markdown: '', context: '# Plan\n\nFirst we' });
    expect(p.instructions).toMatch(/Continue writing/);
    expect(p.instructions).toMatch(/only the new text/);
    expect(p.instructions).toMatch(/no preamble/i);
    expect(p.text).toContain('# Plan\n\nFirst we');
  });

  it('long context keeps its end (the part next to the cursor)', () => {
    const context = `${'x'.repeat(MAX_CONTEXT)}TAIL`;
    const p = aiPrompt({ action: 'continue', markdown: '', context });
    expect(p.text).toContain('TAIL');
    expect(p.text.length).toBeLessThan(MAX_CONTEXT + 200);
  });

  it('Ask AI without a selection writes new content from the instruction', () => {
    const p = aiPrompt({ action: 'ask', markdown: '', instruction: 'List three risks', context: '# Launch' });
    expect(p.instructions).toContain('List three risks');
    expect(p.text).toContain('# Launch');
    expect(p.text).not.toMatch(/Text:/);
  });
});

describe('chatPrompt', () => {
  it('is the instructions followed by the text, as one message to paste into a chat', () => {
    const p = aiPrompt({ action: 'shorten', markdown: sel });
    expect(chatPrompt({ action: 'shorten', markdown: sel })).toBe(`${p.instructions}\n\n${p.text}`);
    expect(chatPrompt({ action: 'shorten', markdown: sel })).toContain(`\`\`\`markdown\n${sel}\n\`\`\``);
  });
});
