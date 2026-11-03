// Tests for 3.1 "Across your computers": syncing highlights, notes, bookmarks, recent files, reading
// positions and settings through a shared folder, with two engines standing in for two computers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sync = require('../src/main/sync.js');
const { Settings } = require('../src/main/settings.js');
const { AnnotationStore } = require('../src/main/annotations.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-sync-'));
const hl = (id, quote, extra = {}) => ({ id, quote, prefix: '', suffix: '', color: 'yellow', note: '', created: 1000, ...extra });

/** A "computer": its own app-data folder, its own copy of the cloud folder, and an engine. */
function computer(shared, name) {
  const base = tmp();
  const cloud = path.join(base, 'OneDrive');
  fs.mkdirSync(path.join(cloud, 'Notes'), { recursive: true });
  const data = path.join(base, 'data');
  const settings = new Settings(data);
  const annotations = new AnnotationStore(data);
  const applied = [];
  const engine = new sync.SyncEngine({
    dir: data, settings, annotations, hostname: name,
    roots: [{ id: 'onedrive', path: cloud }, { id: 'home', path: path.join(base, 'home') }],
    onApplied: (a) => applied.push(a),
  });
  const doc = (rel, text = '# Plan\n\nOpen the shop in spring.\n') => {
    const p = path.join(cloud, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  return { base, cloud, settings, annotations, engine, applied, doc, shared, name };
}

test('sync: a document is named by its place in the cloud folder, the same on every computer', () => {
  const roots = [{ id: 'onedrive', path: path.resolve('/a/OneDrive') }, { id: 'home', path: path.resolve('/a') }];
  const there = [{ id: 'onedrive', path: path.resolve('/b/Cloud/OneDrive') }];
  const key = sync.toKey(path.resolve('/a/OneDrive/Notes/plan.md'), roots);
  assert.equal(key, 'onedrive:Notes/plan.md');
  assert.equal(sync.fromKey(key, there), path.join(path.resolve('/b/Cloud/OneDrive'), 'Notes', 'plan.md'));
  assert.equal(sync.toKey(path.resolve('/a/docs/x.md'), roots), 'home:docs/x.md');
  assert.equal(sync.fromKey('home:docs/x.md', there), null, 'a folder this computer does not have');
  assert.equal(sync.fromKey('onedrive:../escape.md', there), null, 'no climbing out of the folder');
  assert.equal(sync.fromKey('onedrive:a//b.md', there), null);
});

test('sync: the newest version of each item wins, and a removal spreads', () => {
  const a = {};
  sync.record(a, {}, { 's:theme': 'dark', 'h:onedrive:n.md\tx': hl('x', 'spring') }, { now: 100, device: 'aaaa' });
  const b = {};
  assert.ok(sync.merge(b, a));
  assert.equal(b['s:theme'].v, 'dark');
  // B changes the theme later; A removes the highlight later still.
  sync.record(b, { 's:theme': 'dark' }, { 's:theme': 'sepia' }, { now: 200, device: 'bbbb' });
  sync.record(a, { 'h:onedrive:n.md\tx': hl('x', 'spring') }, {}, { now: 300, device: 'aaaa' });
  sync.merge(a, b);
  sync.merge(b, a);
  assert.equal(a['s:theme'].v, 'sepia');
  assert.equal(b['s:theme'].v, 'sepia');
  assert.equal(b['h:onedrive:n.md\tx'].v, null, 'the removal is kept, not forgotten');
  assert.equal(sync.merge(b, { 's:theme': { v: 'dark', t: 50, d: 'zzzz' } }), false, 'an older change never wins');
  assert.equal(sync.merge(b, { 's:bogus': { v: 1, t: 999, d: 'zzzz' } }), false, 'only settings that are meant to sync');
});

test('sync: a computer joining takes the settings already there, and keeps its own highlights', () => {
  const there = {};
  sync.record(there, {}, { 's:theme': 'forest' }, { now: 500, device: 'aaaa' });
  const mine = {};
  sync.record(mine, null, { 's:theme': 'light', 'b:onedrive:mine.md': true }, { now: 900, device: 'bbbb', join: true });
  sync.merge(mine, there);
  assert.equal(mine['s:theme'].v, 'forest');
  assert.equal(mine['b:onedrive:mine.md'].v, true);
});

test('sync: recent files keep the order they were opened in, across computers', () => {
  const j = {};
  sync.record(j, {}, { 'r:k:a.md': true, 'r:k:b.md': true }, { now: 1000, device: 'aaaa' });
  // b.md is opened again: it moves to the top without its value changing.
  sync.record(j, { 'r:k:a.md': true, 'r:k:b.md': true }, { 'r:k:b.md': true, 'r:k:a.md': true }, { now: 2000, device: 'aaaa' });
  const want = sync.desired(j, { resolve: (k) => `/x/${k.slice(2)}`, exists: () => true });
  assert.deepEqual(want.recent, ['/x/b.md', '/x/a.md']);
});

test('sync: password-locked documents are never synced', () => {
  const keyOf = (p) => `k:${path.basename(p)}`;
  const items = sync.snapshot({ settings: { bookmarks: ['/d/secret.mdlock', '/d/open.md'], recent: [], positions: { '/d/secret.mdlock': 0.5 } }, annotations: { '/d/secret.mdlock': [hl('s', 'the secret')] } }, keyOf);
  assert.deepEqual(Object.keys(items).filter((k) => !k.startsWith('s:')), ['b:k:open.md']);
});

test('sync: two computers end up with the same highlights, notes, bookmarks and settings', async () => {
  const shared = tmp();
  const a = computer(shared, 'Desk');
  const b = computer(shared, 'Laptop');
  const pa = a.doc('Notes/plan.md');
  const pb = b.doc('Notes/plan.md');                 // the same file, synced to another place

  a.annotations.set(pa, [hl('h1', 'spring', { note: 'check the date' })]);
  a.settings.update({ theme: 'sepia', bookmarks: [pa] });
  await a.engine.configure({ folder: shared, enabled: true });
  await b.engine.configure({ folder: shared, enabled: true });

  assert.equal(b.settings.get().theme, 'sepia');
  assert.deepEqual(b.settings.get().bookmarks, [pb]);
  assert.equal(b.annotations.get(pb)[0].note, 'check the date');
  assert.deepEqual(b.applied.at(-1).annotationPaths, [pb], 'the open window is told which documents changed');
  assert.deepEqual(b.engine.status().devices.map((d) => d.name), ['Desk']);

  // The laptop removes the highlight and adds another; the desk sees both changes.
  b.annotations.set(pb, [hl('h2', 'shop')]);
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.annotations.get(pa).map((x) => x.id), ['h2']);

  // Each computer wrote only its own file.
  const files = fs.readdirSync(path.join(shared, sync.DIR_NAME, 'devices'));
  assert.equal(files.length, 2);
});

test('sync: a highlight for a document that has not arrived yet waits, and is not deleted', async () => {
  const shared = tmp();
  const a = computer(shared, 'Desk');
  const b = computer(shared, 'Laptop');
  const pa = a.doc('Notes/later.md');
  a.annotations.set(pa, [hl('w1', 'spring')]);
  await a.engine.configure({ folder: shared, enabled: true });
  await b.engine.configure({ folder: shared, enabled: true });   // the laptop doesn't have later.md yet
  await b.engine.sync();
  const pb = b.doc('Notes/later.md');                           // ...now the cloud service delivers it
  await b.engine.sync();
  assert.equal(b.annotations.get(pb).length, 1, 'applied once the document arrived');
  await a.engine.sync();
  assert.equal(a.annotations.get(pa).length, 1, 'and the desk never saw it as deleted');
});

test('sync: a bookmark for a document this computer can’t reach stays where it is', async () => {
  const shared = tmp();
  const a = computer(shared, 'Desk');
  const gone = path.join(a.base, 'elsewhere', 'moved.md');          // outside every folder, and not on disk
  a.settings.update({ bookmarks: [gone] });
  await a.engine.configure({ folder: shared, enabled: true });
  await a.engine.sync();
  assert.deepEqual(a.settings.get().bookmarks, [gone]);
});

test('sync: a file from a newer version, or a damaged one, is skipped without breaking anything', async () => {
  const shared = tmp();
  const a = computer(shared, 'Desk');
  await a.engine.configure({ folder: shared, enabled: true });
  const dir = path.join(shared, sync.DIR_NAME, 'devices');
  fs.writeFileSync(path.join(dir, `${'f'.repeat(24)}.json`), '{ half written');
  fs.writeFileSync(path.join(dir, `${'e'.repeat(24)}.json`), JSON.stringify({ format: sync.FORMAT, version: 99, device: { name: 'Future' }, written: Date.now(), items: { 's:theme': { v: 'dusk', t: Date.now() + 1e6, d: 'e' } } }));
  const st = await a.engine.sync();
  assert.notEqual(a.settings.get().theme, 'dusk');
  assert.match(st.error, /newer version/);
});
