// Pictures another app sent with a document (3.11). The document isn't saved yet, so they're held with it, and they move to
// the `images` folder beside it when it's saved, like a pasted picture. A picture is found by its file name, whichever folder
// the text says it's in.
const PICTURE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(\s+"[^"]*")?\)/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const decoded = (src) => { try { return decodeURIComponent(src); } catch { return src; } };
const baseName = (src) => decoded(String(src)).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();

/** The picture a link in the text means, if it's one that was sent. */
export function sentPicture(src, pictures) {
  if (!pictures?.length || !src || HAS_SCHEME.test(src)) return null;
  const name = baseName(src);
  return pictures.find((p) => p.name.toLowerCase() === name) || null;
}

/** The text with links to sent pictures pointing at where they were saved. `saved` maps a picture's name to its new path. */
export function swapSentPictures(text, saved) {
  const byName = new Map([...saved].map(([name, rel]) => [name.toLowerCase(), rel]));
  return String(text).replace(PICTURE, (whole, alt, angled, plain, title = '') => {
    const src = angled ?? plain;
    const rel = HAS_SCHEME.test(src) ? null : byName.get(baseName(src));
    return rel ? `![${alt}](${rel}${title})` : whole;
  });
}

/** A picture's bytes, to save it. */
export function pictureBytes(url) {
  const raw = atob(String(url).slice(String(url).indexOf(',') + 1));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
