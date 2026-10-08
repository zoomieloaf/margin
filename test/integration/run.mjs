// Runs the integration suite inside a real VS Code (the installed one when found, otherwise a
// downloaded build). Usage: npm run test:integration
import * as esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';

const root = path.resolve('.');
await esbuild.build({
  entryPoints: ['test/integration/suite.ts'],
  outfile: 'out/integration/suite.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  logLevel: 'warning',
});

const workspace = mkdtempSync(path.join(tmpdir(), 'margin-it-'));
mkdirSync(path.join(workspace, 'docs'), { recursive: true });
copyFileSync('test/fixtures/roundtrip/01-basic.md', path.join(workspace, 'docs', 'sample.md'));
copyFileSync('test/fixtures/roundtrip/08-callouts-highlight.md', path.join(workspace, 'docs', 'callouts.md'));

const installed = [
  process.env.MARGIN_VSCODE,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '/usr/share/code/code',
].find((p) => p && existsSync(p));

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'out', 'integration', 'suite.cjs'),
    vscodeExecutablePath: installed,
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
    // MARGIN_TEST registers the margin._test.* commands (synthetic webview messages).
    extensionTestsEnv: { MARGIN_IT_WORKSPACE: workspace, MARGIN_TEST: '1' },
  });
} catch {
  console.error('Integration tests failed');
  process.exit(1);
}
