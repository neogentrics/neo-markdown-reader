import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pageFrom, localPictures, swapPictures, swapLinks, publish, form, slug, createWiki, isWiki } = require('../src/main/wikis.js');
const { cleanServer, cleanServers, cleanUrl, plainAddress, KINDS } = require('../src/main/servers.js');

test('a document’s first heading is its title, and the front matter stays behind', () => {
  assert.deepEqual(pageFrom('---\nnotion: x\n---\n\n# Hello\n\nBody', 'a.md'), { title: 'Hello', text: 'Body' });
  assert.deepEqual(pageFrom('No heading here', 'my note.md'), { title: 'my note', text: 'No heading here' });
  assert.deepEqual(pageFrom('Text\n\n# Later', 'a.md'), { title: 'a', text: 'Text\n\n# Later' });
});

test('only pictures on your computer are picked up', () => {
  assert.deepEqual(localPictures('![a](images/a.png) ![b](https://x.test/b.png) ![c](data:image/png;base64,AA) ![d](<my pic.png>) ![a again](images/a.png "Title")'), ['images/a.png', 'my pic.png']);
  assert.equal(swapPictures('![d](<my pic.png>)', new Map([['my pic.png', '/u/d.png']])), '![d](/u/d.png)');
  assert.equal(swapPictures('![a](images/a.png "T") ![b](b.png)', new Map([['images/a.png', '/u/a.png']])), '![a](/u/a.png) ![b](b.png)');
});

test('links to documents you’re publishing become links to their pages', () => {
  const urls = { 'notes/other.md': 'https://w/other', 'top.md': 'https://w/top' };
  const urlOf = (t) => urls[t] || (t === '*/other' ? 'https://w/other' : null);
  assert.equal(swapLinks('[x](other.md) [y](../top.md#part) [z](missing.md) [w](https://a.test/b.md) ![p](pic.md)', 'notes/here.md', urlOf),
    '[x](https://w/other) [y](https://w/top#part) [z](missing.md) [w](https://a.test/b.md) ![p](pic.md)');
  assert.equal(swapLinks('[[other]] [[other|That one]] [[nothing]]', 'notes/here.md', urlOf), '[other](https://w/other) [That one](https://w/other) [[nothing]]');
});

test('links and pictures with spaces in them work', () => {
  const urlOf = (t) => (t === 'chapter one/next.md' ? 'https://w/next' : null);
  assert.equal(swapLinks('[a](<chapter one/next.md>) [b](chapter%20one/next.md#part) [c](<chapter one/next.md#part>)', 'top.md', urlOf),
    '[a](https://w/next) [b](https://w/next#part) [c](https://w/next#part)');
});

test('names become wiki paths', () => {
  assert.equal(slug('Café Notes & More!'), 'cafe-notes-more');
  assert.equal(slug('!!!'), 'page');
});

test('a form is laid out the way wikis expect', () => {
  const f = form([['type', 'gallery']], { field: 'image', filename: 'a"b.png', type: 'image/png', data: Buffer.from('DATA') });
  const text = f.body.toString();
  assert.match(f.type, /^multipart\/form-data; boundary=/);
  assert.match(text, /name="type"\r\n\r\ngallery\r\n/);
  assert.match(text, /name="image"; filename="ab\.png"\r\ncontent-type: image\/png\r\n\r\nDATA\r\n/);
});

function fakeWiki() {
  let n = 0;
  const wiki = {
    pages: new Map(), pictures: [], sections: [],
    async section({ name }) { wiki.sections.push(name); return `s${wiki.sections.length}`; },
    async save({ id, title, text, section }) {
      if (id && !wiki.pages.has(id)) throw Object.assign(new Error('gone'), { code: 'not_found' });
      const key = id || `p${++n}`;
      wiki.pages.set(key, { title, text, section: id ? wiki.pages.get(id).section : section });
      return { id: key, url: `https://w/${key}` };
    },
    async picture({ pageId, name }) { wiki.pictures.push({ pageId, name }); return `/u/${name}`; },
  };
  return wiki;
}

const doc = (rel, text, dir = '/docs') => ({ key: `/docs/${rel}`, rel, name: rel.split('/').pop(), text, dir });
const noFiles = async () => null;

test('a document becomes a page, with its picture on the wiki', async () => {
  const wiki = fakeWiki();
  const { report, known } = await publish({ wiki, place: 'b', docs: [doc('a.md', '# Title\n\nWords ![c](images/c.png)')], readFile: async () => Buffer.from('png') });
  const page = wiki.pages.get('p1');
  assert.equal(page.title, 'Title');
  assert.equal(page.text, 'Words ![c](/u/c.png)');
  assert.deepEqual(wiki.pictures, [{ pageId: 'p1', name: 'c.png' }]);
  assert.deepEqual([report.made, report.updated, report.pictures], [1, 0, 1]);
  assert.equal(known['/docs/a.md'].url, 'https://w/p1');
});

test('publishing again updates the same page, and sends nothing that hasn’t changed', async () => {
  const wiki = fakeWiki();
  const readFile = async () => Buffer.from('png');
  const first = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\nOne ![c](c.png)')], readFile });
  const same = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\nOne ![c](c.png)')], known: first.known, readFile });
  assert.deepEqual([same.report.made, same.report.updated, same.report.same, same.report.pictures], [0, 0, 1, 0]);
  const edited = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\nTwo ![c](c.png)')], known: same.known, readFile });
  assert.deepEqual([edited.report.made, edited.report.updated, edited.report.pictures], [0, 1, 0]);
  assert.equal(wiki.pages.size, 1);
  assert.equal(wiki.pages.get('p1').text, 'Two ![c](/u/c.png)');
});

test('a folder keeps its shape, and links between its documents work', async () => {
  const wiki = fakeWiki();
  const docs = [doc('top.md', '# Top\n\nSee [the sub](sub/inner.md) and [[inner]].'), doc('sub/inner.md', '# Inner\n\nBack to [top](../top.md).'), doc('sub/two.md', '# Two')];
  const { report } = await publish({ wiki, place: 'b', docs, readFile: noFiles });
  assert.equal(report.made, 3);
  assert.deepEqual(wiki.sections, ['sub']);
  assert.equal(wiki.pages.get('p1').text, 'See [the sub](https://w/p2) and [inner](https://w/p2).');
  assert.equal(wiki.pages.get('p2').text, 'Back to [top](https://w/p1).');
  assert.equal(wiki.pages.get('p2').section, 's1');
});

test('a folder’s place on the wiki is only made once', async () => {
  const wiki = fakeWiki();
  const docs = [doc('sub/one.md', '# One')];
  const first = await publish({ wiki, place: 'b', docs, readFile: noFiles });
  const more = [...docs, doc('sub/two.md', '# Two')];
  const second = await publish({ wiki, place: 'b', docs: more, known: first.known, readFile: noFiles });
  await publish({ wiki, place: 'b', docs: more, known: second.known, readFile: noFiles });
  assert.deepEqual(wiki.sections, ['sub']);
  assert.equal(wiki.pages.get('p2').section, 's1');
});

test('Wiki.js addresses are made from the name, without its extension', async () => {
  const calls = [];
  const wiki = createWiki({ kind: 'wikijs', url: 'http://w', secret: 'k', fetch: async (url, init) => {
    calls.push(JSON.parse(init.body));
    return reply(200, { data: { localization: { config: { locale: 'en' } }, pages: { create: { responseResult: { succeeded: true }, page: { id: 4, path: 'x' } } } } });
  } });
  const page = await wiki.save({ place: 'notes', section: 'notes/sub', title: 'T', name: 'My Plan.md', text: 'X' });
  assert.equal(calls.at(-1).variables.path, 'notes/sub/my-plan');
  assert.equal(page.url, 'http://w/en/notes/sub/my-plan');
});

test('a page removed on the wiki is made again', async () => {
  const wiki = fakeWiki();
  const first = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\nOne')], readFile: noFiles });
  wiki.pages.delete('p1');
  const again = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\nTwo')], known: first.known, readFile: noFiles });
  assert.equal(again.report.made, 1);
  assert.equal(again.known['/docs/a.md'].id, 'p2');
});

test('a missing picture is counted and doesn’t stop the page', async () => {
  const wiki = fakeWiki();
  const { report } = await publish({ wiki, place: 'b', docs: [doc('a.md', '# T\n\n![x](gone.png)')], readFile: noFiles });
  assert.equal(report.missing, 1);
  assert.equal(wiki.pages.get('p1').text, '![x](gone.png)');
});

test('one refused page doesn’t stop the others', async () => {
  const wiki = fakeWiki();
  const { save } = wiki;
  wiki.save = async (p) => { if (p.title === 'Bad') throw new Error('Refused'); return save(p); };
  const { report } = await publish({ wiki, place: 'b', docs: [doc('a.md', '# Bad'), doc('b.md', '# Good')], readFile: noFiles });
  assert.deepEqual(report.failed, [{ rel: 'a.md', message: 'Refused' }]);
  assert.equal(report.made, 1);
});

test('losing the connection stops, and what’s done so far is remembered', async () => {
  const wiki = fakeWiki();
  const { save } = wiki;
  wiki.save = async (p) => { if (p.title === 'Two' && p.id) throw Object.assign(new Error('down'), { code: 'offline' }); return save(p); };
  const failed = await publish({ wiki, place: 'b', docs: [doc('a.md', '# One'), doc('b.md', '# Two')], readFile: noFiles }).catch((e) => e);
  assert.equal(failed.message, 'down');
  assert.ok(failed.known['/docs/b.md'].id, 'the page already made isn’t made twice next time');
});

const reply = (status, body) => new Response(JSON.stringify(body), { status });

test('BookStack is asked the way its API wants', async () => {
  const calls = [];
  const wiki = createWiki({ kind: 'bookstack', url: 'http://w/', secret: 'id:sec', fetch: async (url, init) => { calls.push({ url, ...init }); return reply(200, { id: 7, slug: 's', book_slug: 'b' }); } });
  const page = await wiki.save({ place: '3', title: 'T', text: 'X' });
  assert.equal(calls[0].url, 'http://w/api/pages');
  assert.equal(calls[0].headers.authorization, 'Token id:sec');
  assert.deepEqual(JSON.parse(calls[0].body), { book_id: 3, name: 'T', markdown: 'X' });
  assert.deepEqual(page, { id: '7', url: 'http://w/link/7' });
  await wiki.save({ id: '7', place: '3', title: 'T', text: 'Y' });
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].url, 'http://w/api/pages/7');
});

test('Wiki.js refusals in its answers are noticed', async () => {
  const wiki = createWiki({ kind: 'wikijs', url: 'http://w', secret: 'k', fetch: async () => reply(200, { data: { localization: null, pages: { create: { responseResult: { succeeded: false, message: 'Path already exists' }, page: null } } } }) });
  await assert.rejects(wiki.save({ place: 'a', title: 'T', text: 'X' }), /Path already exists/);
});

test('wrong keys are said plainly', async () => {
  for (const kind of ['bookstack', 'wikijs', 'outline']) {
    const wiki = createWiki({ kind, url: 'http://w', secret: 'k', fetch: async () => reply(401, {}) });
    assert.equal((await wiki.test().catch((e) => e)).code, 'key', kind);
  }
  assert.ok(isWiki('outline') && !isWiki('constructor') && !isWiki('nextcloud'));
});

test('servers are checked before they’re kept', () => {
  assert.equal(cleanUrl('https://cloud.home/'), 'https://cloud.home');
  assert.equal(cleanUrl('ftp://x'), null);
  assert.equal(cleanUrl('https://user:pw@x'), null, 'passwords never go in an address');
  assert.equal(cleanServer({ kind: 'nope', url: 'https://x' }), null);
  assert.equal(cleanServer({ kind: 'constructor', url: 'https://x' }), null);
  const s = cleanServer({ kind: 'nextcloud', url: 'https://x/', user: ' me ', secret: 'never kept here' });
  assert.equal(s.user, 'me');
  assert.equal(s.name, 'Nextcloud');
  assert.ok(!('secret' in s));
  assert.equal(cleanServer({ kind: 'outline', url: 'https://x', user: 'me' }).user, '');
  assert.equal(cleanServers([{ kind: 'webdav', url: 'https://x' }, null, { kind: 'webdav', url: 'bad' }]).length, 1);
  assert.deepEqual(Object.keys(KINDS), ['nextcloud', 'webdav', 'bookstack', 'wikijs', 'outline']);
});

test('addresses that aren’t encrypted are noticed', () => {
  assert.equal(plainAddress('http://192.168.1.5'), true);
  assert.equal(plainAddress('https://x'), false);
  assert.equal(plainAddress('http://localhost:8080'), false);
});
