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
 * Owns the Markdown side of the editor: the parsed document, the text it stands for, and the
 * one edit allowed in flight. The editor reports its document with `change()` (Markdown mode
 * reports the textarea with `sourceChanged()`); the model works out the new text at once and
 * sends one minimal text edit whenever no other edit is waiting for the host's ack.
 */
export class DocModel {
  private doc!: MdDocument;
  /** The Markdown the editor stands for: every local change applied. */
  private text = '';
  /** What the host has, or will have once the edit in flight is applied. */
  private sentText = '';
  /** The host version the edit in flight (or the next edit) is based on. */
  private version = 0;
  /** Last ProseMirror node reconciled for each block id; an identical node means "untouched". */
  private seen = new Map<string, PmNode>();
  private inFlight = false;
  /** Sequence number of the last edit sent; the host echoes it in the ack. */
  private seq = 0;
  /** An ack didn't match the edit in flight: nothing is sent until the host's reset arrives. */
  private resyncing = false;
  /** The text was edited in Markdown mode, so `doc` and the editor document are out of date. */
  private sourceAhead = false;
  /** Callbacks waiting for the model to have nothing unsent or unacknowledged. */
  private idle: Array<() => void> = [];
  readonly newId = createIdGenerator('n');

  constructor(
    private readonly send: (edit: OutgoingEdit, seq: number) => void,
    /** Asks the host for a reset (the webview posts `resync`). */
    private readonly resync: () => void = () => {},
  ) {}

  /** Parses `text` and returns the ProseMirror document to show. */
  load(text: string, version: number): PmNode {
    this.text = text;
    this.sentText = text;
    this.version = version;
    this.inFlight = false;
    this.resyncing = false;
    const pm = this.rebuild();
    this.drainIdle();
    return pm;
  }

  /** Re-parses `text` into blocks and the editor document, leaving the sync state alone. */
  private rebuild(): PmNode {
    this.doc = parseMarkdown(this.text);
    this.sourceAhead = false;
    this.seen.clear();
    const nodes = this.doc.blocks.map((b) => {
      const node = blockToPm(b);
      this.seen.set(b.id, node);
      return node;
    });
    return schema.nodes.doc!.create(null, nodes.length ? nodes : [schema.nodes.paragraph!.create()]);
  }

  /** The Markdown the editor currently stands for (sent or not). */
  get markdown(): string {
    return this.text;
  }

  /** Something is unsent, unacknowledged, or waiting for a resync. */
  get busy(): boolean {
    return this.inFlight || this.text !== this.sentText || this.resyncing;
  }

  /** Call with the editor's current document after it changed. */
  change(pmDoc: PmNode): void {
    // While Markdown mode has newer text, the editor document is stale: don't let it win.
    if (this.sourceAhead) return;
    this.reconcile(pmDoc);
    this.flush();
  }

  /** Call with the Markdown-mode textarea's text after it changed. The editor document is rebuilt by leaveSource(). */
  sourceChanged(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.sourceAhead = true;
    this.flush();
  }

  /** Leaving Markdown mode: the editor document for the edited text, or null when it didn't change. */
  leaveSource(): PmNode | null {
    return this.sourceAhead ? this.rebuild() : null;
  }

  /**
   * The host applied our edit; `version` is the document's new version and `seq` (when the host
   * echoes it) the edit's sequence number. An ack that doesn't match the edit in flight means
   * the two sides disagree (e.g. a reset made us drop an edit the host then applied), so it is
   * ignored and the host is asked for a fresh copy instead of editing at wrong offsets.
   */
  ack(version: number, seq?: number): void {
    if (!this.inFlight || version !== this.version + 1 || (seq !== undefined && seq !== this.seq)) {
      if (!this.resyncing) {
        this.resyncing = true;
        this.resync();
      }
      return;
    }
    this.version = version;
    this.inFlight = false;
    this.flush();
    this.drainIdle();
  }

  /**
   * Runs `fn` once every change has been sent and acknowledged (or a reset replaced them):
   * at once when idle. Undo and redo wait for this, so VS Code undoes the latest edit.
   */
  whenIdle(fn: () => void): void {
    if (this.busy) this.idle.push(fn);
    else fn();
  }

  private drainIdle(): void {
    if (this.busy) return;
    const ready = this.idle;
    this.idle = [];
    ready.forEach((fn) => fn());
  }

  /** Replaces the whole document with the host's text (undo, external change, stale edit). */
  reset(text: string, version: number): PmNode {
    return this.load(text, version);
  }

  /** Replaces the text from Markdown mode in one go: sends the diff and returns the rebuilt document. */
  replaceText(text: string): PmNode {
    this.sourceChanged(text);
    return this.rebuild();
  }

  private flush(): void {
    if (this.inFlight || this.resyncing) return;
    const edit = diffToEdit(this.sentText, this.text);
    if (!edit) return;
    this.sentText = this.text;
    this.inFlight = true;
    this.send({ version: this.version, edits: [edit] }, ++this.seq);
  }

  /** Brings `doc` and `text` up to date with the editor document. */
  private reconcile(pmDoc: PmNode): void {
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
    this.text = writeMarkdown(doc);
    this.doc = commit(doc);
  }
}
