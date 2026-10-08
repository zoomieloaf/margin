import type { Node as PmNode } from 'prosemirror-model';
import { diffToEdit } from '../../md/edits';
import { createIdGenerator } from '../../md/ids';
import { commit, insertBlock, moveBlock, removeBlock, updateBlock } from '../../md/ops';
import { parseMarkdown } from '../../md/parse';
import type { MdDocument, TextEdit } from '../../md/types';
import { writeMarkdown } from '../../md/write';
import { blockToPm, pmToMdast } from './convert';
import { schema } from './schema';

export interface OutgoingEdit {
  version: number;
  edits: TextEdit[];
}

/**
 * Owns the Markdown side of the editor: the parsed document, the text the host last confirmed,
 * and the one edit allowed in flight. The editor reports its document with `change()`; the
 * model works out which blocks changed and sends one minimal text edit.
 */
export class DocModel {
  private doc!: MdDocument;
  private text = '';
  private version = 0;
  /** Last ProseMirror node reconciled for each block id; an identical node means "untouched". */
  private seen = new Map<string, PmNode>();
  private latest: PmNode | null = null;
  private inFlight = false;
  readonly newId = createIdGenerator('n');

  constructor(private readonly send: (edit: OutgoingEdit) => void) {}

  /** Parses `text` and returns the ProseMirror document to show. */
  load(text: string, version: number): PmNode {
    this.doc = parseMarkdown(text);
    this.text = text;
    this.version = version;
    this.latest = null;
    this.inFlight = false;
    this.seen.clear();
    const nodes = this.doc.blocks.map((b) => {
      const node = blockToPm(b);
      this.seen.set(b.id, node);
      return node;
    });
    return schema.nodes.doc!.create(null, nodes.length ? nodes : [schema.nodes.paragraph!.create()]);
  }

  get markdown(): string {
    return this.text;
  }

  get busy(): boolean {
    return this.inFlight || this.latest !== null;
  }

  /** Call with the editor's current document after it changed. */
  change(pmDoc: PmNode): void {
    this.latest = pmDoc;
    this.flush();
  }

  /** The host applied our edit; `version` is the document's new version. */
  ack(version: number): void {
    this.version = version;
    this.inFlight = false;
    this.flush();
  }

  /** Replaces the whole document with the host's text (undo, external change, stale edit). */
  reset(text: string, version: number): PmNode {
    return this.load(text, version);
  }

  /** Replaces the text from Markdown mode: sends the full-text edit and reloads. */
  replaceText(text: string): PmNode {
    const edit = diffToEdit(this.text, text);
    const pm = this.load(text, this.version);
    if (edit) {
      this.inFlight = true;
      this.send({ version: this.version, edits: [edit] });
    }
    return pm;
  }

  private flush(): void {
    if (this.inFlight || !this.latest) return;
    const pmDoc = this.latest;
    this.latest = null;
    const edit = this.reconcile(pmDoc);
    if (!edit) return;
    this.inFlight = true;
    this.send({ version: this.version, edits: [edit] });
  }

  private reconcile(pmDoc: PmNode): TextEdit | null {
    const nodes = new Map<string, PmNode>();
    const order: string[] = [];
    pmDoc.forEach((node) => {
      const id = (node.attrs.blockId as string | null) ?? this.newId();
      if (nodes.has(id)) return; // uniqueIds normally prevents this; keep the first
      nodes.set(id, node);
      order.push(id);
    });

    let doc = this.doc;
    for (const b of this.doc.blocks) if (!nodes.has(b.id)) doc = removeBlock(doc, b.id);
    for (const b of doc.blocks) {
      const node = nodes.get(b.id)!;
      if (this.seen.get(b.id) !== node) doc = updateBlock(doc, b.id, pmToMdast(node));
    }
    order.forEach((id, k) => {
      if (doc.blocks[k]?.id === id) return;
      doc = doc.blocks.some((b) => b.id === id) ? moveBlock(doc, id, k) : insertBlock(doc, k, pmToMdast(nodes.get(id)!), id);
    });

    this.seen = nodes;
    const text = writeMarkdown(doc);
    this.doc = commit(doc);
    const edit = diffToEdit(this.text, text);
    this.text = text;
    return edit;
  }
}
