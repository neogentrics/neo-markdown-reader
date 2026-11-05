# Automations

How RT Markdown Reader talks to your workflows, for anyone building one.

## What a webhook receives

The app sends a `POST` with a JSON body. It follows no redirects, so a document only ever reaches the address that was shown.

```json
{ "app": "RT Markdown Reader", "version": "3.7.0", "action": "Tidy my notes", "name": "notes.md", "text": "# The whole document" }
```

- **Selected text:** `selection` in place of `text`.
- **A folder:** `folder`, and `documents`, a list of `{ "name", "path", "text" }`. Paths are relative to the folder. The limit is 500 documents or 20 MB.

If you saved an authorization header, it's sent as `Authorization`.

## What a webhook can answer

Plain text, or JSON. From JSON, the app takes the first of `markdown`, `text`, `content`, `output`, `result`, `answer`, `body`, `data` or `json`, looking inside the first item of a list. Anything else is shown as a JSON code block. n8n's own `Workflow was started` counts as nothing to show.

## Calling the app

Turn this on in *Preferences → Automations*. Every request needs `Authorization: Bearer <key>`. Requests with an `Origin` header are refused, so web pages can't use it. After 20 wrong keys it refuses everything for a minute.

The address is `http://127.0.0.1:41731`, or this computer's network address if you allow other computers. That traffic isn't encrypted, so only allow it on a network you trust.

In n8n, use an HTTP Request node with an `Authorization` header of `Bearer <key>`. If n8n runs on another computer, Windows may ask whether to let the app through its firewall the first time.

| Request | Body | Does |
|---|---|---|
| `GET /v1/status` | | Says the app is there |
| `POST /v1/documents` | `{ "name", "content" }` | Opens a new, unsaved document |
| `POST /v1/open` | `{ "path" }` | Opens a Markdown file |
| `POST /v1/append` | `{ "path", "text" }` | Adds text to the end of a file, after asking you, keeping a backup and a History copy |

Answers are JSON: `{ "ok": true }`, or `{ "ok": false, "error": "…" }` with an HTTP error code. Locked documents can't be opened or changed this way. The app has to be running.
