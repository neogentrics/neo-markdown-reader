# Changelog

All notable changes to Neo Markdown Reader are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [3.3.0] - 2026-11-03

### Added
- **Your AI, your choice:** AI assist works with **ChatGPT** (OpenAI), **Gemini** (Google), **Mistral** and
  **OpenRouter** as well as Claude, each with your own API key, or with a **model on your own computer**
  through Ollama, LM Studio or any server that speaks the OpenAI format: no key, no internet, and nothing
  leaves your computer. Choose the service in *Edit → AI Assist → AI Assist Settings…*.
  - Summaries, explanations, reports, *Ask About This Folder…* and writing help all work with every service.
  - *Refresh list* reads the models your key can use from the service itself, so new models appear without
    an app update; you can also type a model's name. OpenRouter's list shows each model's price.
  - An optional **quicker model for writing help** (proofread, rewrite, shorten, translate), while summaries,
    reports and folder questions use the main model.
  - Before more than about 50,000 tokens go to a paid service, the app asks first and says how big the
    request is, with its price when the service publishes one.
  - Each service keeps its own key, encrypted by your operating system. The Claude key from earlier versions
    carries over.
  - A server on your own network works over plain `http://`; anywhere else needs `https://`.

### Changed
- The AI panel, the folder question window and writing help name the service that wrote the answer.
- The roadmap adds v3.7 (n8n and webhooks), v3.8 (Notion), v3.9 (home servers: Nextcloud, WebDAV, wikis)
  and v3.10 (WordPress, Ghost and Discord) before 4.0. Feature releases stay 3.x; 4.0 is kept for the
  writing studio.
- The `winget` manifests use the current 1.12 schema, with schema headers, and the package description
  mentions highlights, natural voices and sync. 3.2.0 has been submitted to the Windows Package Manager
  ([microsoft/winget-pkgs#469811](https://github.com/microsoft/winget-pkgs/pull/469811)).
- The roadmap now runs to 4.0: more AI services and private local models (3.3), a Claude connector and
  Claude Code sign-in (3.4), audio export and dictation (3.5), study tools (3.6) and a writing studio (4.0).

## [3.2.0] - 2026-11-03

### Added
- **Natural voices for Read aloud:** ten voices (five female, five male) that sound like a person rather
  than a machine, in English, Spanish, French, German and 27 more languages. Choose *Get natural voices…* in
  the read-aloud bar's voice list: the app says how big they are (about 400 MB) and asks first, then
  downloads them once. After that they work offline, and nothing you read is ever sent anywhere.
  - Each sentence is made on your computer in a separate background process, a sentence or two ahead of
    the one being read, so reading doesn't pause between sentences. A slower computer gets a slightly
    faster setting automatically.
  - The document's language comes from its front matter (`lang:`), or is recognised from its words. A
    language the natural voices don't speak yet is read by your computer's own voice, as before.
  - Your computer's own voices are still in the list, and are still the default. *Remove natural voices…*
    in the same list deletes the download.
  - The voices are Supertonic 3 by Supertone, used under the OpenRAIL-M license. They come from one fixed
    version of Supertone's published model, and every file is checked against its size and SHA-256
    checksum before it's used.

### Changed
- Group headings in drop-down lists are translated too.

## [3.1.0] - 2026-11-03

### Added
- **Sync between computers** (*Edit → Sync Between Computers…*): your highlights, notes, bookmarks, recent
  files, reading positions and settings stay the same on every computer, through a folder you already sync
  with OneDrive, Dropbox, iCloud Drive or Google Drive. No account and no server: your cloud service moves
  the files. Choose the folder once on each computer (the app suggests the cloud folders it finds), and
  each computer's changes reach the others within a minute.
  - Each computer writes only its own file in the sync folder, so the cloud service never makes
    "conflicted copy" files, and every computer keeps the newest version of each highlight, note and
    setting. Removing a highlight or bookmark removes it everywhere.
  - Documents are matched by where they sit inside your cloud folder, so the same file is recognised even
    though its full path differs on each computer. A highlight for a document that hasn't finished
    downloading waits for it.
  - A computer joining a folder that's already in use takes on the settings already there.
  - Never synced: your AI key, editing permissions, version history, the *Allow Running Code Blocks*
    setting, and anything about password-locked documents (their highlights quote the text).

## [3.0.0] - 2026-11-02

### Added
- **The app in your language:** Spanish, French and German, as well as English. It follows your computer's
  language, or choose one in *View → Language*. Menus, buttons, dialogs and messages are translated;
  documents, file names and notes are shown as written.
- **Right-to-left documents:** Arabic, Hebrew, Persian, Urdu and other right-to-left text reads right to
  left. Each block follows its own text, lists, quotes and tables that start in a right-to-left language
  turn as a whole, and `lang: ar` or `dir: rtl` in the front matter turns the whole document. The outline
  and every export keep the direction; e-books read right to left.
- **Add-ons** (*View → Add-ons…*): install `.nmraddon` packages that add code-block types, export formats
  and colour themes. You see what each one adds and approve it first; its code runs in the sealed sandbox
  and what it draws is sanitized. Turn add-ons off or remove them in the same window. A guide for writing
  them is in `docs/addons.md`, with a sample add-on in `samples/addons/neo-extras`.

### Changed
- The header card no longer lists `lang`, `language` or `dir` from the front matter: they set how the
  document is read.
- E-books take their language from the document (`lang:`), or your computer's language.

## [2.4.0] - 2026-11-02

### Added
- **Read aloud** (`Ctrl+Shift+U`): reads the document with your computer's own voices, highlighting each
  sentence. Pause, skip by section, change the speed and the voice; `Esc` stops. Code, equations and
  diagrams are skipped, and only voices on your computer are used.
- **Focus mode** (`F8`): everything but the paragraph you're reading fades back.
- **Folding sections:** fold a section under its heading, or fold them all (`Ctrl+Shift+[`). Going to a
  heading opens its section; exports include everything.
- **Hover previews** of footnotes and of links to other documents (or to a section of one).
- **CSV, TSV, JSON, YAML and Jupyter notebooks** open read-only: CSV as a table you can sort by any column,
  JSON and YAML formatted, notebooks with their saved outputs (nothing is run).
- **Charts from data:** a ```` ```chart ```` block, or a table with `<!-- chart: bar -->` before it, becomes a bar,
  line or pie chart in the theme's colours, included in every export.
- **Export an e-book (EPUB)**, and **slides as PDF or PowerPoint (.pptx)** with editable text.
- **AI writing help** (optional): proofread, rewrite, shorten or translate a selection in the editor. The
  suggestion is shown as a change to accept or reject, and one undo takes it back.

## [2.3.0] - 2026-11-02

### Added
- **Wiki links:** `[[Name]]` links to the document called *Name* anywhere in the open folder;
  `[[Name#Heading]]` goes to a heading and `[[Name|text]]` shows your own text. Links to documents that
  don't exist yet look faded, and clicking one offers to create it.
- **Link suggestions while editing:** type `[[` to pick a document. *Edit → Insert Standard Markdown Links*
  writes `[Name](path.md)` instead.
- **Rename** (`F2`, *File → Rename…*): renames the document and offers to update every `[[link]]` and
  `[link](path)` to it in the folder, backing each changed document up and keeping it in History first.
- **Linked from:** the Outline panel lists the documents that link to the one you're reading.
- **Link map** (`Ctrl+Shift+M`): the folder's documents and the links between them; click one to open it.
- **Tags:** `#tags` and front-matter `tags:` show as chips in the Files panel and filter the files.
- **Tasks** (`Ctrl+Shift+L`): a new sidebar panel with every `- [ ]` item in the folder, overdue first, with
  due dates (`📅 2026-11-20`, `due: 2026-11-20` or `@due(2026-11-20)`). Ticking one off changes the file,
  with permission.
- **Today's note** (`Ctrl+Shift+D`): opens or creates `Daily/YYYY-MM-DD.md` in the folder.
- **Check Links in Folder:** lists links to missing documents, headings, pictures and files.
- **Ask About This Folder** (AI assist, optional): Claude answers a question from the documents you tick,
  with each point linked to the line it came from. Locked documents are never sent.

### Changed
- The sidebar has a sixth panel, **Tasks**.

## [2.2.0] - 2026-11-01

### Added
- **Pictures in the editor:** paste a screenshot or drag a picture into the editor; it's saved in an
  `images` folder next to the document and linked where you dropped it. Existing files are never
  overwritten, and only real PNG, JPEG, GIF, WebP, BMP and AVIF pictures are accepted.
- **Table editor:** *Edit → Edit Table…* (or the table button) edits the table under the cursor as a grid
  (add, move and delete rows and columns, set alignment) or inserts a new one. Tables are written back
  neatly lined up.
- **Paste from spreadsheets, web pages and Word:** cells from Excel or Google Sheets become a Markdown table,
  and formatted text becomes clean Markdown. `Ctrl+Shift+V` pastes plain text.
- **Import Word documents:** *File → Import Word Document…* (or drop a `.docx` on the window) converts it to
  Markdown, with its pictures.
- **Version history:** every save keeps the version it replaces, outside your folder. The **History** panel
  (`Ctrl+Shift+Y`) compares any of them with the current text and restores them. Kept: every version for 30
  days, then one a day, up to 1 GB.
- **Replace in Folder** (`Ctrl+Shift+R`): plain text, whole words or a pattern (regular expression), with a
  preview of every change to untick, a confirmation, backups and History first, and **Undo last replace**.
- **Commands by name:** type `>` in Quick Open (`Ctrl+K`), or *Help → Find a Command…* (`Ctrl+Shift+K`).
- **Your own shortcuts:** *Help → Customize Keyboard Shortcuts…* changes, removes or resets any menu shortcut,
  and explains clashes.

### Changed
- The sidebar has a fifth panel, **History**.

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
