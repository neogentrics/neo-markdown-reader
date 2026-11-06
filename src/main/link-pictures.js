'use strict';
// Pictures that travel with a document over App Link (3.11). docs/app-link.md has the rules. They go as paths, because both
// apps are on one computer: only PNG, JPEG, WebP and GIF, checked by their first bytes and not just their names. Anything
// else on a list is dropped, and the document still opens.
const fs = require('node:fs');
const path = require('node:path');
const { imageKind, MAX_BYTES } = require('./images');
const { localPictures, pictureFile } = require('./wikis');
const { cleanName } = require('./app-link');

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const PICTURE_FILE = /\.(?:png|jpe?g|webp|gif)$/i;
const MAX_PICTURES = 50;
const MAX_TOTAL = 100 * 1024 * 1024;
const FIRST_BYTES = 16;

/** Never a path that reaches another computer: just looking at one would hand it this person's sign-in. */
const onThisComputer = (file) => typeof file === 'string' && path.isAbsolute(file) && !/^[\\/]{2}/.test(file);

async function firstBytes(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(FIRST_BYTES), 0, FIRST_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

/** The pictures a saved document shows, as the list to send with it. An unsaved one has no folder to find them in. */
async function attachmentsFor(text, docPath) {
  if (typeof docPath !== 'string' || !docPath) return [];
  const dir = path.dirname(docPath);
  const files = new Set(localPictures(text).map((src) => pictureFile(dir, src)).filter((file) => PICTURE_FILE.test(file)));
  const found = [];
  for (const file of files) {
    if (found.length >= MAX_PICTURES) break;
    try {
      if (TYPES[imageKind(await firstBytes(file))]) found.push({ name: path.basename(file), path: file });
    } catch { /* it isn't there, so it can't go */ }
  }
  return found;
}

/** A name another app gave a picture, without folders. */
function pictureName(item) {
  const given = typeof item.name === 'string' ? cleanName(item.name.split(/[\\/]/).pop()) : '';
  return given || path.basename(item.path);
}

/** What a list from another app really holds: pictures, read once, because the sender may remove its copies. */
async function readAttachments(list) {
  if (!Array.isArray(list)) return [];
  const pictures = [];
  let total = 0;
  for (const item of list.slice(0, MAX_PICTURES)) {
    if (!onThisComputer(item?.path) || !PICTURE_FILE.test(item.path)) continue;
    try {
      const { size } = await fs.promises.stat(item.path);
      if (size > MAX_BYTES || total + size > MAX_TOTAL) continue;
      const data = await fs.promises.readFile(item.path);
      const type = TYPES[imageKind(data)];
      if (!type) continue;
      total += data.length;
      pictures.push({ name: pictureName(item), url: `data:${type};base64,${data.toString('base64')}` });
    } catch { /* it's gone, or it's a folder */ }
  }
  return pictures;
}

const decoded = (src) => { try { return decodeURIComponent(src); } catch { return src; } };
const baseName = (src) => decoded(src).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();

/** The text with any picture it doesn't show added at the end, so nothing that was sent is out of sight. */
function showEveryPicture(text, pictures) {
  const shown = new Set(localPictures(text).map(baseName));
  const left = pictures.filter((p) => !shown.has(p.name.toLowerCase()));
  if (!left.length) return text;
  const lines = left.map((p) => `![${p.name.replace(/[[\]]/g, '')}](<${p.name.replace(/[<>]/g, '')}>)`);
  return `${String(text).trimEnd()}\n\n${lines.join('\n\n')}\n`;
}

module.exports = { attachmentsFor, readAttachments, showEveryPicture, MAX_PICTURES };
