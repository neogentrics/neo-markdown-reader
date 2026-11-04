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
5. With the key, either app can send the other a document.

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

## Not in version 1

- **Another computer.** Pairing by a one-time code, then a key kept by both apps.
- **Sync.** Keeping a document the same in both apps. It depends on how StoryTracker stores its data.
- **Starting an app that isn't running.**
