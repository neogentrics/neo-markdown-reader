'use strict';
// Private highlights and notes. Stored by the app (in the user's app-data folder), never written into
// the Markdown file. Each highlight remembers the quoted text plus a little context before and after,
// so it can be found again even if the document changes around it.
const fs = require('node:fs');
const path = require('node:path');

const MAX_PER_FILE = 500;
const MAX_FILES = 2000;
const COLORS = ['yellow', 'green', 'blue', 'pink'];

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanAnnotation(a) {
  if (!a || typeof a !== 'object') return null;
  const quote = str(a.quote, 2000);
  if (!quote.trim()) return null;
  return {
    id: str(a.id, 64) || Math.random().toString(36).slice(2, 12),
    quote,
    prefix: str(a.prefix, 64),
    suffix: str(a.suffix, 64),
    color: COLORS.includes(a.color) ? a.color : 'yellow',
    note: str(a.note, 5000),
    created: Number.isFinite(a.created) ? a.created : Date.now(),
  };
}

class AnnotationStore {
  constructor(dir, platform = process.platform) {
    this.file = path.join(dir, 'annotations.json');
    this.platform = platform;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) this.data = {};
    this._timer = null;
  }

  key(p) { const r = path.resolve(p); return this.platform === 'win32' || this.platform === 'darwin' ? r.toLowerCase() : r; }

  get(p) { return (this.data[this.key(p)]?.items || []).map((a) => ({ ...a })); }

  set(p, list) {
    const items = (Array.isArray(list) ? list : []).map(cleanAnnotation).filter(Boolean).slice(0, MAX_PER_FILE);
    const k = this.key(p);
    if (items.length) this.data[k] = { path: path.resolve(p), items, updated: Date.now() };
    else delete this.data[k];
    // Keep the most recently used files if the store grows very large.
    const keys = Object.keys(this.data);
    if (keys.length > MAX_FILES) {
      keys.sort((a, b) => (this.data[a].updated || 0) - (this.data[b].updated || 0));
      for (const old of keys.slice(0, keys.length - MAX_FILES)) delete this.data[old];
    }
    this.save();
    return this.get(p);
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch { /* non-fatal */ }
  }
}

module.exports = { AnnotationStore, cleanAnnotation, COLORS };
