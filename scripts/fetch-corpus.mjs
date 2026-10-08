import { writeFileSync } from 'node:fs';

const repos = [
  'microsoft/vscode', 'facebook/react', 'vercel/next.js', 'nodejs/node', 'denoland/deno',
  'microsoft/TypeScript', 'vuejs/core', 'sveltejs/svelte', 'tailwindlabs/tailwindcss', 'rust-lang/rust',
  'golang/go', 'kubernetes/kubernetes', 'tensorflow/tensorflow', 'pytorch/pytorch', 'ohmyzsh/ohmyzsh',
  'sindresorhus/awesome', 'freeCodeCamp/freeCodeCamp', 'yoopta-editor/Yoopta-Editor', 'remarkjs/remark',
  'github/docs', 'excalidraw/excalidraw', 'microsoft/playwright',
];
const headers = { 'User-Agent': 'margin-fixtures', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
let saved = 0;
for (const repo of repos) {
  const meta = await fetch(`https://api.github.com/repos/${repo}/readme`, { headers });
  if (!meta.ok) { console.warn(`skip ${repo}: ${meta.status}`); continue; }
  const { name, download_url: url } = await meta.json();
  if (!/\.md$/i.test(name)) { console.warn(`skip ${repo}: ${name} is not Markdown`); continue; }
  const body = Buffer.from(await (await fetch(url, { headers })).arrayBuffer());
  writeFileSync(new URL(`../test/fixtures/roundtrip/gh-${repo.replace('/', '-').toLowerCase()}.md`, import.meta.url), body);
  saved++;
}
console.log(`saved ${saved} READMEs`);
if (saved < 19) process.exit(1);
