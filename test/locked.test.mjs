import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const locked = require('../src/main/locked.js');
const files = require('../src/main/files.js');
const { scanFolder, searchFolder } = require('../src/main/folders.js');
const { Editing } = require('../src/main/editing.js');

const FAST = { name: 'scrypt', N: 2 ** 10, r: 8, p: 1 };     // quick key derivation for tests only

test('a locked document opens with the right password and keeps its text exactly', async () => {
  const content = '# Secret plan\n\nUnicode ✓ — ünïcødé, emoji 🚀, and a "quote".\n';
  const { text, key } = await locked.lock({ content, name: 'plan.md' }, 'correct horse battery');
  assert.doesNotMatch(text, /Secret|plan\.md|🚀/, 'nothing readable in the file');
  const env = JSON.parse(text);
  assert.equal(env.format, 'neo-markdown-locked');
  assert.equal(env.kdf.N, 2 ** 17);
  const out = await locked.unlock(text, 'correct horse battery');
  assert.equal(out.content, content);
  assert.equal(out.name, 'plan.md');
  assert.deepEqual(out.key, key);
  assert.equal(locked.unlockWithKey(text, key).content, content);
});

test('a wrong password, a tampered file, or a non-locked file is refused', async () => {
  const { text } = await locked.lock({ content: 'hello', name: 'a.md' }, 'password-one', FAST);
  await assert.rejects(locked.unlock(text, 'password-two'), { code: 'WRONG_PASSWORD' });
  const env = JSON.parse(text);
  const data = Buffer.from(env.data, 'base64'); data[0] ^= 1;
  await assert.rejects(locked.unlock(JSON.stringify({ ...env, data: data.toString('base64') }), 'password-one'), { code: 'WRONG_PASSWORD' });
  // Changing the key-derivation parameters is caught too (they're authenticated).
  await assert.rejects(locked.unlock(JSON.stringify({ ...env, kdf: { ...env.kdf, N: 2 ** 11 } }), 'password-one'), { code: 'WRONG_PASSWORD' });
  await assert.rejects(locked.unlock('# just markdown', 'x'), { code: 'NOT_LOCKED' });
  await assert.rejects(locked.unlock(JSON.stringify({ ...env, kdf: { ...env.kdf, N: 2 ** 24 } }), 'x'), { code: 'NOT_LOCKED' }, 'absurd cost refused');
  await assert.rejects(locked.lock({ content: 'x' }, 'short'), /at least 8/);
  assert.equal(locked.isLockedText(text), true);
  assert.equal(locked.isLockedText('{}'), false);
});

test('each save uses a fresh IV but the same password still opens it', async () => {
  const first = await locked.lock({ content: 'v1', name: 'n.md' }, 'a long password', FAST);
  const again = locked.sealWithKey({ content: 'v2', name: 'n.md' }, first.key, { salt: first.salt, kdf: first.kdf });
  assert.notEqual(JSON.parse(again).iv, JSON.parse(first.text).iv);
  assert.equal((await locked.unlock(again, 'a long password')).content, 'v2');
});

test('reading a locked file: unreadable without the key, readable with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-lock-'));
  const p = join(dir, 'notes.mdlock');
  const { text, key } = await locked.lock({ content: 'line 1\r\nline 2\n', name: 'notes.md' }, 'secret password', FAST);
  writeFileSync(p, text);
  assert.equal(files.isOpenablePath(p), true);
  assert.equal(files.isMarkdownPath(p), false);
  const closed = await files.readDocument(p, () => null);
  assert.equal(closed.needsPassword, true);
  assert.equal(closed.content, '');
  assert.equal(closed.locked, true);
  const open = await files.readDocument(p, () => key);
  assert.equal(open.content, 'line 1\nline 2\n');
  assert.equal(open.needsPassword, undefined);
  writeFileSync(join(dir, 'fake.mdlock'), 'not locked');
  await assert.rejects(files.readDocument(join(dir, 'fake.mdlock')), { code: 'NOT_LOCKED' });
});

test('folders list locked documents but never search inside them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-lockdir-'));
  writeFileSync(join(dir, 'open.md'), 'the word banana\n');
  const { text } = await locked.lock({ content: 'banana inside', name: 'x.md' }, 'secret password', FAST);
  writeFileSync(join(dir, 'secret.mdlock'), text);
  const scan = await scanFolder(dir);
  assert.deepEqual(scan.tree.files.map((f) => [f.name, !!f.locked]), [['open.md', false], ['secret.mdlock', true]]);
  const res = await searchFolder(scan, 'banana');
  assert.deepEqual(res.results.map((r) => r.name), ['open.md']);
});

test('saving a locked document writes ciphertext, never plain text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-locksave-'));
  const p = join(dir, 'a.mdlock');
  const first = await locked.lock({ content: 'old', name: 'a.md' }, 'secret password', FAST);
  writeFileSync(p, first.text);
  const store = { data: { editGrants: { files: [p], folders: [] } }, get() { return this.data; }, update(x) { Object.assign(this.data, x); } };
  const seal = (_p, content) => locked.sealWithKey({ content, name: 'a.md' }, first.key, { salt: first.salt, kdf: first.kdf });
  const ed = new Editing({ settings: store, dialog: {}, backupDir: join(dir, 'backups'), sealLocked: seal });
  const res = await ed.save({ win: null }, { path: p, content: 'new secret words', baseMtime: NaN });
  assert.equal(res.ok, true);
  const disk = readFileSync(p, 'utf8');
  assert.doesNotMatch(disk, /secret words/);
  assert.equal((await locked.unlock(disk, 'secret password')).content, 'new secret words');
  // Without the key the save is refused instead of writing the text unencrypted.
  const noKey = new Editing({ settings: store, dialog: {}, backupDir: join(dir, 'backups') });
  assert.equal((await noKey.save({ win: null }, { path: p, content: 'x', baseMtime: NaN })).reason, 'locked');
});

test('code sandbox: only its own folder is served, only JS and Python run', () => {
  const { sandboxFile, runnableLang } = require('../src/main/sandbox.js');
  const dir = join(tmpdir(), 'sbx');
  assert.equal(sandboxFile(dir, 'nmr-sandbox://app/sandbox.html'), join(dir, 'sandbox.html'));
  assert.equal(sandboxFile(dir, 'nmr-sandbox://app/pyodide/pyodide.mjs'), join(dir, 'pyodide', 'pyodide.mjs'));
  assert.equal(sandboxFile(dir, 'nmr-sandbox://app/..%2f..%2fetc%2fpasswd'), null);
  assert.equal(sandboxFile(dir, 'nmr-sandbox://other/sandbox.html'), null);
  assert.equal(sandboxFile(dir, 'file:///etc/passwd'), null);
  assert.equal(sandboxFile(dir, 'nmr-sandbox://app/'), null);
  assert.deepEqual(['js', 'JavaScript', 'py', 'python3', 'bash', 'powershell', 'sh', ''].map(runnableLang),
    ['javascript', 'javascript', 'python', 'python', null, null, null, null]);
});
