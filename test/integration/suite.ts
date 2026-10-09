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

/** The active tab is the Margin editor for `docs/<name>`. */
const isMarginTab = (name: string) => {
  const input = activeTabInput();
  return input instanceof vscode.TabInputCustom && input.viewType === 'margin.editor' && input.uri.fsPath === file(name).fsPath;
};

/** The active group's tabs, in order: [path under docs/ or the tab label, is a preview tab]. */
const groupTabs = (): Array<[string, boolean]> =>
  vscode.window.tabGroups.activeTabGroup.tabs.map((t) => {
    const input = t.input as { uri?: vscode.Uri } | undefined;
    const name = input?.uri ? path.relative(path.join(workspace, 'docs'), input.uri.fsPath).replace(/\\/g, '/') : t.label;
    return [name, t.isPreview];
  });

/** Sets margin.links.openIn for this workspace (undefined: back to the default). */
const setLinksOpenIn = (value: string | undefined) =>
  vscode.workspace.getConfiguration('margin').update('links.openIn', value, vscode.ConfigurationTarget.Workspace);

const aiCalls = () => vscode.commands.executeCommand<{ clipboard: string[]; opened: string[]; asked: string[] }>('margin._test.aiCalls');

const warnings = () => vscode.commands.executeCommand<Array<{ message: string; items: string[] }>>('margin._test.warnings');

/** The first message the host posted to the Margin editor for `uri` that matches. */
async function waitForPosted(uri: vscode.Uri, match: (m: HostToWebview) => boolean): Promise<HostToWebview> {
  let found: HostToWebview | undefined;
  const end = Date.now() + 10_000;
  while (!found) {
    if (Date.now() > end) throw new Error('Timed out waiting for a host message');
    try {
      found = (await vscode.commands.executeCommand<HostToWebview[]>('margin._test.posted', uri)).find(match);
    } catch {
      // The editor isn't open yet.
    }
    if (!found) await sleep(50);
  }
  return found;
}

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

  ['while the webview has focus, Margin owns Ctrl+Z, Ctrl+B, Ctrl+E, Ctrl+K... (no double undo, no sidebar toggle)', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'margin')!;
    const bindings = ext.packageJSON.contributes.keybindings as Array<{ command: string; key: string; mac?: string; when?: string }>;
    const when = "activeCustomEditorId == 'margin.editor' && margin.webviewFocused";
    // Formatting keys only while editing: in Preview and Markdown mode Margin doesn't use them,
    // so Ctrl+B still toggles the sidebar and Ctrl+` the terminal there.
    const editing = `${when} && margin.editing`;
    const expected: Array<[string, string, string]> = [
      ['ctrl+z', 'margin.undo', when], ['ctrl+y', 'margin.redo', when], ['ctrl+shift+z', 'margin.redo', when], ['ctrl+e', 'margin.webviewKey', when],
      ['ctrl+b', 'margin.webviewKey', editing], ['ctrl+i', 'margin.webviewKey', editing], ['ctrl+k', 'margin.webviewKey', editing],
      ['ctrl+shift+x', 'margin.webviewKey', editing], ['ctrl+shift+h', 'margin.webviewKey', editing], ['ctrl+`', 'margin.webviewKey', editing],
    ];
    for (const [key, command, condition] of expected) {
      const b = bindings.find((k) => k.key === key);
      assert.ok(b, `no keybinding for ${key}`);
      assert.equal(b.command, command, key);
      assert.equal(b.when, condition, key);
      assert.equal(b.mac, key.replace('ctrl+', 'cmd+'), key);
    }
    // Go Back belongs to Margin too: Back first undoes an in-page #jump, then asks VS Code to go back.
    const back = bindings.find((k) => k.key === 'alt+left') as { command: string; mac?: string; linux?: string; when?: string } | undefined;
    assert.deepEqual(back && [back.command, back.mac, back.linux, back.when], ['margin.webviewKey', 'ctrl+-', 'ctrl+alt+-', when]);
    const commands = await vscode.commands.getCommands(true);
    for (const c of ['margin.undo', 'margin.redo', 'margin.webviewKey']) assert.ok(commands.includes(c), `missing command ${c}`);
    // The key commands must not change the document themselves (the webview does the work).
    const doc = await vscode.workspace.openTextDocument(file('callouts.md'));
    const v = doc.version;
    await vscode.commands.executeCommand('margin.undo');
    await vscode.commands.executeCommand('margin.webviewKey');
    assert.equal(doc.version, v);
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

  ['spec: open in Margin, edit, save, undo through VS Code (one step)', async () => {
    const uri = file('sample.md');
    const original = readFileSync(uri.fsPath, 'utf8');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => activeTabInput() instanceof vscode.TabInputCustom, 'Margin tab');
    const doc = await vscode.workspace.openTextDocument(uri);
    const end = doc.getText().length;
    await vscode.commands.executeCommand('margin._test.postEdit', uri, [{ start: end, end, text: '\nFirst edit.\n' }]);
    await vscode.commands.executeCommand('margin._test.postEdit', uri, [{ start: end, end, text: '\nSecond edit.\n' }]);
    const both = `${original}\nSecond edit.\n\nFirst edit.\n`;
    assert.equal(doc.getText(), both);
    assert.ok(doc.isDirty, 'document should be dirty after the edits');

    await vscode.commands.executeCommand('workbench.action.files.save');
    await until(() => !doc.isDirty, 'save');
    assert.equal(readFileSync(uri.fsPath, 'utf8'), both);

    await vscode.commands.executeCommand('undo');
    await until(() => doc.getText() !== both, 'undo');
    await sleep(300); // and nothing more happens
    assert.equal(doc.getText(), `${original}\nFirst edit.\n`, 'undo should revert exactly the last edit');

    // Restore the fixture copy for the tests below.
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
    await vscode.workspace.applyEdit(restore);
    await doc.save();
    assert.equal(readFileSync(uri.fsPath, 'utf8'), original);
  }],

  ['webview messages are handled in order: an edit queued before an undo or an export is applied first', async () => {
    const uri = file('sample.md');
    const doc = await vscode.workspace.openTextDocument(uri);
    const before = doc.getText();
    const end = before.length;
    // Not awaited one by one: both are queued at once, as two quick webview messages would be.
    await Promise.all([
      vscode.commands.executeCommand('margin._test.postEdit', uri, [{ start: end, end, text: '\nQueued.\n' }]),
      vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'undo' }),
    ]);
    await sleep(300);
    assert.equal(doc.getText(), before, 'the undo must undo the queued edit, nothing else');

    // An export queued right behind an edit must see the edited text.
    const html = path.join(workspace, 'docs', 'sample.html');
    await Promise.all([
      vscode.commands.executeCommand('margin._test.postEdit', uri, [{ start: end, end, text: '\nExported right after typing.\n' }]),
      vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'exportHtml' }),
    ]);
    assert.match(readFileSync(html, 'utf8'), /Exported right after typing\./);
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), before);
    await vscode.workspace.applyEdit(restore);
    await doc.save();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['a /rooted link opens the page under the workspace folder, in Margin', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => activeTabInput() instanceof vscode.TabInputCustom, 'Margin tab');
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'openLink', href: '/docs/callouts.md#top' });
    await until(() => isMarginTab('callouts.md'), 'callouts.md opened in Margin from /docs/callouts.md');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['a ./page.md#section link opens the page in Margin, in Preview, scrolled to that heading', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', uri, './other.md#section');
    await until(() => isMarginTab('other.md'), 'other.md opened in Margin');
    const init = await waitForPosted(file('other.md'), (m) => m.type === 'init');
    assert.equal(init.type === 'init' && init.anchor, 'section');
    assert.equal(init.type === 'init' && init.mode, 'preview');
  }],

  ['a link to a page already open in Margin reveals it and scrolls there', async () => {
    await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md active again');
    await vscode.commands.executeCommand('margin._test.openLink', file('sample.md'), 'other.md#section-two');
    await until(() => isMarginTab('other.md'), 'other.md revealed');
    const scroll = await waitForPosted(file('other.md'), (m) => m.type === 'scrollTo');
    assert.deepEqual(scroll, { type: 'scrollTo', anchor: 'section-two' });
    assert.equal(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom && t.input.uri.fsPath === file('other.md').fsPath).length, 1, 'no second tab');
  }],

  ['Go Back (Alt+Left) returns to the previous Margin page', async () => {
    // other.md was opened from sample.md by the test above.
    await vscode.commands.executeCommand('workbench.action.navigateBack');
    await until(() => isMarginTab('sample.md'), 'back on sample.md', 5000);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['a link to a folder opens its README in Margin; a folder without one is revealed in the Explorer', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', uri, './guides/');
    await until(() => isMarginTab('guides/README.md'), 'guides/README.md opened in Margin');
    await vscode.commands.executeCommand('margin._test.answerWarnings', undefined);
    await vscode.commands.executeCommand('margin._test.openLink', uri, 'empty');
    assert.ok(isMarginTab('guides/README.md'), 'an empty folder opens no editor');
    assert.deepEqual(await warnings(), [], 'an existing folder is not reported missing');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['other files open in VS Code; a #L2 fragment selects that line', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', uri, '.\\notes.txt#L2');
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file('notes.txt').fsPath, 'notes.txt opened');
    assert.equal(vscode.window.activeTextEditor!.selection.active.line, 1);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['a link to a missing page warns and offers to create it; Create page writes a titled page and opens it', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.answerWarnings', 'Create page');
    const created = path.join(workspace, 'docs', 'new', 'setup-guide.md');
    assert.equal(existsSync(created), false);
    await vscode.commands.executeCommand('margin._test.openLink', uri, './new/setup-guide.md');
    assert.deepEqual((await warnings()).at(-1), { message: "`./new/setup-guide.md` doesn't exist", items: ['Create page'] });
    assert.equal(readFileSync(created, 'utf8'), '# Setup guide\n');
    await until(() => isMarginTab('new/setup-guide.md'), 'the new page opened in Margin');

    // Not a Markdown file: only the message, nothing created.
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await vscode.commands.executeCommand('margin._test.openLink', uri, 'missing.png');
    assert.deepEqual((await warnings()).at(-1), { message: "`missing.png` doesn't exist", items: [] });
    assert.equal(existsSync(path.join(workspace, 'docs', 'missing.png')), false);
    await vscode.commands.executeCommand('margin._test.answerWarnings', undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['checkLinks reports the missing targets and their paths, without touching the document', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    const doc = await vscode.workspace.openTextDocument(uri);
    const version = doc.version;
    const text = doc.getText();
    const hrefs = ['./other.md#section', 'nope.md', '../docs/guides', '/docs/gone/', 'https://x.y', '#top'];
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'checkLinks', hrefs });
    const status = await waitForPosted(uri, (m) => m.type === 'linkStatus');
    assert.ok(status.type === 'linkStatus');
    assert.deepEqual([...status.missing].sort(), ['/docs/gone/', 'nope.md']);
    assert.deepEqual(new Map(status.paths).get('nope.md'), 'docs/nope.md');
    assert.equal(status.paths.length, 4, 'only local links are checked');
    assert.equal(doc.version, version);
    assert.equal(doc.getText(), text);
    assert.equal(doc.isDirty, false);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['margin.links.openIn is contributed: sameTab (default) or newTab, and the editor learns it (init, then linksOpenIn)', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'margin')!;
    const prop = ext.packageJSON.contributes.configuration.properties['margin.links.openIn'] as { enum: string[]; default: string; enumDescriptions: string[] };
    assert.deepEqual(prop.enum, ['sameTab', 'newTab']);
    assert.equal(prop.enumDescriptions.length, 2);
    assert.equal(prop.default, 'sameTab');
    assert.equal(vscode.workspace.getConfiguration('margin').get('links.openIn'), 'sameTab');
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ready' });
    const init = await waitForPosted(uri, (m) => m.type === 'init');
    assert.equal(init.type === 'init' && init.settings.linksOpenIn, 'sameTab');
    await setLinksOpenIn('newTab');
    assert.deepEqual(await waitForPosted(uri, (m) => m.type === 'linksOpenIn'), { type: 'linksOpenIn', value: 'newTab' });
    await setLinksOpenIn(undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['sameTab: clicking through A → B → C keeps A and one preview tab (C); Ctrl+click opens a tab of its own', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor', { preview: false });
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', file('sample.md'), './other.md');
    await until(() => isMarginTab('other.md'), 'other.md opened');
    assert.deepEqual(groupTabs(), [['sample.md', false], ['other.md', true]]);
    await vscode.commands.executeCommand('margin._test.openLink', file('other.md'), './callouts.md');
    await until(() => isMarginTab('callouts.md'), 'callouts.md opened');
    await until(() => groupTabs().length === 2, 'other.md replaced');
    assert.deepEqual(groupTabs(), [['sample.md', false], ['callouts.md', true]]);
    // Ctrl/Cmd+click (newTab: true) does the opposite of the setting: a pinned tab.
    await vscode.commands.executeCommand('margin._test.openLink', file('callouts.md'), './other.md', true);
    await until(() => isMarginTab('other.md'), 'other.md opened in its own tab');
    assert.deepEqual(groupTabs(), [['sample.md', false], ['callouts.md', true], ['other.md', false]]);
    // Other files follow the same rule.
    await vscode.commands.executeCommand('margin._test.openLink', file('other.md'), './notes.txt');
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file('notes.txt').fsPath, 'notes.txt opened');
    assert.deepEqual(groupTabs(), [['sample.md', false], ['other.md', false], ['notes.txt', true]]);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['newTab: clicking through A → B → C keeps every page in its own tab; Ctrl+click uses the preview tab', async () => {
    await setLinksOpenIn('newTab');
    try {
      await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor', { preview: false });
      await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
      await vscode.commands.executeCommand('margin._test.openLink', file('sample.md'), './other.md');
      await until(() => isMarginTab('other.md'), 'other.md opened');
      await vscode.commands.executeCommand('margin._test.openLink', file('other.md'), './callouts.md');
      await until(() => isMarginTab('callouts.md'), 'callouts.md opened');
      assert.deepEqual(groupTabs(), [['sample.md', false], ['other.md', false], ['callouts.md', false]]);
      await vscode.commands.executeCommand('margin._test.openLink', file('callouts.md'), './guides/', false);
      await until(() => isMarginTab('guides/README.md'), 'guides/README.md opened');
      assert.deepEqual(groupTabs().at(-1), ['guides/README.md', true]);
    } finally {
      await setLinksOpenIn(undefined);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  }],

  ['editing a page in the preview tab pins it', async () => {
    await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor', { preview: false });
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', file('sample.md'), './other.md');
    await until(() => isMarginTab('other.md'), 'other.md opened');
    assert.deepEqual(groupTabs(), [['sample.md', false], ['other.md', true]]);
    const doc = await vscode.workspace.openTextDocument(file('other.md'));
    const original = doc.getText();
    await vscode.commands.executeCommand('margin._test.postEdit', file('other.md'), [{ start: 0, end: 0, text: 'Edited. ' }]);
    await until(() => doc.isDirty, 'other.md dirty');
    await until(() => groupTabs()[1]?.[1] === false, 'the edited tab pinned');
    const restore = new vscode.WorkspaceEdit();
    restore.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
    await vscode.workspace.applyEdit(restore);
    await doc.save();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['the toolbar Back and Forward run Go Back and Go Forward', async () => {
    await vscode.commands.executeCommand('vscode.openWith', file('sample.md'), 'margin.editor', { preview: false });
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    await vscode.commands.executeCommand('margin._test.openLink', file('sample.md'), './other.md', true);
    await until(() => isMarginTab('other.md'), 'other.md opened');
    await vscode.commands.executeCommand('margin._test.postMessage', file('other.md'), { type: 'navigate', direction: 'back' });
    await until(() => isMarginTab('sample.md'), 'back on sample.md', 5000);
    await vscode.commands.executeCommand('margin._test.postMessage', file('sample.md'), { type: 'navigate', direction: 'forward' });
    await until(() => isMarginTab('other.md'), 'forward to other.md', 5000);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['the editor learns the margin.ai setting and whether a model exists (init, then aiAvailable)', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('sample.md'), 'sample.md in Margin');
    const init = await waitForPosted(uri, (m) => m.type === 'init');
    assert.ok(init.type === 'init');
    assert.equal(init.settings.ai, 'auto');
    assert.equal(typeof init.settings.aiEditor, 'boolean');
    const available = await waitForPosted(uri, (m) => m.type === 'aiAvailable');
    // Copilot may or may not be installed here: only the shape is checked.
    assert.ok(available.type === 'aiAvailable' && typeof available.editor === 'boolean');
    const models = await vscode.lm.selectChatModels();
    console.log(`    (this window has ${models.length} chat model(s))`);
  }],

  ['AI without a model (tier 2): asks once, copies the prompt, opens chatgpt.com, leaves the file alone', async () => {
    const uri = file('sample.md');
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const version = doc.version;
    await vscode.commands.executeCommand('margin._test.resetAiConsent');
    await vscode.commands.executeCommand('margin._test.stubAi', { consent: true });
    const selection = 'Some **bold** text.';
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-1', action: 'improve', markdown: selection });
    await waitForPosted(uri, (m) => m.type === 'aiFallback' && m.id === 'it-1');
    let calls = await aiCalls();
    assert.deepEqual(calls.asked, ['chatgpt.com']);
    assert.equal(calls.clipboard.length, 1);
    const prompt = calls.clipboard[0]!;
    assert.match(prompt, /Improve the writing/);
    assert.match(prompt, /Return only the rewritten Markdown/);
    assert.ok(prompt.includes(`\`\`\`markdown\n${selection}\n\`\`\``), 'the selection is in a fenced block');
    assert.equal(calls.opened.length, 1);
    const url = new URL(calls.opened[0]!);
    assert.equal(url.origin + url.pathname, 'https://chatgpt.com/');
    assert.equal(url.searchParams.get('q'), prompt);
    const toast = await waitForPosted(uri, (m) => m.type === 'toast' && m.text.startsWith('Prompt copied'));
    assert.match(toast.type === 'toast' ? toast.text : '', /paste the answer back with (Ctrl|Cmd)\+V/);

    // Agreed once: the second action to chatgpt.com isn't asked about.
    await vscode.commands.executeCommand('margin._test.stubAi', { consent: true });
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-2', action: 'continue', markdown: '', context: '# Plan' });
    await waitForPosted(uri, (m) => m.type === 'aiFallback' && m.id === 'it-2');
    calls = await aiCalls();
    assert.deepEqual(calls.asked, []);
    assert.match(calls.opened[0]!, /^https:\/\/chatgpt\.com\/\?q=/);

    // The editor's chat view is another place (asked about once); when it fails, chatgpt.com opens.
    await vscode.commands.executeCommand('margin._test.stubAi', { consent: true, chatView: true });
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-2b', action: 'continue', markdown: '', context: '# Plan' });
    await waitForPosted(uri, (m) => m.type === 'aiFallback' && m.id === 'it-2b');
    calls = await aiCalls();
    assert.equal(calls.asked.length, 1);
    assert.match(calls.asked[0]!, /'s chat \(or chatgpt\.com\)$/);
    assert.match(calls.opened[0]!, /^https:\/\/chatgpt\.com\/\?q=/);

    assert.equal(doc.getText(), text);
    assert.equal(doc.version, version);
  }],

  ['AI with margin.ai = claude opens claude.ai; a long prompt opens the bare site', async () => {
    const uri = file('sample.md');
    const config = vscode.workspace.getConfiguration('margin');
    await config.update('ai', 'claude', vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('margin._test.stubAi', { consent: true });
      await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-3', action: 'translate', lang: 'German', markdown: 'Hello' });
      await waitForPosted(uri, (m) => m.type === 'aiFallback' && m.id === 'it-3');
      let calls = await aiCalls();
      assert.deepEqual(calls.asked, ['claude.ai']);
      assert.match(calls.opened[0]!, /^https:\/\/claude\.ai\/new\?q=.*German/);

      await vscode.commands.executeCommand('margin._test.stubAi', { consent: true });
      await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-4', action: 'summarize', markdown: 'word '.repeat(1000) });
      await waitForPosted(uri, (m) => m.type === 'aiFallback' && m.id === 'it-4');
      calls = await aiCalls();
      assert.deepEqual(calls.opened, ['https://claude.ai/new']);
      assert.ok(calls.clipboard[0]!.includes('word word'), 'the whole prompt is on the clipboard');
      // The webview hears about the change of setting.
      await waitForPosted(uri, (m) => m.type === 'aiAvailable' && m.setting === 'claude');
    } finally {
      await config.update('ai', undefined, vscode.ConfigurationTarget.Global);
    }
  }],

  ['AI: Cancel on the first-use notice sends nothing; margin.ai = off runs nothing', async () => {
    const uri = file('sample.md');
    await vscode.commands.executeCommand('margin._test.resetAiConsent');
    await vscode.commands.executeCommand('margin._test.stubAi', { consent: false });
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-5', action: 'shorten', markdown: 'Private text' });
    const err = await waitForPosted(uri, (m) => m.type === 'aiError' && m.id === 'it-5');
    assert.equal(err.type === 'aiError' && err.message, 'Nothing was sent.');
    let calls = await aiCalls();
    assert.deepEqual(calls.asked, ['chatgpt.com']);
    assert.deepEqual([calls.clipboard, calls.opened], [[], []]);

    const config = vscode.workspace.getConfiguration('margin');
    await config.update('ai', 'off', vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('margin._test.stubAi', { consent: true });
      await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'ai', id: 'it-6', action: 'shorten', markdown: 'Private text' });
      await waitForPosted(uri, (m) => m.type === 'aiError' && m.id === 'it-6');
      calls = await aiCalls();
      assert.deepEqual([calls.asked, calls.clipboard, calls.opened], [[], [], []]);
    } finally {
      await config.update('ai', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('margin._test.resetAiConsent');
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }],

  ['margin.pageWidth is contributed: narrow, normal, wide, full; normal by default', async () => {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'margin')!;
    const prop = ext.packageJSON.contributes.configuration.properties['margin.pageWidth'] as { enum: string[]; default: string; enumDescriptions: string[] };
    assert.deepEqual(prop.enum, ['narrow', 'normal', 'wide', 'full']);
    assert.equal(prop.enumDescriptions.length, 4);
    assert.equal(prop.default, 'normal');
    assert.equal(vscode.workspace.getConfiguration('margin').get('pageWidth'), 'normal');
    assert.ok((await vscode.commands.getCommands(true)).includes('margin.changePageWidth'));
  }],

  ['a page width chosen for a file survives closing and reopening it, and never touches the file', async () => {
    const uri = file('other.md');
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText();
    const version = doc.version;
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('other.md'), 'Margin tab');
    let init = await waitForPosted(uri, (m) => m.type === 'init');
    assert.equal(init.type === 'init' && init.settings.pageWidth, 'normal');

    // From the toolbar menu.
    await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'pageWidth', value: 'wide' });
    await waitForPosted(uri, (m) => m.type === 'setPageWidth' && m.width === 'wide' && m.override === 'wide');
    assert.deepEqual(await vscode.commands.executeCommand('margin._test.pageWidth', uri), { width: 'wide', setting: 'normal', override: 'wide' });
    assert.equal(doc.isDirty, false);
    assert.equal(doc.version, version);

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await until(() => vscode.window.tabGroups.all.every((g) => g.tabs.length === 0), 'editors closed');
    await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
    await until(() => isMarginTab('other.md'), 'Margin tab again');
    init = await waitForPosted(uri, (m) => m.type === 'init');
    assert.equal(init.type === 'init' && init.settings.pageWidth, 'wide');
    assert.deepEqual(init.type === 'init' && init.settings.pageWidthState, { width: 'wide', setting: 'normal', override: 'wide' });

    // The setting changes pages without a width of their own; this one keeps its own but learns the new default.
    const config = vscode.workspace.getConfiguration('margin');
    const sample = file('sample.md');
    await vscode.commands.executeCommand('vscode.openWith', sample, 'margin.editor', { viewColumn: vscode.ViewColumn.Beside });
    await waitForPosted(sample, (m) => m.type === 'init');
    await config.update('pageWidth', 'narrow', vscode.ConfigurationTarget.Global);
    try {
      await waitForPosted(sample, (m) => m.type === 'setPageWidth' && m.width === 'narrow' && m.override === null);
      await waitForPosted(uri, (m) => m.type === 'setPageWidth' && m.width === 'wide' && m.setting === 'narrow');

      // The command, with a width given (the quick pick does the same), on the active editor.
      await vscode.commands.executeCommand('vscode.openWith', uri, 'margin.editor');
      await until(() => isMarginTab('other.md'), 'other.md active');
      await vscode.commands.executeCommand('margin.changePageWidth', 'full');
      await waitForPosted(uri, (m) => m.type === 'setPageWidth' && m.width === 'full');
      // Use default.
      await vscode.commands.executeCommand('margin._test.postMessage', uri, { type: 'pageWidth', value: null });
      await waitForPosted(uri, (m) => m.type === 'setPageWidth' && m.width === 'narrow' && m.override === null);
      assert.deepEqual(await vscode.commands.executeCommand('margin._test.pageWidth', uri), { width: 'narrow', setting: 'narrow', override: null });
    } finally {
      await config.update('pageWidth', undefined, vscode.ConfigurationTarget.Global);
    }
    assert.equal(doc.getText(), text);
    assert.equal(doc.isDirty, false);
    assert.equal(doc.version, version);
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

  ['DocumentSync answers a burst of stale edits with one reset, and echoes seq in the ack', async () => {
    const doc = await vscode.workspace.openTextDocument(file('callouts.md'));
    const posted: HostToWebview[] = [];
    const sync = new DocumentSync(doc, (m) => posted.push(m));
    const v = doc.version;
    await sync.applyEdit(v - 1, [{ start: 0, end: 0, text: 'stale 1' }]);
    await sync.applyEdit(v - 1, [{ start: 0, end: 0, text: 'stale 2' }]);
    assert.deepEqual(posted.map((m) => m.type), ['reset']);
    await sync.applyEdit(v, [{ start: 0, end: 0, text: 'Seq\n\n' }], 4);
    assert.deepEqual(posted[1], { type: 'ack', version: v + 1, seq: 4 });
    sync.dispose();
    const undo = new vscode.WorkspaceEdit();
    undo.delete(doc.uri, new vscode.Range(0, 0, 2, 0));
    await vscode.workspace.applyEdit(undo);
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
