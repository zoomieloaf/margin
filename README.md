# Margin — Markdown, edited the way you read it

Margin opens your `.md` files as a clean, rendered document inside VS Code, Cursor, Windsurf and VSCodium. Press **Ctrl+E** to edit in place with Notion-style controls. Your file stays plain Markdown, and it changes **only where you edited**, so git diffs stay small.

## Features

- **Preview, Edit and Markdown modes in one tab.** Switch with Ctrl/Cmd+E or the toggle in the toolbar. Double-click any text in Preview to start editing right there.
- **Selection menu.** Select text to get a menu for turning a block into a heading, list, quote or callout. It also has bold, italic, strikethrough, inline code, highlight (`==text==`) and links.
- **Toolbar** with every formatting action, block types, an outline toggle and export.
- **Slash menu.** Type `/` on an empty line to insert headings, lists, to-dos, quotes, callouts, code blocks, tables, dividers or a Mermaid diagram. Each item shows its Markdown syntax.
- **Markdown shortcuts while typing.** `#`, `##`, `-`, `1.`, `>`, `[]`, ```` ``` ```` and `---` each convert the line as you type.
- **Block handles.** Hover a block, drag `⋮⋮` to move it, click it to duplicate, move or delete, or use `+` to add a block below.
- **Tables.** Tab and Shift+Tab move between cells, and Tab in the last cell adds a row. Enter moves to the cell below and adds a row at the end. The block menu (`⋮⋮`) adds a row below or a column on the right, and deletes rows or columns.
- **Links between your docs work like pages in a wiki.** Click a link to `./setup.md`, `../guides/` or `/docs/faq.md#install` and the page opens in Margin, in Preview, scrolled to that heading. A link to a folder opens its `README.md` or `index.md`. A linked page opens in the preview tab, which the next one replaces, so clicking through a wiki doesn't pile up tabs; editing a page keeps its tab. Ctrl+click (Cmd+click on macOS) opens a page in a tab of its own, or set `margin.links.openIn` to `newTab` to make that the default (Ctrl+click then uses the preview tab).
- **Back and Forward.** The ← and → buttons at the left of the toolbar, your mouse's back and forward buttons, and Alt+Left take you back to the page you came from, like VS Code's Go Back. After a jump to a `#section` on the same page, Back first scrolls back to where you were.
- **Broken links are easy to spot.** A link to a file that doesn't exist gets a red wavy underline, and hovering any link to a file shows where it points. Click a broken link to a `.md` page and choose **Create page** to start it, with a title made from the file name.
- **Click to open, in Edit mode too.** A click on a link opens it; dragging across a link still selects text. To change a link's text, click just after it or move there with the arrow keys. Hover a link while editing to get a small card with **Open**, **Open in new tab** (**Open in this tab** with `newTab`), **Edit link** and **Copy link**.
- **AI actions on your selection.** Improve writing, Shorten, Make longer, Fix spelling & grammar, Translate, Summarize, Continue writing, or Ask AI with your own instruction. Find them under **AI** in the toolbar, **✨ AI** in the selection menu, or `/ai` in the slash menu. With GitHub Copilot in VS Code, the answer streams in below your selection as a suggestion: **Accept** replaces the selection in one undo step, **Insert below** keeps it, **Try again** asks again and **Discard** (or Esc) leaves your file untouched. Without an AI model in the editor (in Cursor, say), Margin copies the prompt and opens a chat; paste the answer back with Ctrl+V and it becomes formatted blocks.
- **Page width.** Narrow, normal, wide or full width for the text, from the toolbar or `margin.pageWidth`; each file can keep its own.
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
| Open a link (Preview and Edit) | Click | Click |
| Open a link in a new tab (the opposite of `margin.links.openIn`) | Ctrl+click | Cmd+click |
| Back: an in-page jump first, then the previous page (VS Code's Go Back) | Alt+Left (Ctrl+Alt+- on Linux), mouse back button | Ctrl+-, mouse back button |
| Forward (VS Code's Go Forward) | Alt+Right (Ctrl+Shift+- on Linux), mouse forward button | Ctrl+Shift+-, mouse forward button |
| Line break inside a block | Shift+Enter | Shift+Enter |
| Undo / redo (VS Code's history) | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Cmd+Z / Cmd+Shift+Z or Cmd+Y |
| Indent / outdent list item | Tab / Shift+Tab | Tab / Shift+Tab |
| Next / previous table cell (Tab in the last cell adds a row) | Tab / Shift+Tab | Tab / Shift+Tab |
| Cell below in a table (adds a row at the end) | Enter | Enter |

While you edit in Margin, these shortcuts belong to Margin: for example Ctrl+B makes text bold instead of toggling the sidebar, and Ctrl+K edits a link instead of starting a chord. Undo, redo, Ctrl+E and Go Back belong to Margin whenever it has focus. In Preview and Markdown mode, and everywhere else, the other shortcuts work as usual.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `margin.defaultMode` | `preview` | Mode used when a file opens: `preview` or `edit`. |
| `margin.exportFolder` | *(empty)* | Folder for exported files, relative to the workspace. Empty means next to the Markdown file. |
| `margin.export.theme` | `light` | `light`, `dark` or `auto` (follows VS Code). |
| `margin.export.browserPath` | *(empty)* | Chrome, Edge or Chromium used for PDF export. Empty means detect automatically. |
| `margin.outline.visible` | `true` | Show the outline panel when there is room. |
| `margin.pageWidth` | `normal` | Width of the text column: `narrow` (600 px), `normal` (716 px), `wide` (1000 px) or `full` (the whole editor). The width button in the toolbar, or **Margin: Change Page Width**, sets a width for one file. Exports keep their own print width. |
| `margin.links.openIn` | `sameTab` | Where a clicked link opens its page. `sameTab`: in the preview tab, which the next linked page replaces (as `workbench.editor.enablePreview` allows; editing a page keeps its tab). `newTab`: every linked page gets its own tab. Ctrl+click (Cmd+click on macOS) does the opposite. |
| `margin.ai` | `auto` | Where AI actions send text. `auto`: the editor's AI model (GitHub Copilot) when there is one, otherwise a chat. `editor`: only the editor's model. `chatgpt` or `claude`: copy the prompt and open that site. `off`: hide all AI actions. |

## Privacy

Margin makes no network requests of its own. Remote images in your documents load like in VS Code's Markdown preview. Margin collects no telemetry, and links open only when you click them.

Text leaves your machine only when you run an AI action, and only the text that action needs: your selection (Continue writing and Ask AI also send the document before the cursor). Where it goes depends on `margin.ai`:

- **The editor's AI model:** to GitHub Copilot via VS Code (or the model your editor provides), through VS Code's language model API, under your Copilot account and its terms.
- **chatgpt.com or claude.ai:** Margin copies the prompt to your clipboard and opens the site in your browser. A short prompt goes in the address, and the site may send it right away; a long one waits for you to paste it.
- **`off`:** AI actions are hidden and nothing is ever sent.

The first time an AI action would send text to a place, Margin says where and asks you to continue or cancel.

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
