'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdx', '.txt']);
const MAX_BYTES = 50 * 1024 * 1024;

function isMarkdownPath(p) {
  return typeof p === 'string' && MARKDOWN_EXTS.has(path.extname(p).toLowerCase());
}

/** Pick the first markdown file passed on a command line (double-click / "Open with" / CLI). */
function fileFromArgv(argv, cwd = process.cwd()) {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const abs = path.resolve(cwd, arg);
    if (isMarkdownPath(abs) && fs.existsSync(abs)) return abs;
  }
  return null;
}

async function readMarkdown(filePath) {
  const abs = path.resolve(filePath);
  if (!isMarkdownPath(abs)) throw new Error('Not a Markdown file: ' + path.basename(abs));
  const stat = await fs.promises.stat(abs);
  if (!stat.isFile()) throw new Error('Not a file: ' + abs);
  if (stat.size > MAX_BYTES) throw new Error('File is too large to display (over 50 MB).');
  const content = (await fs.promises.readFile(abs, 'utf8')).replace(/^﻿/, '');
  const dir = path.dirname(abs);
  let baseUrl = pathToFileURL(dir).href;
  if (!baseUrl.endsWith('/')) baseUrl += '/';
  return { path: abs, name: path.basename(abs), dir, baseUrl, content, mtime: stat.mtimeMs, size: stat.size };
}

module.exports = { MARKDOWN_EXTS, isMarkdownPath, fileFromArgv, readMarkdown };
