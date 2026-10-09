// End-to-end smoke test of the built webview (dist/webview.js) in a real Chromium browser,
// driven with real mouse and keyboard input. Run with `npm run e2e`.
// Uses Edge/Chrome already installed (MARGIN_BROWSER overrides the path).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const candidates = [
  process.env.MARGIN_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chromium browser found; set MARGIN_BROWSER.');
  process.exit(1);
}

const harness = pathToFileURL(path.resolve('test/e2e/harness.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--allow-file-access-from-files'] });
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let failures = 0;

/** `settings`: `ai` (the margin.ai setting), `aiEditor` (the editor has a model) and `pageWidth` (a PageWidthState) for the init message; `viewport`: the page size. */
async function open(text, mode = 'edit', settings = {}, viewport = { width: 1100, height: 800 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument((t, m, s) => { window.__initialText = t; window.__mode = m; window.__ai = s.ai; window.__aiEditor = s.aiEditor; window.__pageWidth = s.pageWidth; }, text, mode, settings);
  await page.goto(harness);
  await page.waitForSelector('.ProseMirror');
  await page.waitForSelector('.app[data-mode]'); // the init message has been applied
  await sleep(150);
  page.errors = errors;
  return page;
}

/** Client coordinates of character `offset` inside the n-th element matching `selector`. */
async function charXY(page, selector, n, offset) {
  return page.evaluate((selector, n, offset) => {
    const el = document.querySelectorAll(selector)[n];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let left = offset;
    while (node && left > node.length) { left -= node.length; node = walker.nextNode(); }
    const r = document.createRange();
    r.setStart(node, left);
    r.setEnd(node, left);
    const q = r.getBoundingClientRect();
    return { x: q.left + 1, y: q.top + q.height / 2 };
  }, selector, n, offset);
}

/**
 * Clicks character `offset` of the n-th `selector` element and checks the caret really went there
 * (right after the editor takes focus, a click can occasionally leave the caret at the start of the
 * document; this was flaky before any of the fixes too). Retries a few times.
 */
async function clickChar(page, selector, n, offset) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await sleep(600); // so the retry isn't taken as a double-click
    const at = await charXY(page, selector, n, offset);
    await page.mouse.click(at.x, at.y);
    await sleep(60);
    const caret = await page.evaluate((selector, n) => {
      const el = document.querySelectorAll(selector)[n];
      const s = getSelection();
      if (!el || !s || !s.isCollapsed || !s.focusNode || !el.contains(s.focusNode)) return -1;
      const r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(s.focusNode, s.focusOffset);
      return r.toString().length;
    }, selector, n);
    if (caret === offset) return;
  }
  throw new Error(`could not put the caret at ${selector}[${n}]:${offset}`);
}

const settle = async (page) => {
  await sleep(250); // debounce (150 ms) + ack
  return page.evaluate(() => window.host.text);
};

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

console.log(`webview e2e (${path.basename(executablePath)})`);

await test('renders the document in Preview, read-only', async () => {
  const page = await open('# Title\n\nHello **world**.\n', 'preview');
  assert.equal(await page.$eval('.ProseMirror h1', (e) => e.textContent), 'Title');
  assert.equal(await page.$eval('.ProseMirror', (e) => e.getAttribute('contenteditable')), 'false');
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('bold across two paragraphs bolds only the selected parts', async () => {
  const src = 'First paragraph text.\n\nSecond paragraph text.\n';
  const page = await open(src);
  await clickChar(page, '.ProseMirror p', 0, 6);
  const b = await charXY(page, '.ProseMirror p', 1, 6);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await sleep(100);
  assert.equal(await page.$eval('.bubble', (e) => !e.hidden), true, 'selection bubble should be visible');
  await page.keyboard.down(mod);
  await page.keyboard.press('b');
  await page.keyboard.up(mod);
  assert.equal(await settle(page), 'First **paragraph text.**\n\n**Second** paragraph text.\n');
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('Enter splits a paragraph and only that block changes', async () => {
  const src = '# Keep  this\n\nHello world\n\n* keep\n* style\n';
  const page = await open(src);
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.press('Enter');
  assert.equal(await settle(page), '# Keep  this\n\nHello\n\nworld\n\n* keep\n* style\n');
  await page.close();
});

await test('slash menu inserts a heading', async () => {
  const page = await open('Intro\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForSelector('.menu:not([hidden])');
  await page.keyboard.type('head');
  const first = await page.$eval('.menu .mi.kb .mi-l', (e) => e.firstChild.textContent);
  assert.equal(first, 'Heading 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Section');
  assert.equal(await settle(page), 'Intro\n\n## Section\n');
  await page.close();
});

await test('typing "- " starts a list and "[] " makes a task', async () => {
  const page = await open('Intro\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Ship it');
  assert.equal(await settle(page), 'Intro\n\n- [ ] Ship it\n');
  await page.close();
});

await test('clicking a task checkbox in Preview toggles only that item', async () => {
  const page = await open('Intro\n\n- [ ] a\n- [x] b\n', 'preview');
  await page.click('.cb');
  assert.equal(await settle(page), 'Intro\n\n- [x] a\n- [x] b\n');
  await page.close();
});

await test('a checkbox click changes one character even in an unusually written list', async () => {
  const src = '1.  [ ] 3 * 4\n1.  [ ] b\n    -   [X] c\n';
  const page = await open(src, 'preview');
  const boxes = await page.$$('.cb');
  await boxes[1].click();
  assert.equal(await settle(page), '1.  [ ] 3 * 4\n1.  [x] b\n    -   [X] c\n');
  await (await page.$$('.cb'))[2].click();
  assert.equal(await settle(page), '1.  [ ] 3 * 4\n1.  [x] b\n    -   [ ] c\n');
  assert.equal(await page.$$eval('.cb.on', (els) => els.length), 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('tables grow: Enter in the last row and Tab in the last cell add rows', async () => {
  const page = await open('| a | b |\n| - | - |\n| 1 | 2 |\n');
  await clickChar(page, '.ProseMirror td', 1, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  assert.equal(await settle(page), '| a | b |\n| - | - |\n| 1 | 2 |\n|   | x |\n');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  assert.equal(await settle(page), '| a | b |\n| - | - |\n| 1 | 2 |\n|   | x |\n| y |   |\n');
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('Ctrl+Z is sent to VS Code instead of undoing in the webview', async () => {
  const page = await open('Hello\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.down(mod);
  await page.keyboard.press('z');
  await page.keyboard.up(mod);
  await sleep(50);
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type));
  assert.ok(posted.includes('undo'), `posted: ${posted.join(', ')}`);
  await page.close();
});

await test('Ctrl+Z right after typing sends the edit first, then exactly one undo', async () => {
  const page = await open('Hello\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.type('!');
  await page.keyboard.down(mod);
  await page.keyboard.press('z');
  await page.keyboard.up(mod);
  await sleep(300);
  const posted = await page.evaluate(() => window.host.posted.filter((m) => m.type === 'edit' || m.type === 'undo' || m.type === 'redo'));
  assert.deepEqual(posted.map((m) => m.type), ['edit', 'undo']);
  assert.equal(await page.evaluate(() => window.host.text), 'Hello!\n');
  await page.close();
});

await test('Ctrl+Y and Ctrl+Shift+Z each send one redo', async () => {
  const page = await open('Hello\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.down(mod);
  await page.keyboard.press('y');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up(mod);
  await sleep(100);
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => t === 'undo' || t === 'redo'));
  assert.deepEqual(posted, ['redo', 'redo']);
  await page.close();
});

await test('the webview reports focus and blur to the host', async () => {
  const page = await open('Hello\n');
  await clickChar(page, '.ProseMirror p', 0, 2);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => t === 'focus' || t === 'blur'));
  assert.deepEqual(posted.slice(-2), ['blur', 'focus']);
  await page.close();
});

await test('toolbar buttons work: Bold, Outline and the Export menu', async () => {
  const page = await open('Hello world\n');
  await clickChar(page, '.ProseMirror p', 0, 6);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.click('.toolbar [data-act="strong"]');
  assert.equal(await settle(page), 'Hello **world**\n');
  const outlineBefore = await page.$eval('.outline', (e) => e.hidden);
  await page.click('.toolbar [data-act="outline"]');
  assert.equal(await page.$eval('.outline', (e) => e.hidden), !outlineBefore);
  await page.click('.toolbar [data-act="export"]');
  assert.equal(await page.$eval('.menu', (e) => e.hidden), false);
  await page.click('.menu .mi[data-id="html"]');
  await sleep(50);
  assert.ok(await page.evaluate(() => window.host.posted.some((m) => m.type === 'exportHtml')));
  await page.close();
});

/** Types `text` at the end of the first paragraph, then returns what was posted in the next ~40 ms (well inside the 150 ms debounce). */
async function typeThen(page, text, action) {
  await clickChar(page, '.ProseMirror p', 0, 5);
  await page.keyboard.type(text);
  await action();
  await sleep(40);
  return page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => !['focus', 'blur', 'stats', 'mode', 'ready'].includes(t)));
}

await test('Ctrl+S sends the typing still waiting for the debounce', async () => {
  const page = await open('Hello\n');
  const posted = await typeThen(page, '!', async () => {
    await page.keyboard.down(mod);
    await page.keyboard.press('s');
    await page.keyboard.up(mod);
  });
  assert.deepEqual(posted, ['edit']);
  await page.close();
});

await test('hiding the page (visibilitychange, pagehide) sends the pending typing', async () => {
  for (const hide of [
    () => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); },
    () => window.dispatchEvent(new Event('pagehide')),
  ]) {
    const page = await open('Hello\n');
    const posted = await typeThen(page, '!', () => page.evaluate(hide));
    assert.deepEqual(posted, ['edit']);
    await page.close();
  }
});

await test('Export right after typing exports the new text (edit first, then export)', async () => {
  const page = await open('Hello\n');
  const posted = await typeThen(page, '!', async () => {
    await page.click('[data-act="export"]');
    await page.click('.menu .mi[data-id="html"]');
  });
  await sleep(100);
  const all = await page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => t === 'edit' || t === 'exportHtml'));
  assert.deepEqual(all, ['edit', 'exportHtml'], `posted right after: ${posted.join(', ')}`);
  await page.close();
});

await test('a #anchor link in Preview scrolls to the heading instead of asking the host', async () => {
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n');
  const page = await open(`[Jump](#second-section)\n\n${filler}\n\n## Second section\n\n${filler}\n`, 'preview');
  await page.click('.ProseMirror a');
  await sleep(900);
  const offset = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.ProseMirror h2')].find((e) => e.textContent === 'Second section');
    return h.getBoundingClientRect().top - document.querySelector('.scroll').getBoundingClientRect().top;
  });
  assert.ok(offset >= 0 && offset < 60, `heading is ${offset}px from the top`);
  assert.equal(await page.evaluate(() => window.host.posted.some((m) => m.type === 'openLink')), false);
  await page.close();
});

const LINKS = 'See [setup](./setup.md) and [gone](./gone.md#top) for more.\n';
const openLinks = (page) => page.evaluate(() => window.host.posted.filter((m) => m.type === 'openLink').map((m) => m.href));

await test('a plain click on a link opens it in Edit mode too; Ctrl+click as well', async () => {
  const page = await open(LINKS);
  const at = await charXY(page, '.ProseMirror a', 0, 2);
  await page.mouse.click(at.x, at.y);
  await sleep(50);
  assert.deepEqual(await openLinks(page), ['./setup.md']);
  await sleep(600); // not a double-click
  const gone = await charXY(page, '.ProseMirror a', 1, 1);
  await page.keyboard.down(mod);
  await page.mouse.click(gone.x, gone.y);
  await page.keyboard.up(mod);
  await sleep(50);
  assert.deepEqual(await openLinks(page), ['./setup.md', './gone.md#top']);
  assert.equal(await settle(page), LINKS);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('dragging across or from a link selects text and opens nothing; Shift+click opens nothing', async () => {
  const page = await open(LINKS);
  const start = await charXY(page, '.ProseMirror p', 0, 0);
  const end = await charXY(page, '.ProseMirror p', 0, 16);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await sleep(50);
  assert.equal(await page.evaluate(() => getSelection().toString()), 'See setup and go');
  await sleep(600);
  // A drag that starts on the link.
  const inLink = await charXY(page, '.ProseMirror a', 0, 1);
  await page.mouse.move(inLink.x, inLink.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  await page.keyboard.down('Shift');
  await page.mouse.click(inLink.x, inLink.y);
  await page.keyboard.up('Shift');
  await sleep(50);
  assert.deepEqual(await openLinks(page), []);
  assert.equal(await settle(page), LINKS);
  await page.close();
});

await test('in Preview, dragging across a link selects text; a drag from a link opens nothing', async () => {
  const page = await open(LINKS, 'preview');
  const start = await charXY(page, '.ProseMirror p', 0, 0);
  const end = await charXY(page, '.ProseMirror p', 0, 16);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await sleep(50);
  assert.equal(await page.evaluate(() => getSelection().toString()), 'See setup and go');
  await sleep(600);
  // Chromium never starts a selection on a link outside editable text (Alt+drag does); it must not open either.
  const inLink = await charXY(page, '.ProseMirror a', 0, 1);
  await page.mouse.move(inLink.x, inLink.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await sleep(50);
  assert.deepEqual(await openLinks(page), []);
  await page.close();
});

/** Hovers the n-th link and waits for the link card. */
async function hoverLink(page, n) {
  const at = await charXY(page, '.ProseMirror a', n, 1);
  await page.mouse.move(at.x - 30, at.y + 40);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.waitForSelector('.linkcard:not([hidden])', { timeout: 2000 });
}

await test('hovering a link in Edit mode shows a card: Open, Copy link and Edit link work', async () => {
  const page = await open(LINKS);
  await page.evaluate(() => {
    window.copied = [];
    navigator.clipboard.writeText = (t) => { window.copied.push(t); return Promise.resolve(); };
  });
  await hoverLink(page, 0);
  assert.equal(await page.$eval('.linkcard .lc-href', (e) => e.textContent), './setup.md');
  const buttons = await page.$$eval('.linkcard button', (bs) => bs.map((b) => [b.textContent.trim(), b.title !== '']));
  assert.deepEqual(buttons, [['Open', true], ['Edit link', true], ['Copy link', true]]);

  await page.click('.linkcard [data-act="copy"]');
  assert.deepEqual(await page.evaluate(() => window.copied), ['./setup.md']);
  assert.equal(await page.$eval('.linkcard', (e) => e.hidden), true, 'a button hides the card');

  await page.mouse.move(5, 5);
  await hoverLink(page, 1);
  await page.click('.linkcard [data-act="open"]');
  assert.deepEqual(await openLinks(page), ['./gone.md#top']);

  await page.mouse.move(5, 5);
  await hoverLink(page, 0);
  await page.click('.linkcard [data-act="edit"]');
  await page.waitForSelector('.linkrow:not([hidden])');
  assert.equal(await page.$eval('.linkrow input', (i) => i.value), './setup.md');
  await page.keyboard.down(mod);
  await page.keyboard.press('a');
  await page.keyboard.up(mod);
  await page.keyboard.type('./install.md');
  await page.keyboard.press('Enter');
  assert.equal(await settle(page), 'See [setup](./install.md) and [gone](./gone.md#top) for more.\n');
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('the link card hides when the pointer leaves, on typing, and never shows in Preview', async () => {
  const page = await open(LINKS);
  await hoverLink(page, 0);
  // Moving onto the card keeps it.
  const card = await page.$eval('.linkcard', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; });
  await page.mouse.move(card.x, card.y, { steps: 3 });
  await sleep(400);
  assert.equal(await page.$eval('.linkcard', (e) => e.hidden), false, 'moving onto the card keeps it');
  await page.mouse.move(600, 600);
  await sleep(400);
  assert.equal(await page.$eval('.linkcard', (e) => e.hidden), true, 'leaving hides it');

  await clickChar(page, '.ProseMirror p', 0, 1);
  await hoverLink(page, 0);
  await page.keyboard.type('x');
  assert.equal(await page.$eval('.linkcard', (e) => e.hidden), true, 'typing hides it');

  await page.evaluate(() => window.postMessage({ type: 'setMode', mode: 'preview' }, '*'));
  await page.mouse.move(5, 5);
  const at = await charXY(page, '.ProseMirror a', 0, 1);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await sleep(700);
  assert.equal(await page.$eval('.linkcard', (e) => e.hidden), true, 'no card in Preview');
  await page.close();
});

await test('broken links are marked after the host answers checkLinks, without any edit', async () => {
  const page = await open(LINKS, 'preview');
  const check = await page.evaluate(() => window.host.posted.find((m) => m.type === 'checkLinks'));
  assert.deepEqual(check, { type: 'checkLinks', hrefs: ['./setup.md', './gone.md#top'] });
  await page.evaluate(() => window.postMessage({
    type: 'linkStatus', missing: ['./gone.md#top'], paths: [['./setup.md', 'docs/setup.md'], ['./gone.md#top', 'docs/gone.md']],
  }, '*'));
  await sleep(50);
  const marked = await page.$$eval('.link-missing', (els) => els.map((e) => [e.textContent, e.title, e.closest('a').getAttribute('href')]));
  assert.deepEqual(marked, [['gone', "docs/gone.md doesn't exist", './gone.md#top']]);
  assert.equal(await page.$eval('.ProseMirror a [title="docs/setup.md"]', (e) => e.textContent), 'setup');
  const color = await page.$eval('.link-missing', (e) => getComputedStyle(e).textDecorationStyle);
  assert.equal(color, 'wavy');
  // Switching to Edit and back, and the next check, change nothing in the file.
  await page.click('[data-mode="edit"]');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(300);
  assert.equal(await page.evaluate(() => window.host.posted.filter((m) => m.type === 'checkLinks').length), 2, 'focus checks again');
  assert.deepEqual(await page.evaluate(() => window.host.posted.filter((m) => m.type === 'edit')), []);
  assert.equal(await page.evaluate(() => window.host.text), LINKS);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('init with an anchor opens the page scrolled to that heading; scrollTo scrolls an open page', async () => {
  const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n');
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  await page.evaluateOnNewDocument((t) => { window.__initialText = t; window.__mode = 'preview'; window.__anchor = 'install'; }, `# Top\n\n${filler}\n\n## Install\n\n${filler}\n\n## Usage\n\n${filler}\n`);
  await page.goto(harness);
  await page.waitForSelector('.app[data-mode]');
  await sleep(200);
  const offsetOf = (name) => page.evaluate((name) => {
    const h = [...document.querySelectorAll('.ProseMirror h2')].find((e) => e.textContent === name);
    return h.getBoundingClientRect().top - document.querySelector('.scroll').getBoundingClientRect().top;
  }, name);
  const install = await offsetOf('Install');
  assert.ok(install >= 0 && install < 60, `Install is ${install}px from the top`);
  await page.evaluate(() => window.postMessage({ type: 'scrollTo', anchor: 'usage' }, '*'));
  await sleep(900);
  const usage = await offsetOf('Usage');
  assert.ok(usage >= 0 && usage < 60, `Usage is ${usage}px from the top`);
  await page.close();
});

/** Fires a real paste event carrying only text/plain at the caret. */
const pastePlain = (page, text) => page.evaluate((text) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

await test('pasting Markdown text makes formatted blocks; plain prose stays plain', async () => {
  const page = await open('Intro\n');
  await clickChar(page, '.ProseMirror p', 0, 5);
  await pastePlain(page, '## Pasted\n\n- **a**\n- b');
  await page.keyboard.type('More');
  assert.equal(await settle(page), 'Intro\n\n## Pasted\n\n- **a**\n- b\n\nMore\n');
  assert.equal(await page.$eval('.ProseMirror h2', (e) => e.textContent), 'Pasted');
  await pastePlain(page, ' and 2 * 3');
  assert.equal(await settle(page), 'Intro\n\n## Pasted\n\n- **a**\n- b\n\nMore and 2 \\* 3\n');
  await page.close();
});

await test('an external change resets the editor', async () => {
  const page = await open('Old text\n');
  await page.evaluate(() => {
    window.host.text = 'New text from git\n';
    window.host.version = 9;
    window.postMessage({ type: 'reset', text: window.host.text, version: 9 }, '*');
  });
  await sleep(50);
  assert.equal(await page.$eval('.ProseMirror p', (e) => e.textContent), 'New text from git');
  await page.close();
});

await test('Markdown mode edits apply when switching back', async () => {
  const page = await open('# A\n\nB\n');
  await page.click('[data-mode="source"]');
  await page.$eval('textarea.source', (t) => { t.value = '# A\n\nB changed\n'; t.dispatchEvent(new Event('input')); });
  await page.click('[data-mode="edit"]');
  assert.equal(await settle(page), '# A\n\nB changed\n');
  assert.equal(await page.$$eval('.ProseMirror p', (ps) => ps[0].textContent), 'B changed');
  await page.close();
});

async function typeAtEndOfSource(page, text) {
  await page.click('[data-mode="source"]');
  await page.focus('textarea.source');
  await page.$eval('textarea.source', (t) => t.setSelectionRange(t.value.length, t.value.length));
  await page.keyboard.type(text);
}

await test('Markdown mode: typing reaches the file after the debounce, without leaving the mode', async () => {
  const page = await open('# A\n\nB\n');
  await typeAtEndOfSource(page, 'More');
  await sleep(300);
  assert.equal(await page.evaluate(() => window.host.text), '# A\n\nB\nMore');
  assert.equal(await page.$eval('.app', (e) => e.dataset.mode), 'source');
  const edits = await page.evaluate(() => window.host.posted.filter((m) => m.type === 'edit').map((m) => m.edits));
  assert.deepEqual(edits.at(-1), [{ start: 7, end: 7, text: 'More' }]);
  await page.close();
});

await test('Markdown mode: Ctrl+Z sends the pending edit, then one undo to VS Code', async () => {
  const page = await open('# A\n\nB\n');
  await typeAtEndOfSource(page, 'x');
  await page.keyboard.down(mod);
  await page.keyboard.press('z');
  await page.keyboard.up(mod);
  await sleep(300);
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => t === 'edit' || t === 'undo'));
  assert.deepEqual(posted, ['edit', 'undo']);
  assert.equal(await page.evaluate(() => window.host.text), '# A\n\nB\nx');
  await page.close();
});

await test('Russian layout: Ctrl+Z (key "я") undoes once in Markdown mode, Ctrl+E (key "у") toggles Preview', async () => {
  const page = await open('# A\n\nB\n');
  await typeAtEndOfSource(page, 'x');
  const press = (key, code, keyCode) =>
    page.evaluate((key, code, keyCode) => {
      const t = document.activeElement ?? document.body;
      t.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, ctrlKey: true, bubbles: true, cancelable: true }));
    }, key, code, keyCode);
  await press('я', 'KeyZ', 90);
  await sleep(300);
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type).filter((t) => t === 'edit' || t === 'undo'));
  assert.deepEqual(posted, ['edit', 'undo']);
  await page.evaluate(() => window.postMessage({ type: 'setMode', mode: 'preview' }, '*'));
  await sleep(100);
  assert.equal(await page.$eval('.app', (e) => e.dataset.mode), 'preview');
  await press('у', 'KeyE', 69);
  await sleep(100);
  assert.equal(await page.$eval('.app', (e) => e.dataset.mode), 'edit');
  await page.close();
});

await test('Markdown mode: a reset replaces the textarea when nothing is unsent', async () => {
  const page = await open('# A\n\nB\n');
  await page.click('[data-mode="source"]');
  await page.evaluate(() => {
    window.host.text = '# A\n\nFrom git\n';
    window.host.version = 9;
    window.postMessage({ type: 'reset', text: window.host.text, version: 9 }, '*');
  });
  await sleep(50);
  assert.equal(await page.$eval('textarea.source', (t) => t.value), '# A\n\nFrom git\n');
  await page.close();
});

await test('Markdown mode: a reset over unsent typing shows the file and says so', async () => {
  const page = await open('# A\n\nB\n');
  await typeAtEndOfSource(page, 'typed');
  await page.evaluate(() => {
    window.host.text = '# A\n\nFrom git\n';
    window.host.version = 9;
    window.postMessage({ type: 'reset', text: window.host.text, version: 9 }, '*');
  });
  await sleep(300);
  assert.equal(await page.$eval('textarea.source', (t) => t.value), '# A\n\nFrom git\n');
  assert.equal(await page.evaluate(() => window.host.text), '# A\n\nFrom git\n');
  assert.match(await page.$eval('#toast', (e) => (e.hidden ? '' : e.textContent)), /changed while you were typing/);
  await page.close();
});

await test('under the webview CSP, table alignment and the task progress bar still render', async () => {
  const page = await open('| L | C | R |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n\n- [x] a\n- [ ] b\n', 'preview');
  const align = await page.$$eval('.ProseMirror td', (tds) => tds.map((td) => getComputedStyle(td).textAlign));
  assert.deepEqual(align, ['left', 'center', 'right']);
  const width = await page.$eval('.outline .bar i', (i) => i.getBoundingClientRect().width / i.parentElement.getBoundingClientRect().width);
  assert.ok(Math.abs(width - 0.5) < 0.02, `progress bar at ${width}`);
  assert.deepEqual(page.errors.filter((e) => /Content Security Policy/i.test(e)), []);
  await page.close();
});

await test('untouched file round-trips with no edit at all', async () => {
  const src = '---\ntitle: x\n---\n\n<div align="center">\n  <img src="logo.png">\n</div>\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n> [!note]\n> Lower-case callout.\n';
  const page = await open(src);
  await sleep(300);
  const edits = await page.evaluate(() => window.host.posted.filter((m) => m.type === 'edit'));
  assert.deepEqual(edits, []);
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------------------------------------------------------- AI suggestions

const AI_DOC = 'Intro paragraph here.\n\nSecond  block   stays *as is*.\n';
const posted = (page, type) => page.evaluate((type) => window.host.posted.filter((m) => m.type === type), type);
const fromHost = (page, m) => page.evaluate((m) => window.postMessage(m, '*'), m);
const boxOpen = (page) => page.evaluate(() => !!document.querySelector('.ProseMirror .ai-box'));

/** Selects `length` characters from `offset` in the first paragraph, then runs `action` from the selection bubble's AI menu. */
async function aiFromBubble(page, action, offset = 6, length = 14) {
  await clickChar(page, '.ProseMirror p', 0, offset);
  await page.keyboard.down('Shift');
  for (let i = 0; i < length; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.bubble:not([hidden]) [data-act="ai"]');
  await page.click('.bubble [data-act="ai"]');
  await page.waitForSelector('.menu:not([hidden])');
  await page.click(`.menu .mi[data-id="${action}"]`);
  await sleep(30);
  return (await posted(page, 'ai')).at(-1);
}

await test('AI: the answer streams into a box below the selection; Accept makes exactly one edit', async () => {
  const page = await open(AI_DOC);
  const req = await aiFromBubble(page, 'improve');
  assert.equal(req.action, 'improve');
  assert.equal(req.markdown, 'paragraph here');
  await fromHost(page, { type: 'aiChunk', id: req.id, text: 'text with ' });
  await fromHost(page, { type: 'aiChunk', id: req.id, text: '**bold** words' });
  await sleep(80);
  assert.equal(await page.$eval('.ai-box .ai-out', (e) => e.textContent), 'text with bold words');
  assert.equal(await page.$eval('.ai-box .ai-out strong', (e) => e.textContent), 'bold');
  assert.equal(await page.$eval('.ai-range', (e) => e.textContent), 'paragraph here');
  assert.equal(await page.$eval('[data-ai="accept"]', (b) => b.disabled), true, 'no Accept while streaming');
  assert.equal(await page.$eval('[data-ai="stop"]', (b) => getComputedStyle(b).display !== 'none'), true, 'Stop while streaming');
  // The box sits after the paragraph, before the next block, and is not part of the document.
  assert.equal(await page.$eval('.ai-box', (b) => b.previousElementSibling.textContent), 'Intro paragraph here.');
  await fromHost(page, { type: 'aiDone', id: req.id });
  await sleep(300);
  assert.deepEqual(await posted(page, 'edit'), [], 'nothing is sent before Accept');
  assert.equal(await page.evaluate(() => window.host.text), AI_DOC);
  await page.click('[data-ai="accept"]');
  assert.equal(await settle(page), 'Intro text with **bold** words.\n\nSecond  block   stays *as is*.\n');
  assert.equal((await posted(page, 'edit')).length, 1, 'one edit message');
  assert.equal(await boxOpen(page), false);
  assert.equal(await page.$$eval('.ai-range', (els) => els.length), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('AI: Discard and Esc change nothing and cancel the request; Insert below keeps the selection', async () => {
  const page = await open(AI_DOC);
  let req = await aiFromBubble(page, 'shorten');
  await fromHost(page, { type: 'aiChunk', id: req.id, text: 'Short.' });
  await sleep(50);
  await page.click('.ai-actions [data-ai="discard"]');
  assert.equal(await boxOpen(page), false);
  assert.deepEqual((await posted(page, 'aiCancel')).map((m) => m.id), [req.id]);

  req = await aiFromBubble(page, 'summarize');
  await fromHost(page, { type: 'aiChunk', id: req.id, text: 'Gist.' });
  await fromHost(page, { type: 'aiDone', id: req.id });
  await sleep(50);
  await page.keyboard.press('Escape');
  assert.equal(await boxOpen(page), false, 'Esc discards');
  // A chunk for a discarded request is ignored.
  await fromHost(page, { type: 'aiChunk', id: req.id, text: 'late' });
  await sleep(300);
  assert.deepEqual(await posted(page, 'edit'), []);
  assert.equal(await page.evaluate(() => window.host.text), AI_DOC);

  req = await aiFromBubble(page, 'summarize');
  await fromHost(page, { type: 'aiChunk', id: req.id, text: '- one\n- two' });
  await fromHost(page, { type: 'aiDone', id: req.id });
  await sleep(50);
  await page.click('[data-ai="below"]');
  assert.equal(await settle(page), 'Intro paragraph here.\n\n- one\n- two\n\nSecond  block   stays *as is*.\n');
  assert.equal((await posted(page, 'edit')).length, 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('AI: Try again sends a new request; Stop keeps the partial answer', async () => {
  const page = await open(AI_DOC);
  const first = await aiFromBubble(page, 'longer');
  await fromHost(page, { type: 'aiChunk', id: first.id, text: 'Partial' });
  await sleep(50);
  await page.click('[data-ai="stop"]');
  assert.deepEqual((await posted(page, 'aiCancel')).map((m) => m.id), [first.id]);
  assert.equal(await page.$eval('[data-ai="accept"]', (b) => b.disabled), false);
  await page.click('[data-ai="retry"]');
  const again = (await posted(page, 'ai')).at(-1);
  assert.notEqual(again.id, first.id);
  assert.equal(again.markdown, first.markdown);
  assert.equal(await page.$eval('.ai-box .ai-out', (e) => e.textContent), '');
  await page.close();
});

await test('AI: aiFallback (prompt copied, chat opened) and aiError close the box', async () => {
  const page = await open(AI_DOC, 'edit', { aiEditor: false });
  await clickChar(page, '.ProseMirror p', 0, 2);
  await page.click('.toolbar [data-act="ai"]');
  // Nothing selected: only the writing actions; without a model they open a chat.
  assert.deepEqual(await page.$$eval('.menu .mi', (els) => els.map((e) => e.dataset.id)), ['continue', 'ask']);
  assert.match(await page.$eval('.menu .menu-h', (e) => e.textContent), /opens a chat/);
  await page.keyboard.press('Escape');
  let req = await aiFromBubble(page, 'grammar');
  assert.equal(await boxOpen(page), true);
  await fromHost(page, { type: 'aiFallback', id: req.id });
  await sleep(30);
  assert.equal(await boxOpen(page), false);
  req = await aiFromBubble(page, 'grammar');
  await fromHost(page, { type: 'aiError', id: req.id, message: 'The AI request was blocked' });
  await sleep(30);
  assert.equal(await boxOpen(page), false);
  assert.match(await page.$eval('#toast', (e) => e.textContent), /blocked/);
  await sleep(300);
  assert.deepEqual(await posted(page, 'edit'), []);
  await page.close();
});

await test('AI: Translate to… German, Other… and Ask AI… ask in the box; /ai continues writing at the cursor', async () => {
  const page = await open(AI_DOC);
  await aiFromBubble(page, 'translate');
  await page.waitForSelector('.menu:not([hidden]) .mi[data-id="lang:German"]');
  assert.equal(await page.$eval('.menu .mi:last-child .mi-l', (e) => e.textContent), 'Other…');
  await page.click('.menu .mi[data-id="lang:German"]');
  let req = (await posted(page, 'ai')).at(-1);
  assert.deepEqual([req.action, req.lang, req.markdown], ['translate', 'German', 'paragraph here']);

  await aiFromBubble(page, 'translate');
  await page.click('.menu .mi[data-id="lang:"]');
  await page.waitForSelector('.ai-box[data-phase="ask"] input');
  await page.keyboard.type('Portuguese');
  await page.keyboard.press('Enter');
  req = (await posted(page, 'ai')).at(-1);
  assert.deepEqual([req.action, req.lang], ['translate', 'Portuguese']);
  await page.keyboard.press('Escape');

  await aiFromBubble(page, 'ask');
  await page.waitForSelector('.ai-box[data-phase="ask"] input');
  await page.keyboard.type('Make it formal');
  await page.keyboard.press('Enter');
  req = (await posted(page, 'ai')).at(-1);
  assert.deepEqual([req.action, req.instruction, req.markdown], ['ask', 'Make it formal', 'paragraph here']);
  await page.keyboard.press('Escape');

  // `/ai` on a new line: Continue writing, with the document before the cursor as context.
  await clickChar(page, '.ProseMirror p', 1, 'Second  block   stays as is.'.length);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/ai');
  await page.waitForSelector('.menu:not([hidden])');
  assert.equal(await page.$eval('.menu .mi.kb', (e) => e.dataset.id), 'ai:continue');
  await page.keyboard.press('Enter');
  req = (await posted(page, 'ai')).at(-1);
  assert.equal(req.action, 'continue');
  assert.equal(req.context, 'Intro paragraph here.\n\nSecond  block   stays *as is*.');
  await fromHost(page, { type: 'aiChunk', id: req.id, text: 'Next thought.' });
  await fromHost(page, { type: 'aiDone', id: req.id });
  await sleep(50);
  await page.click('[data-ai="accept"]');
  assert.equal(await settle(page), 'Intro paragraph here.\n\nSecond  block   stays *as is*.\n\nNext thought.\n');
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('AI: a mode change discards the suggestion and cancels the request', async () => {
  const page = await open(AI_DOC);
  const req = await aiFromBubble(page, 'improve');
  await page.click('[data-mode="preview"]');
  assert.equal(await boxOpen(page), false);
  assert.deepEqual((await posted(page, 'aiCancel')).map((m) => m.id), [req.id]);
  await sleep(300);
  assert.equal(await page.evaluate(() => window.host.text), AI_DOC);
  await page.close();
});

await test('margin.ai = off hides every AI entry point; aiAvailable brings them back', async () => {
  const page = await open(AI_DOC, 'edit', { ai: 'off' });
  const visible = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none');
  assert.equal(await visible('.toolbar [data-act="ai"]'), false, 'toolbar');
  await clickChar(page, '.ProseMirror p', 0, 6);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.bubble:not([hidden])');
  assert.equal(await visible('.bubble [data-act="ai"]'), false, 'bubble');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForSelector('.menu:not([hidden])');
  const ids = await page.$$eval('.menu .mi', (els) => els.map((e) => e.dataset.id));
  assert.equal(ids.some((id) => id.startsWith('ai:')), false, 'slash menu');
  await page.keyboard.press('Escape');
  await fromHost(page, { type: 'aiAvailable', editor: true, setting: 'auto' });
  await sleep(30);
  assert.equal(await visible('.toolbar [data-act="ai"]'), true, 'back on');
  await page.close();
});

// ---------------------------------------------------------------- page width

const WIDE_SCREEN = { width: 1600, height: 900 };
const WIDTH_DOC = '# Width\n\nA paragraph long enough to fill the whole text column at every one of the widths, so its box is as wide as the column itself and the test can measure it from the rendered page.\n\n## Second\n\nMore text.\n';
/** The text column of each width in px (the box around it adds 72 px of padding on each side). */
const COLUMN = { narrow: 600, normal: 716, wide: 1000 };
const widthState = (width, override = null, setting = override ? 'normal' : width) => ({ width, setting, override });
/** Width of the text column in the current mode, and what the page shows. */
const measure = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.doc-wrap');
  const mode = document.querySelector('.app').dataset.mode;
  const content = mode === 'source' ? document.querySelector('textarea.source') : document.querySelector('.ProseMirror');
  return {
    width: document.querySelector('.app').dataset.width,
    maxWidth: getComputedStyle(wrap).maxWidth,
    column: Math.round(content.getBoundingClientRect().width),
    scroll: document.querySelector('.scroll').clientWidth,
    outline: !document.querySelector('.outline').hidden && document.querySelector('.outline').getBoundingClientRect().width > 0,
  };
});
const expectColumn = (m, width) => (width === 'full' ? m.scroll - 2 * 72 : COLUMN[width]);

await test('page width: init with each width sets data-width and the column width in Preview, Edit and Markdown', async () => {
  for (const width of ['narrow', 'normal', 'wide', 'full']) {
    const page = await open(WIDTH_DOC, 'preview', { pageWidth: widthState(width) }, WIDE_SCREEN);
    for (const mode of ['preview', 'edit', 'source']) {
      await page.click(`[data-mode="${mode}"]`);
      await sleep(50);
      const m = await measure(page);
      assert.equal(m.width, width, `${width} ${mode}`);
      assert.equal(m.maxWidth, width === 'full' ? '100%' : `${COLUMN[width] + 2 * 72}px`, `${width} ${mode}: max-width`);
      assert.equal(m.column, expectColumn(m, width), `${width} ${mode}: column`);
      assert.equal(m.outline, true, `${width} ${mode}: the outline still shows`);
    }
    // Full width is wider than Wide on this screen.
    if (width === 'full') assert.ok((await measure(page)).column > COLUMN.wide);
    assert.deepEqual(await posted(page, 'edit'), []);
    assert.equal(await page.evaluate(() => window.host.text), WIDTH_DOC);
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});

await test('page width: without a width in init the page is Normal, the width the editor always had', async () => {
  const page = await open(WIDTH_DOC, 'preview', {}, WIDE_SCREEN);
  const m = await measure(page);
  assert.deepEqual([m.width, m.maxWidth, m.column], ['normal', '860px', 716]);
  await page.close();
});

await test('page width: the toolbar menu posts pageWidth and the page follows; Use default goes back', async () => {
  const page = await open(WIDTH_DOC, 'preview', { pageWidth: widthState('normal') }, WIDE_SCREEN);
  const outlineButton = await page.$eval('.toolbar [data-act="width"]', (b) => b.previousElementSibling?.dataset.act ?? b.nextElementSibling?.dataset.act);
  assert.ok(['outline'].includes(outlineButton), 'next to the outline toggle');
  await page.click('.toolbar [data-act="width"]');
  await page.waitForSelector('.menu:not([hidden])');
  const items = await page.$$eval('.menu .mi', (els) => els.map((e) => [e.dataset.id, e.querySelector('.mi-l').textContent, !!e.querySelector('.ck')]));
  assert.deepEqual(items, [
    ['narrow', 'Narrow', false], ['normal', 'Normal', false], ['wide', 'Wide', false], ['full', 'Full width', false],
    ['default', 'Use default (Normal)', true],
  ]);
  await page.click('.menu .mi[data-id="wide"]');
  await sleep(350); // the width transition
  assert.deepEqual(await posted(page, 'pageWidth'), [{ type: 'pageWidth', value: 'wide' }]);
  let m = await measure(page);
  assert.deepEqual([m.width, m.column], ['wide', 1000]);

  await page.click('.toolbar [data-act="width"]');
  await page.waitForSelector('.menu:not([hidden])');
  assert.deepEqual(await page.$$eval('.menu .mi', (els) => els.filter((e) => e.querySelector('.ck')).map((e) => e.dataset.id)), ['wide']);
  await page.click('.menu .mi[data-id="default"]');
  await sleep(350);
  assert.deepEqual((await posted(page, 'pageWidth')).map((p) => p.value), ['wide', null]);
  m = await measure(page);
  assert.deepEqual([m.width, m.column], ['normal', 716]);
  // The width changes nothing in the file, in any mode.
  await page.click('[data-mode="edit"]');
  await page.click('.toolbar [data-act="width"]');
  await page.click('.menu .mi[data-id="narrow"]');
  await sleep(350);
  assert.equal((await measure(page)).column, 600);
  await sleep(200);
  assert.deepEqual(await posted(page, 'edit'), []);
  assert.equal(await page.evaluate(() => window.host.text), WIDTH_DOC);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('page width: setPageWidth from the host applies; block handles and the selection bubble follow the column', async () => {
  const page = await open(WIDTH_DOC, 'edit', { pageWidth: widthState('normal') }, WIDE_SCREEN);
  await fromHost(page, { type: 'setPageWidth', ...widthState('full', 'full') });
  await sleep(350);
  let m = await measure(page);
  assert.deepEqual([m.width, m.column], ['full', expectColumn(m, 'full')]);
  await page.click('.toolbar [data-act="width"]');
  await page.waitForSelector('.menu:not([hidden])');
  assert.deepEqual(await page.$$eval('.menu .mi', (els) => els.filter((e) => e.querySelector('.ck')).map((e) => e.dataset.id)), ['full']);
  await page.keyboard.press('Escape');

  for (const width of ['full', 'narrow', 'wide']) {
    if (width !== 'full') {
      await fromHost(page, { type: 'setPageWidth', ...widthState(width, width) });
      await sleep(350);
    }
    // Hovering a paragraph puts the handles just left of it, inside the page.
    const p = await page.$eval('.ProseMirror p', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 8, left: r.left }; });
    await page.mouse.move(p.x, p.y + 30);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await sleep(50);
    const g = await page.$eval('.gutter', (e) => ({ hidden: e.hidden, ...e.getBoundingClientRect().toJSON() }));
    const scrollLeft = await page.$eval('.scroll', (e) => e.getBoundingClientRect().left);
    assert.equal(g.hidden, false, `${width}: handles show`);
    assert.ok(g.right <= p.left + 1 && g.right >= p.left - 40, `${width}: handles end at ${g.right}, the block starts at ${p.left}`);
    assert.ok(g.left >= scrollLeft, `${width}: handles inside the page`);
  }

  // The bubble stays over the selection when the width changes under it.
  await clickChar(page, '.ProseMirror p', 0, 2);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.bubble:not([hidden])');
  await fromHost(page, { type: 'setPageWidth', ...widthState('narrow', 'narrow') });
  await sleep(400);
  const place = await page.evaluate(() => {
    const sel = getSelection().getRangeAt(0).getBoundingClientRect();
    const b = document.querySelector('.bubble');
    const r = b.getBoundingClientRect();
    return { hidden: b.hidden, gap: sel.top - r.bottom, overlap: Math.min(r.right, sel.right) - Math.max(r.left, sel.left) };
  });
  assert.equal(place.hidden, false);
  assert.ok(place.gap >= 0 && place.gap < 30, `bubble ${place.gap}px above the selection`);
  assert.ok(place.overlap > 0, 'bubble over the selection');
  await sleep(200);
  assert.deepEqual(await posted(page, 'edit'), []);
  assert.deepEqual(await posted(page, 'pageWidth'), [], 'a width from the host is not sent back');
  assert.equal(await page.evaluate(() => window.host.text), WIDTH_DOC);
  assert.deepEqual(page.errors, []);
  await page.close();
});

await test('page width: the width change is animated, except with reduced motion', async () => {
  const page = await open(WIDTH_DOC, 'preview', { pageWidth: widthState('normal') }, WIDE_SCREEN);
  const duration = () => page.$eval('.doc-wrap', (e) => getComputedStyle(e).transitionDuration);
  assert.notEqual(await duration(), '0s');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await duration(), '0s');
  await fromHost(page, { type: 'setPageWidth', ...widthState('wide', 'wide') });
  await sleep(20);
  assert.equal((await measure(page)).column, 1000, 'at once');
  await page.close();
});

await browser.close();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log('all passed');
