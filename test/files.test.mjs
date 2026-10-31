import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isMarkdownPath, fileFromArgv, readMarkdown } = require('../src/main/files.js');
const { sanitize } = require('../src/main/settings.js');
const { compareVersions } = require('../src/main/version.js');

const dir = mkdtempSync(join(tmpdir(), 'nmr-'));
const md = join(dir, 'notes.md');
writeFileSync(md, '\uFEFF# Hi');
writeFileSync(join(dir, 'evil.exe'), 'MZ');

test('only markdown/text extensions are accepted', () => {
  assert.ok(isMarkdownPath('C:\\a\\README.MD'));
  assert.ok(isMarkdownPath('/x/y.markdown'));
  assert.ok(!isMarkdownPath('/x/y.exe'));
  assert.ok(!isMarkdownPath(undefined));
});

test('file is picked from the command line (double-click / Open with)', () => {
  assert.equal(fileFromArgv(['app.exe', '--flag', md]), md);
  assert.equal(fileFromArgv(['electron', '.', 'notes.md'], dir), md);
  assert.equal(fileFromArgv(['app.exe', join(dir, 'evil.exe')]), null);
});

test('readMarkdown strips BOM and produces a base URL for images', async () => {
  const doc = await readMarkdown(md);
  assert.equal(doc.content, '# Hi');
  assert.equal(doc.name, 'notes.md');
  assert.ok(doc.baseUrl.startsWith('file://') && doc.baseUrl.endsWith('/'));
  await assert.rejects(readMarkdown(join(dir, 'evil.exe')), /Not a Markdown file/);
});

test('settings are validated and clamped', () => {
  const s = sanitize({ theme: 'neon', fontScale: 9, pageWidth: 'wide', recent: ['a', 5], showToc: false });
  assert.equal(s.theme, 'system');
  assert.equal(s.fontScale, 1.8);
  assert.equal(s.pageWidth, 'wide');
  assert.deepEqual(s.recent, ['a']);
  assert.equal(s.showToc, false);
});

test('session, positions and menu-bar settings are validated', () => {
  const s = sanitize({
    showMenuBar: false,
    restoreSession: 'yes',
    positions: { 'C:\\a.md': 0.42, 'C:\\b.md': 7, bad: 'x' },
    session: [
      { bounds: { x: 1, y: 2, width: 800, height: 600 }, tabs: [{ path: 'C:\\a.md', scroll: 0.5 }, { path: 42 }], active: 9 },
      { tabs: [] },
    ],
  });
  assert.equal(s.showMenuBar, false);
  assert.equal(s.restoreSession, true);                    // non-boolean ignored
  assert.deepEqual(s.positions, { 'C:\\a.md': 0.42, 'C:\\b.md': 1 });
  assert.equal(s.session.length, 1);                       // empty windows dropped
  assert.deepEqual(s.session[0].tabs, [{ path: 'C:\\a.md', scroll: 0.5 }]);
  assert.equal(s.session[0].active, 0);                    // out-of-range index reset
});

test('version comparison for update checks', () => {
  assert.equal(compareVersions('1.1.0', '1.0.0'), 1);
  assert.equal(compareVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('v1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0-beta.1', '2.0.0'), 0);
});
