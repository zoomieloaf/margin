import { describe, expect, it } from 'vitest';
import { fromMarkdown } from 'mdast-util-from-markdown';

describe('toolchain', () => {
  it('loads the ESM Markdown parser', () => {
    const tree = fromMarkdown('# Hi');
    expect(tree.children[0]?.type).toBe('heading');
  });
});
