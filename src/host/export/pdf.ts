import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Command-line arguments that make a Chromium browser print `htmlFile` to `outFile` and exit. */
export function pdfArgs(htmlFile: string, outFile: string, profileDir: string): string[] {
  return [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // A private profile so an already-running browser doesn't take over the request.
    `--user-data-dir=${profileDir}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    `--print-to-pdf=${outFile}`,
    pathToFileURL(htmlFile).href,
  ];
}

export async function printToPdf(browser: string, htmlFile: string, outFile: string, timeoutMs = 60_000): Promise<void> {
  const profile = mkdtempSync(path.join(tmpdir(), 'margin-pdf-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(browser, pdfArgs(htmlFile, outFile, profile), { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`The browser did not finish printing within ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Could not start ${browser}: ${err.message}`));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    let size = 0;
    try {
      size = statSync(outFile).size;
    } catch {
      size = 0;
    }
    if (size === 0) throw new Error(`${path.basename(browser)} exited without writing ${path.basename(outFile)}.`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
