import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
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

/**
 * Where the export's working folder (the HTML to print and the browser profile) goes. On Linux
 * it's next to the output, because a Snap- or Flatpak-packaged Chromium can't read /tmp; it is
 * a hidden folder unless that would put it at the top of $HOME, which Snap can't read either.
 * Elsewhere the system temp folder is fine and leaves nothing next to the user's files.
 */
export function pdfWorkParent(platform: NodeJS.Platform, outDir: string, home: string, tmp: string): { dir: string; prefix: string } {
  if (platform !== 'linux') return { dir: tmp, prefix: 'margin-pdf-' };
  const atHome = path.resolve(outDir) === path.resolve(home);
  return { dir: outDir, prefix: atHome ? 'margin-pdf-' : '.margin-pdf-' };
}

/** Creates the working folder described by pdfWorkParent(). */
export function makePdfWorkDir(where: { dir: string; prefix: string }): string {
  return mkdtempSync(path.join(where.dir, where.prefix));
}

/** Removes a working folder; never fails the export (a browser helper may still hold a file briefly). */
export function removeWorkDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // left behind; harmless
  }
}

/**
 * Deletes the previous export before printing, so a browser that fails silently can't leave the
 * old file looking like a fresh one. A locked file (open in a PDF viewer) gets a clear message.
 */
export function removeStalePdf(outFile: string, rm: (file: string) => void = (f) => rmSync(f, { force: true })): void {
  try {
    rm(outFile);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(`${path.basename(outFile)} is open in another program. Close the PDF and try again.`);
    }
    throw err;
  }
}

/** Prints `htmlFile` to `outFile`. The browser profile goes in `workDir` (default: the HTML file's folder). */
export async function printToPdf(browser: string, htmlFile: string, outFile: string, timeoutMs = 60_000, workDir = path.dirname(htmlFile)): Promise<void> {
  removeStalePdf(outFile);
  const profile = mkdtempSync(path.join(workDir, 'profile-'));
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
    removeWorkDir(profile);
  }
}
