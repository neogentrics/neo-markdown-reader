---
title: Neo Markdown Reader Roadmap
subtitle: From reader to Markdown workspace
author: Neo Gentrics
date: 2026-10-31
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
| [Ongoing](#ongoing--polish--distribution) | Polish & distribution | ⏭️ Next |

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

## Ongoing — Polish & distribution

| Feature | Size | Details |
|---|:-:|---|
| Code signing | S | Removes the *Windows protected your PC* warning. Needs a paid code-signing certificate; 2.1 makes the builds ready to use one. |

## Open decisions

1. **How long should edit permission last?** ✅ *Decided:* ask the first time, offer *Just this time* / *Always for this file* / *Always for this folder*, defaulting to *Just this time*.
2. **Menu bar visible by default?** ✅ *Decided:* yes, with an option to auto-hide (shipped in 1.1.0).
3. **Which languages may *Run* execute?** ✅ *Decided:* JavaScript and Python only (shipped in 2.0.0). Shell stays off.
4. **Password lock: locked copy or replace the original?** ✅ *Decided:* a locked copy by default, with a checkbox to move the original to the Recycle Bin (shipped in 2.0.0).
