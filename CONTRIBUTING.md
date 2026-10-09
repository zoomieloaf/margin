# Contributing to Margin

## Development

```bash
npm install
npm test                  # unit tests: Markdown layer, editor model, commands, export
npm run e2e               # the built editor in Edge/Chrome with real mouse and keyboard input
npm run test:integration  # inside VS Code: custom editor, sync, export
npm run package           # builds margin-<version>.vsix
npm run demo              # records media/demo.gif in an isolated VS Code with that vsix
```

Press F5 in VS Code to start an Extension Development Host.

### Releasing

```bash
npm run release              # 0.1.0 → 0.1.1
npm run release -- minor     # 0.1.0 → 0.2.0
npm run release -- major     # 0.1.0 → 1.0.0
npm run release -- --dry-run # shows the version and changelog notes, changes nothing
```

The script raises the version, writes the `CHANGELOG.md` section, commits, tags and pushes. The notes come from a `## Unreleased` section if you wrote one, otherwise from the `feat:` and `fix:` commits since the last release. For the very first release, `npm run release -- current` releases the version already in `package.json`.

Pushing the tag starts the Release workflow, which runs every test, builds the `.vsix`, publishes it to the VS Code Marketplace and Open VSX, and creates a GitHub release with the `.vsix` and the changelog notes. Run it from the Actions tab for a dry run that publishes nothing.

It needs the repository secret `OVSX_PAT` (an Open VSX access token). For the VS Code Marketplace it uses `VSCE_PAT` when that secret exists; without it, the workflow skips the Marketplace and you upload the `.vsix` from the GitHub release at marketplace.visualstudio.com/manage. (Azure DevOps stops issuing the all-organizations tokens the Marketplace needs on 2026-12-01; tokenless trusted publishing, `vsce publish --oidc`, is the planned replacement.)

### README on GitHub and in the stores

`npm run package` packs `README.store.md`, made from `README.md` by `scripts/store-readme.mjs`. Anything between `<!-- github-only -->` and `<!-- /github-only -->` (install links and commands) appears on GitHub only, not on the store pages or VS Code's extension page.
