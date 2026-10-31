'use strict';
// JSON settings store kept in the per-user app-data folder
// (Windows: %APPDATA%\Neo Markdown Reader\settings.json).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  theme: 'system',        // system | light | dark | sepia
  font: 'sans',           // sans | serif
  fontScale: 1,           // 0.7 – 1.8
  pageWidth: 'normal',    // narrow | normal | wide | full
  showToc: true,
  showMenuBar: true,      // Windows/Linux: always-visible menu bar (false = press Alt)
  restoreSession: true,   // reopen last windows/tabs on launch
  recent: [],             // most-recent-first absolute paths
  positions: {},          // path -> scroll ratio (0..1), remembered reading positions
  session: [],            // [{ bounds, tabs: [{ path, scroll }], active }]
  editGrants: { files: [], folders: [] },   // "Always allow editing" choices; "Just this time" is never saved
  bookmarks: [],          // starred files (shown in the Files panel and Quick Open)
  recentFolders: [],      // most-recent-first folders opened with File > Open Folder
  windowBounds: null,
});

const THEMES = ['system', 'light', 'dark', 'sepia'];
const FONTS = ['sans', 'serif'];
const WIDTHS = ['narrow', 'normal', 'wide', 'full'];
const MAX_RECENT = 15;
const MAX_POSITIONS = 200;
const MAX_SESSION_WINDOWS = 12;
const MAX_TABS = 60;

const isPath = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096;
const ratio = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)) : 0);

function cleanBounds(b) {
  if (!b || !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k]))) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: !!b.maximized };
}

function cleanSession(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SESSION_WINDOWS).map((w) => {
    const tabs = (Array.isArray(w?.tabs) ? w.tabs : []).filter((t) => isPath(t?.path)).slice(0, MAX_TABS)
      .map((t) => ({ path: t.path, scroll: ratio(t.scroll) }));
    const active = Number.isInteger(w?.active) && w.active >= 0 && w.active < tabs.length ? w.active : 0;
    return { bounds: cleanBounds(w?.bounds), tabs, active, folder: isPath(w?.folder) ? w.folder : null };
  }).filter((w) => w.tabs.length || w.folder);
}

function cleanPositions(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const entries = Object.entries(obj).filter(([k, v]) => isPath(k) && Number.isFinite(v));
  return Object.fromEntries(entries.slice(-MAX_POSITIONS).map(([k, v]) => [k, ratio(v)]));
}

function cleanGrants(g) {
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).filter(isPath))].slice(0, 500);
  return { files: list(g?.files), folders: list(g?.folders) };
}

function sanitize(input) {
  const s = { ...DEFAULTS, recent: [], positions: {}, session: [], editGrants: { files: [], folders: [] }, bookmarks: [], recentFolders: [] };
  if (!input || typeof input !== 'object') return s;
  if (THEMES.includes(input.theme)) s.theme = input.theme;
  if (FONTS.includes(input.font)) s.font = input.font;
  if (WIDTHS.includes(input.pageWidth)) s.pageWidth = input.pageWidth;
  for (const k of ['showToc', 'showMenuBar', 'restoreSession']) if (typeof input[k] === 'boolean') s[k] = input[k];
  const scale = Number(input.fontScale);
  if (Number.isFinite(scale)) s.fontScale = Math.min(1.8, Math.max(0.7, Math.round(scale * 100) / 100));
  if (Array.isArray(input.recent)) s.recent = input.recent.filter(isPath).slice(0, MAX_RECENT);
  s.positions = cleanPositions(input.positions);
  s.session = cleanSession(input.session);
  s.editGrants = cleanGrants(input.editGrants);
  if (Array.isArray(input.bookmarks)) s.bookmarks = [...new Set(input.bookmarks.filter(isPath))].slice(0, 300);
  if (Array.isArray(input.recentFolders)) s.recentFolders = [...new Set(input.recentFolders.filter(isPath))].slice(0, 10);
  s.windowBounds = cleanBounds(input.windowBounds);
  return s;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    try { this.data = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { this.data = sanitize(null); }
    this._timer = null;
  }
  get() { return structuredClone(this.data); }
  update(patch) {
    this.data = sanitize({ ...this.data, ...patch });
    this.save();
    return this.get();
  }
  addRecent(file) {
    const recent = [file, ...this.data.recent.filter((p) => p.toLowerCase() !== file.toLowerCase())];
    return this.update({ recent });
  }
  setPositions(map) {
    // Re-insert updated keys at the end so the oldest positions are the ones trimmed.
    const positions = { ...this.data.positions };
    for (const [k, v] of Object.entries(map)) { delete positions[k]; positions[k] = v; }
    this.update({ positions });
  }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch { /* non-fatal */ }
  }
}

module.exports = { Settings, sanitize, DEFAULTS };
