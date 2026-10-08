// Renders media/icon.png (256×256) with a locally installed Chromium browser.
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [
  process.env.MARGIN_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chromium browser found; set MARGIN_BROWSER.');

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:256px;height:256px;border-radius:56px;background:linear-gradient(150deg,#4a66e8,#2c44b8);
display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
  <div style="position:absolute;left:44px;top:58px;bottom:58px;width:10px;border-radius:5px;background:rgba(255,255,255,.35)"></div>
  <div style="font:700 120px/1 'Segoe UI',system-ui,sans-serif;color:#fff;letter-spacing:-6px;margin-left:22px">M<span style="font-size:96px;opacity:.9">↓</span></div>
</div></body></html>`;

mkdirSync('media', { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: 'media/icon.png', omitBackground: true });
await browser.close();
console.log('wrote media/icon.png');
