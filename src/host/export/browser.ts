import * as path from 'node:path';

export interface FindBrowserOptions {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exists: (file: string) => boolean;
  /** `margin.export.browserPath`; when set, only this path is considered. */
  override?: string;
}

/** Chromium-based browsers able to print to PDF headlessly, most likely first. */
export function browserCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === 'win32') {
    const pf = env.PROGRAMFILES ?? 'C:\\Program Files';
    const pf86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA;
    const list = [
      path.win32.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.win32.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    if (local) {
      list.push(path.win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      list.push(path.win32.join(local, 'Chromium', 'Application', 'chrome.exe'));
    }
    return list;
  }
  if (platform === 'darwin') {
    const apps = ['/Applications'];
    if (env.HOME) apps.push(path.posix.join(env.HOME, 'Applications'));
    const bundles = [
      ['Google Chrome.app', 'Google Chrome'],
      ['Microsoft Edge.app', 'Microsoft Edge'],
      ['Chromium.app', 'Chromium'],
      ['Brave Browser.app', 'Brave Browser'],
    ];
    return apps.flatMap((dir) => bundles.map(([app, bin]) => path.posix.join(dir, app!, 'Contents', 'MacOS', bin!)));
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/brave-browser',
  ];
}

export function findBrowser(o: FindBrowserOptions): string | null {
  if (o.override) return o.exists(o.override) ? o.override : null;
  return browserCandidates(o.platform, o.env).find((p) => o.exists(p)) ?? null;
}
