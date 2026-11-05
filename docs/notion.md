# Notion

RT Markdown Reader reads and writes Notion pages through Notion's own Markdown service, with a key you make yourself. There's no account here and no server in the middle: your computer talks straight to `api.notion.com`.

## Connecting

1. In Notion, open **Settings**, then **Connections**, and choose **Develop or manage integrations**.
2. Make a new **internal integration** and copy its secret.
3. On each page you want to use here, open the **•••** menu, choose **Connections**, and add your integration. Subpages come with it.
4. In the app, choose **File → Notion → Notion Connection…** and paste the key.

The key is encrypted on this computer and only ever sent to Notion. To send documents, the integration needs the *Read content*, *Update content* and *Insert content* capabilities, which are on by default.

## Bringing a page in

**File → Notion → Bring In a Notion Page…** searches what you've shared, or takes a link you paste. Then:

- **Save as Markdown…** writes a file and copies Notion's pictures into an `images` folder beside it. Links to pictures on Notion stop working after about an hour, so this is the choice that keeps them.
- **Just Open It** opens it as a new unsaved document.

With **Keep it linked** on, the document gets one line of front matter:

```yaml
---
notion: https://www.notion.so/Plan-1a2b3c4d5e6f4a1b8c9d0e1f2a3b4c5d
---
```

The link lives in the document, so it survives renaming and moving, and it syncs with the document. Delete that line to unlink.

A database opens as a table of up to 1,000 rows. It's a copy to read and isn't linked.

### How Notion's blocks appear

| In Notion | In the document |
|---|---|
| Callout | An alert: `> [!TIP]` |
| Toggle | `<details>`, which opens and closes |
| Subpage, database | A link: `[📄 Title](…)` |
| File, PDF, audio, video | A link to it |
| Columns, synced blocks | What's inside them, one after the other |
| Colours | Plain text |

Colours aren't lost from Notion by bringing a page in. They only change if you edit that block and send it back.

## Sending to Notion

**File → Notion → Send to Notion…** shows what will change, and nothing is sent until you press **Send**.

- **A linked document** updates its page. Only the blocks you changed are sent, so everything else on the page keeps its colours, mentions and pictures.
- **Any other document** becomes a new page under the page you choose, and is then linked to it. Save the document to keep the link.
- **The first heading** is the page's title. Change it and the page is renamed.
- **Subpages and databases** are safe: the app never allows Notion to delete one. If you remove a subpage's link and send, Notion refuses and you're told why.
- **If the page changed in Notion** since you last brought it in, you're warned before you send.

What doesn't go over:

- Pictures on your computer stay behind, with a note in their place. Notion can only take pictures from the web here. Pictures that came from Notion and haven't changed stay on the page.
- Notion has no footnotes, so they arrive as plain text.
- Password-locked documents are never sent.

## Keeping in step

When you open a linked document or come back to the app, it checks whether the page has moved on, at most once a minute. If it's really different, a note appears: **Compare** opens both side by side, **Bring In Changes** puts Notion's version in the editor for you to review and save, and **Not Now** leaves it until the page changes again. Being offline just means no note.

Reading a page uses Notion's newer Markdown (`markdown_version: v2`), and a page too long for Notion to send whole is marked as such when you bring it in.
