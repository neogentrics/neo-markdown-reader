// Lists the English text the app shows, for translators and for the translation coverage test.
//   node scripts/i18n-strings.mjs            → prints JSON { menus, dialogs, page, messages }
//   node scripts/i18n-strings.mjs --missing  → per language, what isn't translated yet
// Template strings with ${…} become patterns with {0}, {1}… (the form the dictionaries use).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** A JS string literal's text, or a template's text with ${…} as {0}, {1}…; null if it isn't plain text. */
function literal(src) {
  const q = src[0];
  let body = src.slice(1, -1);
  if (q === '`') {
    let n = 0;
    let depth = 0;
    let out = '';
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '$' && body[i + 1] === '{' && depth === 0) { depth = 1; i++; out += `{${n++}}`; continue; }
      if (depth) { if (body[i] === '{') depth++; else if (body[i] === '}') depth--; continue; }
      out += body[i];
    }
    body = out;
  }
  return body.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

const STR = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const isText = (s) => !!s && /[A-Za-z]{2}/.test(s) && !/^[a-z0-9-]+(:[a-z-]+)?$/.test(s) && !/[<>]|=>|^\.|^#|\$\(|^[A-Za-z]+\+/.test(s) && !/^(https?|file|data|mailto):/.test(s) && s.length < 400;

function menuStrings(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:label|sublabel):\s*('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.add(literal(m[1]));
  for (const m of src.matchAll(/\bcmd\(\s*'[^']*',\s*('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.add(literal(m[1]));
  for (const m of src.matchAll(/\bradio\(\s*('(?:[^'\\]|\\.)*')/g)) out.add(literal(m[1]));
  return [...out].filter(isText);
}

function dialogStrings(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:message|detail|title|checkboxLabel):\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.add(literal(m[1]));
  for (const m of src.matchAll(/\bbuttons:\s*\[([^\]]*)\]/g)) for (const b of m[1].match(STR) || []) out.add(literal(b));
  for (const m of src.matchAll(/\berror:\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.add(literal(m[1]));
  return [...out].filter(isText);
}

function pageStrings(html) {
  const { document } = new JSDOM(html).window;
  const out = new Set();
  const walker = document.createTreeWalker(document.body, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('script, style, kbd, code, [translate="no"]')) continue;
    const s = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (isText(s)) out.add(s);
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (isText(v)) out.add(v.trim()); }
  }
  const title = document.querySelector('title')?.textContent;
  return [...out].filter((s) => s !== title);
}

/** Messages the page shows: toast(…), status lines and labels set from code. */
function messageStrings(src) {
  const out = new Set();
  const calls = /\b(?:toast|setStatus|status|say)\(\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  for (const m of src.matchAll(calls)) out.add(literal(m[1]));
  for (const m of src.matchAll(/\.(?:textContent|title|placeholder)\s*=\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.add(literal(m[1]));
  for (const m of src.matchAll(/toast\(\s*[^;]*?\?\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*:\s*('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) { out.add(literal(m[1])); out.add(literal(m[2])); }
  return [...out].filter(isText);
}

export function collect() {
  const main = read('src/main/main.js');
  const mainSide = ['src/main/main.js', 'src/main/editing.js', 'src/main/updater.js'].map(read).join('\n');
  const renderer = readdirSync(join(root, 'src/renderer')).filter((f) => f.endsWith('.js')).map((f) => read(`src/renderer/${f}`)).join('\n');
  return {
    menus: menuStrings(main),
    dialogs: dialogStrings(mainSide),
    page: pageStrings(read('src/renderer/index.html')),
    messages: messageStrings(renderer),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = collect();
  if (process.argv.includes('--missing')) {
    const require = createRequire(import.meta.url);
    const { createTranslator, DICTS } = require('../src/main/i18n.js');
    for (const code of Object.keys(DICTS)) {
      const t = createTranslator(code);
      const missing = {};
      for (const [group, list] of Object.entries(all)) missing[group] = list.filter((s) => !t.has(s));
      console.log(JSON.stringify({ code, missing }, null, 1));
    }
  } else console.log(JSON.stringify(all, null, 1));
}
