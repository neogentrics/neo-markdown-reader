'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdx', '.txt']);
const LOCKED_EXT = '.mdlock';
const MAX_BYTES = 50 * 1024 * 1024;
const BOM = '﻿';

function isMarkdownPath(p) {
  return typeof p === 'string' && MARKDOWN_EXTS.has(path.extname(p).toLowerCase());
}

/** A password-locked document (see locked.js). */
function isLockedPath(p) {
  return typeof p === 'string' && path.extname(p).toLowerCase() === LOCKED_EXT;
}

/** Anything the reader opens: Markdown, plain text, or a locked document. */
function isOpenablePath(p) {
  return isMarkdownPath(p) || isLockedPath(p);
}

/** Pick the first markdown file passed on a command line (double-click / "Open with" / CLI). */
function fileFromArgv(argv, cwd = process.cwd()) {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const abs = path.resolve(cwd, arg);
    if (isOpenablePath(abs) && fs.existsSync(abs)) return abs;
  }
  return null;
}

/** The line ending a file mostly uses ('\r\n' for typical Windows files, else '\n'). */
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/** Can this process write the file? On Windows this also reflects the read-only attribute. */
async function isWritable(p) {
  try { await fs.promises.access(p, fs.constants.W_OK); return true; } catch { return false; }
}

async function readMarkdown(filePath) {
  const abs = path.resolve(filePath);
  if (!isMarkdownPath(abs)) throw new Error('Not a Markdown file: ' + path.basename(abs));
  const stat = await fs.promises.stat(abs);
  if (!stat.isFile()) throw new Error('Not a file: ' + abs);
  if (stat.size > MAX_BYTES) throw new Error('File is too large to display (over 50 MB).');
  const raw = await fs.promises.readFile(abs, 'utf8');
  const bom = raw.startsWith(BOM);
  const eol = detectEol(raw);
  // The page always works with '\n'; the original line ending and BOM are restored on save.
  const content = (bom ? raw.slice(1) : raw).replace(/\r\n/g, '\n');
  const dir = path.dirname(abs);
  let baseUrl = pathToFileURL(dir).href;
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  return {
    path: abs, name: path.basename(abs), dir, baseUrl, content,
    mtime: stat.mtimeMs, size: stat.size, eol, bom, writable: await isWritable(abs),
  };
}

function docBase(abs, stat) {
  const dir = path.dirname(abs);
  let baseUrl = pathToFileURL(dir).href;
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  return { path: abs, name: path.basename(abs), dir, baseUrl, mtime: stat.mtimeMs, size: stat.size };
}

/**
 * Read a password-locked document. With a key remembered from an earlier unlock it comes back
 * readable; otherwise it comes back as { needsPassword: true } with no content.
 * @param {(abs: string) => Buffer | null | undefined} keyFor
 */
async function readLocked(filePath, keyFor = () => null) {
  const { unlockWithKey, parseEnvelope } = require('./locked');
  const abs = path.resolve(filePath);
  const stat = await fs.promises.stat(abs);
  if (!stat.isFile()) throw new Error('Not a file: ' + abs);
  if (stat.size > MAX_BYTES * 1.6) throw new Error('File is too large to open.');
  const text = await fs.promises.readFile(abs, 'utf8');
  parseEnvelope(text);                      // throws a friendly error if it isn't a locked document
  const base = { ...docBase(abs, stat), locked: true, eol: '\n', bom: false, writable: await isWritable(abs) };
  const key = keyFor(abs);
  if (!key) return { ...base, content: '', needsPassword: true };
  const { content } = unlockWithKey(text, key);
  return { ...base, content: content.replace(/\r\n/g, '\n') };
}

/** Read anything openable. */
function readDocument(filePath, keyFor) {
  return isLockedPath(filePath) ? readLocked(filePath, keyFor) : readMarkdown(filePath);
}

/** Turn editor text back into the file's original format (line endings, BOM). */
function encodeForSave(text, { eol = '\n', bom = false } = {}) {
  let out = String(text).replace(/\r\n/g, '\n');
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return (bom ? BOM : '') + out;
}

/** Is `file` inside `folder` (or the folder itself)? Case-insensitive on Windows and macOS. */
function isInside(folder, file, platform = process.platform) {
  const norm = (p) => {
    let r = path.resolve(p);
    if (platform === 'win32' || platform === 'darwin') r = r.toLowerCase();
    return r;
  };
  const f = norm(folder);
  const p = norm(file);
  return p === f || p.startsWith(f.endsWith(path.sep) ? f : f + path.sep);
}

module.exports = { MARKDOWN_EXTS, LOCKED_EXT, isLockedPath, isOpenablePath, readLocked, readDocument, isMarkdownPath, fileFromArgv, readMarkdown, encodeForSave, detectEol, isWritable, isInside };
