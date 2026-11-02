// v3.0 "Make it yours": the app in your language, right-to-left documents, and add-ons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { createRenderer } from '../src/renderer/markdown.js';
import { rtlText, buildModel } from '../src/renderer/export-model.js';
import { collect } from '../scripts/i18n-strings.mjs';

const require = createRequire(import.meta.url);
const i18n = require('../src/main/i18n.js');
const addons = require('../src/main/addons.js');
const tools = require('../src/main/export-tools.js');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const render = createRenderer(window);

test('the language follows the setting, else the system, else English', () => {
  assert.equal(i18n.pickLanguage('de', 'fr-FR'), 'de');
  assert.equal(i18n.pickLanguage('system', 'es-MX'), 'es');
  assert.equal(i18n.pickLanguage('system', 'ja-JP'), 'en');
  assert.equal(i18n.pickLanguage(undefined, ''), 'en');
});

test('translations: exact text, spacing kept, names and numbers in patterns, the most specific pattern first', () => {
  const t = i18n.createTranslator('es');
  assert.equal(t('Open Folder…'), 'Abrir carpeta…');
  assert.equal(t('  Save  '), '  Guardar  ');
  assert.equal(t('Saved as plan.md'), 'Guardado como plan.md');
  assert.equal(t('Replace 3 matches in 2 files?'), '¿Reemplazar 3 coincidencia(s) en 2 archivo(s)?');
  assert.equal(t('Replace 1 match in 1 file?'), '¿Reemplazar 1 coincidencia(s) en 1 archivo(s)?', 'empty plural endings match too');
  assert.equal(t('Something nobody wrote'), 'Something nobody wrote', 'unknown text stays English');
  assert.equal(i18n.createTranslator('en')('Open Folder…'), 'Open Folder…');
  const box = i18n.translateBox({ message: 'Unsaved changes', buttons: ['Cancel', 'Close Without Saving'], detail: 'File not found:\nC:\\x.md' }, i18n.createTranslator('fr'));
  assert.deepEqual(box, { message: 'Modifications non enregistrées', buttons: ['Annuler', 'Fermer sans enregistrer'], detail: 'Fichier introuvable :\nC:\\x.md' });
});

test('menus: labels translated, built-in items labelled, every top-level menu keeps its & shortcut letter', () => {
  const t = i18n.createTranslator('de');
  const menu = i18n.translateMenu([{ label: '&File', submenu: [{ label: 'Open…' }, { role: 'undo' }, { type: 'separator' }] }], t);
  assert.equal(menu[0].label, '&Datei');
  assert.equal(menu[0].submenu[0].label, 'Öffnen…');
  assert.equal(menu[0].submenu[1].label, 'Rückgängig');
  for (const code of ['es', 'fr', 'de']) {
    const tr = i18n.createTranslator(code);
    for (const top of ['&File', '&Edit', '&View', '&Tabs', '&Help']) assert.match(tr(top), /&\S/, `${code}: ${top}`);
  }
});

test('every menu, dialog and screen text is translated into Spanish, French and German', () => {
  const all = collect();
  const brand = new Set(['Neo Markdown Reader', 'No window', '{0} — Neo Markdown Reader']);
  for (const code of ['es', 'fr', 'de']) {
    const t = i18n.createTranslator(code);
    for (const group of ['menus', 'dialogs', 'page']) {
      const missing = all[group].filter((s) => !brand.has(s) && !t.has(s));
      assert.deepEqual(missing, [], `${code} ${group}`);
    }
    const msgs = all.messages.filter((s) => !brand.has(s));
    const done = msgs.filter((s) => t.has(s)).length;
    assert.ok(done / msgs.length > 0.97, `${code} messages: ${done}/${msgs.length}`);
  }
  for (const [code, dict] of Object.entries(i18n.DICTS)) {
    for (const [en, tr] of Object.entries(dict)) {
      if (en.startsWith('_')) continue;
      const need = new Set(en.match(/\{\d\}/g) || []);
      for (const p of tr.match(/\{\d\}/g) || []) assert.ok(need.has(p), `${code}: “${tr}” uses ${p}, which “${en}” doesn't have`);
    }
  }
});

test('right-to-left: blocks follow their own text; lists, quotes and tables that start in Arabic or Hebrew turn too', () => {
  const { html, dir, lang } = render('---\nlang: ar\n---\n# مرحبا\n\nنص عربي\n\n- أول\n- ثاني\n\n> اقتباس\n\n| عمود |\n|---|\n| ١ |\n\nEnglish paragraph.\n\n- English list');
  assert.equal(dir, 'rtl');
  assert.equal(lang, 'ar');
  assert.match(html, /<h1 id="[^"]*" dir="auto"/);
  assert.match(html, /<ul dir="rtl"[^>]*>\n<li dir="auto"/);
  assert.match(html, /<blockquote dir="rtl"/);
  assert.match(html, /<div class="table-wrap" dir="rtl"><table>/);
  assert.match(html, /<ul data-line="\d+">\n<li dir="auto"[^>]*>English list/, 'an English list keeps the page direction');
  assert.equal(render('---\ndir: rtl\n---\nx').dir, 'rtl');
  assert.equal(render('plain').dir, '');
  assert.equal(rtlText('שלום world'), true);
  assert.equal(rtlText('Hello שלום'), false);
  assert.equal(rtlText('2026 · مرحبا'), true, 'numbers and punctuation don’t count');
  const doc = new JSDOM('<article><p dir="auto">مرحبا بالعالم</p><p dir="auto">Hello</p><h2 dir="auto">שלום</h2></article>').window.document;
  const model = buildModel(doc.querySelector('article'));
  assert.deepEqual(model.map((b) => !!b.rtl), [true, false, true]);
});

const EXTRAS = join(import.meta.dirname, '..', 'samples', 'addons', 'neo-extras');
const extrasFiles = () => Object.fromEntries(['addon.json', 'timeline.js', 'opml.js'].map((f) => [f, readFileSync(join(EXTRAS, f))]));

test('add-on manifests: what may be added, and plain reasons for what may not', () => {
  const ok = addons.validateManifest(readFileSync(join(EXTRAS, 'addon.json')));
  assert.equal(ok.error, undefined);
  assert.equal(ok.manifest.id, 'neo-extras');
  assert.deepEqual(addons.capabilities(ok.manifest), [
    'Adds the light theme “Solar”.', 'Draws ```timeline code blocks in your documents.', 'Adds File › Export › Outline (OPML) (.opml).',
  ]);
  const base = { id: 'x-addon', name: 'X', version: '1.0.0' };
  const err = (m) => addons.validateManifest({ ...base, ...m }).error;
  assert.match(err({}), /doesn’t add anything/);
  assert.match(addons.validateManifest({ ...base, id: 'Bad Id' }).error, /id must be/);
  assert.match(err({ codeBlocks: [{ language: 'mermaid', script: 'a.js' }] }), /drawn by the app itself/);
  assert.match(err({ codeBlocks: [{ language: 'abc', script: '../evil.js' }] }), /script .* is missing/);
  assert.match(err({ codeBlocks: [{ language: 'abc', script: 'C:/evil.js' }] }), /missing/);
  assert.match(err({ exports: [{ id: 'run', name: 'Run me', extension: 'exe', script: 'a.js' }] }), /could be run as programs/);
  assert.match(err({ exports: [{ id: 'bat', name: 'Batch', extension: '.BAT', script: 'a.js' }] }), /could be run as programs/);
  assert.match(err({ themes: [{ id: 'tt', name: 'T', colors: { page: 'url(https://x/y.png)' } }] }), /written like #1d2330/);
  assert.match(err({ themes: [{ id: 'tt', name: 'T', colors: { behaviour: '#fff' } }] }), /unknown colour/);
  assert.match(err({ themes: [{ id: 'tt', name: 'Faint', colors: { text: '#bbbbbb' } }] }), /Theme “Faint” would be hard to read: text on page has a contrast of 1\.\d+:1/);
  assert.match(err({ themes: [{ id: 'tt', name: 'Night', tone: 'dark', colors: { page: '#ffffff' } }] }), /hard to read: text on page/, 'a light page under the dark theme’s light text');
  assert.equal(err({ themes: [{ id: 'tt', name: 'Ok', tone: 'dark', colors: { page: '#000000', accent: '#ffd43b' } }] }), undefined);
  assert.equal(addons.themeCss('a:b', { colors: { page: '#fff', accent: '#123456' } }), ':root[data-addon-theme="a:b"] { --page: #fff; --accent: #123456; }');
});

test('add-on packages: a zip with the add-on at the top or in a folder; unsafe names and extra files refused or dropped', () => {
  const zip = (files) => tools.unzipAddon(Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))));
  const inFolder = addons.packageFiles(zip(Object.fromEntries(Object.entries(extrasFiles()).map(([k, v]) => [`neo-extras/${k}`, new Uint8Array(v)]))));
  const checked = addons.checkPackage(inFolder.files);
  assert.equal(checked.manifest.name, 'Neo Extras');
  assert.deepEqual(Object.keys(checked.files).sort(), ['addon.json', 'opml.js', 'timeline.js']);
  const withExtra = addons.checkPackage({ ...extrasFiles(), 'run.exe': Buffer.from('MZ') });
  assert.equal(withExtra.files['run.exe'], undefined, 'only the manifest and its scripts are kept');
  assert.match(addons.packageFiles({ 'addon.json': new Uint8Array(1), '../evil.js': new Uint8Array(1) }).error, /unsafe name/);
  assert.match(addons.packageFiles({ 'a/addon.json': new Uint8Array(1), 'b/addon.json': new Uint8Array(1) }).error, /no addon.json/);
  assert.throws(() => tools.unzipAddon(Buffer.from('not a zip')), /isn’t an add-on package/);
  assert.throws(() => zip({ 'addon.json': '{}', 'big.js': new Uint8Array(2 * 1024 * 1024) }), /too large/);
});

test('installed add-ons are checked again when read, and stay inside their own folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-addons-'));
  const store = new addons.AddonStore(dir).load();
  assert.equal(store.list().length, 0);
  await store.install(addons.checkPackage(extrasFiles()));
  const again = new addons.AddonStore(dir).load();
  assert.equal(again.get('neo-extras').manifest.version, '1.0.0');
  assert.match(await again.script('neo-extras', 'timeline.js'), /function main/);
  await assert.rejects(again.script('neo-extras', '../addon.json'), /No such add-on script/);
  await assert.rejects(again.script('../x', 'timeline.js'), /No such add-on script/);
  await again.remove('neo-extras');
  assert.equal(new addons.AddonStore(dir).load().list().length, 0);
});

test('add-on code gets its input as data and must answer through main()', async () => {
  const program = addons.sandboxProgram('function main(i) { return i.code.toUpperCase(); }', { code: 'a`${x}`\'"</script>' });
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  assert.equal(JSON.parse(await new AsyncFunction(program)()), 'A`${X}`\'"</SCRIPT>');
  await assert.rejects(new AsyncFunction(addons.sandboxProgram('const x = 1;', {}))(), /no main\(\) function/);
});

test('what an add-on draws is sanitized like a document, and can’t reach the web', () => {
  const out = render.sanitizeAddon('<svg viewBox="0 0 10 10"><image href="https://evil.example/t.png"/><a href="https://evil.example"><text>x</text></a><circle r="2" style="fill:red;background:url(https://evil.example/p)"/></svg><img src="https://evil.example/a.png"><script>alert(1)</script><div onclick="x()" style="color:red">ok</div><link rel="stylesheet" href="https://evil.example/c.css">');
  assert.doesNotMatch(out, /evil\.example|<script|onclick|<img|<a |<image|<link/);
  assert.match(out, /<circle r="2">/, 'a style that loads from a URL is dropped');
  assert.match(out, /<div style="color:red">ok<\/div>/);
});
