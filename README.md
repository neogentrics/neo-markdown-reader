<div align="center">

<img src="build/icon.png" width="112" alt="Neo Markdown Reader logo">

# Neo Markdown Reader

**Read Markdown the way it was meant to look.**

A fast, good-looking desktop reader for `.md` files. Double-click any Markdown file and it opens as a
clean, well-laid-out page, the way a well-designed PDF looks. You see formatted text instead of raw
symbols, and no browser tab or code editor is needed.

**[Features](#features)** · **[Install](#install-windows)** · **[Shortcuts](#keyboard-shortcuts)** · **[Roadmap](ROADMAP.md)** · **[Changelog](CHANGELOG.md)** · **[License](#license)**

[![CI](https://github.com/neogentrics/neo-markdown-reader/actions/workflows/ci.yml/badge.svg)](https://github.com/neogentrics/neo-markdown-reader/actions/workflows/ci.yml)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-3b5bdb)
![License](https://img.shields.io/badge/license-proprietary-lightgrey)

<img src="docs/screenshots/tabs.png" width="860" alt="Several documents open in tabs in Neo Markdown Reader">

</div>

## Features

| | |
|---|---|
| **Formatted output** | Headings, tables, task lists, footnotes, definition lists, `==highlights==`, sub/superscript, emoji `:rocket:` |
| **Colors and inline HTML** | `<span style="color:…">`, `<font>`, `<div align="center">`, `<details>` collapsible sections, images side by side |
| **GitHub callouts** | `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` boxes |
| **Code** | Syntax coloring for 190+ languages, one-click **Copy** button |
| **Math** | `$inline$` and `$$display$$` LaTeX via KaTeX |
| **Diagrams** | Mermaid flowcharts, sequence diagrams, Gantt charts, pie charts and more |
| **Document header** | YAML front matter (`title`, `author`, `date`, `tags`) becomes a header card at the top |
| **Outline sidebar** | Clickable table of contents that follows your scroll position, with a filter box |
| **Three themes** | Paper (light), Sepia, Night (dark), or follow Windows' setting |
| **Reading comfort** | Modern or book typeface; adjustable text size and page width; reading-progress bar |
| **Live reload** | Edit the file in VS Code / Notepad++ and the page updates when you save |
| **Export & print** | Save as a PDF that looks like the screen, or print it |
| **Links** | Links to other `.md` files open in the reader (with **Back**); web links open in your browser |
| **Tabs & windows** | Every file opens in a tab. Reorder by dragging; right-click for *Move to New Window*, Duplicate, Close Others; drag a tab out to split it into its own window |
| **Picks up where you left off** | Reopens your last windows and tabs, each scrolled to where you stopped reading |
| **Proper menu bar** | File, Edit, View, Tabs and Help are always visible (or auto-hide them: *View → Always Show Menu Bar*) |
| **Image viewer & rich copy** | Click any image to see it full size and zoom in; *Copy as Formatted Text* pastes into Word or email with formatting |
| **Automatic updates** | The installed app downloads new versions and offers *Restart to update* |
| **Opens your files** | Double-click, *Open with*, drag and drop, `Ctrl+O`, recent files, Windows jump list |

<table>
<tr>
<td><img src="docs/screenshots/paper-tables-code.png" alt="Tables and code in the Paper theme"></td>
<td><img src="docs/screenshots/night-math-diagrams.png" alt="Math and diagrams in the Night theme"></td>
</tr>
<tr>
<td align="center"><sub>Paper theme: tables and syntax-colored code</sub></td>
<td align="center"><sub>Night theme: math and Mermaid diagrams</sub></td>
</tr>
</table>

## Install (Windows)

1. Go to **[Releases](https://github.com/neogentrics/neo-markdown-reader/releases/latest)**.
2. Download one of:
   - **`NeoMarkdownReader-<version>-Setup.exe`** (recommended installer). It adds Start-menu
     and desktop shortcuts and registers the reader for `.md` files, so double-clicking any Markdown
     file opens it here.
   - **`NeoMarkdownReader-<version>-Portable.exe`**: a single file that needs no install. Run it from
     anywhere, including a USB stick.
3. Because the app is not code-signed yet, Windows SmartScreen may say *"Windows protected your PC"*.
   Click **More info → Run anyway**.

**Make it the default for `.md` files** (if you used the portable version, or another app has taken
over): right-click any `.md` file → **Open with** → **Choose another app** → pick **Neo Markdown
Reader** → tick **Always use this app**.

macOS (`.dmg`) and Linux (`.AppImage`) builds are published on the same Releases page.

**Updates:** from version 1.1 on, the installed app checks for new versions by itself, downloads them in the
background and offers *Restart to update*. The portable `.exe` and the Mac build tell you when a new
version is out and link to the download. *(Coming from 1.0? Install 1.1 once by hand; after that it's automatic.)*

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl` `O` | Open file (in a new tab) |
| `Ctrl` `Tab` / `Ctrl` `Shift` `Tab` | Next / previous tab |
| `Ctrl` `1` … `Ctrl` `9` | Jump to a tab |
| `Ctrl` `W` / `Ctrl` `Shift` `T` | Close tab / reopen closed tab |
| `Ctrl` + click a link | Open the linked document in a new tab |
| `Ctrl` `Shift` `C` | Copy as formatted text |
| `Ctrl` `F` | Find in document |
| `Ctrl` `B` | Show / hide outline |
| `Ctrl` `=` / `Ctrl` `-` / `Ctrl` `0` | Bigger / smaller / reset text |
| `Ctrl` `Shift` `E` | Export as PDF |
| `Ctrl` `P` | Print |
| `F5` | Reload file |
| `Alt` `←` | Back to the previous document |
| `Ctrl` `N` / `Ctrl` `Shift` `W` | New window / close window |
| `F1` | Keyboard shortcuts |

On macOS use `Cmd` instead of `Ctrl`.

## Roadmap

**v1.1, Everyday comfort** added tabs, a proper menu bar, session restore, automatic updates, an image
viewer and rich copy. Next up is **v1.2, Create & edit**: new files and editing with a permission step.
Later releases add side-by-side compare, a PDF designer, and sandboxed code running.

**[See the full roadmap →](ROADMAP.md)**

## Building from source

The source is public for reference. Building it for your own use or redistribution requires
permission (see [License](#license)).

Requirements: **Node.js 22** (see `.nvmrc`) and Git.

```bash
npm ci                 # install dependencies
npm run dev            # build the UI and launch the app with the feature showcase
npm test               # unit tests (Markdown pipeline, file handling, settings)
npm run test:e2e       # launches the real app and drives it (open, images, links, reload, PDF)
npm run dist:win       # Windows installer + portable .exe  → release/
npm run dist:mac       # macOS .dmg (run on a Mac)          → release/
npm run dist:linux     # Linux AppImage                     → release/
npm run icons          # regenerate build/icon.png + icon.ico from build/icon.svg (needs Playwright)
```

The Windows `.exe` can be built on Windows, Linux or macOS.

## How it works

```
src/
├── main/                 Electron "main" process (Node.js, talks to the OS)
│   ├── main.js           windows, tabs bookkeeping, menus, file opening, live reload, sessions, PDF export, links
│   ├── updater.js        update checks against GitHub Releases (electron-updater for the installer)
│   ├── version.js        version comparison
│   ├── files.js          which files can be opened + reading them safely
│   ├── settings.js       validated user settings (theme, font, recent files, session, reading positions…)
│   └── preload.js        the small, explicit API the page may call (contextBridge)
└── renderer/             The page you see (runs in a locked-down Chromium sandbox)
    ├── markdown.js       Markdown → sanitized HTML (markdown-it + plugins, DOMPurify)
    ├── app.js            tabs, toolbar, outline, find, drag & drop, image viewer, Mermaid rendering
    ├── index.html        layout + Content-Security-Policy
    └── styles/           themes, document typography, code colors, print/PDF styles
scripts/build-renderer.mjs  bundles the renderer into dist/ with esbuild
samples/showcase.md         feature tour (Help → Open Feature Showcase)
test/                       node:test suites (run under jsdom)
```

**Rendering pipeline:** the file is read by the main process, sent to the page, parsed by
**markdown-it** (GitHub-flavored, with plugins for callouts, footnotes, math, emoji and more),
highlighted by **highlight.js**, sanitized by **DOMPurify**, and then decorated in the page (Mermaid
diagrams, copy buttons, outline). Relative image paths are resolved against the document's folder,
so pictures next to your `.md` file just work.

**Security model:** Markdown files can contain HTML. The reader keeps the parts that make documents
look good (colors, alignment, images, tables, `<details>`) and removes anything that could run code:
`<script>`, event handlers like `onclick`, `<iframe>`, forms and `javascript:` links. The page runs
with `sandbox`, `contextIsolation` and no Node.js access, under a strict Content-Security-Policy.
Clicking a link never executes a file: Markdown links open in the reader, web links open in your
browser, and any other local file is only *shown in its folder*. See [SECURITY.md](SECURITY.md).

## Releasing

1. Bump `version` in `package.json` and add an entry to [CHANGELOG.md](CHANGELOG.md).
2. Commit, then tag and push:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
   Or, without a tag: **Actions → Release → Run workflow**. It tags the current commit as
   `v<version>` from `package.json`.
3. The **Release** workflow builds Windows, macOS and Linux apps and publishes them to GitHub Releases.

Every push and pull request runs the **CI** workflow: tests on Windows, macOS and Linux, plus a
downloadable Windows build under the run's *Artifacts*.

## License

**Proprietary. All rights reserved.** © 2026 Neo Gentrics.

The source code is visible for reference only. You may download and use the official releases. You
may **not** copy, modify, redistribute or reuse the code, in whole or in part, without written
permission. See [LICENSE](LICENSE) for the full terms and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
for the open-source components the app is built on.

For licensing enquiries: **author@neogentrics.com**
