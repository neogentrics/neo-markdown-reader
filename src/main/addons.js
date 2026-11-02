'use strict';
// Add-ons (3.0): new code-block types, export formats and colour themes, installed by the reader.
//
//  - An add-on is a folder (or a .nmraddon / .zip of one) with an addon.json that says what it adds.
//    Before anything is installed, the reader sees that list in plain words and approves it.
//  - Themes are colours only: the app writes the CSS itself, so a theme can't load or run anything.
//  - Code-block types and export formats are JavaScript that runs in the same sealed sandbox as code
//    blocks (src/main/sandbox.js): no internet, no files, no Node.js, a time limit. What a code-block
//    add-on draws is sanitized like any document, with links to the web removed.
//  - Installed add-ons live in the app's data folder (addons/<id>/), never in your documents.
const fs = require('node:fs');
const path = require('node:path');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const LANG_RE = /^[a-z][a-z0-9+-]{0,30}$/;
const EXT_RE = /^[a-z0-9]{1,10}$/;
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_SCRIPT = 512 * 1024;
const MAX_TOTAL = 4 * 1024 * 1024;
// Languages the app itself handles: an add-on can't take them over.
const RESERVED = new Set(['mermaid', 'chart', 'math', 'js', 'javascript', 'mjs', 'node', 'py', 'python', 'python3', 'markdown', 'md']);
// File types an export may never produce (they could be run by double-clicking).
const BLOCKED_EXT = new Set(['exe', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'scr', 'lnk', 'pif', 'hta', 'cpl', 'jar', 'sh', 'command', 'app', 'reg', 'dll', 'so', 'dylib', 'appimage', 'deb', 'rpm', 'dmg', 'pkg', 'url', 'desktop']);
// Theme colours an add-on may set, and the CSS variables they become.
const COLORS = {
  page: '--page', text: '--text', textSoft: '--text-soft', muted: '--muted', heading: '--heading', accent: '--accent', accent2: '--accent-2',
  accentSoft: '--accent-soft', onAccent: '--on-accent', link: '--link', rule: '--rule', ruleStrong: '--rule-strong', codeBg: '--code-bg',
  codeBorder: '--code-border', inlineCodeBg: '--inline-code-bg', inlineCodeText: '--inline-code-text', tableHead: '--table-head',
  tableStripe: '--table-stripe', quoteBar: '--quote-bar', quoteBg: '--quote-bg', mark: '--mark', sel: '--sel', desk: '--desk',
  chrome: '--chrome', chromeBorder: '--chrome-border',
};

const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** A script path inside the add-on: relative, forward slashes, .js, no way out of the folder. */
function scriptPath(p) {
  if (typeof p !== 'string' || p.length > 200 || !/\.js$/.test(p) || p.includes('\\') || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..')) return null;
  return parts.join('/');
}

/**
 * Check an addon.json. Returns { manifest } (cleaned: only known fields) or { error } in plain words.
 * `has(file)` says whether a script file exists in the add-on.
 */
function validateManifest(raw, has = () => true) {
  let m = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try { m = JSON.parse(String(raw)); } catch { return { error: 'Its addon.json isn’t valid JSON.' }; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: 'Its addon.json is empty.' };
  const id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
  if (!id) return { error: 'Its id must be 2–40 lowercase letters, digits or dashes.' };
  const name = str(m.name, 60);
  if (!name) return { error: 'It needs a name (up to 60 characters).' };
  const version = typeof m.version === 'string' && /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]{1,20})?$/.test(m.version) ? m.version : null;
  if (!version) return { error: 'Its version must look like 1.0.0.' };
  const out = { id, name, version, author: str(m.author, 80) || '', description: str(m.description, 300) || '', themes: [], codeBlocks: [], exports: [] };
  if (typeof m.homepage === 'string' && /^https:\/\/[^\s"<>]{3,200}$/.test(m.homepage)) out.homepage = m.homepage;

  for (const th of Array.isArray(m.themes) ? m.themes : []) {
    if (out.themes.length >= 5) return { error: 'It may add at most 5 themes.' };
    if (!th || !ID_RE.test(th.id || '') || !str(th.name, 40)) return { error: 'Each theme needs an id and a name.' };
    const colors = {};
    for (const [k, v] of Object.entries(th.colors || {})) {
      if (!Object.hasOwn(COLORS, k)) return { error: `Theme “${th.name}” sets an unknown colour “${k}”.` };
      if (typeof v !== 'string' || !COLOR_RE.test(v)) return { error: `Theme “${th.name}”: colours must be written like #1d2330.` };
      colors[k] = v.toLowerCase();
    }
    if (!Object.keys(colors).length) return { error: `Theme “${th.name}” sets no colours.` };
    out.themes.push({ id: th.id, name: th.name.trim(), tone: th.tone === 'dark' ? 'dark' : 'light', colors });
  }
  for (const b of Array.isArray(m.codeBlocks) ? m.codeBlocks : []) {
    if (out.codeBlocks.length >= 10) return { error: 'It may add at most 10 code-block types.' };
    const language = typeof b?.language === 'string' ? b.language.toLowerCase() : '';
    if (!LANG_RE.test(language)) return { error: 'Each code-block type needs a language name like “timeline”.' };
    if (RESERVED.has(language)) return { error: `“${language}” code blocks are drawn by the app itself and can’t be taken over.` };
    const script = scriptPath(b.script);
    if (!script || !has(script)) return { error: `The script for “${language}” code blocks is missing.` };
    out.codeBlocks.push({ language, script });
  }
  for (const e of Array.isArray(m.exports) ? m.exports : []) {
    if (out.exports.length >= 5) return { error: 'It may add at most 5 export formats.' };
    if (!e || !ID_RE.test(e.id || '') || !str(e.name, 60)) return { error: 'Each export format needs an id and a name.' };
    const extension = typeof e.extension === 'string' ? e.extension.toLowerCase().replace(/^\./, '') : '';
    if (!EXT_RE.test(extension)) return { error: `Export “${e.name}” needs a file extension like “txt”.` };
    if (BLOCKED_EXT.has(extension)) return { error: `Export “${e.name}” would make .${extension} files, which could be run as programs.` };
    const script = scriptPath(e.script);
    if (!script || !has(script)) return { error: `The script for export “${e.name}” is missing.` };
    out.exports.push({ id: e.id, name: e.name.trim(), extension, script });
  }
  if (!out.themes.length && !out.codeBlocks.length && !out.exports.length) return { error: 'It doesn’t add anything (no themes, code-block types or export formats).' };
  return { manifest: out };
}

/** What an add-on can do, in plain words, for the approval question and the Add-ons dialog. */
function capabilities(m) {
  const list = [];
  for (const th of m.themes) list.push(`Adds the ${th.tone} theme “${th.name}”.`);
  for (const b of m.codeBlocks) list.push(`Draws \`\`\`${b.language} code blocks in your documents.`);
  for (const e of m.exports) list.push(`Adds File › Export › ${e.name} (.${e.extension}).`);
  return list;
}

/** CSS for an add-on theme: its colours over the built-in light or dark theme. */
function themeCss(key, theme) {
  const vars = Object.entries(theme.colors).map(([k, v]) => `${COLORS[k]}: ${v};`).join(' ');
  return `:root[data-addon-theme="${key}"] { ${vars} }`;
}

/**
 * Files of an add-on package (a zip's entries or a folder's files), as { 'addon.json': Buffer, 'x.js': Buffer }.
 * Accepts a manifest at the top or inside one folder. Refuses anything that would land outside the add-on.
 */
function packageFiles(entries) {
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
  let prefix = '';
  if (!names.includes('addon.json')) {
    const inner = names.filter((n) => /^[^/]+\/addon\.json$/.test(n));
    if (inner.length !== 1) return { error: 'There’s no addon.json in it.' };
    prefix = inner[0].slice(0, -'addon.json'.length);
  }
  const files = {};
  let total = 0;
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((s) => !s || s === '.' || s === '..')) return { error: 'It contains a file with an unsafe name.' };
    total += entries[n].length;
    if (total > MAX_TOTAL) return { error: 'It’s too large (over 4 MB).' };
    files[rel] = Buffer.from(entries[n]);
  }
  return { files };
}

/** Read and check a package's files: { manifest, files } (only addon.json and its scripts) or { error }. */
function checkPackage(files) {
  if (!files['addon.json']) return { error: 'There’s no addon.json in it.' };
  const res = validateManifest(files['addon.json'], (p) => !!files[p] && files[p].length <= MAX_SCRIPT);
  if (res.error) return res;
  const keep = { 'addon.json': files['addon.json'] };
  for (const s of [...res.manifest.codeBlocks, ...res.manifest.exports]) keep[s.script] = files[s.script];
  return { manifest: res.manifest, files: keep };
}

/** The input an add-on script receives and the code that runs it in the sandbox. */
function sandboxProgram(source, input) {
  return `const __input = JSON.parse(${JSON.stringify(JSON.stringify(input))});\n${source}\n;\n`
    + "if (typeof main !== 'function') throw new Error('This add-on has no main() function.');\n"
    + 'const __out = await main(__input);\n'
    + 'return JSON.stringify(__out === undefined ? null : __out);\n';
}

class AddonStore {
  constructor(dir) {
    this.dir = dir;
    this.items = new Map();          // id -> { manifest, error? }
  }

  /** Read every installed add-on again (each is checked again; a broken one is listed with its problem). */
  load() {
    this.items.clear();
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none yet */ }
    for (const name of names) {
      if (!ID_RE.test(name)) continue;
      const base = path.join(this.dir, name);
      let raw;
      try { raw = fs.readFileSync(path.join(base, 'addon.json')); } catch { continue; }
      const res = validateManifest(raw, (p) => { try { return fs.statSync(path.join(base, ...p.split('/'))).size <= MAX_SCRIPT; } catch { return false; } });
      if (res.error || res.manifest.id !== name) this.items.set(name, { manifest: { id: name, name, version: '', themes: [], codeBlocks: [], exports: [] }, error: res.error || 'Its folder name doesn’t match its id.' });
      else this.items.set(name, { manifest: res.manifest });
    }
    return this;
  }

  get(id) { return this.items.get(id) || null; }
  list() { return [...this.items.values()]; }

  /** Write an approved package into addons/<id>/, replacing an older version of the same add-on. */
  async install({ manifest, files }) {
    const target = path.join(this.dir, manifest.id);
    const temp = `${target}.installing-${process.pid}-${Date.now()}`;
    await fs.promises.mkdir(temp, { recursive: true });
    try {
      for (const [rel, data] of Object.entries(files)) {
        const dest = path.join(temp, ...rel.split('/'));
        if (!dest.startsWith(temp + path.sep)) throw new Error('unsafe path');
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, data);
      }
      await fs.promises.rm(target, { recursive: true, force: true });
      await fs.promises.rename(temp, target);
    } catch (err) {
      await fs.promises.rm(temp, { recursive: true, force: true });
      throw err;
    }
    this.items.set(manifest.id, { manifest });
  }

  async remove(id) {
    if (!ID_RE.test(id)) return;
    await fs.promises.rm(path.join(this.dir, id), { recursive: true, force: true });
    this.items.delete(id);
  }

  /** A script's source, read fresh from the add-on's own folder. */
  async script(id, rel) {
    const p = scriptPath(rel);
    if (!ID_RE.test(id) || !p) throw new Error('No such add-on script.');
    const base = path.join(this.dir, id);
    const file = path.join(base, ...p.split('/'));
    if (!file.startsWith(base + path.sep)) throw new Error('No such add-on script.');
    return fs.promises.readFile(file, 'utf8');
  }
}

module.exports = { AddonStore, validateManifest, capabilities, themeCss, packageFiles, checkPackage, sandboxProgram, scriptPath, COLORS, RESERVED, BLOCKED_EXT, ID_RE };
