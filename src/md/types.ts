import type { BlockContent, DefinitionContent, Parent, PhrasingContent, RootContent } from 'mdast';

export type BlockKind =
  | 'paragraph' | 'heading' | 'list' | 'quote' | 'callout' | 'code' | 'table' | 'divider' | 'raw';

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/** `==text==` highlight (Margin extension node). */
export interface Mark extends Parent {
  type: 'mark';
  children: PhrasingContent[];
}

/** GitHub-style `> [!KIND]` alert (Margin extension node). */
export interface Callout extends Parent {
  type: 'callout';
  kind: CalloutKind;
  /** The kind as written in the source (e.g. `note`, `Tip`), reused when serializing; new callouts are written in uppercase. */
  label?: string;
  children: Array<BlockContent | DefinitionContent>;
}

declare module 'mdast' {
  interface PhrasingContentMap { mark: Mark }
  interface BlockContentMap { callout: Callout }
  interface RootContentMap { mark: Mark; callout: Callout }
}

export interface Conventions {
  eol: '\n' | '\r\n';
  bullet: '-' | '*' | '+';
  bulletOrdered: '.' | ')';
  emphasis: '*' | '_';
  strong: '*' | '_';
  fence: '`' | '~';
  rule: '-' | '*' | '_';
  /** How hard line breaks are written: two trailing spaces or a backslash. */
  hardBreak: 'spaces' | 'backslash';
}

export interface SourceBlock {
  /** Stable for the lifetime of the parsed document. */
  id: string;
  kind: BlockKind;
  /** Exact source slice; null for blocks created in the editor. */
  original: string | null;
  /** nodeKey() of the data `original` was parsed from; null for new blocks. */
  originalKey: string | null;
  /** Exact text between the previous block (or file start) and this block. */
  gapBefore: string;
  /** Engine-neutral content: an mdast node. */
  data: RootContent;
  dirty: boolean;
}

export interface MdDocument {
  bom: boolean;
  blocks: SourceBlock[];
  /** Exact text after the last block (usually the final newline). */
  trailing: string;
  conventions: Conventions;
}

export interface TextEdit {
  /** UTF-16 offsets into the old text. */
  start: number;
  end: number;
  text: string;
}
