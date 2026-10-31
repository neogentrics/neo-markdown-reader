# Changelog

All notable changes to Neo Markdown Reader are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
