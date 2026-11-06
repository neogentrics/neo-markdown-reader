# Publish anywhere

Send finished writing where people will read it. Everything here starts from **File → This Document → Send This Document**, and nothing leaves until you've seen what's going and pressed the button.

Add your blogs and channels in **File → Home Server → My Servers…**, with your wikis and servers. Each one is tested before it's kept. Passwords, keys and webhooks are encrypted on this computer and only go to the service they're for.

| Service | What you need |
|---|---|
| WordPress | The site's address, your user name, and an application password from *Users → Profile* |
| Ghost | The site's address, and the Admin API key of a custom integration from *Settings → Integrations* |
| Discord | The webhook's address, from the channel's *Settings → Integrations → Webhooks* |

Your sign-in password won't work for WordPress, and it isn't what you should use: an application password can be taken back on its own, without changing how you sign in. WordPress only offers application passwords on an `https://` address.

Self-hosted WordPress is what this has been tested on. On WordPress.com, what's available depends on your plan, and it may not offer application passwords at all.

## Drafts on your blog

**As a Draft on My Blog…** shows the title, tags and featured picture, and you can change any of them first.

| In the post | Where it comes from |
|---|---|
| Title | `title:` in the front matter, or the first heading, or the file name |
| Tags | `tags:` in the front matter, and any `#tags` in the text |
| Excerpt | `excerpt:`, `description:` or `summary:` in the front matter |
| Featured picture | `image:`, `cover:` or `featured_image:` in the front matter, or the first picture |
| Pictures | Pictures on your computer are uploaded to the site; pictures on the web stay where they are |

**It always goes as a draft.** Nobody sees it until you publish it from your blog.

**Sending again updates the same draft.** Pictures that are already there aren't sent twice.

**A published post is never changed from here.** If you've published the last one, the dialog says so, and sending makes a new draft and leaves that post alone. The same happens if you've moved the draft to the bin or removed it.

A few things don't travel, because a blog doesn't have what draws them:

- Maths goes as its source text, in code style.
- Mermaid diagrams go as their source text.
- Charts are left out. If a chart comes from a table, the table still goes.
- Links to other documents on your computer become plain words.

You're told when a diagram or chart was affected.

## Discord

**To Discord…** posts to a channel through its webhook, as the whole document or a summary. The dialog says how many messages it will take.

- Everyone in the channel sees it straight away, and the app can't take it back. To remove a message, delete it in Discord.
- **Nobody is pinged.** `@everyone` or a name in your document stays as words.
- Discord messages are short, so a long document is split at paragraphs, and code blocks stay whole or are closed and reopened. A document that would take more than 20 messages is held back, and you're asked to send a summary.
- Pictures on your computer go as attachments, up to 10 per message and 10 MB each.
- Tables go as code blocks, because Discord can't show them. Small headings become bold.

**A summary** starts from the document's opening, and you can change it. If you've set up AI assist, *Write It with AI* writes one with your chosen service, which means the document goes to that service. Check what it wrote before you post it.

A webhook address is a secret: anyone who has it can post to the channel. It's kept with your keys, and it isn't shown again after you've saved it. If it gets out, delete the webhook in Discord and make a new one.

## Where This Was Sent

**Where This Was Sent** lists where a document has gone and when, newest first, with a link back to each one. That covers WordPress, Ghost and Discord, and also your wikis and Notion from this version on.

The list stays on this computer and follows the document when you rename it from the app. *Forget This List* clears the list for that document. It doesn't remove anything from the sites, and sending again still finds your draft.

Password-locked documents are never sent.
