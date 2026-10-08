import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../src/md/', import.meta.url));
const FORBIDDEN = /from\s+['"](react|react-dom|slate[\w-]*|@yoopta\/[\w-]+|vscode)['"]/;

describe('src/md stays engine-neutral', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.ts')))('%s imports no editor or VS Code packages', (f) => {
    expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(FORBIDDEN);
  });
});
