# Sync between computers

Keep highlights, notes, flashcard progress, bookmarks, recent files and reading positions in step between your computers, with no account.

1. Open [Preferences → Sync](#do=preferences:sync), then **Sync Between Computers…**.
2. Choose a folder you already sync, such as OneDrive, Dropbox or Google Drive. For Google Drive, install Google Drive for desktop.
3. Do the same on your other computers, with the same folder.

Your documents themselves aren't copied: keep those in a synced folder too. Anything about password-locked documents is never synced.

## Linked apps

Other Recon Towers apps on this computer can link with RT Markdown Reader, so you can send documents between them.

1. Open [Preferences → Linked Apps](#do=preferences:link) and turn it on.
2. Start the link from either app, and answer the question that appears. You only do this once for each app.
3. Choose *File → This Document → Send to Linked App* to send what's on screen, including changes you haven't saved.

A document sent to you opens as a new, unsaved document, so nothing is saved until you save it. A linked app can't read
or change your documents on its own, and password-locked documents are never sent. Remove a link in the same place.

## Notion

Choose **File → Notion → Bring In a Notion Page…** to open a page as Markdown, or a database as a table. The first time, the app shows how to make a key in Notion and share your pages with it.

**Save as Markdown…** keeps a copy of Notion's pictures beside your document, because links to them stop working after about an hour. With **Keep it linked** on, you can send your changes back.

**File → Notion → Send to Notion…** shows what will change before anything happens. Only the parts you changed are sent, so colours and mentions elsewhere on the page stay as they are. A document that isn't linked yet becomes a new page under the one you choose.

When a linked page changes in Notion, a note appears at the top. **Compare** shows both, and **Bring In Changes** puts Notion's version in the editor for you to save.

Pictures on your computer aren't sent, and password-locked documents never are. Pictures and files stored on Notion can't be removed or moved from here, so do that in Notion.

## Your home server

Add your servers in **File → Home Server → My Servers…**. The app tests each one before keeping it.

**Open a Folder on My Server…** works with Nextcloud, ownCloud and any WebDAV server. The app keeps its own copy of the folder's documents and pictures, so everything works as it does for a folder on your computer, even offline. Your changes go up by themselves, and changes on the server come down within a minute, or when you press Refresh in the Files panel. Nothing on your server is deleted from here. If a document changed in both places, the server's version stays and yours is kept beside it as a copy.

**Publish This Document to My Wiki…** and **Publish This Folder to My Wiki…** send your writing to BookStack, Wiki.js or Outline, with pictures, and links between your documents become links between pages. Publishing again updates the same pages. Nothing on a wiki is deleted from here.
