import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanFolder, searchFolder, excerpt } = require('../src/main/folders.js');
const { AnnotationStore, cleanAnnotation } = require('../src/main/annotations.js');

function makeFolder() {
  const root = mkdtempSync(join(tmpdir(), 'nmr-folder-'));
  mkdirSync(join(root, 'guides', 'deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(root, 'images'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Project\n\nInstall with npm.\n');
  writeFileSync(join(root, 'notes.txt'), 'plain notes mention Install too\n');
  writeFileSync(join(root, 'guides', 'Setup.md'), '# Setup\r\n\r\nRun the INSTALL script.\r\n');
  writeFileSync(join(root, 'guides', 'deep', 'faq.markdown'), '# FAQ\n\nNothing here.\n');
  writeFileSync(join(root, 'node_modules', 'pkg', 'README.md'), '# should be skipped install\n');
  writeFileSync(join(root, '.git', 'x.md'), 'install');
  writeFileSync(join(root, 'images', 'logo.png'), 'not markdown');
  return root;
}

test('folder scan lists Markdown files as a tree, skipping node_modules, hidden and empty folders', async () => {
  const root = makeFolder();
  const scan = await scanFolder(root);
  assert.equal(scan.files.length, 4);
  assert.deepEqual(scan.tree.files.map((f) => f.name), ['notes.txt', 'README.md']);
  assert.deepEqual(scan.tree.dirs.map((d) => d.name), ['guides']);            // images/, .git/, node_modules/ left out
  assert.deepEqual(scan.tree.dirs[0].dirs[0].files.map((f) => f.name), ['faq.markdown']);
  assert.equal(scan.truncated, false);
});

test('folder scan stops at the file limit and says so', async () => {
  const scan = await scanFolder(makeFolder(), { maxDepth: 10, maxFiles: 2 });
  assert.equal(scan.files.length, 2);
  assert.equal(scan.truncated, true);
});

test('find in folder is case-insensitive and reports line numbers', async () => {
  const root = makeFolder();
  const res = await searchFolder(await scanFolder(root), 'install');
  const names = res.results.map((r) => r.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  assert.deepEqual(names, ['notes.txt', 'README.md', 'Setup.md']);
  const setup = res.results.find((r) => r.name === 'Setup.md');
  assert.deepEqual(setup.matches.map((m) => m.line), [2]);
  assert.match(setup.matches[0].text, /INSTALL/);
  assert.equal(setup.rel.replace(/\\/g, '/'), 'guides/Setup.md');
  assert.equal(res.total, 3);
  assert.deepEqual((await searchFolder(await scanFolder(root), '   ')).results, []);
});

test('search excerpts trim long lines around the match', () => {
  const line = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200);
  const ex = excerpt(line, 200, 6);
  assert.ok(ex.startsWith('…') && ex.endsWith('…') && ex.includes('NEEDLE') && ex.length < 140);
});

test('highlights are validated, stored per file, and survive a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-ann-'));
  const store = new AnnotationStore(dir, 'win32');
  assert.equal(cleanAnnotation({ quote: '   ' }), null);
  const saved = store.set('C:\\Docs\\A.md', [
    { id: 'a1', quote: 'important part', prefix: 'the ', suffix: ' of', color: 'green', note: 'check this' },
    { quote: 'x', color: 'purple' },              // unknown colour → yellow
    { nope: true },                                // dropped
  ]);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].color, 'yellow');
  assert.deepEqual(store.get('c:\\docs\\a.md').map((a) => a.quote), ['important part', 'x']);   // Windows paths: case-insensitive
  store.flush();
  const again = new AnnotationStore(dir, 'win32');
  assert.equal(again.get('C:\\Docs\\A.md')[0].note, 'check this');
  again.set('C:\\Docs\\A.md', []);
  assert.deepEqual(again.get('C:\\Docs\\A.md'), []);
});
