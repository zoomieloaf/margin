import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserCandidates, findBrowser, missingBrowserMessage } from '../../src/host/export/browser';
import { pdfArgs, pdfWorkParent, printToPdf, removeStalePdf } from '../../src/host/export/pdf';
import { renderHtml } from '../../src/host/export/render';

describe('findBrowser', () => {
  it('prefers Edge on Windows and honours env paths', () => {
    const env = { PROGRAMFILES: String.raw`D:\PF`, 'PROGRAMFILES(X86)': String.raw`D:\PF86`, LOCALAPPDATA: String.raw`D:\Local` };
    const list = browserCandidates('win32', env);
    expect(list[0]).toBe(String.raw`D:\PF86\Microsoft\Edge\Application\msedge.exe`);
    expect(list).toContain(String.raw`D:\Local\Google\Chrome\Application\chrome.exe`);
    const only = String.raw`D:\PF\Google\Chrome\Application\chrome.exe`;
    expect(findBrowser({ platform: 'win32', env, exists: (p) => p === only })).toBe(only);
  });

  it('finds Chrome on macOS in ~/Applications', () => {
    const p = '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(findBrowser({ platform: 'darwin', env: { HOME: '/Users/me' }, exists: (x) => x === p })).toBe(p);
  });

  it('finds chromium on Linux', () => {
    expect(findBrowser({ platform: 'linux', env: {}, exists: (x) => x === '/snap/bin/chromium' })).toBe('/snap/bin/chromium');
  });

  it('returns null when nothing is installed', () => {
    expect(findBrowser({ platform: 'linux', env: {}, exists: () => false })).toBeNull();
  });

  it('uses only the override when set', () => {
    expect(findBrowser({ platform: 'linux', env: {}, exists: () => true, override: '/opt/x/chrome' })).toBe('/opt/x/chrome');
    expect(findBrowser({ platform: 'linux', env: {}, exists: (x) => x !== '/opt/x/chrome', override: '/opt/x/chrome' })).toBeNull();
  });
});

describe('pdfArgs', () => {
  it('prints headless with a private profile and no header/footer', () => {
    const args = pdfArgs('/tmp/a b.html', '/out/doc.pdf', '/tmp/profile');
    expect(args).toContain('--headless');
    expect(args).toContain('--user-data-dir=/tmp/profile');
    expect(args).toContain('--print-to-pdf=/out/doc.pdf');
    expect(args).toContain('--no-pdf-header-footer');
    expect(args[args.length - 1]).toMatch(/^file:\/\/.*a%20b\.html$/);
  });
});

describe('renderHtml', () => {
  const html = renderHtml(
    '---\ntitle: x\n---\n\n# Title <x>\n\n> [!TIP]\n> Use ==this==.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\nSee[^1].\n\n[^1]: Note.\n',
    { title: 'My <doc>', theme: 'light', baseHref: 'file:///C:/docs/' },
  );

  it('is a full document with escaped title and base', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>My &lt;doc&gt;</title>');
    expect(html).toContain('<base href="file:///C:/docs/">');
  });

  it('renders callouts, highlights, tables, tasks and footnotes; hides frontmatter', () => {
    expect(html).toContain('class="callout" data-kind="tip"');
    expect(html).toContain('<p class="callout-title">Tip</p>');
    expect(html).toContain('<mark>this</mark>');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('footnotes');
    expect(html).not.toContain('title: x');
  });

  it('switches palettes with the theme', () => {
    expect(renderHtml('a', { title: 't', theme: 'dark' })).toContain('#1f2024');
    expect(html).toContain('#ffffff');
  });
});

describe('PDF export does not report an old file as success', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'margin-test-'));

  it('deletes the previous PDF before printing, so a browser that writes nothing is an error', async () => {
    const d = dir();
    const out = join(d, 'doc.pdf');
    const html = join(d, 'doc.html');
    writeFileSync(out, '%PDF- old export');
    writeFileSync(html, '<p>x</p>');
    // Node stands in for a browser that exits without printing.
    await expect(printToPdf(process.execPath, html, out, 20_000)).rejects.toThrow(/without writing doc\.pdf/);
    expect(existsSync(out)).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });

  it('says to close the PDF when the old file is locked', () => {
    const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    expect(() => removeStalePdf('/x/doc.pdf', () => { throw busy; })).toThrow(/doc\.pdf is open in another program\. Close the PDF and try again\./);
    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    expect(() => removeStalePdf('/x/doc.pdf', () => { throw missing; })).not.toThrow();
  });
});

describe('PDF working folder', () => {
  it('is under the output folder on Linux (Snap Chromium cannot read /tmp), hidden unless that is $HOME', () => {
    expect(pdfWorkParent('linux', '/home/u/docs', '/home/u', '/tmp')).toEqual({ dir: '/home/u/docs', prefix: '.margin-pdf-' });
    expect(pdfWorkParent('linux', '/home/u', '/home/u', '/tmp')).toEqual({ dir: '/home/u', prefix: 'margin-pdf-' });
  });

  it('stays in the temp folder on Windows and macOS', () => {
    expect(pdfWorkParent('win32', String.raw`C:\docs`, String.raw`C:\Users\me`, String.raw`C:\Temp`)).toEqual({ dir: String.raw`C:\Temp`, prefix: 'margin-pdf-' });
    expect(pdfWorkParent('darwin', '/Users/u/docs', '/Users/u', '/var/tmp')).toEqual({ dir: '/var/tmp', prefix: 'margin-pdf-' });
  });
});

describe('missing browser message', () => {
  it('names the setting when margin.export.browserPath points nowhere', () => {
    expect(missingBrowserMessage('/opt/chrome')).toBe("margin.export.browserPath points to a file that doesn't exist: /opt/chrome");
  });

  it('suggests the setting when nothing was found automatically', () => {
    expect(missingBrowserMessage(undefined)).toBe('No Chrome or Edge found. Set margin.export.browserPath or export HTML instead.');
  });
});
