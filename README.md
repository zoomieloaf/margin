# Margin — Markdown, edited the way you read it

Margin opens your `.md` files as a clean, rendered document inside VS Code, Cursor, Windsurf and VSCodium. Press **Ctrl+E** to edit in place with Notion-style controls. Your file stays plain Markdown, and it changes **only where you edited**, so git diffs stay small.

## Features

- **Preview, Edit and Markdown modes in one tab.** Switch with Ctrl/Cmd+E or the toggle in the toolbar. Double-click any text in Preview to start editing right there.
- **Selection menu.** Select text to get a menu for turning a block into a heading, list, quote or callout. It also has bold, italic, strikethrough, inline code, highlight (`==text==`) and links.
- **Toolbar** with every formatting action, block types, an outline toggle and export.
- **Slash menu.** Type `/` on an empty line to insert headings, lists, to-dos, quotes, callouts, code blocks, tables, dividers or a Mermaid diagram. Each item shows its Markdown syntax.
- **Markdown shortcuts while typing.** `#`, `##`, `-`, `1.`, `>`, `[]`, ```` ``` ```` and `---` each convert the line as you type.
- **Block handles.** Hover a block, drag `⋮⋮` to move it, click it to duplicate, move or delete, or use `+` to add a block below.
- **Tables.** Tab and Shift+Tab move between cells; Enter moves down.
- **Outline panel** with the current section, word count, reading time and task progress.
- **GitHub callouts** (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) and to-do checkboxes you can click even in Preview.
- **Export.** Export to **PDF** using the Edge or Chrome already on your machine, with nothing to download. Export to **HTML** as a single file. **Copy as rich text** for Slack, email or Confluence, or **copy as Markdown**.
- **Follows your theme:** light, dark and high contrast.

## Your Markdown stays yours

Margin never rewrites your file. Blocks you didn't touch are written back byte-for-byte, including their spacing, list markers, emphasis style and line endings. An edited block is rewritten in the style the file already uses. Margin doesn't offer editing for frontmatter, raw HTML, footnote definitions or math; it shows them read-only and keeps them exactly as written. Use Markdown mode to change them.

Margin's test suite opens and saves 33 real-world files, including the READMEs of popular projects and files with CRLF line endings, a byte-order mark or no final newline. Every file must come back byte-for-byte unchanged.

## Getting started

1. Open any `.md` file.
2. Click **Open in Margin** in the editor title bar. Or, when Margin asks once, choose to open Markdown files in Margin by default.
3. To get the plain text editor back, use **Reopen in Text Editor** (the title bar icon or the Command Palette).

Undo and redo use VS Code's own history, so Ctrl+Z works across Margin, the text editor and git.

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Toggle Preview / Edit | Ctrl+E | Cmd+E |
| Bold / Italic | Ctrl+B / Ctrl+I | Cmd+B / Cmd+I |
| Strikethrough | Ctrl+Shift+X | Cmd+Shift+X |
| Highlight | Ctrl+Shift+H | Cmd+Shift+H |
| Inline code | Ctrl+\` | Cmd+\` |
| Link | Ctrl+K | Cmd+K |
| Line break inside a block | Shift+Enter | Shift+Enter |
| Indent / outdent list item | Tab / Shift+Tab | Tab / Shift+Tab |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `margin.defaultMode` | `preview` | Mode used when a file opens: `preview` or `edit`. |
| `margin.exportFolder` | *(empty)* | Folder for exported files, relative to the workspace. Empty means next to the Markdown file. |
| `margin.export.theme` | `light` | `light`, `dark` or `auto` (follows VS Code). |
| `margin.export.browserPath` | *(empty)* | Chrome, Edge or Chromium used for PDF export. Empty means detect automatically. |
| `margin.outline.visible` | `true` | Show the outline panel when there is room. |

## Privacy

Margin works entirely offline. It makes no network requests and collects no telemetry. Links open only when you click them.

## Development

```bash
npm install
npm test                  # unit tests: Markdown layer, editor model, commands, export
npm run e2e               # the built editor in Edge/Chrome with real mouse and keyboard input
npm run test:integration  # inside VS Code: custom editor, sync, export
npm run package           # builds margin-<version>.vsix
```

Press F5 in VS Code to start an Extension Development Host.

## License

MIT
