'use strict';
// Tiny JSON settings store kept in the per-user app-data folder
// (Windows: %APPDATA%\Neo Markdown Reader\settings.json).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  theme: 'system',        // system | light | dark | sepia
  font: 'sans',           // sans | serif
  fontScale: 1,           // 0.7 – 1.8
  pageWidth: 'normal',    // narrow | normal | wide | full
  showToc: true,
  recent: [],             // most-recent-first absolute paths
  windowBounds: null,
});

const THEMES = ['system', 'light', 'dark', 'sepia'];
const FONTS = ['sans', 'serif'];
const WIDTHS = ['narrow', 'normal', 'wide', 'full'];
const MAX_RECENT = 15;

function sanitize(input) {
  const s = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return s;
  if (THEMES.includes(input.theme)) s.theme = input.theme;
  if (FONTS.includes(input.font)) s.font = input.font;
  if (WIDTHS.includes(input.pageWidth)) s.pageWidth = input.pageWidth;
  if (typeof input.showToc === 'boolean') s.showToc = input.showToc;
  const scale = Number(input.fontScale);
  if (Number.isFinite(scale)) s.fontScale = Math.min(1.8, Math.max(0.7, Math.round(scale * 100) / 100));
  if (Array.isArray(input.recent)) s.recent = input.recent.filter((p) => typeof p === 'string' && p.length < 4096).slice(0, MAX_RECENT);
  const b = input.windowBounds;
  if (b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k]))) s.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: !!b.maximized };
  return s;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    try { this.data = sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { this.data = sanitize(null); }
    this._timer = null;
  }
  get() { return { ...this.data, recent: [...this.data.recent] }; }
  update(patch) {
    this.data = sanitize({ ...this.data, ...patch });
    this.save();
    return this.get();
  }
  addRecent(file) {
    const recent = [file, ...this.data.recent.filter((p) => p.toLowerCase() !== file.toLowerCase())];
    return this.update({ recent });
  }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
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
