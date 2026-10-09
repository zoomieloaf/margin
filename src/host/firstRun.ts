/** What decides whether Margin offers, once, to open Markdown files in Margin by default. */
export interface FirstRunInput {
  languageId: string;
  /** The document's URI scheme: only files on disk (not git:, untitled:, output...). */
  scheme: string;
  /** The editor is one side of a diff (Source Control, Timeline...): not the moment to ask. */
  inDiff: boolean;
  /** `workbench.editorAssociations`. */
  associations: Record<string, string> | undefined;
  /** The question was already asked once. */
  asked: boolean;
}

/** True when the user opens a Markdown file as text, hasn't chosen an editor for it, and wasn't asked yet. */
export function shouldOfferDefault({ languageId, scheme, inDiff, associations, asked }: FirstRunInput): boolean {
  if (asked || inDiff || languageId !== 'markdown' || scheme !== 'file') return false;
  // Any editor already chosen for Markdown (Margin or another) is the user's choice: don't second-guess it.
  const chosen = Object.keys(associations ?? {}).some((pattern) => /\.(md|markdown)\b/i.test(pattern));
  return !chosen;
}
