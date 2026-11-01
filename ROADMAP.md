---
title: Neo Markdown Reader Roadmap
subtitle: From reader to Markdown workspace
author: Neo Gentrics
date: 2026-11-01
tags: [roadmap, planning]
---

# Roadmap

Version 1.0 does one job well: it opens a `.md` file and shows it beautifully. This page lists the
planned upgrades, grouped into releases that can each be tested on their own. Anything that changes
your files or runs code is always **opt-in** and asks for permission first.

> [!TIP]
> This file is written in Markdown, so it looks best opened in Neo Markdown Reader itself.

**Legend:** 🙋 requested by the owner · 🛡️ needs a permission step · Size: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more

| Release | Theme | Status |
|---|---|---|
| [v1.0](#v10--the-reader) | The reader | ✅ Released |
| [v1.1](#v11--everyday-comfort) | Everyday comfort | ✅ Released (1.1.0) |
| [v1.2](#v12--create--edit) | Create & edit | ✅ Released (1.2.0) |
| [v1.3](#v13--compare--organize) | Compare & organize | ✅ Released ([1.3.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.3.0)) |
| [v1.4](#v14--publish-beautifully) | Publish beautifully | ✅ Released ([1.4.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.4.0)) |
| [v2.0](#v20--power-features) | Power features | ✅ Released ([2.0.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v2.0.0)) |
| [v2.1](#v21--at-home-on-windows) | At home on Windows | ✅ Released ([2.1.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v2.1.0)) |
| [v2.2](#v22--write-faster) | Write faster | ⏭️ Next |
| [v2.3](#v23--connected-notes) | Connected notes | Planned |
| [v2.4](#v24--read-listen--share) | Read, listen & share | Planned |
| [v3.0](#v30--the-next-major-release) | The next major release | Ideas — to be decided |
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
[1.1.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.1.0)** — the installed app now
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

✅ **Released in [1.2.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.2.0).** Decided: the edit-permission prompt defaults to **Just this time**.

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 File › New | S | Blank document or a template (meeting notes, README, checklist, report). Plain `.txt` files open too and can be saved as `.md`. |
| ✅ 🙋🛡️ Edit mode with a permission step | M | Files always open read-only. Clicking *Edit* asks: *Allow Neo Markdown Reader to edit this file?* — **Just this time** (the default), **Always for this file**, or **Always for this folder**. Permissions can be reviewed and revoked in *Edit → Editing Permissions…*. Files marked read-only by Windows show a lock and stay locked. |
| ✅ Side-by-side editor + live preview | M | Markdown on the left, the formatted page on the right, scrolling together. Formatting toolbar, spell check, undo/redo. |
| ✅ 🛡️ Safe saving | S | Save / Save As, unsaved-changes prompt, a backup of the original before the first save, and a warning instead of overwriting if another program changed the file. |

## v1.3 — Compare & organize

✅ **Released in [1.3.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.3.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ 🙋 Split view & compare | M | Two tabs side by side in one window with optional linked scrolling. *Compare* highlights what changed between two versions — two tabs, a file, or your unsaved edits. |
| ✅ Open Folder | M | Browse every `.md` file in a folder from a sidebar tree. |
| ✅ Quick Open & search across files | M | `Ctrl+K` jumps to any file or heading; *Find in Folder* searches every document. |
| ✅ Bookmarks & highlights | M | Private highlights and notes, stored by the app — never written into the file. |

## v1.4 — Publish beautifully

✅ **Released in [1.4.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v1.4.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ PDF designer | M | Letter, A4, Legal or A5, three margin sizes, a cover page from the front matter (with an optional logo), a contents page with real page numbers, title header and page-number footer, chapters on new pages, PDF bookmarks and document properties. |
| ✅ More export formats | M | Word (`.docx`) with real headings, lists, tables, links, images and pictures of diagrams and equations; a self-contained web page (`.html`) with no scripts; plain text. |
| ✅ Presentation mode | S | Full-screen slides, using `---` as slide breaks (or the main headings), with the front matter as a title slide. |
| ✅ Custom themes | S | Your own accent colour and fonts, or a brand stylesheet (e.g. a Neo Gentrics house style). Exports use them too. |

## v2.0 — Power features

✅ **Released in [2.0.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v2.0.0).**

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

✅ **Released in [2.1.0](https://github.com/neogentrics/neo-markdown-reader/releases/tag/v2.1.0).**

| Feature | Size | Details |
|---|:-:|---|
| ✅ Preview in File Explorer | L | Select a `.md` file in Explorer and see it formatted in the Preview pane, without opening the app. A small Windows add-on installed with the app (not the portable version), built and tested on Windows in the automated builds. Moved here from 2.0. |
| ✅ Accessibility pass | S | Screen-reader labels throughout, WCAG AA contrast in all seven themes, Windows high-contrast support, and full keyboard navigation of tabs, the sidebar and Quick Open — checked automatically with axe in the tests. |
| ✅ More install options | S | A Linux `.deb` package, a Mac build for Intel Macs, and a generator for the `winget` manifests (`winget install NeoGentrics.NeoMarkdownReader` once they're accepted). |
| ✅ Ready for code signing | S | The release builds sign the Windows installer automatically as soon as a code-signing certificate is added to the repository's secrets (buying the certificate is the only step left). |

## v2.2 — Write faster

⏭️ **Next.** Make writing and editing quicker, and make every change easy to undo.

| Feature | Size | Details |
|---|:-:|---|
| 🛡️ Paste & drop images | M | Paste a screenshot or drag a picture into the editor: it's saved next to the document (in an `images` folder) and linked for you. Nothing outside the document's folder is touched. |
| Table editor & paste from spreadsheets | M | Edit a table as a grid (add, move or delete rows and columns, set alignment) and paste cells from Excel, Google Sheets or Word to get a Markdown table. |
| Bring content in | M | Paste from a web page or Word as clean Markdown (headings, lists, links, bold), and open a Word `.docx` as a new Markdown document, with its images. |
| 🛡️ Version history | M | Every save keeps the earlier version. A *History* panel lists them by time; compare any version with the current one (using Compare) and restore it with one click. Stored by the app, never in your folder. |
| 🛡️ Find & replace across a folder | M | Replace text, or a pattern, in many files at once: preview every change, untick the ones you don't want, and undo the whole batch. Only files you've allowed editing are changed, and each is backed up first. |
| Commands from the keyboard & your own shortcuts | S | Type `>` in Quick Open (`Ctrl+K`) to run any menu command by name, and change any keyboard shortcut in Settings. |

## v2.3 — Connected notes

Turn a folder of documents into a small knowledge base.

| Feature | Size | Details |
|---|:-:|---|
| Wiki links | M | Type `[[` to link another document by name (or `[[Name#Heading]]`), with suggestions as you type. Renaming a file offers to update the links to it. Exports turn them into normal links. |
| Backlinks & link map | M | A *Backlinks* panel shows every document that links to this one, with the sentence around each link; a map view draws how the folder's documents connect. |
| Tags | S | Tags from the front matter and `#tags` in the text, with a *Tags* panel that filters the folder. |
| 🛡️ Tasks across a folder & daily notes | M | A *Tasks* panel gathers every `- [ ]` checkbox in the folder, with due dates, sorted by date; ticking one off updates its file (with permission). One click creates today's note from a template. |
| Link checker | S | Finds broken links, missing images and links to headings that no longer exist, across the whole folder. |
| Ask your folder (AI, optional) | M | Ask a question and get an answer drawn from the documents you choose, with links to the passages it used. Uses your own key; locked documents are never sent. |

## v2.4 — Read, listen & share

More ways to take in a document, and more ways to hand it on.

| Feature | Size | Details |
|---|:-:|---|
| Read aloud | M | Reads the document with your computer's built-in voices, highlighting each sentence as it goes; pause, change the speed, skip by heading. Works offline. |
| Comfortable reading | S | Focus mode (dims everything but the paragraph you're reading), a reading progress bar, sections that fold under their headings, and hover previews of footnotes and of links to other documents. |
| More file types | M | Open CSV and TSV files as sortable tables, JSON and YAML formatted, and Jupyter notebooks (`.ipynb`) with their outputs, read-only. |
| Charts from data | M | A `chart` code block, or a table, becomes a bar, line or pie chart in the theme's colours; PDF and Word exports include it. |
| eBooks & slide decks | M | Export an EPUB for e-readers, and presentations as PDF or PowerPoint (`.pptx`). |
| AI writing help (optional) | M | Proofread, rewrite, shorten or translate a selection in the editor; the suggestion appears as a change you accept or reject. |

## v3.0 — The next major release

💡 **Ideas — to be decided** (see [open decision 8](#open-decisions)). Bigger changes, each worth a release of its own.

| Feature | Size | Details |
|---|:-:|---|
| 🛡️ Add-ons | L | Install add-ons for new code-block types, themes and export formats. Each add-on says what it can do, and you approve it before it runs. |
| The app in your language | L | Menus and dialogs translated (Spanish, French and German first), and right-to-left documents (Arabic, Hebrew). |
| Sync between your computers | M | Highlights, notes, bookmarks, history and settings kept in step through a folder you already sync (OneDrive, Dropbox, iCloud). No account needed. |
| Git built in | M | Changed files marked in the Files panel, compare with the last commit, and commit from the app. |
| Shared review | L | Comments that other people can see and answer. It needs a sharing service, so it's an open question whether it's worth it. |

## Ongoing — Polish & distribution

| Feature | Size | Details |
|---|:-:|---|
| Code signing (Windows) | S | Removes the *Windows protected your PC* warning. Needs a paid code-signing certificate; 2.1 makes the builds ready to use one. |
| Signed & notarized Mac app | S | Removes macOS's *cannot be opened because the developer cannot be verified* warning. Needs an Apple Developer membership (yearly fee). |
| Store listings | S | `winget` (submitted after each release), the Microsoft Store, and Flathub for Linux. |
| Keeping dependencies up to date | S | Regular updates and security fixes, starting with the open Dependabot alert. |

## Open decisions

1. **How long should edit permission last?** ✅ *Decided:* ask the first time, offer *Just this time* / *Always for this file* / *Always for this folder*, defaulting to *Just this time*.
2. **Menu bar visible by default?** ✅ *Decided:* yes, with an option to auto-hide (shipped in 1.1.0).
3. **Which languages may *Run* execute?** ✅ *Decided:* JavaScript and Python only (shipped in 2.0.0). Shell stays off.
4. **Password lock: locked copy or replace the original?** ✅ *Decided:* a locked copy by default, with a checkbox to move the original to the Recycle Bin (shipped in 2.0.0).
5. **Where should pasted images go?** *Proposed:* an `images` folder next to the document, changeable per folder.
6. **Wiki links aren't standard Markdown.** Keep them as `[[Name]]` in the file (the same as Obsidian), or write standard links? *Proposed:* `[[Name]]` by default, with a setting to write standard Markdown links instead.
7. **How much version history to keep?** *Proposed:* every save for 30 days, then one a day, up to 1 GB in total, adjustable.
8. **What should 3.0 focus on?** *Proposed:* add-ons and the app in your language first, then sync; shared review only if it's needed.
