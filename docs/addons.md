# Writing an add-on

An add-on gives Neo Markdown Reader new **code-block types**, **export formats** and **colour themes**.
It's a folder with an `addon.json` and a few JavaScript files, zipped and renamed to `.nmraddon`.
A complete example is in [samples/addons/neo-extras](../samples/addons/neo-extras): a `timeline` code
block, an outline export (OPML) and the Solar theme.

## What an add-on can and can't do

- Its code runs in the app's sealed sandbox, the same one that runs ▶ Run code blocks. It can't use the
  internet, read or write files, see your settings or change your documents. It gets some text, and it
  gives some text back.
- What it draws is cleaned like any document. Scripts, event handlers, links, pictures and anything loaded
  from a web address are removed, so a drawing must be self-contained: HTML or inline SVG, with styles
  written in `style="…"` attributes.
- A theme is colours only. The app writes the CSS itself.
- Before an add-on is installed, the reader sees its name, its author and what it adds. Nothing is installed
  until they agree.

## The package

```
my-addon/
├── addon.json
├── timeline.js
└── opml.js
```

Zip the folder (or just its contents) and rename the `.zip` to `.nmraddon`. *View → Add-ons… → Install
Add-on…* also accepts a `.zip`, or the `addon.json` file of an unzipped folder.

Limits:
- 4 MB in all, 1 MB for each file and 200 files; each script is at most 512 KB.
- Only `addon.json` and the scripts it names are installed. Any other files are left out.
- File names may not contain `..`, backslashes or a drive letter.

## addon.json

```json
{
  "id": "neo-extras",
  "name": "Neo Extras",
  "version": "1.0.0",
  "author": "Neo Gentrics",
  "description": "Timeline blocks, an outline export (OPML) and the Solar theme.",
  "themes": [
    { "id": "solar", "name": "Solar", "tone": "light", "colors": { "page": "#fdf6e3", "accent": "#8a4700" } }
  ],
  "codeBlocks": [
    { "language": "timeline", "script": "timeline.js" }
  ],
  "exports": [
    { "id": "opml", "name": "Outline (OPML)", "extension": "opml", "script": "opml.js" }
  ]
}
```

| Field | Rules |
|---|---|
| `id` | 2–40 lowercase letters, digits or dashes. Installing an add-on with the same id updates it. |
| `name` | Up to 60 characters. |
| `version` | Like `1.0.0` (up to four numbers, optionally `-beta.1`). |
| `author`, `description` | Optional; up to 80 and 300 characters. |
| `themes` | Up to 5. |
| `codeBlocks` | Up to 10. |
| `exports` | Up to 5. |

An add-on must add at least one theme, code-block type or export format.

## Code-block types

```json
{ "language": "timeline", "script": "timeline.js" }
```

Every ```` ```timeline ```` block in a document is replaced by what the script draws. Language names are
lowercase, like `timeline` or `abc-notation`. The app's own block types can't be taken over: `mermaid`,
`chart`, `math`, `markdown`, and the runnable JavaScript and Python languages.

The script defines `main`, which gets `{ code, language }` and returns HTML or SVG as a string:

```js
function main({ code }) {
  const lines = code.split('\n').filter(Boolean);
  return `<svg viewBox="0 0 400 ${lines.length * 30}" role="img" aria-label="${lines.length} events">…</svg>`;
}
```

- `main` may be `async`. It has 5 seconds, and the result may be up to 2 MB.
- If it throws, the block shows the error above the original code.
- Use the theme's colours so the drawing matches every theme:
  `style="fill:var(--text, #1d2330)"`. The variables are the colour names below, written in
  CSS form (`--accent`, `--text-soft`, `--code-bg`…).
- Give an `<svg>` a `role="img"` and an `aria-label` that says what it shows, for screen readers.
- Drawings are kept in PDF, Word (as a picture), web page and e-book exports.

## Export formats

```json
{ "id": "opml", "name": "Outline (OPML)", "extension": "opml", "script": "opml.js" }
```

The format appears as *File → Export → Outline (OPML) (.opml)…*. The script's `main` gets the document:

| Field | What it is |
|---|---|
| `title` | The document's title (front matter `title`, or its first heading, or its file name). |
| `name` | Its file name. |
| `markdown` | Its text, as written. |
| `html` | The rendered page, cleaned (as in the web page export, without the app's styles). |
| `headings` | `[{ level, text, id }]`, in order. |

It returns the new file's text as a string, or `{ base64: "…" }` for a binary file. It has 20 seconds, and
the file may be up to 50 MB. The reader chooses where to save it, and the app adds the extension.

File types that could be run as programs (`exe`, `bat`, `cmd`, `ps1`, `js`, `sh`, `msi`, `app`, `dmg` and
others) can't be exported.

## Themes

```json
{ "id": "solar", "name": "Solar", "tone": "light", "colors": { "page": "#fdf6e3", "text": "#3b4a52" } }
```

A theme sits on the light theme (`"tone": "light"`, the default) or the dark one (`"tone": "dark"`), and
changes the colours you list. It appears in *View → Theme* as “Solar (Neo Extras)”. Colours are written as
hex: `#rgb`, `#rrggbb` or `#rrggbbaa`.

| Colour | Used for |
|---|---|
| `page`, `desk` | The page, and the background around it |
| `text`, `textSoft`, `muted`, `heading` | Body text, softer text, hints and labels, headings |
| `accent`, `accent2`, `accentSoft`, `onAccent` | Buttons and highlights, a second accent, pale accent backgrounds, text on an accent |
| `link` | Links |
| `rule`, `ruleStrong` | Lines and borders |
| `codeBg`, `codeBorder`, `inlineCodeBg`, `inlineCodeText` | Code blocks and `inline code` |
| `tableHead`, `tableStripe` | Table headers and alternate rows |
| `quoteBar`, `quoteBg` | Quotes |
| `mark`, `sel` | `==Highlighted==` text and selected text |
| `chrome`, `chromeBorder` | The toolbar, tabs and sidebar |

A theme must stay readable. Each of these pairs needs a contrast of at least 4.5:1 (WCAG AA), or the add-on
isn't installed and the reader is told which pair is too faint:

- `text`, `textSoft`, `muted`, `heading` and `link` on `page`;
- `text` on `codeBg`, and `inlineCodeText` on `inlineCodeBg`;
- `text` and `muted` on `chrome`;
- `accent` on `accentSoft`, and `onAccent` on `accent`.

A colour you leave out comes from the light or dark theme underneath.

## Trying it out

1. Zip the folder and install it from *View → Add-ons…*.
2. To change it, edit the files, zip them again and install again: the same id updates the add-on.
3. If a script fails, the block or the export shows its error message.

The reader can turn an add-on off, or remove it, in *View → Add-ons…*. Their documents are never changed:
with the add-on off, a `timeline` block is shown as ordinary code again.
