# App Link

How Recon Towers apps on the same computer find each other, agree to work together and send each other documents.
RT Markdown Reader follows these rules from 3.6. Any app can join by following them; nothing here depends on the
language it's written in. There are no user accounts.

This is protocol version **1**. A later version only adds to it: an app must ignore fields it doesn't know.

## The short version

1. While it's running with App Link on, an app leaves a small file saying how to reach it.
2. Another app reads that file and connects.
3. The first time, it asks to link. The person answers in the app being asked.
4. If they say yes, both apps keep the same key, and every later request carries it.
5. With the key, either app can send the other a document, with its pictures.

There's a second road with no link at all, for one document a person chooses to hand over. It goes through the system, and
it also starts an app that isn't running. See [With no link](#with-no-link).

## Finding an app

Each app that's running with App Link on writes one file to this folder:

| System | Folder |
|---|---|
| Windows | `%APPDATA%\Recon Towers\app-link\` |
| macOS | `~/Library/Application Support/Recon Towers/app-link/` |
| Linux | `$XDG_CONFIG_HOME/Recon Towers/app-link/`, or `~/.config/Recon Towers/app-link/` |

The file is named after the app's id, such as `rt-markdown-reader.json`:

```json
{
  "protocol": 1,
  "id": "rt-markdown-reader",
  "name": "RT Markdown Reader",
  "version": "3.6.0",
  "endpoint": "\\\\.\\pipe\\rt-app-link-0123456789abcdef"
}
```

- `id` is lowercase letters, numbers and hyphens, at most 64 characters, and it matches the file's name.
- `endpoint` is a named pipe on Windows, always starting `\\.\pipe\`, and the full path of a Unix socket elsewhere.
  Nothing else is allowed: never a network address.
- The file holds no secrets. An app removes its file when it stops.
- A file can be left behind by a crash. If an app can't be reached, it isn't running.

## Talking to an app

Connect to the endpoint and send one JSON object per line, in UTF-8. Each line gets one line back, with the same `id`:

```json
{ "id": 1, "method": "hello", "params": {} }
{ "id": 1, "result": { "protocol": 1, "app": "rt-markdown-reader", "name": "RT Markdown Reader", "version": "3.6.0", "accepts": ["markdown", "text"] } }
```

A request that fails gets an `error` instead of a `result`:

```json
{ "id": 2, "error": { "code": "not_linked", "message": "That app isn't linked. Link it first." } }
```

A line can be at most 8 MB. Show `message` to the person if you need to; decide what to do from `code`.

| Code | Meaning |
|---|---|
| `bad_request` | Something in the request is missing or isn't valid. |
| `unknown_method` | This app doesn't have that method. |
| `not_linked` | The app or key isn't linked. Ask to link again. |
| `declined` | The person said no. Don't ask again straight away. |
| `timed_out` | Nobody answered. |
| `busy` | The app is already asking the person something. Try later. |
| `no_safe_store` | This computer has no safe place to keep the key. |
| `not_allowed` | The app won't do that, such as opening a password-locked document. |
| `not_found` | The document isn't there. |
| `failed` | Something went wrong in the app. |

## Methods

Every app implements all four.

### `hello`

Needs no key. Returns `protocol`, `app`, `name`, `version` and `accepts`, the kinds of document the app takes.

### `pair`

Asks the person to link. Only ask because they just chose to, never in the background.

```json
{ "id": 3, "method": "pair", "params": { "app": "storytracker", "name": "StoryTracker" } }
```

The answer can take up to two minutes, so wait for it. If they say yes:

```json
{ "id": 3, "result": { "key": "64 hexadecimal characters", "app": "rt-markdown-reader", "name": "RT Markdown Reader" } }
```

The app that was asked makes the key, from a secure random source, 32 bytes long. Both apps then keep it in the
system's encrypted storage, such as Electron's `safeStorage` or the Windows Data Protection API. If there's no such
storage, keep it only until the app closes, or answer `no_safe_store`. Never put a key in a log, a URL or a plain file.

Pairing again replaces the old key.

### `open_document`

Sends a document for the person to work on. Give `text`, or `path` for a file on this computer.

```json
{ "id": 4, "method": "open_document", "params": { "app": "storytracker", "key": "…", "name": "Chapter 1.md", "text": "# Chapter 1\n" } }
{ "id": 5, "method": "open_document", "params": { "app": "storytracker", "key": "…", "path": "C:\\Books\\Chapter 1.md" } }
```

Returns `{ "opened": true }`.

- `text` opens as a new document that hasn't been saved. Nothing is written to disk until the person saves it.
- `path` opens that file as if the person had opened it. RT Markdown Reader takes Markdown files only.
- `name` is a suggestion. Clean it before you show it.
- Password-locked documents are never sent or opened this way.

Two more fields are optional. An app that doesn't know them ignores them, so they need no new protocol version.

| Field | What it is |
|---|---|
| `attachments` | The pictures that go with the document, as a list of `{ "name": "map.png", "path": "C:\\Books\\images\\map.png" }`. |
| `kind` | A hint at what the document is: `chapter`, `record`, `page`, `note` or `research`. The person still chooses. |

```json
{ "id": 7, "method": "open_document", "params": { "app": "storytracker", "key": "…", "name": "Chapter 2.md", "text": "![Map](map.png)\n", "kind": "chapter", "attachments": [{ "name": "map.png", "path": "C:\\Books\\images\\map.png" }] } }
```

`attachments`:

- Pictures only: PNG, JPEG, WebP and GIF. Drop anything else on the list, and still open the document.
- `path` is a full path on this computer, so a list stays small however big the pictures are. Never follow a path to another
  computer, such as `\\server\share\map.png`.
- `name` is the picture's file name. Clean it before you show it, as you would a document's.
- A sender can remove its copies later, so read a picture when you take the document, or say how long you need it.
- The list is for a document sent as `text`. A file sent as `path` has its pictures beside it, and RT Markdown Reader ignores
  a list that comes with one.

What RT Markdown Reader does with them:

- It sends the pictures a saved document shows, found from the document's own folder, and leaves out any that aren't real
  pictures or aren't there. An unsaved document has no folder, so it sends none.
- It reads the ones it's sent at once and holds them with the unsaved document, checking each by its first bytes. Nothing is
  written to disk until the person saves, and at most 50 pictures of 25 MB each, 100 MB in all, are taken.
- A link in the text finds a picture by its file name, whichever folder the link says it's in. A picture the text doesn't
  show is added at the end of the document, so it's seen.
- When the person saves, the pictures go in an `images` folder beside the document, as pasted pictures do, and the links
  follow them.

RT Markdown Reader doesn't use `kind`: it accepts it and ignores it.

### `unlink`

```json
{ "id": 6, "method": "unlink", "params": { "app": "storytracker", "key": "…" } }
```

The key stops working and returns `{ "unlinked": true }`. Forget the key when you receive this, and send it when the
person removes a link on your side.

## What an app must do

- Keep App Link off until the person turns it on.
- Show the name it was given when asking the person, with control characters removed, and treat it as a claim:
  any program running as this person could give any name.
- Compare keys in constant time.
- Treat everything it receives as untrusted, as it would a file downloaded from the web.
- Never change or save a document because of a request. The person does that.

## With no link

A person can hand one document to another app with no link, and with neither app's App Link turned on. This road doesn't use
the protocol, so it needs no key. It's the same as choosing *Open With*:

1. The app sending it writes the document as a temporary `.md` file, in a folder of its own.
2. It starts the other app with that file's path, or asks the system to.
3. The other app takes the file as if the person had opened it.

It's safe with no key because a person just chose it, and it can only offer a document: an app that's handed a file saves
nothing until the person says so.

The app taking a file:

- Takes a path it's started with, and a path handed to the copy that's already running. On macOS that's the `open-file` event.
- Reads the file straight away, because the sender will remove it.
- Refuses a password-locked document and any file it doesn't handle, as it would over the link.

The app sending a file:

- Sends only because the person just chose to, never in the background.
- Never sends a password-locked document this way, and never writes one to a temporary file.
- Removes the temporary file when it's done. RT Markdown Reader removes it two minutes after handing it over, or when it
  closes if that's sooner, and sweeps up at its next start anything a crash left behind. Sweep only your own folders.
- Starts the other app with no shell in between.

Pictures don't go this way: a path can only name one file, so the app sending says they stayed behind.

### Which app starts the other

**The app the person is in starts the other one.** There's no background service, and an app never starts another by itself.

| | RT Markdown Reader sends | RT Story Tracker sends |
|---|---|---|
| **The command** | *Send to StoryTracker* | *Open in RT Markdown Reader* |
| **Linked, and the other app is running** | `open_document`, with pictures | `open_document` |
| **Not linked, or the other app is closed** | Starts it with a temporary `.md`, without pictures | Starts it with a temporary `.md` |

Each app looks where the other's installers put it. If it isn't there, the app says so rather than opening some other
program. An app installed somewhere else, or an AppImage, can't be found this way, but it works once it's linked and running.

RT Story Tracker takes a path it's started with from version 3.7.

## Not in version 1

- **Another computer.** Pairing by a one-time code, then a key kept by both apps.
- **Sync.** Keeping a document the same in both apps. It depends on how StoryTracker stores its data.
