// Integration suite, executed inside VS Code by test/integration/run.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { HostToWebview } from '../../src/bridge/messages';
import { findBrowser } from '../../src/host/export/browser';
import { DocumentSync } from '../../src/host/sync';

const workspace = process.env.MARGIN_IT_WORKSPACE!;
const file = (name: string) => vscode.Uri.file(path.join(workspace, 'docs', name));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

const activeTabInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;

const tests: Array<[string, () => Promise<void>]> = [
  ['the extension activates and registers its commands', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'margin');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const c of ['margin.openInMargin', 'margin.reopenAsText', 'margin.toggleMode', 'margin.exportPdf', 'margin.exportHtml', 'margin.copyMarkdown']) {
      assert.ok(commands.includes(c), `missing command ${c}`);
    }
  }],

  ['a Markdown file opens in the Margin editor', async () => {
    await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor');
    await until(() => activeTabInput() instanceof vscode.TabInputCustom, 'custom editor tab');
    assert.equal((activeTabInput() as vscode.TabInputCustom).viewType, 'margin.editor');
  }],

  ['Reopen in Text Editor switches to the text editor', async () => {
    await vscode.commands.executeCommand('margin.reopenAsText');
    await until(() => activeTabInput() instanceof vscode.TabInputText, 'text editor tab');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['DocumentSync applies an edit and acks the new version', async () => {
    const doc = await vscode.workspace.openTextDocument(file('callouts.md'));
    const posted: HostToWebview[] = [];
    const sync = new DocumentSync(doc, (m) => posted.push(m));
    const before = doc.getText();
    const v = doc.version;
    await sync.applyEdit(v, [{ start: 0, end: 0, text: 'Hello\n\n' }]);
    assert.equal(doc.getText(), `Hello\n\n${before}`);
    assert.deepEqual(posted, [{ type: 'ack', version: v + 1 }]);
    sync.dispose();
  }],

  ['DocumentSync refuses a stale edit with a reset', async () => {
    const doc = await vscode.workspace.openTextDocument(file('callouts.md'));
    const posted: HostToWebview[] = [];
    const sync = new DocumentSync(doc, (m) => posted.push(m));
    const text = doc.getText();
    await sync.applyEdit(doc.version - 1, [{ start: 0, end: 0, text: 'stale' }]);
    assert.equal(doc.getText(), text);
    assert.equal(posted[0]?.type, 'reset');
    sync.dispose();
  }],

  ['an external change resets the webview', async () => {
    const doc = await vscode.workspace.openTextDocument(file('callouts.md'));
    const posted: HostToWebview[] = [];
    const sync = new DocumentSync(doc, (m) => posted.push(m));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(0, 0), 'External ');
    await vscode.workspace.applyEdit(edit);
    await until(() => posted.length > 0, 'reset message');
    assert.equal(posted[0]?.type, 'reset');
    assert.equal((posted[0] as { text: string }).text, doc.getText());
    sync.dispose();
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],

  ['Export to HTML writes a styled file next to the Markdown', async () => {
    const doc = await vscode.workspace.openTextDocument(file('sample.md'));
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('margin.exportHtml');
    const out = path.join(workspace, 'docs', 'sample.html');
    await until(() => existsSync(out), 'sample.html');
    const html = readFileSync(out, 'utf8');
    assert.match(html, /<h1>Project title<\/h1>/);
    assert.match(html, /<base href="file:/);
  }],

  ['Export to PDF prints with the installed browser', async () => {
    const browser = findBrowser({ platform: process.platform, env: process.env, exists: existsSync });
    if (!browser) {
      console.log('    (skipped: no Chromium browser installed)');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(file('sample.md'));
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('margin.exportPdf');
    const out = path.join(workspace, 'docs', 'sample.pdf');
    await until(() => existsSync(out) && statSync(out).size > 1000, 'sample.pdf', 60_000);
    assert.equal(readFileSync(out).subarray(0, 5).toString(), '%PDF-');
  }],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
    }
  }
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
