import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

const host = {
  ...common,
  entryPoints: ['src/host/extension.ts'],
  outfile: 'dist/extension.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

const webview = {
  ...common,
  entryPoints: { webview: 'src/webview/main.ts' },
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  loader: { '.css': 'css' },
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(host), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(host), esbuild.build(webview)]);
}
