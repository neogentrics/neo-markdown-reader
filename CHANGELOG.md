# Changelog

All notable changes to Neo Markdown Reader are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.1.0] - 2026-11-01

### Added
- **File Explorer preview:** select a `.md` file in Explorer with the Preview pane on to see it formatted.
  - It's a small add-on installed with the app for the current user (no admin rights), and it follows
    Windows' light or dark mode.
  - The preview doesn't load images and can't navigate or run anything.
  - An existing Markdown previewer (such as PowerToys') is left in place, and uninstalling removes the add-on.
- **Accessibility:**
  - Every screen, dialog and theme passes automated axe checks, including Windows high-contrast mode.
  - Page tabs work with `←` `→` `Home` `End`, and `Delete` closes one.
  - Sidebar panels are proper tabs, and Quick Open announces the selected match.
  - Focus is always visible, and animations respect Windows' *Animation effects* setting.
- **More install options:**
  - A Linux `.deb` package.
  - A Mac build for Intel Macs (`…-mac-x64.dmg`) next to the Apple-silicon one.
  - `scripts/winget-manifest.mjs` writes the Windows Package Manager manifests for a release.
- **Ready for code signing:** the Release workflow signs the Windows installer as soon as
  `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` secrets are added, and it reports the signature status.

### Changed
- Better contrast:
  - Secondary text is darker in the light themes.
  - Buttons in the dark themes use dark text on their accent colour.
  - Callout titles are readable in every theme.
  - Mist's accent is slightly deeper.
- The close (×) on a tab is part of the tab rather than a separate button inside it, so screen readers
  announce tabs properly. Close a tab with `Ctrl+W` or `Delete`.

## [2.0.0] - 2026-11-01

### Added
- **Run code blocks.** JavaScript and Python code blocks get a ▶ Run button, and the output appears under
  the block.
  - Every run asks first, with an option not to ask again for that document until you close it.
  - Code runs in a sealed sandbox: a separate hidden window with its own session. Every request outside
    the sandbox is refused, and the code has no access to Node.js or permissions.
  - Runs are stopped after 10 seconds (Python: 30).
  - Python is Pyodide with its standard library, built into the app.
  - *Edit → Allow Running Code Blocks* turns the feature off.
- **Password-locked documents** (`.mdlock`).
  - *File → Protect with Password…* saves an AES-256-GCM encrypted copy with a key made from your
    password (scrypt). It's verified before anything else changes, and you can optionally move the
    original to the Recycle Bin.
  - Locked tabs show an unlock screen; *Lock Now* locks them again.
  - Editing a locked document saves it encrypted. *Save an Unlocked Copy…* writes plain Markdown.
  - Locked documents appear in folders but are never searched, highlighted or sent to AI assist.
- **AI assist (optional)** with Claude and your own Anthropic API key: *Summarize Document*, *Explain
  Selection* and *Turn Notes into a Report* (which opens the draft as a new document).
  - Off by default.
  - Answers stream into a panel.
  - Choose Claude Opus 5.5 (default), Sonnet 5.5 or Haiku 5.5.
  - The key is encrypted by the operating system and never stored in the settings file.
- **Four more colour themes:** Mist, Forest, Dusk and High Contrast.
- `.mdlock` files open with the app (file association).

### Changed
- Code colours, highlights, diagrams and custom accents now follow every dark theme, not only Night.
- *Preview in File Explorer* moved from 2.0 to a later release.

## [1.4.0] - 2026-10-31

### Added
- **PDF designer** (*File → Export → PDF…*, `Ctrl+Shift+E`). Choose:
  - paper (Letter, A4, Legal, A5, or *Auto* by country) and margins;
  - a **cover page** from the front matter (`title`, `subtitle`, `author`, `date`, `tags`, `organization`,
    `version`, `logo`);
  - a **contents page** with real page numbers and clickable entries;
  - a title header and page-number footer;
  - chapters on new pages, and paper or on-screen colours.

  A live sketch previews the first pages. PDFs get bookmarks for every heading and their title, author and
  keywords set. Choices are remembered.
- **Export to Word** (`.docx`): headings, lists, task lists, tables, links (including links to headings),
  images, code and page numbers. Mermaid diagrams and display equations are included as pictures.
- **Export as a web page** (`.html`): a single file with styles, images and maths fonts built in, and no scripts.
- **Export as plain text** (`.txt`).
- **Presentation mode** (*View → Present as Slides*, `Ctrl+Shift+P`): full-screen slides split on `---` (or
  at the main headings), the front matter as a title slide, keyboard and click navigation, and text that
  shrinks to fit.
- **Customize theme** (*View → Customize Theme…*): accent colour, text/heading/code fonts and an optional
  brand stylesheet. They apply on screen and to every export.

### Changed
- The toolbar's PDF button opens the PDF designer. *File → Export* replaces *Export as PDF…*.
- A `logo` front-matter key is no longer listed in the document header (it's used on PDF cover pages).

## [1.3.0] - 2026-10-31

### Added
- **Open Folder** (`Ctrl+Shift+O`): browse every Markdown file in a folder from the sidebar's **Files** panel
  (a tree with a filter box), with *Open Recent Folder* and *Close Folder*. It skips `node_modules`, hidden
  folders and folders without Markdown. The folder is restored with your session and refreshes when
  files change.
- **Find in Folder** (`Ctrl+Shift+F`): search the text of every file in the open folder; results show the
  line, and clicking one opens the file at that line.
- **Quick Open** (`Ctrl+K`): fuzzy-find open tabs, bookmarks, recent files and folder files; type `#` to
  jump to a heading in the current document.
- **Split view** (`Ctrl+\`, *Open to the Side*): two documents side by side, choose or swap the right one,
  with optional **linked scrolling**.
- **Compare**: a line-by-line diff with changed words highlighted. Compare two tabs, the current document
  with any file, or your unsaved edits with the saved version.
- **Highlights & notes**: select text and highlight it (`Ctrl+Shift+H`) or add a note; four colours; a
  **Notes** panel lists them. Stored privately by the app, never in the file, and found again after the
  document changes.
- **Bookmarks** (`Ctrl+D`): starred files appear at the top of the Files panel and in Quick Open.
- The sidebar now has four panels: **Outline · Files · Search · Notes**. View menu items open each one.

### Changed
- `Ctrl+B` shows or hides the whole sidebar (outside the editor, where it still means bold).

## [1.2.0] - 2026-10-31

### Added
- **New documents.** *File → New Document* (`Ctrl+N`) and *New from Template*: meeting notes, README,
  checklist, report with a title page. New documents open in the editor; saving asks where. *New Window*
  moves to `Ctrl+Shift+N`.
- **Editing with permission.** Documents open read-only. **Edit** (`Ctrl+E`) asks first:
  - **Just this time** (the default; ends when the tab closes), **Always for this file**, or
    **Always for this folder**.
  - "Always" choices can be reviewed and removed under *Edit → Editing Permissions…*.
  - Files marked read-only by Windows stay locked.
- **Editor beside the live preview.**
  - Markdown on the left, the formatted page on the right, scrolling together.
  - Formatting toolbar: headings, bold, italic, strikethrough, code, lists, checklists, quotes, links,
    images, tables, code blocks, dividers.
  - Shortcuts (`Ctrl+B`/`I`/`K`), undo/redo, find & replace, and spell check with suggestions on
    right-click.
- **Safe saving.**
  - *Save* (`Ctrl+S`) and *Save As* (`Ctrl+Shift+S`); `.txt` files can be saved as `.md`.
  - The original is backed up before the first save (*Edit → Open Backups Folder*).
  - If another program changed the file while you edited, the app asks before replacing those changes,
    and a banner offers to load their version.
  - The file's original line endings and byte-order mark are preserved.
  - Closing a tab or window with unsaved changes asks first.
- Edit menu: Undo, Redo, Cut, Paste. Right-click in the editor: spelling suggestions and clipboard actions.

## [1.1.0] - 2026-10-31

### Added
- **Tabs.** Every file opens in a tab. Switch with `Ctrl+Tab` / `Ctrl+Shift+Tab` or `Ctrl+1…9`; close
  with `Ctrl+W` or middle-click; reopen with `Ctrl+Shift+T`; drag to reorder. `Ctrl`+click or
  middle-click a link to open it in a new tab.
- **Tab menu & separate windows.** Right-click a tab for Move to New Window, Duplicate, Copy Path,
  Show in Folder, Close Others and Close Tabs to the Right. Drag a tab out of the window to split it
  into a new window.
- Double-clicking a `.md` file while the app is open adds a tab to the open window, or focuses the tab
  if that file is already open.
- **Always-visible menu bar** with a new Tabs menu and more commands (Reopen Closed Tab, Copy File
  Path, Find Next/Previous, Close Window, Check for Updates). *View → Always Show Menu Bar* switches
  back to auto-hide.
- **Session restore.** Reopens your windows and tabs from last time.
- **Reading positions.** Files reopen scrolled to where you stopped reading.
- **Automatic updates.** The installed Windows app and the Linux AppImage download new versions in the
  background and offer *Restart to update*; the portable and macOS builds link to the download page.
- **Image viewer.** Click an image to view it full size; click again to zoom to actual size.
- **Copy as Formatted Text** (`Ctrl+Shift+C`) copies the selection, or the whole document, with
  formatting for Word and email.

### Fixed
- One press of `Alt+←` could go back two documents, because both the menu and the page handled it.
- Images further down a long document now load right away instead of only when scrolled into view.

## [1.0.0] - 2026-10-31

### Added
- First release: a desktop Markdown reader for Windows, with macOS and Linux builds.
- GitHub-flavored Markdown: tables, task lists, strikethrough, autolinks, footnotes, definition
  lists, highlights, sub/superscript, emoji.
- GitHub callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- Safe inline HTML (colors, alignment, `<details>`, images), sanitized with DOMPurify.
- Syntax highlighting for 190+ languages with copy buttons.
- KaTeX math and Mermaid diagrams.
- YAML front matter rendered as a document header card.
- Outline sidebar with scroll tracking and filtering.
- Paper, Sepia and Night themes (or follow the system); Modern/Book typefaces; text size and page
  width controls.
- Live reload on save, find in page, back navigation between linked documents.
- Export to PDF and print.
- `.md` file association, single-instance window handling, recent files, drag and drop.
- Windows NSIS installer and portable `.exe`; CI and tagged-release workflows.
