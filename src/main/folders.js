'use strict';
// Browsing and searching a folder of Markdown files (File > Open Folder…).
// Only folders the user picked in the native folder dialog are ever scanned (see main.js).
const fs = require('node:fs');
const path = require('node:path');
const { isOpenablePath, isLockedPath } = require('./files');

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache', '$RECYCLE.BIN', 'System Volume Information']);
const LIMITS = Object.freeze({ maxDepth: 10, maxFiles: 5000, maxSearchBytes: 2 * 1024 * 1024, maxMatches: 1000, maxPerFile: 50 });

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Scan a folder for Markdown files.
 * @returns {Promise<{ root: string, name: string, tree: object, files: string[], truncated: boolean }>}
 * tree nodes: { name, path, dirs: Node[], files: { name, path }[] } — folders without Markdown are left out.
 */
async function scanFolder(root, limits = LIMITS) {
  const files = [];
  let truncated = false;
  async function walk(dir, depth) {
    const node = { name: path.basename(dir) || dir, path: dir, dirs: [], files: [] };
    if (depth > limits.maxDepth) return node;
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return node; }
    for (const e of entries) {
      if (files.length >= limits.maxFiles) { truncated = true; break; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const child = await walk(full, depth + 1);
        if (child.dirs.length || child.files.length) node.dirs.push(child);
      } else if (e.isFile() && isOpenablePath(full)) {
        node.files.push(isLockedPath(full) ? { name: e.name, path: full, locked: true } : { name: e.name, path: full });
        files.push(full);
      }
    }
    node.dirs.sort(byName);
    node.files.sort(byName);
    return node;
  }
  const tree = await walk(root, 0);
  return { root, name: path.basename(root) || root, tree, files, truncated };
}

/**
 * Search every Markdown file in a scanned folder for plain text (case-insensitive).
 * @returns {Promise<{ results: { path, name, rel, matches: { line, text, col }[] }[], total: number, truncated: boolean }>}
 */
async function searchFolder(scan, query, limits = LIMITS) {
  const q = String(query || '').trim();
  if (!q) return { results: [], total: 0, truncated: false };
  const needle = q.toLowerCase();
  const results = [];
  let total = 0;
  let truncated = false;
  for (const file of scan.files) {
    if (isLockedPath(file)) continue;          // locked documents are never searched
    let text;
    try {
      const st = await fs.promises.stat(file);
      if (st.size > limits.maxSearchBytes) continue;
      text = await fs.promises.readFile(file, 'utf8');
    } catch { continue; }
    if (!text.toLowerCase().includes(needle)) continue;
    const matches = [];
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < limits.maxPerFile; i++) {
      const col = lines[i].toLowerCase().indexOf(needle);
      if (col >= 0) matches.push({ line: i, col, text: excerpt(lines[i], col, q.length) });
    }
    if (!matches.length) continue;
    results.push({ path: file, name: path.basename(file), rel: path.relative(scan.root, file), matches });
    total += matches.length;
    if (total >= limits.maxMatches) { truncated = true; break; }
  }
  return { results, total, truncated };
}

/** A short piece of the line around the match, so long lines stay readable. */
function excerpt(line, col, len, radius = 60) {
  const start = Math.max(0, col - radius);
  const end = Math.min(line.length, col + len + radius);
  return (start > 0 ? '…' : '') + line.slice(start, end).trim() + (end < line.length ? '…' : '');
}

module.exports = { scanFolder, searchFolder, excerpt, LIMITS, SKIP_DIRS };
