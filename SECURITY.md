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
