# Editing a document

Documents open read-only, so nothing changes by accident.

1. Click **Edit** in the toolbar, or press `Ctrl+E`.
2. The app asks first. Choose **Just This Time**, or allow it always for that file or folder.
3. Type, then press `Ctrl+S` to save.
4. Click the button again to go back to reading.

The original is backed up before the first save. Change what you've allowed in [Preferences → Editing](#do=preferences:editing).

## Going back

- **Version History** (`Ctrl+Shift+Y`) keeps earlier saves, so you can compare and restore them. It's under **Edit → Compare and History**.
- **Backups** are in the folder you can open from [Preferences → Editing](#do=preferences:editing).

## Writing faster

- Paste a picture and it's saved in an `images` folder next to the document.
- Paste from a spreadsheet and it becomes a table. **Edit → Edit Table…** edits one in a grid.
- Paste from a web page or Word and it becomes Markdown.
- **File → New from Template** starts a meeting note, README, checklist or report.
- **File → This Document → Import Word Document…** brings in a `.docx`.

## Locking a document

**File → This Document → Protect with Password…** saves an encrypted copy. A forgotten password can't be recovered.

## Dictation

While you're editing, press `Ctrl+Alt+D` or the microphone button, and speak. Your words appear at the cursor at each pause. Press it again to stop.

The first time, the app asks to download the speech model, about 80 MB, one time only. After that it works offline, and what you say never leaves your computer. Choose your microphone in [Preferences → Reading Aloud](#do=preferences:voices).

## Citations

Cite your sources in the text, and the app writes the citations and the reference list.

```
---
bibliography: refs.bib
citation-style: apa
---

Most networks go unwatched [@smith2020, p. 50].
Others disagree [see @lee2018; @ross2021].
@lee2018 [p. 12] argues for a short plan.
```

1. Put a BibTeX (`.bib`) or CSL JSON (`.json`) file next to your document and name it in the front matter, or choose one library for all your documents in *Edit → Insert Citation*.
2. To use Zotero instead, choose **Use Zotero** there. Zotero must be open, with *Allow other applications on this computer to communicate with Zotero* ticked under *Settings → Advanced*. The app keeps a copy, so citations still work when Zotero is closed. Choose **Refresh** after adding sources.
3. While editing, type `[@` to pick from your sources, or use *Edit → Insert Citation*.

The style can be `apa`, `mla`, `chicago`, `ieee` or `harvard`. Set it in the same window, or per document with `citation-style`.

The reference list goes at the end, under a heading of your own if the document ends with one such as *References* or *Bibliography*. To put it somewhere else, add `<!-- bibliography -->` there. Exports include it all.

Titles appear as your library has them, so check their capitals against your style. `.csl` style files aren't supported. A key that isn't in the document's bibliography is shown in red.
