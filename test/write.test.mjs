// v2.2 "Write faster": tables, paste conversion, Word import, version history, find & replace,
// pictures and keyboard shortcuts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { parseTable, formatTable, findTable, looksLikeCells, cellsToTable, parseTsv, splitRow, blankTable } from '../src/renderer/tables.js';
import { convertPaste } from '../src/renderer/paste.js';
import { prettyShortcut } from '../src/renderer/palette.js';

const require = createRequire(import.meta.url);
const { htmlToMarkdown } = require('../src/main/html-to-md.js');
const { HistoryStore, planPrune } = require('../src/main/history.js');
const { buildMatcher, findMatches, applyChosen, expand } = require('../src/main/replace.js');
const { runJob } = require('../src/main/folder-replace.js');
const { saveImage, imageKind, safeName } = require('../src/main/images.js');
const { cleanAccelerator, sanitize } = require('../src/main/settings.js');
const { Editing } = require('../src/main/editing.js');
const tools = require('../src/main/export-tools.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const DAY = 86400000;

// ---------------------------------------------------------------- tables
test('tables: read, write back aligned, find the one around the cursor', () => {
  const md = '| Name | Qty |\n|:--|--:|\n| Apple | 3 |\n| Kiwi | 12 |';
  const t = parseTable(md);
  assert.deepEqual(t.header, ['Name', 'Qty']);
  assert.deepEqual(t.align, ['left', 'right']);
  assert.deepEqual(t.rows, [['Apple', '3'], ['Kiwi', '12']]);
  assert.equal(formatTable(t), '| Name  | Qty |\n| :---- | --: |\n| Apple |   3 |\n| Kiwi  |  12 |');
  assert.deepEqual(splitRow('| a \\| b | `x|y` | c |'), ['a \\| b', '`x|y`', 'c']);
  const lines = ['Intro', '', ...md.split('\n'), '', 'After'];
  assert.deepEqual(findTable(lines, 4), { start: 2, end: 5 });
  assert.equal(findTable(lines, 0), null);
  assert.equal(findTable(['a | b', 'not a separator'], 0), null);
  // Short rows are padded, pipes and line breaks in cells are made safe.
  assert.deepEqual(parseTable('| a | b | c |\n|---|---|---|\n| 1 |').rows, [['1', '', '']]);
  assert.match(formatTable({ header: ['x|y'], align: [], rows: [['line\nbreak']] }), /x\\\|y[\s\S]*line break/);
  assert.equal(blankTable(2, 1).header.length, 2);
});

test('tables: cells copied from a spreadsheet become a Markdown table', () => {
  const tsv = 'Item\tPrice\tNote\nTea\t3.50\t"has ""quotes"""\nCake\t12\t\n';
  assert.ok(looksLikeCells(tsv));
  assert.deepEqual(parseTsv(tsv)[1], ['Tea', '3.50', 'has "quotes"']);
  const table = cellsToTable(tsv);
  assert.match(table, /^\| Item \| Price \| Note/);
  assert.match(table, /\| ---- \| ----: \|/);                 // numbers are right-aligned
  assert.ok(!looksLikeCells('just text'));
  assert.ok(!looksLikeCells('a\tb'));                          // one row of two cells is just a tab
  assert.ok(!looksLikeCells('a\tb\nc'));                        // ragged rows aren't a table
});

// ---------------------------------------------------------------- paste conversion
test('paste: web pages and Word become clean Markdown; code from an editor stays plain', () => {
  const web = convertPaste({ text: 'Title Some bold', html: '<h2>Title</h2><p>Some <strong>bold</strong> <a href="https://x.com">link</a> <a href="javascript:alert(1)">bad</a></p><script>alert(1)</script>' });
  assert.equal(web.kind, 'markdown');
  assert.equal(web.text, '## Title\n\nSome **bold** [link](https://x.com) bad');
  const sheet = convertPaste({ text: 'A\tB\n1\t2', html: '<table><tr><td>A</td><td>B</td></tr></table>' });
  assert.equal(sheet.kind, 'table');
  const word = htmlToMarkdown('<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="font-family:Symbol">·<span>&nbsp;&nbsp; </span></span>First<o:p></o:p></p><!--[if gte mso 9]><xml>junk</xml><![endif]-->');
  assert.equal(word, '- First');
  assert.equal(convertPaste({ text: 'const a = 1;', html: '<div style="white-space: pre;"><span>const a = 1;</span></div>' }), null);
  assert.equal(convertPaste({ text: 'plain', html: '' }), null);
  // Embedded pictures are dropped (keeping their description); web pictures are kept.
  assert.equal(htmlToMarkdown('<p><img src="data:image/png;base64,AAA" alt="logo"> <img src="https://e.com/a.png" alt="pic"></p>'), '*[logo]* ![pic](https://e.com/a.png)');
  // A table without a header row gets its first row as the header.
  assert.equal(htmlToMarkdown('<table><tr><td>Name</td><td>Qty</td></tr><tr><td>Apple</td><td>3</td></tr></table>'), '| Name | Qty |\n| --- | --- |\n| Apple | 3   |');
});

test('Word import: headings, formatting, lists, tables and pictures', async () => {
  const docx = require('docx');
  const d = new docx.Document({ sections: [{ children: [
    new docx.Paragraph({ text: 'Report', heading: docx.HeadingLevel.HEADING_1 }),
    new docx.Paragraph({ children: [new docx.TextRun('Hello '), new docx.TextRun({ text: 'bold', bold: true })] }),
    new docx.Paragraph({ text: 'Item one', bullet: { level: 0 } }),
    new docx.Paragraph({ children: [new docx.ImageRun({ type: 'png', data: PNG, transformation: { width: 10, height: 10 } })] }),
  ] }] });
  const out = await tools.docxToMarkdown(await docx.Packer.toBuffer(d), { imagePrefix: 'report' });
  assert.equal(out.markdown, '# Report\n\nHello **bold**\n\n- Item one\n\n![](images/report-1.png)');
  assert.equal(out.images.length, 1);
  assert.equal(imageKind(out.images[0].data), 'png');
});

// ---------------------------------------------------------------- version history
test('history: keeps each replaced version once, newest first, and reads it back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-hist-'));
  let now = Date.UTC(2026, 10, 1, 12);
  const store = new HistoryStore(join(dir, 'history'), { now: () => now });
  const doc = join(dir, 'notes.md');
  assert.deepEqual(await store.list(doc), []);
  await store.add(doc, Buffer.from('v1'));
  now += 1000;
  assert.equal(await store.add(doc, Buffer.from('v1')), null);          // unchanged: not kept twice
  await store.add(doc, Buffer.from('v2'), 'replace');
  const list = await store.list(doc);
  assert.deepEqual(list.map((v) => v.reason), ['replace', 'save']);
  assert.equal((await store.read(doc, list[1].id)).toString(), 'v1');
  await assert.rejects(store.read(doc, 'nope'));
  await assert.rejects(store.read(join(dir, 'other.md'), list[0].id));
});

test('history: every version for 30 days, then one a day; 1 GB cap; newest always kept', () => {
  const now = Date.UTC(2026, 10, 1, 12);
  const v = (doc, id, daysAgo, size = 10, hour = 0) => ({ doc, id, time: now - daysAgo * DAY + hour * 3600000, size });
  const all = [v('a', 'recent1', 1), v('a', 'recent2', 1, 10, 1), v('a', 'old-am', 40, 10, 1), v('a', 'old-pm', 40, 10, 5), v('a', 'older', 50)];
  assert.deepEqual([...planPrune(all, now)], ['a/old-am']);            // same old day: only the newest stays
  const big = [v('a', 'x', 1, 600), v('a', 'y', 2, 600), v('b', 'z', 3, 600)];
  const drop = planPrune(big, now, { maxBytes: 1000 });
  assert.ok(drop.has('a/y') && !drop.has('a/x') && !drop.has('b/z'));  // oldest first, but never a doc's newest
});

test('saving keeps the version it replaces in History', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-hsave-'));
  const file = join(dir, 'a.md');
  writeFileSync(file, 'first\n');
  let data = sanitize({ editGrants: { files: [file], folders: [] } });
  const settings = { get: () => structuredClone(data), update: (p) => { data = sanitize({ ...data, ...p }); } };
  const history = new HistoryStore(join(dir, 'history'));
  const editing = new Editing({ settings, dialog: { showMessageBox: async () => ({ response: 0 }) }, backupDir: join(dir, 'backups'), history });
  const state = {};
  const { mtimeMs } = (await import('node:fs')).statSync(file);
  assert.ok((await editing.save(state, { path: file, content: 'second\n', baseMtime: mtimeMs, eol: '\n', bom: false })).ok);
  const versions = await history.list(file);
  assert.equal(versions.length, 1);
  assert.equal((await history.read(file, versions[0].id)).toString(), 'first\n');
});

// ---------------------------------------------------------------- find & replace
test('replace: plain text, whole words, case and regular expressions with groups', () => {
  const text = 'The cat sat.\nCat and cat.\nconcatenate';
  const plain = findMatches(text, buildMatcher('cat'), 'dog');
  assert.equal(plain.matches.length, 4);
  assert.deepEqual(plain.matches.map((m) => m.line), [0, 1, 1, 2]);
  const words = findMatches(text, buildMatcher('cat', { wholeWord: true, matchCase: true }), 'dog');
  assert.equal(words.matches.length, 2);
  assert.equal(applyChosen(text, words.matches, [1]), 'The cat sat.\nCat and dog.\nconcatenate');
  const re = findMatches('2026-11-01', buildMatcher('(\\d+)-(\\d+)-(\\d+)', { regex: true }), '$3/$2/$1', { regex: true });
  assert.equal(re.matches[0].replacement, '01/11/2026');
  assert.equal(expand('$$1 $& $<y>', Object.assign(['ab', 'a'], { groups: { y: 'Y' } }), true), '$1 ab Y');
  assert.equal(findMatches('a+b', buildMatcher('a+b'), '$1').matches[0].replacement, '$1');   // plain mode: literal
  assert.throws(() => buildMatcher('(a', { regex: true }), /isn’t valid/);
  assert.throws(() => buildMatcher('x*', { regex: true }), /empty text/);
  assert.throws(() => buildMatcher(''), /Type what to find/);
});

test('replace: the worker previews, applies only the chosen matches, and stops slow patterns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-rep-'));
  writeFileSync(join(dir, 'a.md'), '﻿# Plan\r\nThe cat sat.\r\nCat and cat.\r\n');
  writeFileSync(join(dir, 'b.md'), 'No match.\n');
  const files = ['a.md', 'b.md'].map((n) => ({ path: join(dir, n), rel: n }));
  const prev = await runJob({ mode: 'preview', files, find: 'cat', replacement: 'dog', opts: {} });
  assert.ok(prev.ok);
  assert.equal(prev.total, 3);
  assert.equal(prev.results.length, 1);
  assert.equal(prev.results[0].matches[0].prefix, 'The ');
  const done = await runJob({ mode: 'apply', chosen: { [files[0].path]: [0, 2] }, find: 'cat', replacement: 'dog', opts: {} });
  assert.equal(done.files[0].content, '# Plan\nThe dog sat.\nCat and dog.\n');
  assert.equal(done.files[0].eol, '\r\n');
  assert.equal(done.files[0].bom, true);
  writeFileSync(join(dir, 'slow.md'), `${'a'.repeat(40)}!`);
  const slow = await runJob({ mode: 'preview', files: [{ path: join(dir, 'slow.md'), rel: 'slow.md' }], find: '(a+)+$', replacement: '', opts: { regex: true } },
    { maxBytes: 1e6, maxTotal: 100, timeoutMs: 400 });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /took too long/);
});

// ---------------------------------------------------------------- pictures
test('pictures: only real images, saved next to the document under a free name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-img-'));
  const doc = join(dir, 'notes.md');
  writeFileSync(doc, '# Notes\n');
  const a = await saveImage(doc, { name: 'My Photo (1).png', data: PNG });
  assert.deepEqual([a.ok, a.rel], [true, 'images/My-Photo-1.png']);
  const b = await saveImage(doc, { name: 'My Photo (1).png', data: PNG });
  assert.equal(b.rel, 'images/My-Photo-1-2.png');
  const pasted = await saveImage(doc, { name: 'image.png', data: PNG });
  assert.match(pasted.rel, /^images\/pasted-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  assert.deepEqual(await saveImage(doc, { name: 'x.png', data: Buffer.from('<script>') }), { ok: false, reason: 'not-image' });
  assert.equal((await saveImage(doc, { name: '../../evil.png', data: PNG })).rel, 'images/evil.png');
  assert.equal(safeName('..\\..\\x.jpg', 'png'), 'x.png');
  assert.equal(readdirSync(join(dir, 'images')).length, 4);
  assert.ok(readFileSync(join(dir, 'images', 'My-Photo-1.png')).equals(PNG));
  assert.ok(!existsSync(join(dir, 'evil.png')));
});

// ---------------------------------------------------------------- shortcuts
test('shortcuts: only valid key combinations are kept', () => {
  assert.equal(cleanAccelerator('CmdOrCtrl+Shift+K'), 'CmdOrCtrl+Shift+K');
  assert.equal(cleanAccelerator('F5'), 'F5');
  assert.equal(cleanAccelerator('CmdOrCtrl+/'), 'CmdOrCtrl+/');
  assert.equal(cleanAccelerator('K'), null);                      // a plain letter would break typing
  assert.equal(cleanAccelerator('Ctrl+Ctrl+K'), null);
  assert.equal(cleanAccelerator('Hyper+K'), null);
  const s = sanitize({ shortcuts: { 'quick-open': 'CmdOrCtrl+P', print: '', 'Bad Id': 'F2', save: 'nonsense' } });
  assert.deepEqual(s.shortcuts, { 'quick-open': 'CmdOrCtrl+P', print: '' });
  assert.equal(prettyShortcut('CmdOrCtrl+Shift+K'), 'Ctrl+Shift+K');
  assert.equal(prettyShortcut('CmdOrCtrl+Shift+K', 'darwin'), '⌘⇧K');
  assert.equal(prettyShortcut('Alt+Left'), 'Alt+←');
});
