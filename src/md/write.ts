import { serializeBlock } from './serialize';
import type { Conventions, MdDocument, SourceBlock } from './types';

export function blockText(b: SourceBlock, c: Conventions): string {
  return !b.dirty && b.original !== null ? b.original : serializeBlock(b.data, c);
}

export function writeMarkdown(doc: MdDocument): string {
  const body = doc.blocks.map((b) => b.gapBefore + blockText(b, doc.conventions)).join('');
  return (doc.bom ? '﻿' : '') + body + doc.trailing;
}
