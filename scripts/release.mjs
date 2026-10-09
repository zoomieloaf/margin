// Cuts a release in one command:
//   npm run release            → patch (0.1.0 → 0.1.1)
//   npm run release -- minor   → 0.1.0 → 0.2.0
//   npm run release -- major   → 0.1.0 → 1.0.0
//   npm run release -- current → releases the version already in package.json (the first release)
//   add --dry-run to see what would happen without changing anything.
//
// It raises the version in package.json and package-lock.json, writes the CHANGELOG section,
// commits, tags vX.Y.Z and pushes the commit to main and the tag. The tag starts the Release
// workflow on GitHub, which tests, publishes to both stores and creates the GitHub release.
//
// Changelog notes: a "## Unreleased" section at the top of CHANGELOG.md is used as written.
// Without one, the notes are made from the feat/fix commit subjects since the last tag.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';
if (!['patch', 'minor', 'major', 'current'].includes(bump)) fail(`Unknown release type "${bump}": use patch, minor, major or current.`);

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run = (cmd) => (dryRun ? console.log(`  would run: ${cmd}`) : execSync(cmd, { stdio: 'inherit' }));
function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// 1. A clean tree, so the release commit holds only the release.
if (sh('git status --porcelain --untracked-files=no')) fail('commit or stash your changes first.');

// 2. The new version.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const version = {
  current: pkg.version,
  patch: `${major}.${minor}.${patch + 1}`,
  minor: `${major}.${minor + 1}.0`,
  major: `${major + 1}.0.0`,
}[bump];
const tag = `v${version}`;
if (sh(`git tag --list ${tag}`)) fail(`${tag} already exists: that version was released.`);

// 3. The changelog section.
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split('\n');
const heading = (l) => /^## /.test(l);
const sectionOf = (title) => {
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && heading(l));
  return { start, end: end < 0 ? lines.length : end };
};
let newChangelog = changelog;
const existing = sectionOf(version);
const unreleased = sectionOf('Unreleased');
if (existing) {
  console.log(`CHANGELOG.md already has "## ${version}"; using it.`);
} else if (unreleased && lines.slice(unreleased.start + 1, unreleased.end).some((l) => l.trim())) {
  lines[unreleased.start] = `## ${version}`;
  newChangelog = lines.join('\n');
  console.log(`CHANGELOG.md: "## Unreleased" becomes "## ${version}".`);
} else {
  const last = sh('git tag --list "v*" --sort=-v:refname').split('\n')[0];
  const range = last ? `${last}..HEAD` : 'HEAD';
  const subjects = sh(`git log ${range} --format=%s`).split('\n').filter(Boolean);
  const pick = (type) => subjects.filter((s) => s.startsWith(`${type}:`) || s.startsWith(`${type}(`)).map((s) => `- ${s.replace(/^\w+(\([^)]*\))?:\s*/, '')}`);
  const features = pick('feat');
  const fixes = pick('fix');
  if (!features.length && !fixes.length) fail(`no feat/fix commits since ${last || 'the start'}; write a "## Unreleased" section in CHANGELOG.md.`);
  const notes = [`## ${version}`, '', ...(features.length ? ['New:', '', ...features, ''] : []), ...(fixes.length ? ['Fixed:', '', ...fixes, ''] : [])];
  const at = lines.findIndex(heading);
  lines.splice(at < 0 ? lines.length : at, 0, ...notes);
  newChangelog = lines.join('\n');
  console.log(`CHANGELOG.md: "## ${version}" written from ${features.length + fixes.length} commits since ${last || 'the start'}.`);
}

console.log(`Releasing ${pkg.version === version ? version : `${pkg.version} → ${version}`} as ${tag}${dryRun ? ' (dry run)' : ''}.`);
if (dryRun) {
  const s = newChangelog.split('\n');
  const from = s.findIndex((l) => l.trim() === `## ${version}`);
  const to = s.findIndex((l, i) => i > from && heading(l));
  console.log(`\n${s.slice(from, to < 0 ? undefined : to).join('\n')}\n`);
}

// 4. Write, commit, tag, push.
if (!dryRun) {
  fs.writeFileSync('CHANGELOG.md', newChangelog);
  if (version !== pkg.version) execSync(`npm version ${version} --no-git-tag-version`, { stdio: 'ignore' });
}
run('git add package.json package-lock.json CHANGELOG.md');
if (dryRun || sh('git status --porcelain --untracked-files=no')) run(`git commit -m "release: ${version}"`);
run(`git tag ${tag}`);
run('git push origin HEAD:main');
run(`git push origin ${tag}`);
console.log(dryRun ? 'Nothing was changed.' : `Pushed ${tag}. Follow the release at https://github.com/zoomieloaf/margin/actions`);
