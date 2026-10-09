// Records media/demo.gif: a real VS Code with the packaged Margin extension, driven over the
// Chrome DevTools Protocol with real mouse and keyboard input. Run with `npm run demo`
// (after `npm run package`, which builds margin-<version>.vsix).
//
// VS Code runs isolated: a temporary user-data-dir and extensions-dir, a copy of
// scripts/demo/workspace as a fresh git repo. Nothing of the user's own VS Code is touched.
// Options: --keep (leave the temp dir), --frames-only (skip GIF encoding).
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { encodeGif } from './encode.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
const args = new Set(process.argv.slice(2));
const W = 1280;
const H = 800;
const PORT = 9333;

if (!existsSync(vsix)) throw new Error(`${path.basename(vsix)} not found; run npm run package first.`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- VS Code ---------------------------------------------------------------------------------

/** The installed VS Code, or the build downloaded into .vscode-test by the integration tests. */
function findCode() {
  const list = [process.env.MARGIN_VSCODE];
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  const test = path.join(root, '.vscode-test');
  if (existsSync(test)) {
    for (const d of readdirSync(test).filter((d) => d.startsWith('vscode-')).sort().reverse()) list.push(path.join(test, d, 'Code.exe'));
  }
  list.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/usr/share/code/code');
  return list.filter((p) => p && existsSync(p));
}

/** Runs VS Code's CLI (cli.js under Electron-as-Node) next to `exe`. */
function codeCli(exe, cliArgs) {
  const dir = path.dirname(exe);
  const cli = [path.join(dir, 'resources', 'app', 'out', 'cli.js')];
  for (const d of readdirSync(dir)) cli.push(path.join(dir, d, 'resources', 'app', 'out', 'cli.js'));
  const js = cli.find((p) => existsSync(p));
  if (!js) throw new Error(`VS Code CLI not found next to ${exe}`);
  return execFileSync(exe, [js, ...cliArgs], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
}

const tmp = mkdtempSync(path.join(tmpdir(), 'margin-demo-'));
const ws = path.join(tmp, 'harbor-docs');
const userData = path.join(tmp, 'user-data');
const extDir = path.join(tmp, 'extensions');
const framesDir = path.join(tmp, 'frames');
mkdirSync(path.join(userData, 'User'), { recursive: true });
mkdirSync(extDir);
mkdirSync(framesDir);

// The demo workspace: a fresh git repo with one commit, so the end scene shows a real diff.
cpSync(path.join(root, 'scripts', 'demo', 'workspace'), ws, { recursive: true });
const git = (...a) => execFileSync('git', ['-c', 'user.name=Harbor', '-c', 'user.email=docs@harbor.example', '-c', 'core.autocrlf=false', ...a], { cwd: ws });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'Docs');

writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.editor.empty.hint': 'hidden',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.welcomePage.walkthroughs.openOnInstall': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'workbench.editorAssociations': { '*.md': 'margin.editor' },
  'security.workspace.trust.enabled': false,
  'window.restoreWindows': 'none',
  'window.zoomLevel': 0,
  'editor.minimap.enabled': false,
  'editor.wordWrap': 'on',
  'diffEditor.wordWrap': 'on',
  'diffEditor.hideUnchangedRegions.enabled': false,
  'diffEditor.renderSideBySide': true,
  'diffEditor.useInlineViewWhenSpaceIsLimited': false,
  'files.autoSave': 'afterDelay',
  'files.autoSaveDelay': 300,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.ignoreRecommendations': true,
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'git.autofetch': false,
  'git.openRepositoryInParentFolders': 'never',
  'github.gitAuthentication': false,
  'git.terminalAuthentication': false,
  'margin.outline.visible': true,
  'margin.defaultMode': 'preview',
}, null, 2));

const candidates = findCode();
if (!candidates.length) throw new Error('VS Code not found; set MARGIN_VSCODE to Code.exe.');

let code;
let exe;
for (const c of candidates) {
  try {
    codeCli(c, ['--user-data-dir', userData, '--extensions-dir', extDir, '--install-extension', vsix, '--force']);
  } catch (e) {
    console.warn(`${c}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    continue;
  }
  exe = c;
  code = spawn(c, [
    '--user-data-dir', userData,
    '--extensions-dir', extDir,
    `--remote-debugging-port=${PORT}`,
    '--force-device-scale-factor=1',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-gpu-sandbox',
    '--new-window',
    ws,
  ], { stdio: 'ignore', detached: false });
  break;
}
if (!code) throw new Error('No usable VS Code.');
console.log(`VS Code: ${exe}`);

let browser;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* already gone */ }
  try { code.kill(); } catch { /* already gone */ }
  await sleep(1500);
  if (!args.has('--keep')) {
    for (let i = 0; i < 5; i++) {
      try { rmSync(tmp, { recursive: true, force: true }); break; } catch { await sleep(1000); }
    }
  } else console.log(`Kept ${tmp}`);
};

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
  await record();
} catch (e) {
  // Leave a screenshot and the frame list behind for diagnosis.
  try {
    const page = (await browser.pages()).find((p) => p.url().includes('workbench'));
    const shot = path.join(tmpdir(), 'margin-demo-error.png');
    await page.screenshot({ path: shot });
    console.error(`Screenshot: ${shot}`);
    for (const f of page.frames()) console.error(`  frame ${f.url().slice(0, 140)}`);
  } catch { /* no page */ }
  throw e;
} finally {
  await cleanup();
}

// --- Recording -------------------------------------------------------------------------------

async function record() {
  let page;
  for (let i = 0; !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes('workbench'));
    if (!page) {
      if (i > 60) throw new Error('No workbench window');
      await sleep(500);
    }
  }
  await page.waitForFunction(() => document.querySelector('.monaco-workbench'), { timeout: 60000 });
  await sizeWindow(page);
  await page.bringToFront();
  // The window is usually not the OS foreground window; let the page behave as focused anyway.
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // Open README.md from the Explorer once the extension is up (not recorded).
  const readme = await page.waitForFunction(() => {
    const r = [...document.querySelectorAll('.explorer-folders-view .monaco-list-row')].find((el) => el.textContent.trim() === 'README.md');
    if (!r) return null;
    const q = r.getBoundingClientRect();
    return { x: q.left + 60, y: q.top + q.height / 2 };
  }, { timeout: 30000 }).then((h) => h.jsonValue());
  await sleep(2000);
  // Do Not Disturb: no toasts in the recording (the diff's text editor would otherwise get
  // Margin's first-run "Open Markdown files in Margin by default?").
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget:not([style*="display: none"]) input', { timeout: 10000 });
  await page.keyboard.type('Toggle Do Not Disturb', { delay: 10 });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.mouse.click(readme.x, readme.y);
  const doc = await marginFrame(page, 'Harbor');
  await sleep(2500); // extension host, git, link checks settle
  const size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  console.log(`Window ${size.join(' x ')}`);
  await installCursor(page);
  const m = mouse(page);
  // Focus the page (the keybindings need the webview focused): a click on blank space, before
  // the recording starts.
  await m.jump(W * 0.66, H * 0.9);
  await page.mouse.click(W * 0.66, H * 0.9);
  await sleep(600);

  if (args.has('--probe')) {
    const shot = path.join(tmpdir(), 'margin-demo-probe.png');
    await page.screenshot({ path: shot });
    console.log(`Probe screenshot: ${shot}`);
    return;
  }

  const rec = await startCapture(page);

  // 1. README in Preview, outline on the right.
  await sleep(1500);

  // 2. Edit mode, select a phrase, Bold.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyE');
  await page.keyboard.up('Control');
  await sleep(700);
  const para = 'p';
  const intro = await doc.evaluate(() => document.querySelector('.ProseMirror p').textContent);
  const at = intro.indexOf('plain Markdown');
  const a = await textPoint(doc, para, 0, at, 'start');
  const b = await textPoint(doc, para, 0, at + 'plain Markdown'.length, 'end');
  await m.move(a.x, a.y, 450);
  await m.drag(b.x, b.y, 500);
  await sleep(500);
  const bold = await box(doc, '.bubble:not([hidden]) [data-act="strong"]');
  await m.move(bold.x, bold.y, 380);
  await m.click();
  await sleep(700);

  // 3. Slash menu: a callout after the intro paragraph.
  const end = await textPoint(doc, para, 0, intro.length, 'end');
  await m.move(end.x + 3, end.y, 450);
  await m.click();
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.type('/call', { delay: 70 });
  await sleep(650);
  await page.keyboard.press('Enter');
  await sleep(250);
  await page.keyboard.type('Ship on Friday', { delay: 60 });
  await sleep(600);

  // 4. Tick the second task.
  const cb = await box(doc, '.cb', 1);
  await m.move(cb.x, cb.y, 450);
  await m.click();
  await sleep(700);

  // 5. Follow a link, then Alt+Left back.
  const link = await linkBox(doc, './guides/setup.md');
  await m.move(link.x, link.y, 450);
  await m.click();
  await marginFrame(page, 'Setup');
  await focusClick(page, m);
  await sleep(1000);
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Alt');
  await marginFrame(page, 'Harbor');
  await focusClick(page, m);
  await sleep(1200);

  // 6. Source Control, README.md: VS Code's own diff of the Markdown.
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyG');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(900);
  const row = await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.scm-view .monaco-list-row')];
    const r = rows.find((el) => /README\.md/.test(el.textContent) && el.getBoundingClientRect().width > 0);
    if (!r) return null;
    const q = r.querySelector('.label-name')?.getBoundingClientRect() ?? r.getBoundingClientRect();
    return { x: q.left + Math.min(q.width / 2, 40), y: q.top + q.height / 2 };
  }, { timeout: 15000 }).then((h) => h.jsonValue());
  await m.move(row.x, row.y, 500);
  await m.click();
  await page.waitForSelector('.monaco-diff-editor', { timeout: 15000 });
  await sleep(600);
  await m.move(W * 0.93, H * 0.9, 600); // out of the way
  await sleep(2500);

  const frames = await rec.stop();
  console.log(`${frames.length} frames captured`);
  if (args.has('--frames-only')) return;
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const info = await encodeGif(frames, {
    out: path.join(root, 'media', 'demo.gif'),
    still: path.join(root, 'media', 'demo-first-frame.png'),
    width: Number(process.env.DEMO_WIDTH || W),
    fps: 12,
    fadeMs: 500,
  });
  console.log(info);
}

/**
 * A newly opened page has no keyboard focus. The cursor glides off the text to blank space, and
 * a click there gives the page focus; the press isn't drawn (it would look like a stray click).
 */
async function focusClick(page, m) {
  if (m.x !== W * 0.66 || m.y !== H * 0.9) await m.move(W * 0.66, H * 0.9, 450);
  await page.mouse.click(W * 0.66, H * 0.9);
}

/**
 * Makes the window's page exactly W×H. Electron has no CDP window bounds, so on Windows the
 * native window is resized with SetWindowPos (the window is frameless: page size = window size).
 */
async function sizeWindow(page) {
  if (process.platform !== 'win32') throw new Error('Window sizing is implemented for Windows only.');
  const title = await page.evaluate(() => document.title);
  for (let i = 0; i < 4; i++) {
    const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
    if (w === W && h === H) return;
    const ps = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
'@
[Win]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Id ${code.pid} -ErrorAction SilentlyContinue
$h = $p.MainWindowHandle
if ($h -eq 0) { $h = (Get-Process Code | Where-Object { $_.MainWindowTitle -eq '${title.replace(/'/g, "''")}' } | Select-Object -First 1).MainWindowHandle }
[Win]::ShowWindow($h, 9) | Out-Null
$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
[Win]::SetWindowPos($h, [IntPtr]::Zero, 40, 40, ($r.R - $r.L) + ${W} - ${w}, ($r.B - $r.T) + ${H} - ${h}, 0x0044) | Out-Null
`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: ['ignore', 'inherit', 'inherit'] });
    await sleep(800);
  }
  const [w, h] = await page.evaluate(() => [innerWidth, innerHeight]);
  if (w !== W || h !== H) throw new Error(`Could not size the window to ${W}x${H} (got ${w}x${h}).`);
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

/** Offset of a frame's viewport inside the workbench page. */
async function frameOffset(frame) {
  const el = await frame.frameElement();
  const bb = await el.boundingBox();
  return { x: bb.x, y: bb.y };
}

async function box(frame, selector, n = 0) {
  await frame.waitForFunction((s, n) => document.querySelectorAll(s)[n], { timeout: 10000 }, selector, n);
  const r = await frame.evaluate((s, n) => {
    const q = document.querySelectorAll(s)[n].getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  }, selector, n);
  const o = await frameOffset(frame);
  return { x: r.x + o.x, y: r.y + o.y };
}

async function linkBox(frame, href) {
  const r = await frame.evaluate((h) => {
    const a = [...document.querySelectorAll('.ProseMirror a')].find((el) => el.getAttribute('href') === h);
    const q = a.getBoundingClientRect();
    return { x: q.left + q.width * 0.45, y: q.top + q.height / 2 };
  }, href);
  const o = await frameOffset(frame);
  return { x: r.x + o.x, y: r.y + o.y };
}

/** Page coordinates of a character boundary inside the n-th `selector` element. */
async function textPoint(frame, selector, n, offset, side) {
  const r = await frame.evaluate((selector, n, offset, side) => {
    const el = document.querySelectorAll(selector)[n];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let left = offset;
    while (node && left > node.length) { left -= node.length; node = walker.nextNode(); }
    const range = document.createRange();
    range.setStart(node, left);
    range.setEnd(node, left);
    const rects = range.getClientRects();
    const q = rects[side === 'start' ? rects.length - 1 : 0] ?? range.getBoundingClientRect();
    return { x: q.left + (side === 'start' ? 1 : -1), y: q.top + q.height / 2 };
  }, selector, n, offset, side);
  const o = await frameOffset(frame);
  return { x: r.x + o.x, y: r.y + o.y };
}

// --- Cursor and mouse ------------------------------------------------------------------------

/** CDP draws no mouse pointer: a small arrow drawn above everything in the workbench page. */
async function installCursor(page) {
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'demo-cursor';
    // The workbench enforces Trusted Types: build the SVG node by node, no innerHTML.
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ width: 18, height: 26, viewBox: '0 0 18 26' })) svg.setAttribute(k, String(v));
    const arrow = document.createElementNS(NS, 'path');
    for (const [k, v] of Object.entries({ d: 'M1.5 1.5v19.2l4.6-4.4 3.1 7.3 3.2-1.4-3.1-7.1h6.4z', fill: '#fff', stroke: '#111', 'stroke-width': 1.3, 'stroke-linejoin': 'round' })) arrow.setAttribute(k, String(v));
    svg.append(arrow);
    el.append(svg);
    Object.assign(el.style, {
      position: 'fixed', left: '0', top: '0', width: '18px', height: '26px', zIndex: '2147483647',
      pointerEvents: 'none', transformOrigin: '2px 2px', transition: 'scale 60ms ease-out',
      filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.35))',
    });
    document.body.append(el);
    window.__cursor = (x, y) => { el.style.transform = `translate(${x - 1.5}px, ${y - 1.5}px)`; };
    window.__press = (on) => { el.style.scale = on ? '0.9' : '1'; };
  });
}

function mouse(page) {
  let x = 0;
  let y = 0;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const to = async (nx, ny) => {
    x = nx;
    y = ny;
    await Promise.all([page.mouse.move(x, y), page.evaluate((x, y) => window.__cursor(x, y), x, y)]);
  };
  const glide = async (tx, ty, ms) => {
    const fx = x;
    const fy = y;
    const t0 = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - t0) / ms);
      await to(fx + (tx - fx) * ease(t), fy + (ty - fy) * ease(t));
      if (t >= 1) break;
      await sleep(12);
    }
  };
  return {
    get x() { return x; },
    get y() { return y; },
    jump: (nx, ny) => to(nx, ny),
    move: glide,
    async click() {
      await page.evaluate(() => window.__press(true));
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      await sleep(30);
      await page.evaluate(() => window.__press(false));
    },
    async drag(tx, ty, ms) {
      await page.evaluate(() => window.__press(true));
      await page.mouse.down();
      await sleep(80);
      await glide(tx, ty, ms);
      await sleep(80);
      await page.mouse.up();
      await page.evaluate(() => window.__press(false));
    },
  };
}

// --- Capture ---------------------------------------------------------------------------------

/** Screencast frames (PNG) with their timestamps; the compositor sends one per visual change. */
async function startCapture(page) {
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ t: f.metadata.timestamp * 1000, at: Date.now(), png: Buffer.from(f.data, 'base64') });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* stopped */ }
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  // A repaint so the first frame arrives right away.
  await page.evaluate(() => window.__cursor(...(document.getElementById('demo-cursor').style.transform.match(/-?[\d.]+/g).map((v) => Number(v) + 1.5))));
  return {
    async stop() {
      const stopped = Date.now();
      await cdp.send('Page.stopScreencast');
      if (!frames.length) throw new Error('No frames captured');
      const last = frames[frames.length - 1];
      // The end of the recording, on the frames' clock (the screen may not have changed lately).
      frames.push({ t: last.t + (stopped - last.at), png: last.png });
      return frames;
    },
  };
}
