'use strict';
// The open folder's links, tags and tasks (2.3), for Backlinks, the link map, the Tags and Tasks panels
// and the link checker. Each document is read once and re-read only when it changes; locked documents
// are never read, and very large files are skipped.
const fs = require('node:fs');
const path = require('node:path');
const core = require('./notes-core');
const { parseCards } = require('./flashcards');
const { isLockedPath } = require('./files');

const MAX_BYTES = 2 * 1024 * 1024;

class FolderIndex {
  constructor() {
    this.cache = new Map();          // path -> { mtime, size, data, lines }
  }

  /** Bring the index up to date with a folder scan ({ root, files }). */
  async update(scan) {
    const wanted = new Set();
    const docs = new Map();
    for (const file of scan.files) {
      if (isLockedPath(file)) continue;
      wanted.add(file);
      let st;
      try { st = await fs.promises.stat(file); } catch { continue; }
      if (st.size > MAX_BYTES) continue;
      let entry = this.cache.get(file);
      if (!entry || entry.mtime !== st.mtimeMs || entry.size !== st.size) {
        let text;
        try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
        const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
        entry = { mtime: st.mtimeMs, size: st.size, data: core.extract(clean), lines: clean.split('\n') };
        this.cache.set(file, entry);
      }
      docs.set(file, entry.data);
    }
    for (const p of this.cache.keys()) if (!wanted.has(p)) this.cache.delete(p);
    this.root = scan.root;
    this.docs = docs;
    this.files = scan.files.filter((f) => !isLockedPath(f)).map((f) => ({ path: f, rel: path.relative(scan.root, f) }));
    this.links = core.allLinks(docs, this.files);
    return this;
  }

  rel(p) { return path.relative(this.root, p); }

  /** The flashcards in each document, worked out once per version of the file. */
  cards() {
    const out = [];
    for (const f of this.files) {
      const entry = this.cache.get(f.path);
      if (!entry) continue;
      entry.cards ??= parseCards(entry.lines.join('\n'));
      if (entry.cards.length) out.push({ ...f, cards: entry.cards });
    }
    return out;
  }

  /** One line of a document, cleaned up for showing as context. */
  lineText(p, line) {
    const text = this.cache.get(p)?.lines[line] ?? '';
    return text.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  backlinks(p) {
    return core.backlinks(this.links, p, (f, l) => this.lineText(f, l)).map((b) => ({ ...b, rel: this.rel(b.from), title: this.docs.get(b.from)?.title || '' }));
  }

  graph() { return core.graph(this.links, this.files); }

  tags() { return core.tagSummary(this.docs).map((t) => ({ ...t, files: t.files.map((f) => ({ path: f, rel: this.rel(f) })) })); }

  tasks(today) { return core.taskList(this.docs, today).map((t) => ({ ...t, rel: this.rel(t.path) })); }

  check() {
    return core.checkLinks(this.docs, this.files, (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
      .map((p) => ({ ...p, rel: this.rel(p.path), text: this.lineText(p.path, p.line) }));
  }

  /** Documents linking to `oldPath`, and their texts with those links pointing at `newPath` instead. */
  retarget(oldPath, newPath) {
    const sources = new Set(this.links.filter((l) => l.to === oldPath && l.from !== oldPath).map((l) => l.from));
    const out = [];
    for (const from of sources) {
      const lines = this.cache.get(from)?.lines;
      if (!lines) continue;
      const res = core.retargetLinks(lines.join('\n'), from, oldPath, newPath, this.files);
      if (res.count) out.push({ path: from, text: res.text, count: res.count });
    }
    return out;
  }
}

module.exports = { FolderIndex };
