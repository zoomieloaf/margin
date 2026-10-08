import * as vscode from 'vscode';
import type { Mode } from '../bridge/messages';
import { folderIndex, isMarkdownPath, joinLinkPath, lineFragment, linkTarget, pageTitle, type LinkTarget } from './links';

/** What following a link needs from the editor provider. */
export interface Pages {
  /** Opens `uri` in Margin, or reveals the Margin editor already showing it, and scrolls to `anchor`. */
  openPage(uri: vscode.Uri, opts: { mode: Mode; anchor?: string }): Promise<void>;
  /** A warning notification with buttons (the integration tests replace it). */
  warn(message: string, ...items: string[]): Thenable<string | undefined>;
}

export const CREATE_PAGE = 'Create page';

/** The file a local link points to: `./` and `../` from the document's folder, `/` from the workspace folder. */
export function linkUri(document: vscode.TextDocument, target: Extract<LinkTarget, { kind: 'file' }>): vscode.Uri {
  const docDir = vscode.Uri.joinPath(document.uri, '..');
  // `/docs/a.md` is relative to the workspace folder (like on GitHub, where it's the repository root).
  const base = target.rooted
    ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri ?? docDir
    : docDir;
  return base.with({ path: joinLinkPath(base.path, target.path), query: '', fragment: '' });
}

const statOf = (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => undefined);

/**
 * Follows a link clicked in Margin: Markdown pages open in Margin (scrolled to the `#heading`),
 * a folder opens its README or index page, other files open in VS Code, web links in the browser.
 */
export async function followLink(document: vscode.TextDocument, href: string, pages: Pages): Promise<void> {
  const target = linkTarget(href);
  if (target.kind === 'external') {
    await vscode.env.openExternal(vscode.Uri.parse(target.href));
    return;
  }
  if (target.kind !== 'file') return;
  let uri = linkUri(document, target);
  const stat = await statOf(uri);
  if (!stat) return missingLink(href, uri, pages);
  if (stat.type & vscode.FileType.Directory) {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const index = folderIndex(entries.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name));
    if (!index) {
      await vscode.commands.executeCommand('revealInExplorer', uri);
      return;
    }
    uri = vscode.Uri.joinPath(uri, index);
  }
  if (isMarkdownPath(uri.path)) {
    await pages.openPage(uri, { mode: 'preview', anchor: target.fragment });
    return;
  }
  // Other files ignore the fragment, except GitHub's `#L10` line links.
  const line = target.fragment ? lineFragment(target.fragment) : null;
  const options: vscode.TextDocumentShowOptions | undefined = line ? { selection: new vscode.Range(line - 1, 0, line - 1, 0) } : undefined;
  await vscode.commands.executeCommand('vscode.open', uri, options);
}

/** A link to a file that isn't there: says so, and offers to create a Markdown page. */
async function missingLink(href: string, uri: vscode.Uri, pages: Pages): Promise<void> {
  const markdown = isMarkdownPath(uri.path);
  const choice = await pages.warn(`\`${href}\` doesn't exist`, ...(markdown ? [CREATE_PAGE] : []));
  if (choice !== CREATE_PAGE) return;
  // Someone may have created it while the notification was up: never overwrite a file.
  if (!(await statOf(uri))) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`# ${pageTitle(uri.path)}\n`));
  }
  await pages.openPage(uri, { mode: 'edit' });
}

/** Which local links in the document point nowhere, and where each one points (for the hover title). */
export async function checkLinks(document: vscode.TextDocument, hrefs: readonly string[]): Promise<{ missing: string[]; paths: Array<[string, string]> }> {
  const missing: string[] = [];
  const paths: Array<[string, string]> = [];
  if (document.uri.scheme === 'untitled') return { missing, paths };
  await Promise.all(
    [...new Set(hrefs)].map(async (href) => {
      const target = linkTarget(href);
      if (target.kind !== 'file') return;
      const uri = linkUri(document, target);
      paths.push([href, vscode.workspace.asRelativePath(uri)]);
      if (!(await statOf(uri))) missing.push(href);
    }),
  );
  return { missing, paths };
}
