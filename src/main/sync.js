'use strict';
// Sync between your computers (3.1): highlights and notes, bookmarks, recent files, reading positions and
// settings, kept in step through a folder the reader already syncs (OneDrive, Dropbox, iCloud Drive,
// Google Drive…). No account and no server: the cloud service moves the files, this module reads them.
//
//  - Each computer writes only its own file (devices/<id>.json). Two computers never write the same
//    file, so the cloud service never has to choose between them or make "conflicted copy" files.
//  - Every computer reads every file and keeps the newest version of each item. Removing something is
//    recorded too, so a deleted highlight or bookmark disappears everywhere instead of coming back.
//  - A document is named by where it sits inside a cloud folder ("onedrive:Notes/plan.md"), not by its
//    full path, because the same file has a different full path on every computer.
//  - What changed on this computer is found by comparing with how things looked after the last sync —
//    never with what other computers sent. A highlight for a document that hasn't finished downloading
//    here is simply waiting, not "deleted on this computer".
//  - Never synced: the AI key, edit permissions, window positions, version history (it can be 1 GB), the
//    "run code" setting, and anything about password-locked documents (their highlights quote the text).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { cleanAnnotation } = require('./annotations');

const FORMAT = 'neo-markdown-reader-sync';
const VERSION = 1;
const DIR_NAME = 'Neo Markdown Reader';
const MAX_FILE = 20 * 1024 * 1024;     // a device file larger than this is not read
const MAX_ITEMS = 60000;
const MAX_RECENT = 15;
const POLL_MS = 30 * 1000;
const SETTLE_MS = 2000;

/** Settings that follow you between computers. Everything else stays on the computer it was set on. */
const SYNCED_SETTINGS = ['theme', 'surface', 'font', 'fontScale', 'pageWidth', 'showToc', 'showMenuBar', 'wikiLinks', 'readAloud', 'language', 'shortcuts', 'exportOptions', 'brand'];

const isLocked = (p) => /\.mdlock$/i.test(p);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ======================================================================== where documents live
/**
 * The cloud folders on this computer, most specific first. Each has an id that is the same on every
 * computer ("onedrive", "dropbox"…), so a path inside one can be named without the part that differs.
 * The home folder comes last: it catches documents outside any cloud folder that are kept at the same
 * place under each computer's home folder.
 */
function detectRoots({ env = process.env, home = os.homedir(), platform = process.platform, exists = fs.existsSync, list = safeList } = {}) {
  if (env.NMR_SYNC_ROOTS) {                     // tests stand in for different computers this way
    try { return JSON.parse(env.NMR_SYNC_ROOTS).filter((r) => r && typeof r.id === 'string' && typeof r.path === 'string'); } catch { return []; }
  }
  const roots = [];
  const add = (id, p) => { if (p && exists(p) && !roots.some((r) => samePath(r.path, p, platform))) roots.push({ id, path: path.resolve(p) }); };
  if (platform === 'win32') {
    add('onedrive', env.OneDriveConsumer || (env.OneDriveCommercial ? '' : env.OneDrive));
    add('onedrive-business', env.OneDriveCommercial);
    add('dropbox', path.join(home, 'Dropbox'));
    add('icloud', path.join(home, 'iCloudDrive'));
    for (const drive of ['G', 'H', 'I']) add('google-drive', `${drive}:\\My Drive`);
  } else if (platform === 'darwin') {
    const cs = path.join(home, 'Library', 'CloudStorage');
    for (const name of list(cs)) {
      if (/^OneDrive-Personal$/i.test(name) || /^OneDrive$/i.test(name)) add('onedrive', path.join(cs, name));
      else if (/^OneDrive-/i.test(name)) add('onedrive-business', path.join(cs, name));
      else if (/^Dropbox/i.test(name)) add('dropbox', path.join(cs, name));
      else if (/^GoogleDrive-/i.test(name)) add('google-drive', path.join(cs, name, 'My Drive'));
    }
    add('icloud', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    add('dropbox', path.join(home, 'Dropbox'));
    add('onedrive', path.join(home, 'OneDrive'));
  } else {
    add('dropbox', path.join(home, 'Dropbox'));
    add('onedrive', path.join(home, 'OneDrive'));
    add('google-drive', path.join(home, 'GoogleDrive'));
  }
  roots.push({ id: 'home', path: path.resolve(home) });
  return roots;
}

function safeList(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

function samePath(a, b, platform = process.platform) {
  return platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** "onedrive:Notes/plan.md" for a document inside a known folder, "abs:<path>" otherwise. */
function toKey(p, roots, platform = process.platform) {
  const full = path.resolve(p);
  for (const r of roots) {
    const rel = path.relative(r.path, full);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inside && samePath(path.join(r.path, rel), full, platform)) return `${r.id}:${rel.split(path.sep).join('/')}`;
  }
  return `abs:${full}`;
}

/** The path a key names on this computer, or null when the folder it lives in isn't here. */
function fromKey(key, roots) {
  if (typeof key !== 'string' || key.length > 4200) return null;
  const at = key.indexOf(':');
  if (at < 1) return null;
  const id = key.slice(0, at);
  const rel = key.slice(at + 1);
  if (id === 'abs') return path.isAbsolute(rel) ? rel : null;
  const root = roots.find((r) => r.id === id);
  if (!root || !rel || rel.split('/').some((part) => part === '..' || part === '')) return null;
  return path.join(root.path, ...rel.split('/'));
}

// ======================================================================== items
// Everything that syncs is a flat map of items, so one rule (newest wins) covers all of it:
//   s:<setting>           the setting's value
//   b:<doc>               true while the document is bookmarked
//   r:<doc>               true while the document is in Recent; newer = nearer the top
//   p:<doc>               reading position (0–1)
//   h:<doc>\t<id>         one highlight or note
// A removed item is kept as null, so the removal spreads instead of the item coming back.

/** This computer's synced state, as items. */
function snapshot({ settings, annotations }, keyOf) {
  const items = {};
  for (const k of SYNCED_SETTINGS) {
    let v = settings[k];
    if (k === 'brand' && v) v = { ...v, stylesheet: '' };        // a file path on this computer
    if (v !== undefined) items[`s:${k}`] = v;
  }
  const docKey = (p) => (typeof p === 'string' && !isLocked(p) ? keyOf(p) : null);
  for (const p of settings.bookmarks || []) { const k = docKey(p); if (k) items[`b:${k}`] = true; }
  for (const p of settings.recent || []) { const k = docKey(p); if (k) items[`r:${k}`] = true; }
  for (const [p, v] of Object.entries(settings.positions || {})) { const k = docKey(p); if (k) items[`p:${k}`] = v; }
  for (const [p, list] of Object.entries(annotations || {})) {
    const k = docKey(p);
    if (!k) continue;
    for (const a of list) items[`h:${k}\t${a.id}`] = a;
  }
  return items;
}

/**
 * Record what changed on this computer since the last sync. `baseline` is the snapshot taken after the
 * last sync (null the first time). Returns true if anything was recorded.
 *
 * When a computer joins a folder other computers already use (`join`), its settings and reading
 * positions are recorded as old, so it takes on the settings already there instead of overwriting them;
 * its highlights, bookmarks and recent files are simply added. The first computer in a folder isn't
 * joining anything: its settings are the ones the others will take.
 */
function record(journal, baseline, current, { now = Date.now(), device, join = false }) {
  let changed = false;
  const first = !baseline;
  const before = baseline || {};
  const recentRank = (map) => Object.keys(map).filter((k) => k.startsWith('r:'));
  for (const k of new Set([...Object.keys(before), ...Object.keys(current)])) {
    const v = k in current ? current[k] : null;
    const was = k in before ? before[k] : null;
    if (same(v, was) && !first) continue;
    if (first && v === null) continue;
    const old = first && join && (k.startsWith('s:') || k.startsWith('p:'));
    const t = old ? 1 : now;
    if (journal[k] && same(journal[k].v, v) && (old || journal[k].t >= t)) continue;
    journal[k] = { v, t, d: device };
    changed = true;
  }
  // Recent is an order, not just a set. A document that is new to the list, or opened again and moved
  // up, is stamped by its place, so the computers agree which came last. (Moving up doesn't change its
  // "in Recent" value, so the loop above can't see it.)
  const order = recentRank(current);
  const prev = recentRank(before);
  order.forEach((k, i) => {
    const j = prev.indexOf(k);
    if (j === -1 || j > i) { journal[k] = { v: true, t: now + (order.length - i), d: device }; changed = true; }
  });
  return changed;
}

/** Fold other computers' items in: for each item, the newest version wins (ties go to the larger device id). */
function merge(journal, remote) {
  let changed = false;
  for (const [k, e] of Object.entries(remote || {})) {
    if (!validItem(k, e)) continue;
    const mine = journal[k];
    if (!mine || e.t > mine.t || (e.t === mine.t && String(e.d) > String(mine.d) && !same(e.v, mine.v))) {
      journal[k] = { v: e.v, t: e.t, d: String(e.d).slice(0, 64) };
      changed = true;
    }
  }
  return changed;
}

function validItem(k, e) {
  if (typeof k !== 'string' || k.length > 4300 || !/^[sbrph]:./.test(k)) return false;
  if (!e || typeof e !== 'object' || !Number.isFinite(e.t) || e.t < 0) return false;
  if (k.startsWith('s:') && !SYNCED_SETTINGS.includes(k.slice(2))) return false;
  return true;
}

/**
 * What this computer should look like, from the journal: only items whose document is here (its cloud
 * folder exists on this computer and the file has arrived). Anything else waits in the journal.
 */
function desired(journal, { resolve, exists }) {
  const out = { settings: {}, bookmarks: [], recent: [], positions: {}, annotations: new Map() };
  const doc = (k) => {
    const p = resolve(k);
    return p && !isLocked(p) && exists(p) ? p : null;
  };
  const bookmarks = [];
  const recent = [];
  for (const [k, e] of Object.entries(journal)) {
    if (k.startsWith('s:')) { if (e.v !== null) out.settings[k.slice(2)] = e.v; continue; }
    if (e.v === null && !k.startsWith('h:')) continue;
    if (k.startsWith('h:')) {
      const tab = k.indexOf('\t');
      const p = doc(k.slice(2, tab));
      if (!p) continue;
      if (!out.annotations.has(p)) out.annotations.set(p, []);
      if (e.v !== null) { const a = cleanAnnotation(e.v); if (a) out.annotations.get(p).push(a); }
      continue;
    }
    const p = doc(k.slice(2));
    if (!p) continue;
    if (k.startsWith('b:')) bookmarks.push([e.t, p]);
    else if (k.startsWith('r:')) recent.push([e.t, p]);
    else if (k.startsWith('p:') && Number.isFinite(e.v)) out.positions[p] = e.v;
  }
  out.bookmarks = bookmarks.sort((a, b) => b[0] - a[0]).map(([, p]) => p);
  out.recent = recent.sort((a, b) => b[0] - a[0]).slice(0, MAX_RECENT).map(([, p]) => p);
  for (const list of out.annotations.values()) list.sort((a, b) => a.created - b.created);
  return out;
}

// ======================================================================== the engine
class SyncEngine {
  /**
   * @param {object} o
   * @param {string} o.dir        this computer's app-data folder (sync-state.json lives there)
   * @param {object} o.settings   the Settings store
   * @param {object} o.annotations the AnnotationStore
   * @param {Function} o.onApplied called with { settings: bool, annotationPaths: string[] } after other computers' changes are applied
   * @param {Function} o.onStatus  called with the status whenever it changes
   */
  constructor({ dir, settings, annotations, onApplied = () => {}, onStatus = () => {}, roots = detectRoots(), platform = process.platform, hostname = os.hostname() }) {
    this.file = path.join(dir, 'sync-state.json');
    this.settings = settings;
    this.annotations = annotations;
    this.onApplied = onApplied;
    this.onStatus = onStatus;
    this.roots = roots;
    this.platform = platform;
    this.hostname = hostname;
    this.timer = null;
    this.poll = null;
    this.watcher = null;
    this.running = null;
    this.again = false;
    this.seen = new Map();             // device file -> mtime already merged
    this.devices = new Map();          // device id -> { id, name, platform, written }
    this.lastSync = 0;
    this.error = '';
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { /* first run */ }
    this.state = {
      device: typeof saved.device === 'string' && /^[a-f0-9]{16,64}$/.test(saved.device) ? saved.device : crypto.randomBytes(12).toString('hex'),
      name: typeof saved.name === 'string' && saved.name.trim() ? saved.name.slice(0, 80) : hostname,
      folder: typeof saved.folder === 'string' ? saved.folder : '',
      enabled: saved.enabled === true,
      journal: saved.journal && typeof saved.journal === 'object' ? saved.journal : {},
      baseline: saved.baseline && typeof saved.baseline === 'object' ? saved.baseline : null,
      written: typeof saved.written === 'string' ? saved.written : '',
    };
  }

  // -------------------------------------------------------------- where the files go
  /** The app's own folder inside the folder the reader chose. */
  syncDir(folder = this.state.folder) {
    if (!folder) return '';
    return path.basename(folder) === DIR_NAME ? folder : path.join(folder, DIR_NAME);
  }
  devicesDir() { return path.join(this.syncDir(), 'devices'); }
  ownFile() { return path.join(this.devicesDir(), `${this.state.device}.json`); }

  /** Cloud folders found on this computer, for the dialog's suggestions. */
  suggestions() {
    return this.roots.filter((r) => r.id !== 'home').map((r) => ({ id: r.id, path: r.path }));
  }

  status() {
    return {
      enabled: this.state.enabled,
      folder: this.state.folder,
      syncDir: this.syncDir(),
      name: this.state.name,
      device: this.state.device,
      lastSync: this.lastSync,
      busy: !!this.running,
      error: this.error,
      devices: [...this.devices.values()].filter((d) => d.id !== this.state.device).sort((a, b) => b.written - a.written),
      suggestions: this.suggestions(),
    };
  }

  // -------------------------------------------------------------- turning it on and off
  start() {
    if (!this.state.enabled || !this.state.folder) return;
    this.stopWatching();
    this.poll = setInterval(() => this.sync(), POLL_MS);
    this.poll.unref?.();
    try {
      fs.mkdirSync(this.devicesDir(), { recursive: true });
      this.watcher = fs.watch(this.devicesDir(), () => this.soon());
      this.watcher.on('error', () => this.stopWatching(true));
      this.watcher.unref?.();                 // never what keeps the app (or a test) running
    } catch { /* polling still works */ }
    this.sync();
  }

  stopWatching(keepPoll = false) {
    if (!keepPoll) { clearInterval(this.poll); this.poll = null; }
    try { this.watcher?.close(); } catch { /* already closed */ }
    this.watcher = null;
  }

  /** Change the folder and/or switch syncing on or off. */
  async configure({ folder, enabled, name } = {}) {
    if (typeof name === 'string' && name.trim()) this.state.name = name.trim().slice(0, 80);
    if (typeof folder === 'string' && folder !== this.state.folder) {
      this.state.folder = folder;
      // A different folder is a different set of computers: start the comparison over.
      this.state.journal = {};
      this.state.baseline = null;
      this.state.written = '';
      this.seen.clear();
      this.devices.clear();
    }
    if (typeof enabled === 'boolean') this.state.enabled = enabled && !!this.state.folder;
    this.error = '';
    this.save();
    this.stopWatching();
    if (this.state.enabled) {
      try {
        fs.mkdirSync(this.devicesDir(), { recursive: true });
        const readme = path.join(this.syncDir(), 'README.txt');
        if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
      } catch (err) {
        this.error = `Can’t write to the sync folder: ${err.message}`;
        this.state.enabled = false;
        this.save();
        this.onStatus(this.status());
        return this.status();
      }
      this.start();
      await this.running;
    }
    this.onStatus(this.status());
    return this.status();
  }

  // -------------------------------------------------------------- syncing
  /** Something changed on this computer: sync shortly (changes often come in bursts). */
  soon() {
    if (!this.state.enabled || this.applying) return;          // our own writes are not "a change here"
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), SETTLE_MS);
    this.timer.unref?.();
  }

  sync() {
    if (!this.state.enabled || !this.state.folder) return Promise.resolve(this.status());
    if (this.running) { this.again = true; return this.running; }
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this.sync(); }
    });
    return this.running;
  }

  async cycle() {
    clearTimeout(this.timer);
    const me = this.state.device;
    const keyOf = (p) => toKey(p, this.roots, this.platform);
    try {
      // 1. What the other computers have written.
      const { files, warning } = await this.readDevices();
      // 2. What changed here since last time. (Read the others first: the first time, whether anyone
      //    is already using this folder decides whose settings win.)
      const local = this.local();
      record(this.state.journal, this.state.baseline, snapshot(local, keyOf), { device: me, join: files.length > 0 });
      for (const f of files) merge(this.state.journal, f.items);
      // 3. Make this computer match, for every document that's here. A document already in this
      //    computer's lists counts as here even if the file has moved: syncing never drops it.
      const listed = new Set([...local.settings.bookmarks, ...local.settings.recent, ...Object.keys(local.settings.positions || {}), ...Object.keys(local.annotations)].map((p) => this.norm(p)));
      const exists = (p) => listed.has(this.norm(p)) || fs.existsSync(p);
      this.applying = true;
      let applied;
      try { applied = this.apply(desired(this.state.journal, { resolve: (k) => fromKey(k, this.roots), exists })); } finally { this.applying = false; }
      // 4. Remember how things look now, and publish this computer's file if anything is new.
      this.state.baseline = snapshot(this.local(), keyOf);
      this.trim();
      await this.write();
      this.save();
      this.lastSync = Date.now();
      this.error = warning;
      if (applied.settings || applied.annotationPaths.length) this.onApplied(applied);
    } catch (err) {
      this.error = err.message || String(err);
    }
    this.onStatus(this.status());
    return this.status();
  }

  norm(p) { const r = path.resolve(p); return this.platform === 'win32' || this.platform === 'darwin' ? r.toLowerCase() : r; }

  local() {
    const s = this.settings.get();
    const annotations = {};
    for (const entry of Object.values(this.annotations.data || {})) {
      if (entry && typeof entry.path === 'string' && Array.isArray(entry.items)) annotations[entry.path] = entry.items;
    }
    return { settings: s, annotations };
  }

  /** Bring this computer in line with `want`. Only what differs is written. */
  apply(want) {
    const s = this.settings.get();
    const patch = {};
    for (const [k, v] of Object.entries(want.settings)) {
      const next = k === 'brand' && v ? { ...v, stylesheet: s.brand?.stylesheet || '' } : v;
      if (!same(s[k], next)) patch[k] = next;
    }
    const keyOf = (p) => toKey(p, this.roots, this.platform);
    // Lists also keep entries this computer has that no other computer can name (not in the journal).
    const known = (prefix, p) => { const e = this.state.journal[`${prefix}:${keyOf(p)}`]; return !!e; };
    const bookmarks = [...want.bookmarks, ...s.bookmarks.filter((p) => !known('b', p) && !want.bookmarks.some((q) => samePath(p, q, this.platform)))];
    if (!same(bookmarks, s.bookmarks)) patch.bookmarks = bookmarks;
    const recent = [...want.recent, ...s.recent.filter((p) => !known('r', p) && !want.recent.some((q) => samePath(p, q, this.platform)))].slice(0, MAX_RECENT);
    if (!same(recent, s.recent)) patch.recent = recent;
    const positions = { ...s.positions };
    let moved = false;
    for (const [p, v] of Object.entries(want.positions)) if (positions[p] !== v) { delete positions[p]; positions[p] = v; moved = true; }
    if (moved) patch.positions = positions;
    const settingsChanged = Object.keys(patch).length > 0;
    if (settingsChanged) this.settings.update(patch);

    const annotationPaths = [];
    for (const [p, items] of want.annotations) {
      if (!same(this.annotations.get(p), items)) { this.annotations.set(p, items); annotationPaths.push(p); }
    }
    return { settings: settingsChanged, annotationPaths };
  }

  /** Removed items are kept so the removal spreads; after 90 days every computer has had its chance. */
  trim() {
    const cutoff = Date.now() - 90 * 86400000;
    const j = this.state.journal;
    for (const [k, e] of Object.entries(j)) if (e.v === null && e.t < cutoff) delete j[k];
    const keys = Object.keys(j);
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => j[a].t - j[b].t);
      for (const k of keys.slice(0, keys.length - MAX_ITEMS)) delete j[k];
    }
  }

  /** Other computers' files that changed since last read, and a warning worth showing (or ''). */
  async readDevices() {
    const dir = this.devicesDir();
    const out = [];
    let warning = '';
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch { return { files: out, warning }; }
    for (const name of names) {
      const m = /^([a-f0-9]{16,64})\.json$/.exec(name);
      if (!m) continue;
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.stat(file);
        if (st.size > MAX_FILE) continue;
        const data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        if (data?.format !== FORMAT || !data.items || typeof data.items !== 'object') continue;
        const id = m[1];
        this.devices.set(id, {
          id,
          name: typeof data.device?.name === 'string' ? data.device.name.slice(0, 80) : 'Another computer',
          platform: typeof data.device?.platform === 'string' ? data.device.platform.slice(0, 20) : '',
          written: Number.isFinite(data.written) ? data.written : st.mtimeMs,
        });
        if (id === this.state.device) continue;            // our own file: we already have all of it
        if (data.version > VERSION) { warning = `${this.devices.get(id).name} uses a newer version of RT Markdown Reader — update this one to sync with it`; continue; }
        if (this.seen.get(file) === st.mtimeMs) continue;
        this.seen.set(file, st.mtimeMs);
        out.push({ id, items: data.items });
      } catch { /* half-written by the cloud service: read it next time */ }
    }
    return { files: out, warning };
  }

  async write() {
    const body = JSON.stringify(this.state.journal);
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    if (hash === this.state.written && fs.existsSync(this.ownFile())) return;
    await fs.promises.mkdir(this.devicesDir(), { recursive: true });
    const data = { format: FORMAT, version: VERSION, device: { id: this.state.device, name: this.state.name, platform: this.platform }, written: Date.now(), items: this.state.journal };
    const tmp = `${this.ownFile()}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data));
    await fs.promises.rename(tmp, this.ownFile());
    this.state.written = hash;
    this.devices.set(this.state.device, { id: this.state.device, name: this.state.name, platform: this.platform, written: data.written });
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch { /* non-fatal: the next sync tries again */ }
  }

  /** On quit: one last sync so the other computers see the latest. */
  async flush() {
    clearTimeout(this.timer);
    this.stopWatching();
    if (this.state.enabled) { await this.running; await this.sync(); }
  }
}

const README = `This folder keeps RT Markdown Reader in step between your computers.

Each computer writes its own file in "devices". Every computer reads all of them and keeps the newest
of each highlight, note, bookmark, recent file, reading position and setting.

You don't need to do anything here. To stop syncing, turn it off in RT Markdown Reader
(Edit > Sync Between Computers). Deleting this folder deletes nothing from your documents.
`;

module.exports = { SyncEngine, detectRoots, toKey, fromKey, snapshot, record, merge, desired, SYNCED_SETTINGS, FORMAT, DIR_NAME };
