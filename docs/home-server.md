# Your home server

RT Markdown Reader works with servers you run yourself: there's no account here and nothing in the middle. These work today:

| Server | What it's for | What you need |
|---|---|---|
| Nextcloud, ownCloud | Folders | Your address, your name, and an app password from *Personal settings → Security* |
| Any WebDAV server | Folders | The folder's full address, your name and password |
| BookStack | Publishing | An API token from your profile, written as `id:secret` |
| Wiki.js | Publishing | An API key from *Administration → API Access*, with the API turned on |
| Outline | Publishing | An API key from *Settings → API* |

Add them in **File → Home Server → My Servers…**, also in *Preferences → Automations*. Each is tested before it's kept. Passwords and keys are encrypted on this computer and only go to the server they're for. Your n8n and a local AI model appear in the same list, with a *Test* button.

If an address starts with `http://`, the app tells you it isn't encrypted. That's usually fine inside your home network.

## Folders

**Open a Folder on My Server…** lets you browse your server and pick a folder. The app copies its documents and pictures to a private place on this computer and opens that, so search, links, outlines and editing all work as they do for any folder, and it keeps working offline.

- Your changes go to the server by themselves, usually within seconds.
- Changes on the server come down within a minute, or when you press Refresh in the Files panel.
- Only documents and pictures are copied. Hidden folders are skipped, and a folder can hold up to 5,000 of them.
- Files open read-only as usual, and editing asks first.

**Nothing on your server is ever deleted from here.** If you delete a document in the copy, it comes back from the server. If a document is removed on the server, it goes from the copy too, unless you'd changed it, in which case your words go back up.

**If a document changed in both places,** the server's version stays and yours is kept beside it as `plan (my copy).md`, and you're told. Both then sync like any other document.

## Publishing

**Publish This Document to My Wiki…** or **Publish This Folder to My Wiki…** shows how many pages are new, how many will be updated and how many pictures go with them, then asks where to put them.

| | BookStack | Wiki.js | Outline |
|---|---|---|---|
| You choose | A book | A path | A collection |
| A subfolder becomes | A chapter | A path | A parent document |

- The first heading is the page's title, and front matter stays behind.
- Pictures on your computer are uploaded, and links between your documents become links between the pages.
- Publishing again updates the same pages, and skips anything that hasn't changed.
- A page removed on the wiki is made again next time.
- Nothing on a wiki is deleted from here, so a document you delete leaves its page behind.
- Password-locked documents are never published.

Pages are remembered on this computer, so publishing the same folder from another computer makes new pages.
