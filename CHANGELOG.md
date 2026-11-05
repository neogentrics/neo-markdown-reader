# Changelog

All notable changes to RT Markdown Reader (Neo Markdown Reader until 3.4.1) are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [3.8.0] - Unreleased

Notion and your Markdown files, working together.

### Added
- **Bring Notion pages in.** *File → Notion → Bring In a Notion Page…* opens a page as Markdown, with its headings, lists, to-dos, tables, code, callouts, toggles and pictures. A database opens as a table. Save it as a file, with Notion's pictures copied beside it, or just read it.
- **Send documents to Notion.** Send a document as a new page under one you choose, or update the page it's linked to. You see what will change first, and only the blocks you changed are sent, so colours, mentions and pictures elsewhere on the page stay as they are. Notion refuses anything that would delete a subpage or database.
- **Keep them in step.** A linked document tells you when its Notion page has changed. *Compare* shows the differences, and *Bring In Changes* puts them in the editor for you to save.
- **Connect with your own key.** A Notion internal integration, shared with the pages you choose, kept encrypted on this computer and sent only to Notion.

### Changed
- *Reopen Closed Tab* moved from the File menu to the Tabs menu, with the same shortcut.

## [3.7.0] - 2026-11-04

### Added
- **Automations** (*File → Automations*): any webhook becomes a command, in the menu and in Quick Open. n8n, Make, Zapier,
  Home Assistant or your own script gets the open document, the selected text or every document in the open folder. The
  answer opens as a new document or shows as a change you accept or reject. The app always shows what will be sent, and
  where, before anything goes. Locked documents are never sent.
- **Your n8n workflows by name:** add your n8n address and API key, and pick from your workflows instead of pasting
  webhook addresses.
- **Let workflows open documents** (*Preferences → Automations*): off until you turn it on. A key-protected address that
  your workflows can call to create, open or add to a document. Every change to a file still asks you first.
  `docs/automations.md` has the details.

### Changed
- **Sync** finds Google Drive on any drive letter, and in mirrored folders too.

## [3.6.3] - 2026-11-04

### Fixed
- **Natural voices start much sooner after you skip, start or resume.** A skip now interrupts the sentence being made
  instead of waiting for it, and a long sentence starts with its opening words while the rest is made.

## [3.6.2] - 2026-11-04

### Added
- **Names for the natural voices:** Clara, Maya, Nora, Sofia and Zoe, and Ethan, Leo, Marcus, Owen and Theo. Your saved
  choice stays the same.
- **Skip by paragraph** in the read-aloud bar, next to skip by section.

### Fixed
- **Long documents in presentation mode:** text ran off the bottom of the slide. A section too long for one slide now
  flows onto as many as it needs, at a readable size, and PDF and PowerPoint slides do the same. Lists and tables are cut
  between their items and rows, tables keep their header row, and later slides name the section they continue.
- The mouse wheel now turns the slides.
- Read aloud's skip buttons went to the wrong place. A heading like "I. The Beginning" counted as two sections, and with
  no section left to go to, skipping jumped to the very end of the document.
- Skipping while read aloud is paused now moves the page or slide to where it will read from.
- Skipping several times quickly no longer scrolls past the sentence being read.

## [3.6.1] - 2026-11-04

### Fixed
- The document's title now sits in the middle of the window, not between the toolbar's buttons.
- Buttons at the bottom of dialogs no longer touch. In the welcome message, *Not now* sits between the other two.
- Your accent colour is now exactly the same on every filled button, including *Open* in themes with dark panels, where
  it was washed out. Words on the panels are still lightened or darkened as far as they need to be read.
- *Save* and *Restart to update* no longer use white text on a pale accent colour.

## [3.6.0] - 2026-11-04

### Added
- **App Link** (*Preferences → Linked Apps*): other Recon Towers apps on this computer can link with this one, and
  documents can be sent between them with *File → Send to Linked App*. You approve each app once, there are no
  accounts, and it stays off until you turn it on. The rules for other apps are in `docs/app-link.md`.
- **Customize Theme** can now change the panel and background colours too. Text on your panels changes to stay
  readable, whatever colour you pick. These stay in the app, so exports don't use them, and High Contrast keeps its own.
  With Glass on, panels stay solid over colours you've chosen, so they can still be read.
- **Flashcards** (*View → Study Flashcards*): `Q:` / `A:` lines and definitions in your documents become cards, with
  spaced repetition that brings each one back when it's due. Study one document or the whole open folder, practise
  everything, or take a multiple-choice quiz. Progress stays on your computer and follows you through Sync, and it
  holds no words from your cards. AI assist can draft cards from a chapter (*Draft Flashcards*), for you to check first.
- **Citations** (*Edit → Insert Citation*): write `[@key]`, and the page shows the citation and builds the reference
  list, in APA, MLA, Chicago, IEEE or Harvard. Sources come from a BibTeX or CSL JSON file, or from Zotero on your
  computer. They carry through to PDF, Word, web page, e-book and plain text exports. The syntax is Pandoc's, so
  documents still work there.
- **Smart search** (*Search by meaning* in the Search panel): find documents by what they mean, in any of about a hundred
  languages, not only by their exact words. *Related documents* appear under the outline. It's a one-time download of
  about 135 MB, and after that everything happens on your computer. Locked documents are never read, and the index
  keeps no words from your documents.

### Changed
- **Paper, Sepia, Mist, Night, Forest and Dusk** now have panels that run from one colour to another, with contrasting
  buttons, like Blue, Red and Yellow. High Contrast stays flat.

### Fixed
- Blue and Red: small text on the brightest part of the panels was a little too faint.
- Your accent colour didn't reach the buttons on the toolbar, tabs and sidebar in themes with coloured panels. It does
  now, lightened or darkened only as much as it takes to be read there.
- Text on buttons in your accent colour now stays readable, whatever colour you pick.

## [3.5.0] - 2026-11-04

### Added
- **Export as audio** (*File → Export → Audio*): a document read by the natural voices into an MP3, or an audiobook
  (`.m4b`) with a chapter for each heading. It runs in the background, with its progress in the corner of the window.
- **Dictation** (`Ctrl+Alt+D`, or the microphone button while editing): speak and the editor types, in the language
  of the document. It works offline with the Whisper model, an 80 MB download the first time you use it.
- **Choose your microphone and speakers** in *Preferences → Reading Aloud*. The speaker choice works with the natural
  voices, because the computer plays its own voices itself.
- **Read aloud in presentation mode:** reading carries on in full-screen slides, marks each sentence and turns the
  slides by itself. Press `R` to start it. Move to another slide and the reading comes with you.
- **A pronunciation list** (*Preferences → Reading Aloud*): teach read aloud how to say names and invented words, for
  every document or for one folder and what's inside it. Audio exports use it too.
- **Blue, Red and Yellow themes,** with panels that run from one colour to another and contrasting buttons.
- **A Glass look** for any theme: panels and the page frosted over the theme's own colours.
- **Colour-safe colours** (*Preferences → Appearance*): for colour blindness, in any theme. Compare uses blue and orange
  with underlines and strikethroughs, and charts and highlights use colours that stay different with protanopia,
  deuteranopia and tritanopia.
- **Fifteen fonts,** including Times New Roman, Georgia and Century, for the page and its headings. Word and PowerPoint
  exports use them too.

### Changed
- **The read-aloud bar can be moved:** drag it anywhere in the window, and it stays there. Double-click it to put it back.

### Fixed
- The read-aloud bar was hard to see, because it used the same colour as the page. It now uses the opposite colours
  in every theme.
- Replace in Folder: a search still waiting from your last keystroke could land on top of the preview or wipe the
  "Replaced" message.

## [3.4.1] - 2026-11-03

### Changed
- **Neo Markdown Reader is now RT Markdown Reader,** part of the Recon Towers suite. Updating keeps your settings,
  API keys, highlights, voices and sync folder where they are. Installed copies update in place. On a Mac, install
  the new version and remove the old one; your API keys may need entering again.
- **Recon Towers owns the app,** and its Dev Department publishes it. The About window, license and installer say so.
- **Shorter menus:** settings moved to Preferences, and document actions moved to *File → This Document*. Everything
  that moved keeps its shortcut, and *Find a Command* (`Ctrl+Shift+K`) still finds it. `F1` now opens the Help Center.

### Added
- **Connect Claude:** Claude Desktop and Claude Code can list and read your open documents, search your open folder
  and see your highlights and notes, with no API key. Turn it on in *Edit → AI Assist → Connect Claude…*, where one
  click adds it to either app. Password-locked documents are never shared, and it works only while the app is open
  and the connector is on.
- **Changes from Claude are yours to approve:** a suggestion appears as a marked-up change to accept or reject.
  Accepting asks for edit permission as usual, with a backup and a History copy.
- **AI assist through Claude Code:** choose *Claude Code (your sign-in, no key)* in AI Assist Settings to use your
  Claude plan. It runs with every tool switched off, so it can only write text back.
- ***File → Open Folder in Claude Code*** opens a terminal in the folder, running Claude Code.
- **A hands-on tutorial** with a practice document, offered when the app starts, including after updating from an
  older version. Pick up where you left off, or take it again from *Help → Tutorial*.
- **The Help Center** (`F1`): guides for the whole app, a home page with the tutorial, quick links and common
  questions, search, and buttons that take you straight to the setting a guide describes. The guides are in English
  for now.
- **Preferences** (`Ctrl+,`): every setting in one window, including the voice list, so natural voices are easy to find.

### Fixed
- **Update Links after a rename:** if you took more than a moment to answer the question, links could be left
  unchanged with no warning, because the folder list refreshed while the question was open. Every link is now
  updated, and a document that can't be changed (a read-only file, for example) is reported instead of skipped silently.

### Changed
- **Restart to update** now installs without showing the installer, then reopens the app. An install for everyone
  on the computer still gets one Windows permission prompt.

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

- **A proper About window** (*Help → About Neo Markdown Reader*): what the app is, its version, links to its
  [website](https://recontowers.com/projects/neo-markdown-reader/), this version's release notes, reporting a
  problem, the source code, the license and the open-source notices, and *Copy Version Details* (app,
  Electron, Chromium, Node and system versions) for bug reports.

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
