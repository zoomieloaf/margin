import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { findBrowser } from './browser';
import { printToPdf } from './pdf';
import { renderHtml, type ExportTheme } from './render';

function exportTheme(): ExportTheme {
  const setting = vscode.workspace.getConfiguration('margin').get<string>('export.theme', 'light');
  if (setting === 'dark' || setting === 'light') return setting;
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
}

/** Where exported files go: `margin.exportFolder` (workspace-relative) or next to the source. */
function outputDir(document: vscode.TextDocument): string {
  const folder = vscode.workspace.getConfiguration('margin').get<string>('exportFolder', '').trim();
  const source = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
  if (folder) {
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? source ?? process.cwd();
    return path.resolve(root, folder);
  }
  return source ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? tmpdir();
}

function baseName(document: vscode.TextDocument): string {
  const name = path.basename(document.uri.path).replace(/\.(md|markdown)$/i, '');
  return name || 'document';
}

function sourceDirHref(document: vscode.TextDocument): string | undefined {
  if (document.uri.scheme !== 'file') return undefined;
  const href = pathToFileURL(path.dirname(document.uri.fsPath)).href;
  return href.endsWith('/') ? href : `${href}/`;
}

async function announce(file: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(`Exported ${path.basename(file)}`, 'Open', 'Show in folder');
  if (choice === 'Open') await vscode.env.openExternal(vscode.Uri.file(file));
  if (choice === 'Show in folder') await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
}

export async function exportHtml(document: vscode.TextDocument): Promise<string> {
  const dir = outputDir(document);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${baseName(document)}.html`);
  const html = renderHtml(document.getText(), { title: baseName(document), theme: exportTheme(), baseHref: sourceDirHref(document) });
  writeFileSync(file, html, 'utf8');
  void announce(file);
  return file;
}

export async function exportPdf(document: vscode.TextDocument): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('margin');
  const browser = findBrowser({
    platform: process.platform,
    env: process.env,
    exists: (p) => existsSync(p),
    override: config.get<string>('export.browserPath', '').trim() || undefined,
  });
  if (!browser) {
    const choice = await vscode.window.showErrorMessage(
      'No Chrome or Edge found. Set margin.export.browserPath or export HTML instead.',
      'Open setting',
      'Export HTML',
    );
    if (choice === 'Open setting') await vscode.commands.executeCommand('workbench.action.openSettings', 'margin.export.browserPath');
    if (choice === 'Export HTML') await exportHtml(document);
    return undefined;
  }

  const dir = outputDir(document);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${baseName(document)}.pdf`);
  const work = mkdtempSync(path.join(tmpdir(), 'margin-export-'));
  try {
    const htmlFile = path.join(work, 'document.html');
    writeFileSync(htmlFile, renderHtml(document.getText(), { title: baseName(document), theme: exportTheme(), baseHref: sourceDirHref(document) }), 'utf8');
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Exporting ${path.basename(file)}…` },
      () => printToPdf(browser, htmlFile, file),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`PDF export failed: ${(err as Error).message}`);
    return undefined;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  void announce(file);
  return file;
}

export async function copyMarkdown(document: vscode.TextDocument): Promise<void> {
  await vscode.env.clipboard.writeText(document.getText());
  void vscode.window.setStatusBarMessage('$(check) Copied as Markdown', 2500);
}
