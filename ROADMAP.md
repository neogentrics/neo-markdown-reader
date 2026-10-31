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
| [v1.1](#v11--everyday-comfort) | Everyday comfort | 🚧 In progress |
| [v1.2](#v12--create--edit) | Create & edit | Planned |
| [v1.3](#v13--compare--organize) | Compare & organize | Planned |
| [v1.4](#v14--publish-beautifully) | Publish beautifully | Planned |
| [v2.0](#v20--power-features) | Power features | Planned |
| [Ongoing](#ongoing--polish--distribution) | Polish & distribution | Planned |

## v1.0 — The reader

- [x] Polished rendering: GitHub-flavored Markdown, callouts, footnotes, tables, task lists
- [x] Syntax-highlighted code, KaTeX math, Mermaid diagrams, front-matter header card
- [x] Outline sidebar, Paper / Sepia / Night themes, typeface, size and width controls
- [x] Live reload, find in page, links between documents with Back
- [x] Export to PDF, print, drag & drop, recent files, `.md` file association
- [x] Windows installer + portable `.exe`, macOS `.dmg`, Linux AppImage

## v1.1 — Everyday comfort

Make it feel like a normal Windows program.

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Always-visible menu bar | S | File, Edit, View, Help shown by default; *View → Always Show Menu Bar* toggles auto-hide. Adds Close Tab, Reopen Closed Tab, Next/Previous Tab, Copy as Formatted Text, Check for Updates. |
| 🙋 Tabs | M | Every file opens in a tab. `Ctrl+Tab` to switch, `Ctrl+W` or middle-click to close, drag to reorder. Double-clicking a `.md` file adds a tab to the open window. |
| 🙋 Tab right-click menu & separate windows | M | *Move to New Window*, Duplicate, Close Others, Close to the Right, Copy Path, Show in Folder. Drag a tab out of the window to split it off. |
| Restore last session | S | Reopens your windows and tabs, each scrolled back to where you stopped reading. |
| Automatic updates | M | The installed app downloads new versions and offers *Restart to update*; the portable version shows a download link. |
| Image viewer & rich copy | S | Click an image to view it full size with zoom. *Copy as Formatted Text* pastes into Word or email with styling. |

## v1.2 — Create & edit

| Feature | Size | Details |
|---|:-:|---|
| 🙋 File › New | S | Blank document or a template (meeting notes, README, checklist, report). Plain `.txt` files open too and can be saved as `.md`. |
| 🙋🛡️ Edit mode with a permission step | M | Files always open read-only. Clicking *Edit* asks: *Allow Neo Markdown Reader to edit this file?* — **Just this time**, **Always for this file**, or **Always for this folder**. Permissions can be reviewed and revoked in Settings. Files marked read-only by Windows show a lock and stay locked. |
| Side-by-side editor + live preview | M | Markdown on the left, the formatted page on the right, scrolling together. Formatting toolbar, spell check, undo/redo. |
| 🛡️ Safe saving | S | Save / Save As, unsaved-changes prompt, a backup of the original before the first save, and a warning instead of overwriting if another program changed the file. |

## v1.3 — Compare & organize

| Feature | Size | Details |
|---|:-:|---|
| 🙋 Split view & compare | M | Two tabs side by side in one window with optional linked scrolling. *Compare* highlights what changed between two versions. |
| Open Folder | M | Browse every `.md` file in a folder from a sidebar tree. |
| Quick Open & search across files | M | `Ctrl+K` jumps to any file or heading; *Find in Folder* searches every document. |
| Bookmarks & highlights | M | Private highlights and notes, stored by the app — never written into the file. |

## v1.4 — Publish beautifully

| Feature | Size | Details |
|---|:-:|---|
| PDF designer | M | Letter or A4, margins, cover page from front matter, table-of-contents page, headers and footers with page numbers. |
| More export formats | M | Word (`.docx`), self-contained web page (`.html`), plain text. |
| Presentation mode | S | Full-screen slides, using `---` as slide breaks. |
| Custom themes | S | Your own accent color and fonts, or a brand stylesheet (e.g. a Neo Gentrics house style). |

## v2.0 — Power features

| Feature | Size | Details |
|---|:-:|---|
| 🙋🛡️ Run code blocks | L | A ▶ Run button on code blocks. JavaScript and Python (via Pyodide) run in a sealed sandbox with **no access** to your files, network or settings. Nothing runs automatically: each run shows the code and asks first. Can be switched off entirely. |
| 🙋 Password-locked documents | L | *Protect with password* saves an AES-256 encrypted copy that only this app can open with the password. |
| Preview in File Explorer | L | See a formatted preview of a `.md` file in Explorer's Preview pane. |
| AI assist (optional) | M | Summarize, explain, or turn notes into a clean report with Claude. Off by default; uses your own API key and only sends what you choose. |

> [!WARNING]
> **Running code is the riskiest feature on this list.** A downloaded `.md` file could contain
> harmful code. Shell, PowerShell and batch commands cannot be sandboxed — they will stay off unless
> you explicitly enable them behind a separate warning.

> [!NOTE]
> Markdown has no built-in password feature, so locking is done with an app-specific encrypted file.
> **A forgotten password cannot be recovered** — that is what makes the lock real.

## Ongoing — Polish & distribution

| Feature | Size | Details |
|---|:-:|---|
| Code signing | S | Removes the *Windows protected your PC* warning. Needs a paid code-signing certificate. |
| More install options | S | `winget install NeoMarkdownReader`, an Intel/universal Mac build, a Linux `.deb`. |
| Accessibility pass | S | Screen-reader labels, Windows high-contrast support, full keyboard navigation. |

## Open decisions

1. **How long should edit permission last?** Proposed: ask the first time, offer *Just this time* / *Always for this file* / *Always for this folder*, defaulting to *Just this time*.
2. **Menu bar visible by default?** Proposed: yes, with an option to auto-hide. *(Adopted in v1.1.)*
3. **Which languages may *Run* execute?** Proposed: JavaScript and Python only at first; shell later behind a separate warning.
4. **Password lock: locked copy or replace the original?** Proposed: make a locked copy by default, with *replace original* as a checkbox.
