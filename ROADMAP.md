---
title: RT Markdown Reader Roadmap
subtitle: From reader to Markdown workspace
author: Recon Towers Dev Department
date: 2026-11-03
tags: [roadmap, planning]
---

# Roadmap

Version 1.0 does one job well: it opens a `.md` file and shows it beautifully. This page lists the
planned upgrades, grouped into releases that can each be tested on their own. Anything that changes
your files or runs code is always **opt-in** and asks for permission first.

> [!TIP]
> This file is written in Markdown, so it looks best opened in RT Markdown Reader itself.

**Legend:** 🙋 requested by the owner · 🛡️ needs a permission step · Size: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more

**Version numbers:** new features and connections are 3.x releases (3.9 is followed by 3.10, 3.11…). The next
major version, 4.0, is kept for a change to what the app is: the writing studio.

| Release | Theme | Status |
|---|---|---|
| [v1.0](#v10--the-reader) | The reader | ✅ Released |
| [v1.1](#v11--everyday-comfort) | Everyday comfort | ✅ Released (1.1.0) |
| [v1.2](#v12--create--edit) | Create & edit | ✅ Released (1.2.0) |
| [v1.3](#v13--compare--organize) | Compare & organize | ✅ Released ([1.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.3.0)) |
| [v1.4](#v14--publish-beautifully) | Publish beautifully | ✅ Released ([1.4.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.4.0)) |
| [v2.0](#v20--power-features) | Power features | ✅ Released ([2.0.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.0.0)) |
| [v2.1](#v21--at-home-on-windows) | At home on Windows | ✅ Released ([2.1.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.1.0)) |
| [v2.2](#v22--write-faster) | Write faster | ✅ Released ([2.2.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.2.0)) |
| [v2.3](#v23--connected-notes) | Connected notes | ✅ Released ([2.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.3.0)) |
| [v2.4](#v24--read-listen--share) | Read, listen & share | ✅ Released ([2.4.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.4.0)) |
| [v3.0](#v30--make-it-yours) | Make it yours | ✅ Released ([3.0.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.0.0)) |
| [v3.1](#v31--across-your-computers) | Across your computers | ✅ Released ([3.1.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.1.0)) |
| [v3.2](#v32--natural-voices) | Natural voices | ✅ Released ([3.2.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.2.0)) |
| [v3.3](#v33--your-ai-your-choice) | Your AI, your choice | ✅ Released ([3.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.3.0)) |
| [v3.4](#v34--claude-connected) | Claude, connected, and a first-run tutorial | ✅ Released ([3.4.1](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.4.1)) |
| [v3.5](#v35--listen--speak) | Listen & speak | ✅ Released ([3.5.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.5.0)) |
| [v3.6](#v36--study--research) | Study & research | 🔨 In progress |
| [v3.7](#v37--automate-with-n8n) | Automate with n8n | Planned |
| [v3.8](#v38--notion) | Notion | Planned |
| [v3.9](#v39--your-home-server) | Your home server | Planned |
| [v3.10](#v310--publish-anywhere) | Publish anywhere | Planned |
| [v4.0](#v40--writing-studio) | Writing studio | Planned |
| [Later](#later--only-if-needed) | Only if needed | Ideas |
| [Ongoing](#ongoing--polish--distribution) | Polish & distribution | Ongoing |

## v1.0 — The reader

- [x] Polished rendering: GitHub-flavored Markdown, callouts, footnotes, tables, task lists
- [x] Syntax-highlighted code, KaTeX math, Mermaid diagrams, front-matter header card
- [x] Outline sidebar, Paper / Sepia / Night themes, typeface, size and width controls
- [x] Live reload, find in page, links between documents with Back
- [x] Export to PDF, print, drag & drop, recent files, `.md` file association
- [x] Windows installer + portable `.exe`, macOS `.dmg`, Linux AppImage

## v1.1 — Everyday comfort

Make it feel like a normal Windows program. **Released in
[1.1.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.1.0)** — the installed app now
updates itself from here on.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Always-visible menu bar | S | File, Edit, View, Help shown by default; *View → Always Show Menu Bar* toggles auto-hide. Adds Close Tab, Reopen Closed Tab, Next/Previous Tab, Copy as Formatted Text, Check for Updates. |
| ✅ 🙋 Tabs | M | Every file opens in a tab. `Ctrl+Tab` to switch, `Ctrl+W` or middle-click to close, drag to reorder. Double-clicking a `.md` file adds a tab to the open window. |
| ✅ 🙋 Tab right-click menu & separate windows | M | *Move to New Window*, Duplicate, Close Others, Close to the Right, Copy Path, Show in Folder. Drag a tab out of the window to split it off. |
| ✅ Restore last session | S | Reopens your windows and tabs, each scrolled back to where you stopped reading. |
| ✅ Automatic updates | M | The installed app downloads new versions and offers *Restart to update*; the portable version shows a download link. |
| ✅ Image viewer & rich copy | S | Click an image to view it full size with zoom. *Copy as Formatted Text* pastes into Word or email with styling. |

## v1.2 — Create & edit

✅ **Released in [1.2.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.2.0).** Decided: the edit-permission prompt defaults to **Just this time**.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 File › New | S | Blank document or a template (meeting notes, README, checklist, report). Plain `.txt` files open too and can be saved as `.md`. |
| ✅ 🙋🛡️ Edit mode with a permission step | M | Files always open read-only. Clicking *Edit* asks: *Allow RT Markdown Reader to edit this file?* — **Just this time** (the default), **Always for this file**, or **Always for this folder**. Permissions can be reviewed and revoked in *Edit → Editing Permissions…*. Files marked read-only by Windows show a lock and stay locked. |
| ✅ Side-by-side editor + live preview | M | Markdown on the left, the formatted page on the right, scrolling together. Formatting toolbar, spell check, undo/redo. |
| ✅ 🛡️ Safe saving | S | Save / Save As, unsaved-changes prompt, a backup of the original before the first save, and a warning instead of overwriting if another program changed the file. |

## v1.3 — Compare & organize

✅ **Released in [1.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.3.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Split view & compare | M | Two tabs side by side in one window with optional linked scrolling. *Compare* highlights what changed between two versions — two tabs, a file, or your unsaved edits. |
| ✅ Open Folder | M | Browse every `.md` file in a folder from a sidebar tree. |
| ✅ Quick Open & search across files | M | `Ctrl+K` jumps to any file or heading; *Find in Folder* searches every document. |
| ✅ Bookmarks & highlights | M | Private highlights and notes, stored by the app — never written into the file. |

## v1.4 — Publish beautifully

✅ **Released in [1.4.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v1.4.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ PDF designer | M | Letter, A4, Legal or A5, three margin sizes, a cover page from the front matter (with an optional logo), a contents page with real page numbers, title header and page-number footer, chapters on new pages, PDF bookmarks and document properties. |
| ✅ More export formats | M | Word (`.docx`) with real headings, lists, tables, links, images and pictures of diagrams and equations; a self-contained web page (`.html`) with no scripts; plain text. |
| ✅ Presentation mode | S | Full-screen slides, using `---` as slide breaks (or the main headings), with the front matter as a title slide. |
| ✅ Custom themes | S | Your own accent colour and fonts, or a brand stylesheet (e.g. a Recon Towers house style). Exports use them too. |

## v2.0 — Power features

✅ **Released in [2.0.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.0.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋🛡️ Run code blocks | L | A ▶ Run button on JavaScript and Python code blocks. Code runs in a sealed sandbox (its own hidden window and session; every request outside the sandbox is refused) with **no access** to your files, network or settings, and is stopped after 10 s (Python 30 s). Nothing runs automatically: each run shows the code and asks first. Can be switched off entirely. |
| ✅ 🙋 Password-locked documents | L | *Protect with Password* saves an AES-256-GCM encrypted copy (`.mdlock`, scrypt key) that only this app can open with the password. Lock Now, editing with encrypted saves, and Save an Unlocked Copy. Never searched, highlighted or sent to AI assist. |
| ✅ 🙋 Four more colour themes | S | **Mist** (soft blue-grey), **Forest** (deep green, dark), **Dusk** (plum, dark) and **High Contrast** (for readability and accessibility), alongside Paper, Sepia and Night. They work with your own accent colour and in exports. |
| ✅ AI assist (optional) | M | Summarize, explain a selection, or turn notes into a report with Claude (Opus 5.5 by default). Off by default; uses your own API key, stored encrypted by the operating system, and only sends what you choose. |

> [!WARNING]
> **Running code is the riskiest feature on this list.** A downloaded `.md` file could contain
> harmful code. Shell, PowerShell and batch commands cannot be sandboxed, so they are never run.

> [!NOTE]
> Markdown has no built-in password feature, so locking is done with an app-specific encrypted file.
> **A forgotten password cannot be recovered** — that is what makes the lock real.

## v2.1 — At home on Windows

✅ **Released in [2.1.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.1.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ Preview in File Explorer | L | Select a `.md` file in Explorer and see it formatted in the Preview pane, without opening the app. A small Windows add-on installed with the app (not the portable version), built and tested on Windows in the automated builds. Moved here from 2.0. |
| ✅ Accessibility pass | S | Screen-reader labels throughout, WCAG AA contrast in all seven themes, Windows high-contrast support, and full keyboard navigation of tabs, the sidebar and Quick Open — checked automatically with axe in the tests. |
| ✅ More install options | S | A Linux `.deb` package, a Mac build for Intel Macs, and a generator for the `winget` manifests (`winget install NeoGentrics.NeoMarkdownReader` once they're accepted). |
| ✅ Ready for code signing | S | The release builds sign the Windows installer automatically as soon as a code-signing certificate is added to the repository's secrets (buying the certificate is the only step left). |

## v2.2 — Write faster

✅ **Released in [2.2.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.2.0).** Make writing and editing quicker, and make every change easy to undo.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🛡️ Paste & drop images | M | Paste a screenshot or drag a picture into the editor: it's saved next to the document (in an `images` folder) and linked for you. Nothing outside the document's folder is touched. |
| ✅ Table editor & paste from spreadsheets | M | Edit a table as a grid (add, move or delete rows and columns, set alignment) and paste cells from Excel, Google Sheets or Word to get a Markdown table. |
| ✅ Bring content in | M | Paste from a web page or Word as clean Markdown (headings, lists, links, bold), and open a Word `.docx` as a new Markdown document, with its images. |
| ✅ 🛡️ Version history | M | Every save keeps the earlier version. A *History* panel lists them by time; compare any version with the current one (using Compare) and restore it with one click. Stored by the app, never in your folder. |
| ✅ 🛡️ Find & replace across a folder | M | Replace text, or a pattern, in many files at once: preview every change, untick the ones you don't want, and undo the whole batch. Only files you've allowed editing are changed, and each is backed up first. |
| ✅ Commands from the keyboard & your own shortcuts | S | Type `>` in Quick Open (`Ctrl+K`) to run any menu command by name, and change any keyboard shortcut in Settings. |

## v2.3 — Connected notes

✅ **Released in [2.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.3.0).** Turn a folder of documents into a small knowledge base.

| Feature | Size | Details |
|---|:-:|---|
| ✅ Wiki links | M | Type `[[` to link another document by name (or `[[Name#Heading]]`, `[[Name\|your text]]`), with suggestions as you type. Clicking a link to a document that doesn't exist yet offers to create it. Renaming a file (`F2`) offers to update every link to it. A setting writes standard Markdown links instead. |
| ✅ Backlinks & link map | M | *Linked from*, under the outline, shows every document that links to this one, with the line around each link; the link map draws how the folder's documents connect. |
| ✅ Tags | S | Tags from the front matter and `#tags` in the text, shown as chips in the *Files* panel that filter the folder. |
| ✅ 🛡️ Tasks across a folder & daily notes | M | A *Tasks* panel gathers every `- [ ]` checkbox in the folder, with due dates, sorted by date; ticking one off updates its file (with permission). One click creates today's note from a template. |
| ✅ Link checker | S | Finds broken links, missing images and links to headings that no longer exist, across the whole folder. |
| ✅ Ask your folder (AI, optional) | M | Ask a question and get an answer drawn from the documents you choose, with links to the passages it used. Uses your own key; locked documents are never sent. |

## v2.4 — Read, listen & share

✅ **Released in [2.4.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v2.4.0).** More ways to take in a document, and more ways to hand it on.

| Feature | Size | Details |
|---|:-:|---|
| ✅ Read aloud | M | Reads the document with your computer's built-in voices, highlighting each sentence as it goes; pause, change the speed, skip by heading. Works offline. |
| ✅ Comfortable reading | S | Focus mode (dims everything but the paragraph you're reading), sections that fold under their headings, and hover previews of footnotes and of links to other documents. (The reading progress bar is already there.) |
| ✅ More file types | M | Open CSV and TSV files as sortable tables, JSON and YAML formatted, and Jupyter notebooks (`.ipynb`) with their outputs, read-only. |
| ✅ Charts from data | M | A `chart` code block, or a table, becomes a bar, line or pie chart in the theme's colours; PDF and Word exports include it. |
| ✅ eBooks & slide decks | M | Export an EPUB for e-readers, and presentations as PDF or PowerPoint (`.pptx`). |
| ✅ AI writing help (optional) | M | Proofread, rewrite, shorten or translate a selection in the editor; the suggestion appears as a change you accept or reject. |

## v3.0 — Make it yours

✅ **Released in [3.0.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.0.0).** Add-ons you approve, the app in your language, and right-to-left documents (decision 8).

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🛡️ Add-ons | L | Install add-ons for new code-block types, themes and export formats. Each add-on says what it can do, and you approve it before it's installed; its code runs in the sealed sandbox. A guide for writing them is in [docs/addons.md](docs/addons.md). |
| ✅ The app in your language | L | Menus, dialogs and messages translated into Spanish, French and German, and right-to-left documents (Arabic, Hebrew, Persian, Urdu…). |

## v3.1 — Across your computers

✅ **Released in [3.1.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.1.0).** Your reading life, the same on every computer, without an account.

| Feature | Size | Details |
|---|:-:|---|
| ✅ Sync between your computers | M | Highlights, notes, bookmarks, recent files, reading positions and settings kept in step through a folder you already sync (OneDrive, Dropbox, iCloud Drive, Google Drive). No account needed. Version history stays on each computer: it can be up to 1 GB. |

## v3.2 — Natural voices

✅ **Released in [3.2.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.2.0)** (decision 9). Read aloud in a voice that sounds like a person, not a machine.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Natural voices, offline | M | Natural-sounding voices that run on your computer, with no internet and nothing sent anywhere. Downloaded once, when you first choose one (the app asks first), so the installer stays small. Your computer's own voices stay available, and still read languages the natural voices don't speak yet. |

## v3.3 — Your AI, your choice

✅ **Released in [3.3.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.3.0)** (decision 10). AI assist works with the service you already pay for, or with none at all.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 More AI services | M | Choose Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), Mistral or OpenRouter (hundreds of models with one key), each with your own API key, stored encrypted by the operating system. Every AI feature (summaries, *Ask your folder*, writing help) works with whichever one you pick. |
| ✅ 🙋 Private AI on your computer | M | Use a model running on your own computer through Ollama or LM Studio, or any OpenAI-compatible server. No key, no internet, and nothing leaves your computer. |
| ✅ AI settings per task | S | A quicker model for proofreading, rewriting and translating, and the main one for summaries, reports and folder questions. Before more than about 50,000 tokens go to a paid service, the app asks, with the request's size and its price when the service publishes one (OpenRouter does). |

## v3.4 — Claude, connected

✅ **Released in [3.4.1](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.4.1)** (decision 11), numbered that way because the fixes below went out in the same release. The app also took its Recon Towers name here: RT Markdown Reader. 🙋 Work with Claude through the Claude apps you already sign in to, with no API key needed.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋🛡️ Connect Claude to your documents | L | A built-in connector (an MCP server) lets Claude Desktop and Claude Code list your open documents, read them, search your folder, and see your highlights and notes. Edits Claude suggests go through the same permission prompt as yours and appear as changes you accept or reject. Locked documents are never shared. It stays off until you turn it on; one click adds it to Claude Desktop or Claude Code. |
| ✅ 🙋 Use your Claude Code sign-in | M | If Claude Code is installed and signed in, AI assist can run through it instead of an API key, using your Claude plan. |
| ✅ Open in Claude Code | S | *File → Open Folder in Claude Code* starts a Claude Code session in the document's folder. |
| ✅ 🙋 First-run tutorial | L | A hands-on tour that walks you through the app with a practice document: reading, themes, editing, folders, links, listening, exporting and sync. It starts the first time the app opens. People updating from an older version get it too, because the app checks whether the tutorial has been finished. It can be skipped, resumed, and replayed from *Help*. |
| ✅ 🙋 Help Center | M | `F1` opens the app's own guide: a home page with the tutorial, quick links and common questions, plus searchable guides that take you straight to the setting. The tutorial doesn't try AI live, so a guide shows how to connect each service, with a picture of the settings. |
| ✅ 🙋 Preferences and shorter menus | M | Every setting moves to one Preferences window, including the voice list. Anything moved keeps its shortcut and can still be found by name. |

**Fixes in the same release:**

- [x] 🙋 *Update Links* after a rename silently changed nothing if you took more than a moment to answer. It now updates every link, and tells you if a document couldn't be changed.
- [x] 🙋 *Restart to update* installs without showing the installer. Installs for everyone on the computer still get one Windows permission prompt (decision 14).

## v3.5 — Listen & speak

✅ **Released in [3.5.0](https://github.com/neogentrics/rt-markdown-reader/releases/tag/v3.5.0).** More out of the natural voices, a voice of your own for writing, and more ways to make the app look right for you.

| Feature | Size | Details |
|---|:-:|---|
| ✅ Export as audio | M | Turn a document into an MP3, or an audiobook (`.m4b`) with a chapter for each heading, read by the natural voices. Offline. |
| ✅ Pronunciation list | S | Teach the voices how to say names and invented words, with a list for every document and one for any folder. It's used for reading aloud and for audio exports. |
| ✅ Dictation | M | Speak and the editor types, using an offline speech-recognition model (Whisper, about 80 MB) that's downloaded once, when you ask. Nothing is sent anywhere. |
| ✅ 🙋 Choose your microphone | S | Pick the input device for dictation in *Preferences → Reading Aloud*. |
| ✅ 🙋 Choose where read aloud plays | S | Pick the speakers or headset in *Preferences → Reading Aloud*. This works with the natural voices, which the app plays itself. The computer's own voices are played by the system, so they stay on its default device. |
| ✅ 🙋 Read aloud in presentation mode | M | Reading carries on in full-screen slides, shows the sentence being read, and moves to the next slide when the reading gets there. |
| ✅ 🙋 A read-aloud bar you can move | S | Drag the bar anywhere in the window, and it stays where you left it. |
| ✅ 🙋 Blue, red and yellow themes | S | Three new themes with real contrast: panels that run from one colour to another, gold or navy buttons, and a clean page to read on. |
| ✅ 🙋 Glass look | S | Any theme can be frosted: its panels and page turn to glass over its own colours. It's left out of High Contrast, and of printing and exports, and it steps aside if your computer is set for less transparency. |
| ✅ 🙋 Colour-safe colours | S | An option for any theme. Compare, charts and highlights use colours that stay different with protanopia, deuteranopia and tritanopia, and changes get underlines and strikethroughs. |
| ✅ 🙋 More fonts | S | Fifteen to choose from, including Times New Roman, Georgia and Century, for the page and its headings. The nearest match is used on a computer without one. Word and PowerPoint exports use it too. |

**Fixes in the same release:**

- [x] 🙋 The read-aloud bar is hard to see, because it uses the same colour as the page. It gets a contrasting colour in every theme.

## v3.6 — Study & research

🔨 **In progress.** For coursework, research and reference notes, with more colour for the themes that came before 3.5.

| Feature | Size | Details |
|---|:-:|---|
| Smart search | M | Find documents by what they mean, not only by their exact words, with an index built and kept on your computer. *Related documents* appear under the outline. |
| Citations & bibliography | M | Insert citations from a BibTeX file or a Zotero library. The bibliography is formatted (APA, MLA, Chicago and more) on the page and in PDF and Word exports. |
| ✅ Flashcards & quizzes | M | Turn definitions, or `Q:` / `A:` lines, into flashcards with spaced repetition. AI (optional) can draft questions from a chapter. |
| ✅ 🙋 Colour for the older themes | S | The themes from before 3.5 get what Blue, Red and Yellow have: panels that run from one colour to another, and contrasting buttons. High Contrast stays flat, because plain contrast is the point of it. |
| ✅ 🙋 More colours in Customize Theme | S | Pick the panel and background colours as well as the button colour. Text on the panels changes to stay readable. |
| ✅ 🙋 Link with other Recon Towers apps | M | Apps on the same computer find each other, you approve the link once, and documents can be sent across, with no accounts. The rules are published in `docs/app-link.md`, so StoryTracker can be built to them. Pairing with a copy on another computer, by a one-time code, comes with StoryTracker's sync. |

## v3.7 — Automate with n8n

🙋 Your own automations, run on your documents. n8n and similar tools will never know about this app, so the
app learns to talk to them (decision 12).

| Feature | Size | Details |
|---|:-:|---|
| 🙋🛡️ Run n8n workflows | M | Pick a workflow and send it the open document, the selection, or documents from the open folder. What it answers opens as a new document or appears as a change you accept or reject. With your n8n API key, the list shows your workflows by name; the app always shows what will be sent before it goes. |
| 🛡️ Your own actions | S | Any webhook (n8n, Make, Zapier, Home Assistant, or your own script) becomes a command in the menu and in `Ctrl+K`, with its own name and what it receives. |
| 🛡️ Let workflows open documents | M | Off until you turn it on: an address on this computer that your workflows can call to open, create or add to a document, protected by a key only you have. Every change still goes through the edit-permission prompt. |

## v3.8 — Notion

🙋 Notion and your Markdown files, working together (decision 13).

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Bring Notion pages in | M | Open a Notion page as Markdown, with its headings, lists, to-dos, tables, code, callouts and pictures; a database opens as a table. Save it as a `.md` file, or keep it linked. |
| 🙋🛡️ Send documents to Notion | M | Send a document to a Notion page you choose: as a new page, or to update the linked one. Shows what will change before anything is replaced. |
| Keep them in step | M | A linked document shows when its Notion page has changed, and *Compare* shows the differences before you bring them in. |

## v3.9 — Your home server

🙋 Documents and publishing on servers you run yourself.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Nextcloud & WebDAV folders | M | Open a folder on Nextcloud, ownCloud or any WebDAV server like a folder on your computer: browse, search, read, and (with permission) edit and save back. |
| 🙋🛡️ Publish to your wiki | M | Send a document, or a whole folder, to BookStack, Wiki.js or Outline as pages, with pictures, and update them later. |
| Home server presets | S | One place for your servers' addresses and keys (encrypted like AI keys), shared by n8n, wikis, WebDAV and local AI models, with a *Test connection* button. |

## v3.10 — Publish anywhere

Send finished writing where people will read it.

| Feature | Size | Details |
|---|:-:|---|
| 🛡️ WordPress & Ghost drafts | M | Send a document as a draft post, with its title, tags, featured picture and pictures, to WordPress (including a self-hosted site) or Ghost. You publish it from there. |
| 🛡️ Share to Discord | S | Post a document, or a summary of it, to a Discord channel through its webhook. |
| Publishing history | S | Each document remembers where it was sent and when, with links back to it. |

## v4.0 — Writing studio

From a folder of chapters to a finished book or website.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Book projects | L | A project that puts a folder of chapters in order, with front and back matter and word-count goals per chapter and per day. One click exports the whole book as an EPUB, a print-ready PDF (trim sizes such as 6×9 with mirrored margins) and a Word file. |
| Git built in | M | Moved from *Later*. Changed files are marked in the Files panel; compare with the last commit, and commit, from the app. |
| Publish a folder as a website | M | A static site with navigation, search and your theme, ready for GitHub Pages or any web host. |
| Add-on gallery | M | Browse add-ons and install them from inside the app, each one still approved by you. |

## Later — only if needed

💡 Ideas kept for later, if people ask for them.

| Feature | Size | Details |
|---|:-:|---|
| Shared review | L | Comments that other people can see and answer. It needs a sharing service, so it's an open question whether it's worth it. |
| Phone companion | L | Read, highlight and listen on a phone, kept in step through the same sync folder. |
| Writing together live | L | Several people editing one document at the same time. Like shared review, it needs a service in the middle. |

## Ongoing — Polish & distribution

| Feature | Size | Details |
|---|:-:|---|
| Code signing (Windows) | S | Removes the *Windows protected your PC* warning. Needs a paid code-signing certificate; 2.1 makes the builds ready to use one. |
| Signed & notarized Mac app | S | Removes macOS's *cannot be opened because the developer cannot be verified* warning. Needs an Apple Developer membership (yearly fee). |
| 🔨 Store listings | S | `winget`: 3.2.0 was submitted on 3 November 2026 ([microsoft/winget-pkgs#469811](https://github.com/microsoft/winget-pkgs/pull/469811)) and is waiting for Microsoft's review; each later release is submitted the same way. Then the Microsoft Store and Flathub for Linux. |
| Keeping dependencies up to date | S | Regular updates and security fixes, starting with the open Dependabot alert. |

## Open decisions

1. **How long should edit permission last?** ✅ *Decided:* ask the first time, offer *Just this time* / *Always for this file* / *Always for this folder*, defaulting to *Just this time*.
2. **Menu bar visible by default?** ✅ *Decided:* yes, with an option to auto-hide (shipped in 1.1.0).
3. **Which languages may *Run* execute?** ✅ *Decided:* JavaScript and Python only (shipped in 2.0.0). Shell stays off.
4. **Password lock: locked copy or replace the original?** ✅ *Decided:* a locked copy by default, with a checkbox to move the original to the Recycle Bin (shipped in 2.0.0).
5. **Where should pasted images go?** ✅ *Decided:* an `images` folder next to the document (shipped in 2.2.0).
6. **Wiki links aren't standard Markdown.** ✅ *Decided:* `[[Name]]` by default (the same as Obsidian), with *Edit → Insert Standard Markdown Links* to write `[Name](path.md)` instead (shipped in 2.3.0).
7. **How much version history to keep?** ✅ *Decided:* every save for 30 days, then one a day, up to 1 GB in total (shipped in 2.2.0).
8. **What should 3.0 focus on?** ✅ *Decided:* add-ons and the app in your language (3.0), then sync (3.1); Git and shared review only if they're needed.
9. **Natural voices: on the computer, or a cloud service?** The voices Microsoft Edge reads with come from an online service only Edge can use. The choices were neural voices that run offline on your computer, Microsoft's Azure voices with your own key, or reaching Edge's service unofficially. ✅ *Decided:* offline voices that run on your computer — free, private, and working without internet (3.2).
10. **Which AI services come first?** ✅ *Decided:* all of them in 3.3: Claude, OpenAI, Gemini, Mistral, OpenRouter, and local models (Ollama, LM Studio, or any OpenAI-compatible server). The model lists come from each service, so new models appear without an app update.
11. **Signing in with a Claude account.** Anthropic doesn't currently offer a "Sign in with Claude" that lets other apps use a Claude plan. ✅ *Decided:* 3.4 goes through the Claude apps instead: the connector lets Claude use the reader, and Claude Code lets the reader use Claude. If Anthropic adds a sign-in for apps, it can replace the Claude Code step.
12. **How should the app talk to n8n?** *Proposed:* through workflow webhooks, which every n8n setup has (self-hosted or n8n Cloud); an n8n API key is optional, only to list workflows by name. The app never runs a workflow without showing what it will send.
13. **How should the app sign in to Notion?** *Proposed:* with a Notion *internal integration* token that you create in Notion and share with the pages you choose. Notion's full sign-in (OAuth) needs a web server in the middle, which this app doesn't have.
14. **Updating an install for everyone on the computer.** Those files need administrator rights to replace. Running the whole app as administrator would remove the prompt, but a document viewer shouldn't run with those rights, because every file it opens would be handled with full control of the computer. *Proposed:* keep the single Windows prompt for now; the Recon Towers app store can later bring a small background updater that asks once, at install.
