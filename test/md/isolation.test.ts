import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../src/md/', import.meta.url));
const PACKAGES = String.raw`(?:react|react-dom|slate[\w-]*|@yoopta\/[\w-]+|prosemirror-[\w-]+|@tiptap\/[\w-]+|vscode)(?:\/[^'"]*)?`;
/** `from '…'`, side-effect `import '…'`, `require('…')` and dynamic `import('…')`. */
const FORBIDDEN = new RegExp(
  String.raw`(?:\bfrom\s+|\bimport\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]${PACKAGES}['"]`,
);

describe('src/md stays engine-neutral', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.ts')))('%s imports no editor or VS Code packages', (f) => {
    expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(FORBIDDEN);
  });

  const testDir = fileURLToPath(new URL('./', import.meta.url));
  const sources = [
    ...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)),
    ...readdirSync(testDir).filter((f) => f.endsWith('.ts')).map((f) => join(testDir, f)),
  ];
  it.each(sources)('%s has no invisible BOM literal (use the escape)', (path) => {
    expect(readFileSync(path, 'utf8').includes(String.fromCharCode(0xfeff))).toBe(false);
  });

  it.each([
    `import { x } from 'react';`,
    `import x from "slate-react";`,
    `import { EditorState } from 'prosemirror-state';`,
    `import { Editor } from '@tiptap/core';`,
    `import '@tiptap/starter-kit';`,
    `import 'vscode';`,
    `const v = require('vscode');`,
    `const m = await import('prosemirror-model');`,
    `export { y } from '@yoopta/editor';`,
    `import { z } from 'react-dom/client';`,
  ])('the guard catches %s', (line) => {
    expect(line).toMatch(FORBIDDEN);
  });

  it.each([
    `import { fromMarkdown } from 'mdast-util-from-markdown';`,
    `import type { Root } from 'mdast';`,
    `import './callout';`,
    `const reactive = 'react';`,
  ])('the guard allows %s', (line) => {
    expect(line).not.toMatch(FORBIDDEN);
  });
});
