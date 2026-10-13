// Edits Markdown files through Margin in a real VS Code, with real mouse and keyboard input and
// autosave on, then compares the files on disk with the expected text byte for byte. Each file
// is opened in Preview, edited in Edit mode, edited in Markdown mode, and shown in Preview again.
// The same document runs with LF and with CRLF line endings. Run with `npm run e2e:vscode`.
//
// VS Code runs isolated: a temporary user-data-dir, no other extensions, Margin from this folder
// (dist/, so build first). Uses the installed VS Code, MARGIN_VSCODE, or the .vscode-test build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The document: headings with their paragraph on the very next line, accents and an emoji
// (two UTF-16 units), a list, tasks, a table and code. Written with `eol`.
const DOC = [
  '# Bakery notes',
  '',
  '## Monday',
  'Croissant dough rested overnight. 🥐',
  '',
  '## Tuesday',
  'Tried the crème brûlée again',
  '',
  '- flour',
  '- butter',
  '',
  'Checklist:',
  '',
  '- [ ] order sugar',
  '- [ ] clean the oven',
  '',
  '| Item | Price |',
  '| --- | --- |',
  '| Café au lait | 3 |',
  '| Tart | 4 |',
  '',
  '```bash',
  'oven --preheat 200',
  '```',
  '',
].join('\n');

/** After the Edit mode steps below. */
const AFTER_EDIT = [
  '# Bakery notes',
  '',
  '## Monday',
  'Croissant dough rested overnight. 🥐 Flaky.',
  '',
  'Next: bake at 200 °C.',
  '',
  '## Tuesday',
  'Tried the crème brûlée again',
  '',
  '- flour',
  '- butter',
  '- eggs',
  '',
  'Checklist:',
  '',
  '- [ ] order sugar',
  '- [x] clean the oven',
  '',
  '| Item         | Price |',
  '| ------------ | ----- |',
  '| Café au lait | 3     |',
  '| Tart tatin   | 4     |',
  '',
  '```bash',
  'oven --preheat 200',
  '```',
  '',
].join('\n');

/** Markdown mode steps: [text to put the caret after (in the text so far), keys to type]. Enter is "\n". */
const SOURCE_STEPS = [
  ['Tried the crème brûlée again', ' — better'],
  ['- eggs', '\n- milk'],
  ['| Tart tatin   | 4     |', '\n| Éclair | 5 |'],
  ['oven --preheat 200', '\noven --timer 25'],
];

function findCode() {
  const list = [process.env.MARGIN_VSCODE];
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  const test = path.join(root, '.vscode-test');
  if (existsSync(test)) {
    for (const d of readdirSync(test).filter((d) => d.startsWith('vscode-')).sort().reverse()) list.push(path.join(test, d, 'Code.exe'));
  }
  list.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/usr/share/code/code');
  return list.find((p) => p && existsSync(p));
}

const exe = findCode();
if (!exe) throw new Error('VS Code not found; set MARGIN_VSCODE.');
if (!existsSync(path.join(root, 'dist', 'extension.cjs'))) throw new Error('dist/ is missing; run npm run build first.');

const tmp = mkdtempSync(path.join(tmpdir(), 'margin-vscode-e2e-'));
const ws = path.join(tmp, 'notes');
const userData = path.join(tmp, 'user-data');
mkdirSync(ws);
mkdirSync(path.join(userData, 'User'), { recursive: true });
const FILES = { 'lf.md': '\n', 'crlf.md': '\r\n' };
const withEol = (text, eol) => text.replace(/\n/g, eol);
for (const [name, eol] of Object.entries(FILES)) writeFileSync(path.join(ws, name), withEol(DOC, eol));

writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  'files.autoSave': 'afterDelay',
  'files.autoSaveDelay': 100,
  'workbench.editorAssociations': { '*.md': 'margin.editor' },
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'security.workspace.trust.enabled': false,
  'window.restoreWindows': 'none',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.ignoreRecommendations': true,
  'chat.disableAIFeatures': true,
  'git.enabled': false,
  'margin.defaultMode': 'preview',
  'margin.outline.visible': false,
}, null, 2));

const code = spawn(exe, [
  '--user-data-dir', userData,
  '--extensions-dir', path.join(tmp, 'extensions'),
  `--extensionDevelopmentPath=${root}`,
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  '--new-window',
  ws,
], { stdio: 'ignore' });

let browser;
let failures = 0;
try {
  for (let i = 0; ; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null, protocolTimeout: 60000 });
      break;
    } catch (e) {
      if (i > 60) throw e;
      await sleep(500);
    }
  }
  let page;
  for (let i = 0; !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes('workbench'));
    if (!page) {
      if (i > 60) throw new Error('No workbench window');
      await sleep(500);
    }
  }
  await page.waitForFunction(() => document.querySelector('.monaco-workbench'), { timeout: 60000 });
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.waitForFunction(() => [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].some((el) => el.textContent.trim() === 'lf.md'), { timeout: 30000 });
  await sleep(1500);

  for (const [name, eol] of Object.entries(FILES)) {
    try {
      await run(page, name, eol);
      console.log(`  ✓ ${name}: Preview, Edit and Markdown edits reach the file exactly`);
    } catch (e) {
      failures++;
      console.error(`  ✗ ${name}: ${e.message}`);
      // For diagnosis: the file as it is, and the window.
      const out = path.join(tmpdir(), `margin-vscode-e2e-${name}`);
      writeFileSync(`${out}.txt`, readFileSync(path.join(ws, name)));
      await page.screenshot({ path: `${out}.png` });
      console.error(`    file and screenshot: ${out}.txt, ${out}.png`);
    } finally {
      await closeAll(page);
    }
  }
} finally {
  try { await browser?.close(); } catch { /* already gone */ }
  try { code.kill(); } catch { /* already gone */ }
  await sleep(1500);
  for (let i = 0; i < 5; i++) {
    try { rmSync(tmp, { recursive: true, force: true }); break; } catch { await sleep(1000); }
  }
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------------------------

async function run(page, name, eol) {
  const file = path.join(ws, name);
  const disk = () => readFileSync(file, 'utf8');

  // Open the file from the Explorer: Margin shows it in Preview.
  const row = await page.evaluate((n) => {
    const r = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find((el) => el.textContent.trim() === n);
    const q = r.getBoundingClientRect();
    return { x: q.left + 40, y: q.top + q.height / 2 };
  }, name);
  await page.mouse.click(row.x, row.y);
  const doc = await marginFrame(page, 'Bakery notes');
  // A file opens in the mode last used: Preview, unless an earlier file left Margin in another.
  await click(page, doc, '[data-mode="preview"]');
  assert.equal(await doc.evaluate(() => document.querySelector('.app').dataset.mode), 'preview', 'shows Preview');
  await sleep(500);
  assert.equal(disk(), withEol(DOC, eol), 'opening the file changes nothing');

  // Edit mode.
  await click(page, doc, '[data-mode="edit"]');
  await sleep(300);
  await clickEnd(page, doc, '.ProseMirror p', 'overnight. 🥐');
  await type(page, ' Flaky.\nNext: bake at 200 °C.');
  await clickEnd(page, doc, '.ProseMirror li', 'butter');
  await type(page, '\neggs');
  await clickEnd(page, doc, '.ProseMirror td', 'Tart');
  await type(page, ' tatin');
  await click(page, doc, '.cb', 1);
  await settle(disk, withEol(AFTER_EDIT, eol), 'after Edit mode');

  // Markdown mode: the textarea always has LF line endings.
  await click(page, doc, '[data-mode="source"]');
  await sleep(300);
  let expected = AFTER_EDIT;
  for (const [after, keys] of SOURCE_STEPS) {
    const at = expected.indexOf(after) + after.length;
    await doc.evaluate((at) => {
      const t = document.querySelector('textarea.source');
      t.focus();
      t.setSelectionRange(at, at);
    }, at);
    await type(page, keys);
    expected = expected.slice(0, at) + keys + expected.slice(at);
    await sleep(250); // past the debounce and the autosave delay, so edits and saves interleave
  }
  await settle(disk, withEol(expected, eol), 'after Markdown mode');

  // Preview again: shows the edits and writes nothing.
  await click(page, doc, '[data-mode="preview"]');
  const shown = await doc.evaluate(() => document.querySelector('.ProseMirror').textContent);
  for (const s of ['Flaky.', 'Next: bake at 200 °C.', '— better', 'eggs', 'milk', 'Éclair', 'oven --timer 25']) assert.ok(shown.includes(s), `Preview shows "${s}"`);
  await sleep(800);
  assert.equal(disk(), withEol(expected, eol), 'Preview writes nothing');
  if (eol === '\r\n') assert.ok(!/[^\r]\n/.test(disk()), 'every line ends with CRLF');
}

/** Closes every editor, so the next file starts in a fresh Margin editor. */
async function closeAll(page) {
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget:not([style*="display: none"]) input', { timeout: 10000 });
  await page.keyboard.type('View: Close All Editors', { delay: 5 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.tabs-container .tab'), { timeout: 10000 });
  await sleep(300);
}

/** Waits until the file on disk is `expected`, and reports the first difference if it never is. */
async function settle(disk, expected, when) {
  const end = Date.now() + 10000;
  let text = disk();
  while (text !== expected && Date.now() < end) {
    await sleep(100);
    text = disk();
  }
  if (text === expected) return;
  let i = 0;
  while (text[i] === expected[i]) i++;
  const show = (s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40));
  throw new Error(`${when}: the file differs at offset ${i}\n      file:     ${show(text)}\n      expected: ${show(expected)}`);
}

/** Types `keys`, pressing Enter for "\n". */
async function type(page, keys) {
  const parts = keys.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (i) await page.keyboard.press('Enter');
    if (parts[i]) await page.keyboard.type(parts[i], { delay: 15 });
  }
}

/** The Margin webview frame showing a page whose first heading is `title`. */
async function marginFrame(page, title) {
  for (let i = 0; i < 120; i++) {
    for (const f of page.frames()) {
      try {
        const ok = await f.evaluate((t) => {
          const h = document.querySelector('.ProseMirror h1');
          return !!h && h.textContent.trim() === t && document.visibilityState === 'visible';
        }, title);
        if (ok) return f;
      } catch { /* detached or not ready */ }
    }
    await sleep(250);
  }
  throw new Error(`Margin page "${title}" not found`);
}

async function offset(frame) {
  const bb = await (await frame.frameElement()).boundingBox();
  return { x: bb.x, y: bb.y };
}

/** Clicks the middle of the n-th `selector` element. */
async function click(page, frame, selector, n = 0) {
  await frame.waitForFunction((s, n) => document.querySelectorAll(s)[n], { timeout: 10000 }, selector, n);
  const r = await frame.evaluate((s, n) => {
    const q = document.querySelectorAll(s)[n].getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  }, selector, n);
  const o = await offset(frame);
  await page.mouse.click(r.x + o.x, r.y + o.y);
  await sleep(150);
}

/** Clicks just after the end of the text of the `selector` element that contains `needle`. */
async function clickEnd(page, frame, selector, needle) {
  const r = await frame.evaluate((s, needle) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.includes(needle));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.includes(needle)) last = n;
    const range = document.createRange();
    const end = last.textContent.indexOf(needle) + needle.length;
    range.setStart(last, end);
    range.setEnd(last, end);
    const q = range.getBoundingClientRect();
    return { x: q.left + 1, y: q.top + q.height / 2 };
  }, selector, needle);
  if (!r) throw new Error(`No ${selector} with "${needle}"`);
  const o = await offset(frame);
  await page.mouse.click(r.x + o.x, r.y + o.y);
  await sleep(150);
}
