// Writes README.store.md: the README as the extension stores and VS Code's extension page show it.
// Blocks between <!-- github-only --> and <!-- /github-only --> (install links and commands, which
// only make sense on GitHub) are left out. `npm run package` packs this file as the readme.
import fs from 'node:fs';

const readme = fs.readFileSync('README.md', 'utf8');
const store = readme.replace(/\r?\n?<!-- github-only -->[\s\S]*?<!-- \/github-only -->\r?\n?/g, '');
if (store.includes('github-only')) throw new Error('README.md has an unclosed <!-- github-only --> block');
fs.writeFileSync('README.store.md', store);
