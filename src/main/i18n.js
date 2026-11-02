'use strict';
// The app in your language (3.0). English is written in the code; each translation is a dictionary
// from English text to the language's text, in src/locales/<code>.json. Entries with {0}, {1}… are
// patterns that also translate text with names or numbers in it ("Saved {0}" → "Guardado {0}").
// Shared by the main process (menus, native dialogs) and the page (src/renderer/i18n-ui.js).

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
];
const CODES = new Set(LANGUAGES.map((l) => l.code));

const DICTS = {
  es: require('../locales/es.json'),
  fr: require('../locales/fr.json'),
  de: require('../locales/de.json'),
};

/** The language to use: the one chosen, or the system's if it's one we have, else English. */
function pickLanguage(setting, systemLocale = '') {
  if (CODES.has(setting)) return setting;
  const base = String(systemLocale || '').toLowerCase().split(/[-_]/)[0];
  return CODES.has(base) ? base : 'en';
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A translate function for `code`: t('Open Folder…') → 'Abrir carpeta…'. Text it doesn't know comes
 * back unchanged, so a missing translation shows English rather than nothing.
 */
function createTranslator(code, dicts = DICTS) {
  const dict = code === 'en' ? null : dicts[code];
  if (!dict) {
    const same = (s) => s;
    same.lang = 'en';
    same.has = () => true;
    return same;
  }
  const exact = new Map();
  const patterns = [];
  for (const [key, value] of Object.entries(dict)) {
    if (key.startsWith('_') || typeof value !== 'string') continue;   // "_comment" entries
    if (/\{\d\}/.test(key)) {
      const order = [...key.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
      const re = new RegExp(`^${escRe(key).replace(/\\\{\d\\\}/g, '([\\s\\S]*?)')}$`);
      patterns.push({ re, order, value });
    } else exact.set(key, value);
  }
  const cache = new Map();
  const t = (text) => {
    if (typeof text !== 'string' || !text) return text;
    if (exact.has(text)) return exact.get(text);
    if (cache.has(text)) return cache.get(text);
    // Keep spacing around the text (text nodes in the page often have it).
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    let out = text;
    if (m[2] && m[2] !== text && exact.has(m[2])) out = m[1] + exact.get(m[2]) + m[3];
    else {
      for (const p of patterns) {
        const hit = p.re.exec(m[2]);
        if (!hit) continue;
        const args = [];
        p.order.forEach((n, i) => { args[n] = t(hit[i + 1]); });
        out = m[1] + p.value.replace(/\{(\d)\}/g, (_x, n) => args[Number(n)] ?? '') + m[3];
        break;
      }
    }
    if (cache.size < 5000) cache.set(text, out);
    return out;
  };
  t.lang = code;
  t.has = (text) => exact.has(text) || patterns.some((p) => p.re.test(text));
  return t;
}

// Built-in menu items Electron labels in English by itself.
const ROLE_LABELS = { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All', selectall: 'Select All', delete: 'Delete', togglefullscreen: 'Toggle Full Screen' };

/** Translate a menu template in place (labels and sublabels), keeping & shortcuts working. */
function translateMenu(items, t) {
  for (const item of items || []) {
    if (!item.label && item.role && ROLE_LABELS[item.role] && t.lang !== 'en') item.label = ROLE_LABELS[item.role];
    if (item.label) item.label = t(item.label);
    if (item.sublabel) item.sublabel = t(item.sublabel);
    if (Array.isArray(item.submenu)) translateMenu(item.submenu, t);
  }
  return items;
}

/** Translate the words of a native message box (title, message, detail, buttons, checkbox). */
function translateBox(opts, t) {
  if (!opts || t.lang === 'en') return opts;
  const out = { ...opts };
  for (const k of ['title', 'message', 'detail', 'checkboxLabel']) if (typeof out[k] === 'string') out[k] = t(out[k]);
  if (Array.isArray(out.buttons)) out.buttons = out.buttons.map((b) => t(b));
  return out;
}

module.exports = { LANGUAGES, CODES, pickLanguage, createTranslator, translateMenu, translateBox, DICTS };
