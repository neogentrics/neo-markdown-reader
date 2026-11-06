import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { davUrl, parseListing, createClient, syncFolder, safeRel, DavError } = require('../src/main/webdav.js');

test('Nextcloud’s path is added for you', () => {
  assert.equal(davUrl({ kind: 'nextcloud', url: 'https://cloud.home', user: 'neo gent' }), 'https://cloud.home/remote.php/dav/files/neo%20gent/');
  assert.equal(davUrl({ kind: 'nextcloud', url: 'https://cloud.home/sub/', user: 'a' }), 'https://cloud.home/sub/remote.php/dav/files/a/');
  assert.equal(davUrl({ kind: 'nextcloud', url: 'https://c/remote.php/dav/files/a', user: 'a' }), 'https://c/remote.php/dav/files/a/');
  assert.equal(davUrl({ kind: 'webdav', url: 'https://nas/dav', user: 'a' }), 'https://nas/dav/');
});

const NEXTCLOUD = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
<d:response><d:href>/remote.php/dav/files/rt/</d:href><d:propstat><d:prop><d:getlastmodified>Thu, 05 Nov 2026 06:00:00 GMT</d:getlastmodified><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;abc&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/rt/My%20Notes/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;def&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/rt/plan%20%26%20more.md</d:href><d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:resourcetype/><d:getetag>&quot;ghi&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
const APACHE = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:"><D:response xmlns:lp1="DAV:"><D:href>https://nas.home/dav/a.md</D:href><D:propstat><D:prop><lp1:resourcetype/><lp1:getcontentlength>3</lp1:getcontentlength><lp1:getetag>"x-y"</lp1:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;

test('listings are read whatever the server calls its XML', () => {
  const items = parseListing(NEXTCLOUD, '/remote.php/dav/files/rt/');
  assert.deepEqual(items.map((i) => [i.rel, i.dir, i.etag]), [['', true, '"abc"'], ['My Notes', true, '"def"'], ['plan & more.md', false, '"ghi"']]);
  assert.equal(items[2].size, 12);
  assert.deepEqual(parseListing(APACHE, '/dav/').map((i) => [i.rel, i.dir, i.etag]), [['a.md', false, '"x-y"']]);
  assert.deepEqual(parseListing('<multistatus><response><href>/elsewhere/a.md</href></response></multistatus>', '/dav/'), []);
});

const reply = (status, body = '', headers = {}) => new Response(status === 204 ? null : body, { status, headers });

test('requests carry your name and password and refuse to be redirected', async () => {
  const calls = [];
  const client = createClient({
    url: 'https://nas.home/dav/', user: 'neo', password: 'pw',
    fetch: async (url, init) => { calls.push({ url, ...init }); return reply(207, '<multistatus></multistatus>'); },
  });
  await client.folders('My Notes');
  assert.equal(calls[0].url, 'https://nas.home/dav/My%20Notes');
  assert.equal(calls[0].method, 'PROPFIND');
  assert.equal(calls[0].headers.depth, '1');
  assert.equal(calls[0].headers.authorization, `Basic ${Buffer.from('neo:pw').toString('base64')}`);
  assert.equal(calls[0].redirect, 'error');
});

test('a save only goes through if the server’s copy is the one we started from', async () => {
  const calls = [];
  const client = createClient({
    url: 'https://nas/dav', user: 'a', password: 'b',
    fetch: async (url, init) => { calls.push(init); return reply(204, '', { etag: '"new"' }); },
  });
  assert.equal(await client.write('a.md', Buffer.from('x'), { etag: '"old"' }), '"new"');
  assert.equal(calls[0].headers['if-match'], '"old"');
  await client.write('b.md', Buffer.from('x'), { fresh: true });
  assert.equal(calls[1].headers['if-none-match'], '*');
});

test('refusals are said plainly', async () => {
  const says = async (status) => createClient({ url: 'https://n/d', fetch: async () => reply(status) }).test().catch((e) => e);
  assert.equal((await says(401)).code, 'key');
  assert.equal((await says(404)).code, 'not_found');
  assert.equal((await says(405)).code, 'not_dav');
  const down = await createClient({ url: 'https://n/d', fetch: async () => { throw new Error('x'); } }).test().catch((e) => e);
  assert.equal(down.code, 'offline');
});

test('names from a server can’t reach outside the folder', () => {
  assert.equal(safeRel('notes/a.md'), 'notes/a.md');
  for (const bad of ['../a.md', 'a/../../b.md', 'a\\b.md', 'C:/x.md', 'con.md', 'a/nul.txt', 'a .md/', 'x?.md', '', 'a//b.md', 'trailing./a.md']) assert.equal(safeRel(bad), null, bad);
});

/** A stand-in for a server's files, with the same promises a real one makes. */
function fakeServer(start = {}) {
  const files = new Map();
  let n = 0;
  const put = (rel, text) => { n += 1; files.set(rel, { data: Buffer.from(text), etag: `"${n}"` }); };
  for (const [rel, text] of Object.entries(start)) put(rel, text);
  const client = {
    writes: [], folders: [],
    async tree(remote) {
      const out = new Map();
      for (const [rel, f] of files) {
        if (remote && !rel.startsWith(`${remote}/`)) continue;
        out.set(remote ? rel.slice(remote.length + 1) : rel, { etag: f.etag, size: f.data.length });
      }
      return { files: out, more: false };
    },
    async read(rel) { const f = files.get(rel); if (!f) throw new DavError('gone', 'not_found', 404); return { data: f.data, etag: f.etag }; },
    async write(rel, data, { etag, fresh } = {}) {
      client.writes.push(rel);
      const f = files.get(rel);
      if ((etag && f?.etag !== etag) || (fresh && f)) throw new DavError('changed', 'changed', 412);
      put(rel, data);
      return files.get(rel).etag;
    },
    async makeFolder(rel) { client.folders.push(rel); },
  };
  return { client, files, put, text: (rel) => files.get(rel)?.data.toString() };
}

function place() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-dav-'));
  return { root, file: (rel) => path.join(root, ...rel.split('/')), text: (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'), has: (rel) => fs.existsSync(path.join(root, ...rel.split('/'))) };
}

const write = (p, rel, text) => { fs.mkdirSync(path.dirname(p.file(rel)), { recursive: true }); fs.writeFileSync(p.file(rel), text); };

test('a folder comes down, and a second look changes nothing', async () => {
  const s = fakeServer({ 'a.md': 'one', 'sub/b.md': 'two' });
  const p = place();
  const first = await syncFolder({ client: s.client, root: p.root });
  assert.equal(first.report.down, 2);
  assert.equal(p.text('sub/b.md'), 'two');
  const second = await syncFolder({ client: s.client, root: p.root, known: first.known });
  assert.deepEqual([second.report.down, second.report.up, second.report.removed], [0, 0, 0]);
  assert.deepEqual(s.client.writes, []);
});

test('only the chosen folder is touched', async () => {
  const s = fakeServer({ 'notes/a.md': 'in', 'other/b.md': 'out' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, remote: 'notes', root: p.root });
  assert.ok(p.has('a.md'));
  assert.ok(!p.has('b.md') && !p.has('other/b.md'));
  write(p, 'a.md', 'changed');
  await syncFolder({ client: s.client, remote: 'notes', root: p.root, known });
  assert.equal(s.text('notes/a.md'), 'changed');
});

test('your edit goes up, and a change on the server comes down', async () => {
  const s = fakeServer({ 'a.md': 'one', 'b.md': 'two' });
  const p = place();
  let { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'a.md', 'edited here');
  s.put('b.md', 'edited there');
  const res = await syncFolder({ client: s.client, root: p.root, known });
  known = res.known;
  assert.equal(s.text('a.md'), 'edited here');
  assert.equal(p.text('b.md'), 'edited there');
  const again = await syncFolder({ client: s.client, root: p.root, known });
  assert.deepEqual([again.report.down, again.report.up], [0, 0]);
});

test('a new document here goes up, with its folders', async () => {
  const s = fakeServer({ 'a.md': 'one' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'deep/down/new.md', 'hello');
  await syncFolder({ client: s.client, root: p.root, known });
  assert.equal(s.text('deep/down/new.md'), 'hello');
  assert.deepEqual(s.client.folders, ['deep', 'deep/down']);
});

test('when both sides changed, neither is lost', async () => {
  const s = fakeServer({ 'a.md': 'start' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'a.md', 'mine');
  s.put('a.md', 'theirs');
  const res = await syncFolder({ client: s.client, root: p.root, known });
  assert.equal(p.text('a.md'), 'theirs');
  assert.equal(p.text('a (my copy).md'), 'mine');
  assert.deepEqual(res.report.conflicts, ['a (my copy).md']);
  assert.equal(s.text('a.md'), 'theirs', 'the server keeps its version until yours goes up');
  await syncFolder({ client: s.client, root: p.root, known: res.known });
  assert.equal(s.text('a (my copy).md'), 'mine');
});

test('the same edit on both sides isn’t a conflict', async () => {
  const s = fakeServer({ 'a.md': 'start' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'a.md', 'same');
  s.put('a.md', 'same');
  const res = await syncFolder({ client: s.client, root: p.root, known });
  assert.deepEqual(res.report.conflicts, []);
  assert.ok(!p.has('a (my copy).md'));
});

test('nothing on your server is deleted from here', async () => {
  const s = fakeServer({ 'a.md': 'one' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  fs.rmSync(p.file('a.md'));
  await syncFolder({ client: s.client, root: p.root, known });
  assert.equal(s.text('a.md'), 'one');
  assert.equal(p.text('a.md'), 'one');
});

test('a document removed on the server goes here too, unless you changed it', async () => {
  const s = fakeServer({ 'a.md': 'one', 'b.md': 'two' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  s.files.delete('a.md');
  s.files.delete('b.md');
  write(p, 'b.md', 'I was still working on this');
  const res = await syncFolder({ client: s.client, root: p.root, known });
  assert.ok(!p.has('a.md'));
  assert.equal(res.report.removed, 1);
  assert.equal(s.text('b.md'), 'I was still working on this', 'your words go back up');
});

test('first time with files already here, nothing is overwritten', async () => {
  const s = fakeServer({ 'a.md': 'server', 'same.md': 'same' });
  const p = place();
  write(p, 'a.md', 'local');
  write(p, 'same.md', 'same');
  const res = await syncFolder({ client: s.client, root: p.root });
  assert.equal(p.text('a (my copy).md'), 'local');
  assert.equal(res.report.conflicts.length, 1);
});

test('a name that isn’t safe is skipped, and counted', async () => {
  const s = fakeServer({ '../evil.md': 'x', 'ok.md': 'y' });
  const p = place();
  const { report } = await syncFolder({ client: s.client, root: p.root });
  assert.equal(report.skipped, 1);
  assert.ok(!fs.existsSync(path.join(p.root, '..', 'evil.md')));
  assert.equal(p.text('ok.md'), 'y');
});

test('a file refused by the server doesn’t stop the rest, and is tried again', async () => {
  const s = fakeServer({ 'a.md': 'one', 'b.md': 'two' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'a.md', 'new a');
  write(p, 'b.md', 'new b');
  const { write: real } = s.client;
  s.client.write = async (rel, ...rest) => { if (rel === 'a.md') throw new DavError('no', 'refused', 403); return real(rel, ...rest); };
  const res = await syncFolder({ client: s.client, root: p.root, known });
  assert.equal(res.report.failed, 1);
  assert.equal(s.text('b.md'), 'new b');
  s.client.write = real;
  await syncFolder({ client: s.client, root: p.root, known: res.known });
  assert.equal(s.text('a.md'), 'new a');
});

test('being offline stops the sync without losing what it knew', async () => {
  const s = fakeServer({ 'a.md': 'one' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  s.client.tree = async () => { throw new DavError('down', 'offline'); };
  await assert.rejects(syncFolder({ client: s.client, root: p.root, known }), /down/);
  assert.equal(p.text('a.md'), 'one');
});

test('other kinds of file are left alone', async () => {
  const s = fakeServer({ 'a.md': 'one' });
  const p = place();
  const { known } = await syncFolder({ client: s.client, root: p.root });
  write(p, 'program.exe', 'x');
  write(p, '.hidden/secret.md', 'x');
  await syncFolder({ client: s.client, root: p.root, known });
  assert.ok(!s.files.has('program.exe'));
  assert.ok(!s.files.has('.hidden/secret.md'));
});
