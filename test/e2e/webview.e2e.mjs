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
  const a = await charXY(page, '.ProseMirror p', 0, 6);
  const b = await charXY(page, '.ProseMirror p', 1, 6);
  await page.mouse.click(a.x, a.y);
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
  const at = await charXY(page, '.ProseMirror p', 0, 5);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Enter');
  assert.equal(await settle(page), '# Keep  this\n\nHello\n\nworld\n\n* keep\n* style\n');
  await page.close();
});

await test('slash menu inserts a heading', async () => {
  const page = await open('Intro\n');
  const at = await charXY(page, '.ProseMirror p', 0, 5);
  await page.mouse.click(at.x, at.y);
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
  const at = await charXY(page, '.ProseMirror p', 0, 5);
  await page.mouse.click(at.x, at.y);
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

await test('Ctrl+Z is sent to VS Code instead of undoing in the webview', async () => {
  const page = await open('Hello\n');
  const at = await charXY(page, '.ProseMirror p', 0, 5);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.down(mod);
  await page.keyboard.press('z');
  await page.keyboard.up(mod);
  await sleep(50);
  const posted = await page.evaluate(() => window.host.posted.map((m) => m.type));
  assert.ok(posted.includes('undo'), `posted: ${posted.join(', ')}`);
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
