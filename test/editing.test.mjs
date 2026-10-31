import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { encodeForSave, detectEol, isInside, readMarkdown } = require('../src/main/files.js');
const { Editing } = require('../src/main/editing.js');
const { sanitize } = require('../src/main/settings.js');

function fakeSettings(initial = {}) {
  let data = sanitize(initial);
  return { get: () => structuredClone(data), update: (p) => { data = sanitize({ ...data, ...p }); return data; } };
}
function fakeDialog(answers = []) {
  const asked = [];
  return {
    asked,
    showMessageBox: async (_w, o) => { asked.push(o.message); return { response: answers.length ? answers.shift() : o.cancelId }; },
    showSaveDialog: async () => ({ canceled: true }),
  };
}

test('line endings and BOM survive a round trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-enc-'));
  const f = join(dir, 'a.md');
  writeFileSync(f, '﻿# A\r\n\r\nline\r\n');
  const doc = await readMarkdown(f);
  assert.equal(doc.content, '# A\n\nline\n');                  // the page always sees \n
  assert.equal(doc.eol, '\r\n');
  assert.equal(doc.bom, true);
  assert.equal(encodeForSave(doc.content + 'more\n', doc), '﻿# A\r\n\r\nline\r\nmore\r\n');
  assert.equal(encodeForSave('a\nb', { eol: '\n', bom: false }), 'a\nb');
  assert.equal(detectEol('a\nb\nc\r\n'), '\n');
});

test('folder permission covers files inside it, not look-alike folders', () => {
  assert.ok(isInside('/docs', '/docs/a.md', 'linux'));
  assert.ok(isInside('/docs', '/docs/sub/a.md', 'linux'));
  assert.ok(!isInside('/docs', '/docs-old/a.md', 'linux'));
  assert.ok(!isInside('/Docs', '/docs/a.md', 'linux'));         // Linux paths are case-sensitive
  assert.ok(isInside('/Docs', '/docs/a.md', 'win32'));          // Windows paths are not
});

test('permission: Just this time is per window and ends when the tab closes; Always is remembered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-perm-'));
  const f = join(dir, 'a.md');
  writeFileSync(f, '# A\n');
  const settings = fakeSettings();
  const dialog = fakeDialog([0, 3, 1]);
  const ed = new Editing({ settings, dialog, backupDir: join(dir, 'bk'), platform: 'linux' });
  const winA = { win: null };
  const winB = { win: null };

  assert.deepEqual(await ed.requestEdit(winA, f), { ok: true, scope: 'session' });   // Just This Time
  assert.ok(ed.isGranted(winA, f));
  assert.ok(!ed.isGranted(winB, f), 'another window must ask again');
  ed.pruneSession(winA, []);                                                          // tab closed
  assert.ok(!ed.isGranted(winA, f));
  assert.deepEqual(await ed.requestEdit(winA, f), { ok: false, reason: 'cancelled' }); // Cancel
  assert.deepEqual(await ed.requestEdit(winA, f), { ok: true, scope: 'file' });       // Always for This File
  assert.ok(ed.isGranted(winB, f), 'remembered grants apply everywhere');
  assert.equal(dialog.asked.length, 3);
  assert.deepEqual(ed.revokeGrant('files', f).files, []);
  assert.ok(!ed.isGranted(winB, f));
});

test('save refuses without permission, backs up once, and stops on an outside change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-save-'));
  const f = join(dir, 'a.md');
  writeFileSync(f, '# Original\n');
  const settings = fakeSettings();
  const dialog = fakeDialog([0, 0]);            // Just This Time, then Cancel on the conflict question
  const bk = join(dir, 'bk');
  const ed = new Editing({ settings, dialog, backupDir: bk, platform: 'linux' });
  const w = { win: null };
  const doc = await readMarkdown(f);

  assert.equal((await ed.save(w, { path: f, content: 'x', baseMtime: doc.mtime })).reason, 'not-allowed');
  await ed.requestEdit(w, f);
  const first = await ed.save(w, { path: f, content: '# Edited\n', baseMtime: doc.mtime, eol: '\n' });
  assert.ok(first.ok);
  assert.equal(readFileSync(f, 'utf8'), '# Edited\n');
  assert.equal(readFileSync(first.backup, 'utf8'), '# Original\n');
  const second = await ed.save(w, { path: f, content: '# Edited again\n', baseMtime: first.mtime, eol: '\n' });
  assert.ok(second.ok && second.backup === null, 'only the first save in a session makes a backup');
  assert.equal(readdirSync(bk).length, 1);

  // Another program writes the file (with a different modification time).
  writeFileSync(f, '# Theirs\n');
  utimesSync(f, new Date(), new Date(Date.now() + 5000));
  const conflict = await ed.save(w, { path: f, content: '# Mine\n', baseMtime: second.mtime, eol: '\n' });
  assert.deepEqual(conflict, { ok: false, reason: 'conflict' });
  assert.equal(readFileSync(f, 'utf8'), '# Theirs\n');
  assert.match(dialog.asked.at(-1), /was changed by another program/);
});
