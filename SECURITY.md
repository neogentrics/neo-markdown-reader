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
