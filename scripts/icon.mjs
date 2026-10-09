// Renders media/icon.png (256×256) from media/icon.svg with a locally installed Chromium browser.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

// The source is media/icon.svg; the Marketplace needs a PNG (at least 128×128).
const svg = readFileSync('media/icon.svg', 'utf8');
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;

mkdirSync('media', { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: 'media/icon.png', omitBackground: true });
await browser.close();
console.log('wrote media/icon.png');
