'use strict';
// Version history: every time a document is saved (or changed by Find & Replace, or restored), the
// version being replaced is kept here, in the app's own data folder — never next to the document.
//
//   history/<doc id>/index.json   { path, versions: [{ id, time, size, hash, reason }] }
//   history/<doc id>/<id>.gz      the file's bytes exactly as they were (gzip-compressed)
//
// Locked documents are kept as the encrypted bytes they are on disk, so their history is encrypted too.
// Kept: every version from the last 30 days, then the newest version of each day, and at most 1 GB in
// total (the oldest go first; the newest version of each document is always kept).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULTS = Object.freeze({ keepAllDays: 30, maxBytes: 1024 * 1024 * 1024, maxPerDoc: 2000 });
const ID_RE = /^\d{13}-[0-9a-f]{6}$/;

const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/**
 * Which versions to delete. Pure, so it can be tested.
 * @param {{ doc: string, id: string, time: number, size: number }[]} all  every stored version
 * @returns {Set<string>} keys `${doc}/${id}` to delete
 */
function planPrune(all, now, { keepAllDays = DEFAULTS.keepAllDays, maxBytes = DEFAULTS.maxBytes, maxPerDoc = DEFAULTS.maxPerDoc } = {}) {
  const drop = new Set();
  const key = (v) => `${v.doc}/${v.id}`;
  const byDoc = new Map();
  for (const v of all) { if (!byDoc.has(v.doc)) byDoc.set(v.doc, []); byDoc.get(v.doc).push(v); }
  const newest = new Set();
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.time - a.time);
    newest.add(key(list[0]));
    const seenDays = new Set();
    list.forEach((v, i) => {
      if (i >= maxPerDoc) { drop.add(key(v)); return; }
      if (now - v.time <= keepAllDays * DAY) return;
      const day = localDay(v.time);
      if (seenDays.has(day)) drop.add(key(v)); else seenDays.add(day);       // keep the newest of each older day
    });
  }
  let total = all.filter((v) => !drop.has(key(v))).reduce((n, v) => n + v.size, 0);
  if (total > maxBytes) {
    for (const v of [...all].sort((a, b) => a.time - b.time)) {
      if (total <= maxBytes) break;
      if (drop.has(key(v)) || newest.has(key(v))) continue;
      drop.add(key(v));
      total -= v.size;
    }
  }
  return drop;
}

class HistoryStore {
  /** @param {string} dir  @param {{ platform?: string, now?: () => number, limits?: object }} [opts] */
  constructor(dir, { platform = process.platform, now = () => Date.now(), limits = {} } = {}) {
    this.dir = dir;
    this.platform = platform;
    this.now = now;
    this.limits = { ...DEFAULTS, ...limits };
    this.queue = Promise.resolve();
  }

  /** Run one change at a time, so two saves can't interleave their index updates. */
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  docId(p) {
    const abs = path.resolve(p);
    const k = this.platform === 'win32' || this.platform === 'darwin' ? abs.toLowerCase() : abs;
    return crypto.createHash('sha256').update(k).digest('hex').slice(0, 32);
  }

  docDir(p) { return path.join(this.dir, this.docId(p)); }

  async readIndex(docDir) {
    try {
      const idx = JSON.parse(await fs.promises.readFile(path.join(docDir, 'index.json'), 'utf8'));
      return { path: String(idx.path || ''), versions: Array.isArray(idx.versions) ? idx.versions.filter((v) => ID_RE.test(v?.id)) : [] };
    } catch { return null; }
  }

  async writeIndex(docDir, idx) {
    const tmp = path.join(docDir, `index.${process.pid}.tmp`);
    await fs.promises.writeFile(tmp, JSON.stringify(idx));
    await fs.promises.rename(tmp, path.join(docDir, 'index.json'));
  }

  /**
   * Keep `bytes` as a version of `p` (unless it's the same as the newest version kept).
   * @returns {Promise<{ id: string, time: number } | null>}
   */
  add(p, bytes, reason = 'save') {
    return this.serial(async () => {
      if (!bytes || !bytes.length) return null;
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const docDir = this.docDir(p);
      await fs.promises.mkdir(docDir, { recursive: true });
      const idx = (await this.readIndex(docDir)) || { path: path.resolve(p), versions: [] };
      idx.path = path.resolve(p);
      if (idx.versions[0]?.hash === hash) return null;
      const time = Math.max(this.now(), (idx.versions[0]?.time || 0) + 1);
      const id = `${String(time).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
      await fs.promises.writeFile(path.join(docDir, `${id}.gz`), zlib.gzipSync(buf));
      idx.versions.unshift({ id, time, size: buf.length, hash, reason: ['save', 'replace', 'restore'].includes(reason) ? reason : 'save' });
      await this.writeIndex(docDir, idx);
      await this.prune();
      return { id, time };
    });
  }

  /** The versions kept for `p`, newest first. */
  async list(p) {
    const idx = await this.readIndex(this.docDir(p));
    return (idx?.versions || []).map(({ id, time, size, reason }) => ({ id, time, size, reason }));
  }

  /** One version's bytes. */
  async read(p, id) {
    if (!ID_RE.test(String(id))) throw new Error('No such version');
    const docDir = this.docDir(p);
    const idx = await this.readIndex(docDir);
    if (!idx?.versions.some((v) => v.id === id)) throw new Error('That version is no longer kept');
    return zlib.gunzipSync(await fs.promises.readFile(path.join(docDir, `${id}.gz`)));
  }

  /** Apply the retention rules across every document. */
  async prune() {
    let docs = [];
    try { docs = (await fs.promises.readdir(this.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return 0; }
    const all = [];
    const indexes = new Map();
    for (const doc of docs) {
      const idx = await this.readIndex(path.join(this.dir, doc));
      if (!idx) continue;
      indexes.set(doc, idx);
      for (const v of idx.versions) all.push({ doc, id: v.id, time: v.time, size: v.size });
    }
    const drop = planPrune(all, this.now(), this.limits);
    if (!drop.size) return 0;
    for (const [doc, idx] of indexes) {
      const before = idx.versions.length;
      const gone = idx.versions.filter((v) => drop.has(`${doc}/${v.id}`));
      if (!gone.length) continue;
      idx.versions = idx.versions.filter((v) => !drop.has(`${doc}/${v.id}`));
      await this.writeIndex(path.join(this.dir, doc), idx);
      for (const v of gone) await fs.promises.rm(path.join(this.dir, doc, `${v.id}.gz`), { force: true });
      if (before && !idx.versions.length) await fs.promises.rm(path.join(this.dir, doc), { recursive: true, force: true });
    }
    return drop.size;
  }
}

module.exports = { HistoryStore, planPrune, DEFAULTS };
