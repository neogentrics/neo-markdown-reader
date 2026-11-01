'use strict';
// Pictures pasted or dropped into the editor are saved in an `images` folder next to the document.
// Only real picture files are written (checked by their first bytes, not just their name), never over
// an existing file, and never anywhere but that folder.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 25 * 1024 * 1024;
const SIGNATURES = [
  ['png', (b) => b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG'],
  ['jpg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', (b) => b.toString('latin1', 0, 4) === 'GIF8'],
  ['webp', (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
  ['bmp', (b) => b.toString('latin1', 0, 2) === 'BM'],
  ['avif', (b) => b.toString('latin1', 4, 12) === 'ftypavif'],
];

/** The picture format of these bytes ('png', 'jpg', …), or null if they aren't a picture we accept. */
function imageKind(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  return SIGNATURES.find(([, test]) => test(b))?.[0] || null;
}

/** A tidy file name: letters, digits, dashes; no path parts; the right extension. */
function safeName(name, ext) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
    .normalize('NFKC').replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(0, 60);
  return `${base || 'image'}.${ext}`;
}

/** A name in `dir` that isn't taken yet: photo.png, photo-2.png, photo-3.png… */
function freeName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let n = 1; n < 10000; n++) {
    const candidate = n === 1 ? name : `${base}-${n}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

/** "pasted-2026-11-01-153012" for screenshots and other pictures without a real name. */
function pastedName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `pasted-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Save picture bytes next to the document `docPath`.
 * @returns {Promise<{ ok: true, rel: string, file: string } | { ok: false, reason: string }>}
 *   rel is the link to put in the document, e.g. "images/photo.png".
 */
async function saveImage(docPath, { name, data }, { folder = 'images' } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (!bytes.length) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too-large' };
  const kind = imageKind(bytes);
  if (!kind) return { ok: false, reason: 'not-image' };
  const dir = path.join(path.dirname(path.resolve(docPath)), folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = freeName(dir, safeName(name && !/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? name : pastedName(), kind));
  await fs.promises.writeFile(path.join(dir, file), bytes, { flag: 'wx' });
  return { ok: true, rel: `${folder}/${file}`, file: path.join(dir, file) };
}

module.exports = { saveImage, imageKind, safeName, freeName, pastedName, MAX_BYTES };
