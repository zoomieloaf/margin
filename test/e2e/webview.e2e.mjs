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

async function open(text, mode = 'edit') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument((t, m) => { window.__initialText = t; window.__mode = m; }, text, mode);
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

await browser.close();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log('all passed');
