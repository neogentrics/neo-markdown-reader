# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email **author@neogentrics.com** with:

- a description of the issue and its impact,
- a Markdown file or steps that reproduce it,
- the app version (Help → About) and your operating system.

You should get a reply within 5 business days. Please give us reasonable time to release a fix before
disclosing the issue publicly.

## Supported versions

Only the latest release receives security fixes.

## Design notes

Markdown files are treated as **untrusted input**:

- HTML in documents is sanitized with DOMPurify. Scripts, event-handler attributes, iframes, objects,
  forms and `javascript:` URLs are removed.
- The document view runs with Electron `sandbox: true`, `contextIsolation: true` and
  `nodeIntegration: false`, behind a Content-Security-Policy that only allows the app's own scripts.
- The page can reach the operating system only through a small, validated IPC API (`src/main/preload.js`).
- The window cannot be navigated away or open new windows. Links are routed through the main process:
  `http(s)`/`mailto` links open in the default browser, Markdown files open in the reader, and other
  local files are only revealed in their folder, never executed.
- All web permission requests (camera, microphone, notifications, …) are denied.

### Editing (since 1.2)

- The page never writes files. Saving is performed by the main process (`src/main/editing.js`) and only for
  a file the user allowed through a **native** permission dialog, which document content cannot draw or
  answer. "Just this time" permission lives in memory for one window and ends when the tab closes;
  "Always" permissions are listed and revocable in *Edit → Editing Permissions…*.
- Before the first save of a file in a session, the original is copied to the app's backups folder.
- A save is refused (after asking) if the file's modification time no longer matches the version that
  editing started from, so changes made by another program aren't silently overwritten.
- Files that the operating system reports as not writable (e.g. the Windows read-only attribute) are
  never written.
- *Save As* only writes to the location the user picked in the native save dialog.

### Folders, highlights and bookmarks (since 1.3)

- Only a folder the user picked in the native folder dialog (or reopened from *Open Recent Folder*) can
  be listed or searched, and only by the window it was opened in. Searching reads Markdown files inside
  that folder; it never follows into `node_modules` or hidden folders and skips files over 2 MB.
- Highlights and notes are stored in the app's data folder (`annotations.json`), validated and size-capped.
  They are never written into documents.

### Exports, presentation and themes (since 1.4)

- Exports are built by the main process. PDFs, and the pictures of diagrams and equations in Word documents,
  are made in hidden windows with **JavaScript disabled**. These windows can't navigate or open other
  windows, and they load only the already-sanitized page content and the app's own stylesheet. Temporary
  files are deleted afterwards.
- Exports are only written where the user chose in the native save dialog.
- Exported web pages contain no scripts. Local images are embedded only if they're image files the
  document already showed.
- For Word export, web images the page already displayed are downloaded again by the main process
  (10-second timeout, 25 MB limit) so they can be embedded.
- A brand stylesheet is chosen in the native open dialog and read as text (1 MB limit). It is applied as
  CSS and never run as code. Font names are reduced to letters, digits and a few punctuation marks
  before they're used in CSS.
- Private highlights and notes are removed from every export.

### Running code (since 2.0)

- Code blocks never run on their own. A run starts only from the ▶ Run button, and the main process
  then shows a **native** confirmation with the code, which document content can't draw or answer.
  "Don't ask again" lasts only while that document stays open in that window.
- Only JavaScript and Python are run. Shell, PowerShell and batch code is never run.
- Code runs in a hidden window on its own in-memory session (`nmr-sandbox`):
  - It is served only the files in `dist/sandbox` through a private scheme, and paths that try to leave
    that folder are refused.
  - Every other request from that session (http/https, `file://`, WebSockets) is cancelled.
  - All permission requests are denied, and navigation and new windows are blocked.
  - The window has no preload and no Node.js.
- Each program runs in a Web Worker. Network APIs are removed before user code runs, the worker is
  terminated when its time is up (10 s; Python 30 s), and output is capped and shown as text, never as HTML.
- *Edit → Allow Running Code Blocks* switches the feature off.

### Password-locked documents (since 2.0)

- `.mdlock` files use AES-256-GCM with a 256-bit key from scrypt (N = 2^17, r = 8, p = 1, 16-byte random
  salt) and a fresh 12-byte IV for every save. The text and the original file name are inside the
  ciphertext, and the key-derivation parameters are authenticated.
- When reading files, scrypt parameters above N = 2^20, r = 16 or p = 4 are refused.
- Keys of unlocked documents are kept in main-process memory only, until the app quits or *Lock Now*.
  After three wrong passwords, further attempts are increasingly delayed.
- A locked document is never written unencrypted. Saving without its key is refused.
- A new locked copy is decrypted and checked before the original is touched. The optional removal of the
  original moves it to the Recycle Bin, so plaintext may remain there until it is emptied.
- Locked documents are never searched, never highlighted (highlights are stored unencrypted) and never
  sent to AI assist.
- There is no password recovery.

### AI assist (since 2.0)

- Off by default. Requests are made only from an explicit menu command, contain only the current
  document (and selection), and go only to `https://api.anthropic.com`. The address is fixed, so an
  `ANTHROPIC_BASE_URL` set on the computer can't redirect them.
- The API key is encrypted with the operating system's key store (Electron `safeStorage`) in its own
  file and never written to the settings file. Where no secure store exists (some Linux setups) it is
  kept in memory for the session only.
- Answers are shown as sanitized Markdown, and links in them open in the browser.
