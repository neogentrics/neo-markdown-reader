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

### File Explorer preview (since 2.1)

- The preview handler runs inside Windows' preview host (`prevhost.exe`), not in the app. It's registered
  per user and only for Markdown extensions, and it never replaces another app's preview handler.
  Windows starts it through a small native COM server (`NeoMarkdownPreviewShim.dll`) that loads only
  the handler installed next to it, into the .NET Framework that is part of Windows.
- Documents are rendered with Markdig with raw HTML disabled, so HTML in a document is shown as text and
  never interpreted. Images aren't loaded (no web requests from Explorer), and link targets other than
  `http(s)`, `mailto` and in-page anchors are removed.
- The page is shown in a browser control that refuses every navigation after the page loads, has no
  context menu or browser shortcuts, and opens no new windows.
- Files over 8 MB aren't previewed.

### Writing faster (since 2.2)

- **Pictures** pasted or dropped into the editor are written by the main process, only for a document
  you're currently allowed to edit, and only into the `images` folder next to it. The bytes must really be a
  PNG, JPEG, GIF, WebP, BMP or AVIF picture (checked by content, not by name), the name is cleaned of any
  path, an existing file is never overwritten, and the limit is 25 MB. Pictures can't be added to locked
  documents, because they would be stored unencrypted.
- **Pasted formatting** is converted to Markdown text; scripts, styles, frames, forms and embedded
  (`data:`) pictures are dropped, and links other than web, mail, in-page and relative ones keep only their
  text. The result is then rendered like any other document (sanitized, no scripts).
- **Word import** reads only the `.docx` you chose and writes only the Markdown file you chose and its
  pictures (in an `images` folder next to it). Replacing an existing Markdown file backs it up first.
- **Version history** is stored in the app's data folder (`history/` next to `settings.json`), never in your
  folders, and only for documents open in the window asking. Each version is the file's exact bytes,
  compressed, so locked documents' versions stay encrypted. Restoring asks first (or asks for edit
  permission) and keeps the current version before replacing it.
- **Replace in Folder** only touches Markdown files in the folder you opened, never locked documents or
  files with unsaved edits in a tab. Matching runs in a separate worker with a time limit, so a slow pattern
  is stopped rather than freezing the app. Nothing changes until you confirm; each file must be unchanged
  since the preview, is backed up and has its old version kept in History first. *Undo last replace* only
  puts back files that haven't changed again since.
- **Shortcuts** you choose are checked against a fixed list of keys and modifiers before they're saved or
  used, and menu shortcuts are paused while you press keys for a new one.

### Connected notes (since 2.3)

- The folder's links, tags and tasks are worked out by the main process from the Markdown files in the folder
  you opened. Locked documents are never read for this, and files over 2 MB are skipped.
- **Ticking a task off** changes one line of one file, and only after the usual edit permission. The line
  must still say exactly what the Tasks panel showed; otherwise nothing is written. The file is backed up
  and its old version kept in History first, and its line endings are kept.
- **Creating a document from a missing link** asks first, never overwrites an existing file, and only creates
  it next to the linking document (or, for `[[folder/Name]]`, inside the open folder). `..` is refused.
- **Rename** needs edit permission for the document, refuses names with path separators and never replaces
  another file. Updating links to it asks first, and each document changed is backed up and kept in History.
- **Today's note** is only ever created inside the open folder's `Daily` folder.
- **Ask About This Folder** sends only the documents you tick, and the main process checks each one is a
  Markdown file in the open folder and not a locked document before reading it. Citations in the answer only
  link to documents that were sent.

### Read, listen & share (since 2.4)

- **Read aloud** only offers voices installed on the computer (`localService`), so the text isn't sent to an
  online speech service.
- **CSV, JSON, YAML and notebooks** are converted to Markdown by the main process and shown read-only through
  the same sanitizer as any document; they can't be edited or saved from the app. Notebook outputs are what
  was saved in the file: nothing is run, notebook code gets no *Run* button, and HTML outputs are sanitized
  like HTML in a document.
- **Charts** are drawn as SVG from the numbers and labels in the document; all text in them is escaped,
  and the result is sanitized with the rest of the page.
- **Hover previews** read only Markdown and data files, never locked documents, and don't remember or
  watch what they read.
- **E-books** keep only links within the book and to the web; links to files on the computer are removed.
  Pictures are copied in; diagrams are drawn to pictures in a hidden window that runs no scripts.
- **AI writing help** sends only the selected text and up to 2,000 characters either side, never from a
  locked document. The suggestion changes nothing until it's accepted, and only if the selected text is
  still unchanged.

### Make it yours (since 3.0)

- **Add-ons** are installed only after a native dialog (which the page can't fake) shows what each one adds
  and the reader agrees. Packages are checked before anything is written: at most 4 MB and 200 files, no
  file names with `..`, backslashes or drive letters, and only `addon.json` and the scripts it names are
  kept. Each add-on lives in its own folder under the app's data folder and is checked again every time the
  app starts.
- **Add-on code** runs in the same sealed sandbox as ▶ Run (a separate hidden window in the sandbox's private
  session): no internet, no files, no settings. Its input is passed as an escaped JSON string and parsed
  there, so a document's text can't become code. It has 5 seconds to draw a block and 20 seconds to export,
  and its answer is size-limited.
- **What an add-on draws** is sanitized like a document, and more strictly: pictures, links, `<use>`,
  `<style>` and any style or attribute that refers to a URL are removed, so it can't load anything from the
  web or track the reader.
- **Add-on exports** can't produce file types that could be run as programs (`.exe`, `.bat`, `.js`, `.sh`,
  `.msi`, `.app` and others). The reader chooses where the file is saved, and the extension is forced.
- **Add-on themes** are colours only (hex values); the app writes the CSS itself, and a theme that would be
  hard to read (below 4.5:1 contrast) is refused.
- **Translations** are built into the app; they're plain text looked up by the English original and are
  never treated as HTML. Documents, file names and notes are never translated.

### Sync between computers (since 3.1)

- **Off until the reader turns it on** and chooses the folder in a native dialog (or one of the cloud folders
  the app found). The app writes only inside a *RT Markdown Reader* folder in it: a README and one file per
  computer. No server and no account are involved; what leaves the computer is whatever the reader's own
  cloud service carries.
- **What's in the files:** highlight quotes and notes, bookmarked and recent documents (as places inside a
  cloud folder, e.g. `onedrive:Notes/plan.md`), reading positions and display settings. They are not
  encrypted beyond what the cloud service does, which is why these never go in them: the AI key, editing
  permissions, version history, the *Allow Running Code Blocks* setting, and anything about
  password-locked documents (a highlight quotes the text it marks).
- **Files from other computers are treated as untrusted.** Each is size-limited (20 MB), read only if it is
  in this format and version, and every item is checked: only the settings that are meant to sync, and
  each value through the same validation as the settings and highlights stores. Document places can't
  climb out of their cloud folder (`..` is refused), and a place that doesn't exist on this computer is
  left alone rather than created. Nothing in a sync file can run code, open a file or change a document.
- Each computer writes only its own file (written to a temporary name, then renamed), so a half-synced
  file is skipped and read next time rather than merged.

### Natural voices (since 3.2)

- **Nothing is downloaded until the reader agrees** in a native dialog that gives the size and the license.
  The files come from one fixed revision of Supertone's published model on Hugging Face (the revision is
  part of every URL), through Electron's network stack (the system's proxy and certificate store).
- **Every file is checked before use:** its size and SHA-256 are written into the app (`src/main/voices.js`).
  Bytes are hashed as they arrive; a file larger than expected is stopped at once, and a file that doesn't
  match is deleted. Files are downloaded under a temporary name and only renamed into place once they
  match, and the voices count as installed only when every file is in place.
- **Speech runs in a separate process** (Electron's `utilityProcess`) with ONNX Runtime's WebAssembly engine,
  bundled into the app; there is no native code. It reads only the model folder in the app's data folder,
  opens no network connections, and is stopped after five idle minutes.
- **What reaches it** is the sentence being read, the language code and the voice name, checked by the main
  process (text length, a known voice, a language the model speaks, speed and quality in range). What comes
  back is audio samples, played by the page; nothing is written to disk.
- **Locked documents** can be read aloud like any open document; their text goes only to the voice process
  on this computer, never anywhere else.

### The Claude connector (since 3.4)

- **Off by default.** The app listens only while *Connect Claude* is on, and never on a network port: Claude's side
  reaches it over a named pipe on Windows, or a socket file only this user can open elsewhere.
- **A new secret each time.** The connector writes a random token to `connector.json` in the app-data folder when it
  starts and removes it when it stops. Requests without the token are dropped.
- **Limited reach.** Only Markdown documents open in a tab or in the open folder. Paths are checked in the app, not
  by Claude's side. Password-locked documents are refused, and aren't listed.
- **No writing.** `suggest_edit` shows the change in the app. Nothing is written until the person accepts it, and
  accepting goes through the normal edit permission, with a backup and a History copy. The text to replace must
  appear exactly once, so a change can't land in the wrong place.
- **Claude Desktop's settings** are changed only when you click *Add to Claude Desktop*. Other entries are kept, the
  earlier file is saved as `.bak`, and a file that can't be read is left alone.
- **Claude Code** is run with `--tools ""`, without your settings or other connectors, and in a temporary folder. The
  document goes in on stdin. The app never sees or stores your Claude sign-in.

### AI assist (since 2.0; more services since 3.3)

- Off by default. Requests are made only from an explicit menu command and contain only the current
  document (and selection), or the folder documents the reader ticked.
- They go only to the service the reader chose, at a fixed address: `https://api.anthropic.com`,
  `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com/v1beta/openai`,
  `https://api.mistral.ai/v1` or `https://openrouter.ai/api/v1`. Environment variables such as
  `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL` set on the computer can't redirect them.
- **A model on this computer** (3.3) uses the server address the reader enters. `https://` may point
  anywhere; plain `http://` is accepted only for this computer (`localhost`, `127.x`, `::1`) or a private
  network address (`10.x`, `172.16–31.x`, `192.168.x`, link-local, `.local`, `.lan` and single-word names),
  so document text never crosses the internet unencrypted. Addresses with a user name, password, query
  or fragment are refused.
- Each service's API key is encrypted with the operating system's key store (Electron `safeStorage`) in
  one file (`ai-keys.bin`), never written to the settings file and never synced. Where no secure store
  exists (some Linux setups) keys are kept in memory for the session only. A key must be one printable
  word, so it can't add a line to a request's headers. The 2.x file `ai-key.bin` is read once and removed
  when keys are next saved.
- Before a request of more than about 50,000 tokens goes to a paid service, the reader is asked, with
  its size and (where the service publishes it) its price.
- Model lists are fetched only when the settings window is open for that service, with that service's key.
- Answers are shown as sanitized Markdown, and links in them open in the browser.
