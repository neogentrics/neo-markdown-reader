# Folders, links and tasks

**File → Open Folder…** (`Ctrl+Shift+O`) shows a folder in the **Files** panel, and turns on everything below.

## Finding things

- **Find in Folder** (`Ctrl+Shift+F`) searches every document.
- **Search by meaning**, a tick box in the same panel, finds documents about what you asked even if they use other words, or another language. *Related documents* then appear under the outline.
- **Replace in Folder** (`Ctrl+Shift+R`) previews each change first, and can undo the batch.

## Search by meaning

The first time you tick **Search by meaning**, the app asks to download its model, about 135 MB. After that it works offline, and your documents never leave your computer.

The app then reads the folder in the background, and keeps up as documents change. Results appear while it's reading, and improve as it goes. It works best with folders of at least a few dozen short sections.

Locked documents are never read. What it keeps is a list of numbers for each passage, not your words. To free the space, choose **Remove Smart Search Download** in *Find a Command* (`Ctrl+K`, then `>`).

## Linking documents

- Type `[[` in the editor to link to another document by name.
- **Backlinks** at the bottom of the Outline show what links here.
- **View → Panels → Link Map** draws how your documents connect.
- **Edit → Check Links in Folder…** finds links that go nowhere.
- Renaming a document with `F2` offers to update the links to it.

To insert standard Markdown links instead of `[[wiki links]]`, use [Preferences → Editing](#do=preferences:editing).

## Tags and tasks

- Tags such as `#idea` show as chips in the Files panel.
- The **Tasks** panel lists every `- [ ]` task in the folder, overdue ones first.
- **File → Today’s Note** opens a daily note in the folder.
