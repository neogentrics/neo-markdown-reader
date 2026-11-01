# Third-party notices

Neo Markdown Reader is proprietary software (see [LICENSE](LICENSE)), but it is built on the following
open-source components, each used under its own license. Full license texts ship inside the
application (`resources/app.asar/dist/app.js.LEGAL.txt` and the Electron `LICENSES.chromium.html`).

| Component | Version | License | Homepage |
|---|---|---|---|
| electron | 45.2.1 | MIT | https://github.com/electron/electron |
| markdown-it | 15.0.3 | MIT | https://github.com/markdown-it/markdown-it |
| markdown-it-anchor | 10.0.0 | Unlicense | https://github.com/valeriangalliat/markdown-it-anchor |
| markdown-it-footnote | 4.0.0 | MIT | https://github.com/markdown-it/markdown-it-footnote |
| markdown-it-task-lists | 2.1.1 | ISC | https://github.com/revin/markdown-it-task-lists#readme |
| markdown-it-emoji | 3.1.0 | MIT | https://github.com/markdown-it/markdown-it-emoji |
| markdown-it-deflist | 4.0.0 | MIT | https://github.com/markdown-it/markdown-it-deflist |
| markdown-it-mark | 4.0.0 | MIT | https://github.com/markdown-it/markdown-it-mark |
| markdown-it-sub | 2.0.0 | MIT | https://github.com/markdown-it/markdown-it-sub |
| markdown-it-sup | 2.0.0 | MIT | https://github.com/markdown-it/markdown-it-sup |
| markdown-it-github-alerts | 1.0.1 | MIT | https://github.com/antfu/markdown-it-github-alerts#readme |
| markdown-it-front-matter | 0.2.4 | MIT | https://github.com/ParkSB/markdown-it-front-matter |
| markdown-it-texmath | 1.0.0 | MIT | https://github.com/goessner/markdown-it-texmath |
| katex | 0.19.1 | MIT | https://katex.org |
| highlight.js | 11.12.0 | BSD-3-Clause | https://highlightjs.org/ |
| mermaid | 12.2.0 | MIT | https://github.com/mermaid-js/mermaid |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) | https://github.com/cure53/DOMPurify |
| js-yaml | 5.5.0 | MIT | https://github.com/nodeca/js-yaml |
| electron-updater | 6.8.11 | MIT | https://github.com/electron-userland/electron-builder |
| CodeMirror 6 (`codemirror`, `@codemirror/*`, `@lezer/*`) | 6.x | MIT | https://codemirror.net |
| diff (jsdiff) | 9.0.0 | BSD-3-Clause | https://github.com/kpdecker/jsdiff |
| pdf-lib (with `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`) | 1.17.1 | MIT (pako: MIT AND Zlib) | https://pdf-lib.js.org |
| docx | 9.15.1 | MIT | https://docx.js.org |
| fflate | 0.8.3 | MIT | https://github.com/101arrowz/fflate |
| tslib | 2.9.1 | 0BSD | https://www.typescriptlang.org/ |
| nanoid | 6.0.2 | MIT | https://github.com/ai/nanoid |
| Pyodide (CPython for WebAssembly, with the Python standard library) | 314.0.7 | MPL-2.0 (Python: PSF License) | https://pyodide.org |
| @anthropic-ai/sdk | 1.3.0 | Apache-2.0 | https://github.com/anthropics/anthropic-sdk-typescript |
| Markdig (File Explorer preview, with System.Memory, System.Buffers and related .NET packages) | 1.5.1 | BSD-2-Clause (.NET packages: MIT) | https://github.com/xoofx/markdig |

Pyodide is shipped unmodified in `resources/app.asar/dist/sandbox/pyodide/`; its source is available
from the Pyodide project under the Mozilla Public License 2.0.

The PDF and Word export libraries and the Anthropic SDK are bundled into `resources/app.asar/dist/export-tools.cjs`; their
license texts are in `export-tools.cjs.LEGAL.txt` next to it.
