// End-to-end test for 3.9: a folder on a WebDAV server and publishing to a wiki, through the real dialogs, against stand-ins
// that keep the promises the real servers make. (The engines were also run against real Nextcloud, BookStack, Wiki.js and Outline.)
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-srv-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'images'), { recursive: true });
fs.mkdirSync(path.join(docs, 'sub'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const note = path.join(docs, 'note.md');
fs.writeFileSync(note, '---\ntitle: x\n---\n\n# My Note\n\nWords and [the other](sub/other.md).\n\n![Dot](images/dot.png)\n');
fs.writeFileSync(path.join(docs, 'sub', 'other.md'), '# The Other\n\nBack to [my note](../note.md).\n');
fs.writeFileSync(path.join(docs, 'images', 'dot.png'), PNG);

// ---- a WebDAV server
const USER = 'neo';
const PASS = 'test-password';
const dav = new Map([['Notes/plan.md', '# Plan\n\nOn the server.\n'], ['Notes/sub/deep.md', '# Deep\n'], ['Other/skip.md', '# Skip\n']]);
const etags = new Map();
let clock = 0;
const stamp = (rel) => { clock += 1; etags.set(rel, `"e${clock}"`); };
for (const rel of dav.keys()) stamp(rel);
const davLog = [];
const dirs = () => { const out = new Set(['']); for (const rel of dav.keys()) { const p = rel.split('/'); for (let i = 1; i < p.length; i++) out.add(p.slice(0, i).join('/')); } return out; };

function davAnswer(req, body, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/dav\/?/, '').replace(/\/$/, '');
  davLog.push(`${req.method} ${rel}`);
  if (req.headers.authorization !== `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`) { res.writeHead(401); res.end(); return; }
  if (req.method === 'PROPFIND') {
    const all = dirs();
    if (!all.has(rel) && !dav.has(rel)) { res.writeHead(404); res.end(); return; }
    const entry = (r, dir) => `<d:response><d:href>/dav/${r.split('/').map(encodeURIComponent).join('/')}${dir ? '/' : ''}</d:href><d:propstat><d:prop><d:resourcetype>${dir ? '<d:collection/>' : ''}</d:resourcetype>${dir ? '' : `<d:getetag>${etags.get(r).replace(/"/g, '&quot;')}</d:getetag><d:getcontentlength>${dav.get(r).length}</d:getcontentlength>`}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    let out = entry(rel, all.has(rel));
    if (req.headers.depth === '1') {
      const under = (r) => (rel ? r.startsWith(`${rel}/`) : !!r) && !r.slice(rel ? rel.length + 1 : 0).includes('/');
      for (const d of all) if (under(d)) out += entry(d, true);
      for (const f of dav.keys()) if (under(f)) out += entry(f, false);
    }
    res.writeHead(207, { 'content-type': 'application/xml' });
    res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${out}</d:multistatus>`);
    return;
  }
  if (req.method === 'GET') {
    if (!dav.has(rel)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { etag: etags.get(rel) });
    res.end(dav.get(rel));
    return;
  }
  if (req.method === 'PUT') {
    if (req.headers['if-match'] && etags.get(rel) !== req.headers['if-match']) { res.writeHead(412); res.end(); return; }
    if (req.headers['if-none-match'] === '*' && dav.has(rel)) { res.writeHead(412); res.end(); return; }
    dav.set(rel, body.toString());
    stamp(rel);
    res.writeHead(204, { etag: etags.get(rel) });
    res.end();
    return;
  }
  if (req.method === 'MKCOL') { res.writeHead(dirs().has(rel) ? 405 : 201); res.end(); return; }
  res.writeHead(405);
  res.end();
}

// ---- BookStack
const TOKEN = 'id1:secret1';
const books = [{ id: 1, name: 'Handbook' }];
const chapters = [];
const pages = new Map();
const uploads = [];
let nextId = 10;

function wikiAnswer(req, body, res) {
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (req.headers.authorization !== `Token ${TOKEN}`) { send(401, { error: { message: 'bad' } }); return; }
  const url = new URL(req.url, 'http://x').pathname;
  const json = () => JSON.parse(body.toString() || '{}');
  if (req.method === 'GET' && url === '/api/books') { send(200, { data: books }); return; }
  if (req.method === 'POST' && url === '/api/books') { const b = { id: ++nextId, name: json().name }; books.push(b); send(200, b); return; }
  const book = /^\/api\/books\/(\d+)$/.exec(url);
  if (req.method === 'GET' && book) { send(200, { id: Number(book[1]), contents: chapters.filter((c) => c.book_id === Number(book[1])).map((c) => ({ type: 'chapter', ...c })) }); return; }
  if (req.method === 'POST' && url === '/api/chapters') { const c = { id: ++nextId, ...json() }; chapters.push(c); send(200, c); return; }
  if (req.method === 'POST' && url === '/api/pages') { const p = { id: ++nextId, ...json() }; pages.set(p.id, p); send(200, { ...p, slug: 'x' }); return; }
  const page = /^\/api\/pages\/(\d+)$/.exec(url);
  if (req.method === 'PUT' && page) { const p = pages.get(Number(page[1])); Object.assign(p, json()); send(200, { ...p, slug: 'x' }); return; }
  if (req.method === 'POST' && url === '/api/image-gallery') {
    assert.match(req.headers['content-type'], /^multipart\/form-data/);
    uploads.push(body);
    send(200, { url: `/uploads/${uploads.length}.png` });
    return;
  }
  send(404, {});
}

const server = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    if (req.url.startsWith('/dav')) davAnswer(req, body, res); else wikiAnswer(req, body, res);
  });
});

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

async function until(fn, what, ms = 70000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), note],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.tab');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  const shot = async (name) => { if (process.env.NMR_SHOTS) await win.screenshot({ path: path.join(process.env.NMR_SHOTS, `srv-${name}.png`) }); };

  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const text = (id) => win.evaluate((x) => document.getElementById(x)?.textContent || '', id);
  const visible = (id) => win.evaluate((x) => { const el = document.getElementById(x); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }, id);
  const click = (id) => win.click(`#${id}`);
  const toasted = (re) => until(() => win.evaluate((s) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(s).test(t.textContent)), re.source), `toast ${re}`);

  const addServer = async (kind, url, user, secret) => {
    await menu('server-list');
    await until(() => visible('srv-list-page'), 'the list');
    await click('srv-add');
    await until(() => visible('srv-edit-page'), 'the form');
    await win.selectOption('#srv-kind', kind);
    await win.fill('#srv-url', url);
    if (user) await win.fill('#srv-user', user);
    await win.fill('#srv-secret', secret);
    await shot(`add-${kind}`);
    await click('srv-save');
  };

  await step('the commands are in the File menu, which stays short', async () => {
    const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((m) => m.label.replace(/&/g, '') === 'File').submenu.items.filter((i) => i.visible && i.type !== 'separator').map((i) => i.label));
    assert.ok(items.includes('Home Server'));
    assert.ok(items.length <= 20, `File has ${items.length}`);
    assert.ok(await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu().getMenuItemById('rename-doc')));
  });

  await step('with no server yet, you’re asked to add one', async () => {
    await menu('server-open');
    await until(() => visible('srv-edit-page'), 'the form');
    await win.fill('#srv-url', 'http://192.168.1.5');
    await until(async () => /isn’t encrypted/.test(await text('srv-plain')), 'the warning');
    await click('srv-edit-cancel');
  });

  await step('a wrong password is refused, and the server isn’t kept', async () => {
    await addServer('webdav', `${base}/dav`, USER, 'wrong');
    await until(async () => /didn’t accept/.test(await text('srv-edit-msg')), 'the refusal');
    assert.equal((await win.evaluate(() => window.reader.srvList())).servers.length, 0);
    await click('srv-edit-cancel');
  });

  await step('the right password connects, and it’s listed without its secret', async () => {
    await addServer('webdav', `${base}/dav`, USER, PASS);
    await until(() => visible('srv-list-page'), 'the list');
    assert.equal(await text('srv-list-msg'), 'Connected.');
    const list = await win.evaluate(() => window.reader.srvList());
    assert.equal(list.servers.length, 1);
    assert.equal(list.servers[0].hasSecret, true);
    assert.ok(!JSON.stringify(list).includes(PASS));
  });

  await step('the dialog passes an accessibility check', async () => {
    await win.evaluate(axeSource);
    const res = await win.evaluate(() => window.axe.run(document.getElementById('srv-dlg'), { rules: { 'color-contrast': { enabled: false } } }));
    assert.deepEqual(res.violations.map((v) => v.id), []);
    await shot('list');
    await click('srv-close');
  });

  let copy = '';
  await step('browsing finds the folder, and opening brings it here', async () => {
    await menu('server-open');
    await until(() => visible('srv-browse-page'), 'the folders');
    await until(async () => (await win.locator('#srv-folders li').count()) === 2, 'two folders');
    await win.click('#srv-folders button[aria-label="Go into Notes"]');
    await until(async () => (await text('srv-browse-at')) === '/Notes', 'going in');
    await shot('browse');
    await click('srv-open');
    await toasted(/2 documents are here/);
    await until(() => win.evaluate(() => /plan/.test(document.getElementById('sidebar')?.textContent || '')), 'its documents in the sidebar');
    copy = (await win.evaluate(() => window.reader.init().then((r) => r.settings.serverFolders)))[0].root;
    assert.equal(fs.readFileSync(path.join(copy, 'plan.md'), 'utf8'), '# Plan\n\nOn the server.\n');
    assert.ok(fs.existsSync(path.join(copy, 'sub', 'deep.md')));
    assert.ok(!fs.existsSync(path.join(copy, 'skip.md')), 'only that folder');
  });

  await step('a saved change goes to the server by itself', async () => {
    fs.writeFileSync(path.join(copy, 'plan.md'), '# Plan\n\nEdited here.\n');
    await until(() => dav.get('Notes/plan.md').includes('Edited here'), 'the upload');
  });

  await step('a new document goes up too', async () => {
    fs.writeFileSync(path.join(copy, 'fresh.md'), '# Fresh\n');
    await until(() => dav.get('Notes/fresh.md') === '# Fresh\n', 'the upload');
  });

  await step('a change on the server comes down when you refresh', async () => {
    dav.set('Notes/plan.md', '# Plan\n\nEdited there.\n');
    stamp('Notes/plan.md');
    await win.evaluate(() => window.reader.refreshFolder?.());
    await until(() => fs.readFileSync(path.join(copy, 'plan.md'), 'utf8').includes('Edited there'), 'the download', 70000);
  });

  await step('when both change, you keep yours as a copy and are told', async () => {
    dav.set('Notes/plan.md', '# Plan\n\nTheirs.\n');
    stamp('Notes/plan.md');
    fs.writeFileSync(path.join(copy, 'plan.md'), '# Plan\n\nMine.\n');
    await toasted(/yours is kept as “plan \(my copy\)\.md”/);
    assert.match(fs.readFileSync(path.join(copy, 'plan.md'), 'utf8'), /Theirs/);
    assert.match(fs.readFileSync(path.join(copy, 'plan (my copy).md'), 'utf8'), /Mine/);
    assert.equal(dav.get('Notes/plan.md'), '# Plan\n\nTheirs.\n');
  });

  await step('deleting here doesn’t delete on the server', async () => {
    fs.rmSync(path.join(copy, 'fresh.md'));
    await until(() => fs.existsSync(path.join(copy, 'fresh.md')), 'it to come back');
    assert.equal(dav.get('Notes/fresh.md'), '# Fresh\n');
    assert.ok(!davLog.some((l) => l.startsWith('DELETE')));
  });

  await step('a wiki connects with its key', async () => {
    await addServer('bookstack', base, '', TOKEN);
    await until(() => visible('srv-list-page'), 'the list');
    await click('srv-close');
  });

  await step('a document publishes with its picture and goes to the book you pick', async () => {
    await win.click('.tab:has-text("note")');
    await menu('server-publish');
    await until(() => visible('srv-publish-page'), 'the publish page');
    await until(async () => (await text('srv-publish-what')) === '1 new page, 1 picture', 'the summary');
    assert.equal(await win.inputValue('#srv-place'), '1');
    await shot('publish');
    await click('srv-publish-go');
    await until(async () => /1 page made/.test(await text('srv-publish-msg')), 'the result');
    assert.ok(await visible('srv-publish-open'));
    const page = [...pages.values()].find((p) => p.name === 'My Note');
    assert.equal(page.book_id, 1);
    assert.match(page.markdown, /!\[Dot\]\(\/uploads\/1\.png\)/);
    assert.ok(!page.markdown.includes('title: x'), 'front matter stays behind');
    assert.ok(uploads[0].includes(PNG));
    await click('srv-publish-cancel');
  });

  await step('publishing it again updates that page', async () => {
    await menu('server-publish');
    await until(async () => (await text('srv-publish-what')) === '1 page to update, 1 picture', 'the summary');
    await click('srv-publish-go');
    await until(async () => /already up to date/.test(await text('srv-publish-msg')), 'the result');
    assert.equal(pages.size, 1);
    assert.equal(uploads.length, 1);
    await click('srv-publish-cancel');
  });

  await step('a folder goes into a new book, with its shape and its links', async () => {
    await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, docs);
    await menu('open-folder');
    await until(() => win.evaluate(() => /other/.test(document.getElementById('sidebar')?.textContent || '')), 'the folder');
    await menu('server-publish-folder');
    await until(async () => /1 new page, 1 page to update/.test(await text('srv-publish-what')), 'the summary')
      .catch(async (e) => { throw new Error(`${e.message}: “${await text('srv-publish-what')}” “${await text('srv-publish-msg')}”`); });
    await win.selectOption('#srv-place', '');
    await until(() => visible('srv-new-row'), 'the name box');
    await win.fill('#srv-new-place', 'New Book');
    await click('srv-publish-go');
    await until(async () => /1 page made/.test(await text('srv-publish-msg')), 'the result');
    assert.ok(books.some((b) => b.name === 'New Book'));
    assert.equal(chapters.length, 1);
    const other = [...pages.values()].find((p) => p.name === 'The Other');
    assert.equal(other.chapter_id, chapters[0].id);
    assert.match(other.markdown, /\[my note\]\(.*\/link\/\d+\)/);
    const mine = [...pages.values()].find((p) => p.name === 'My Note');
    assert.match(mine.markdown, /\[the other\]\(.*\/link\/\d+\)/);
    await click('srv-publish-cancel');
  });

  await step('password-locked documents are never published', async () => {
    const list = await win.evaluate(() => window.reader.srvList());
    const res = await win.evaluate(([id, p]) => window.reader.srvPublishPrepare({ id, scope: 'doc', text: 'x', path: p }), [list.servers[1].id, path.join(docs, 'secret.mdlock')]);
    assert.match(res.error, /never sent/);
  });

  await step('passwords are kept encrypted, not in plain sight', async () => {
    const dir = path.join(tmp, 'p');
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      if (fs.lstatSync(file).isFile()) assert.ok(!fs.readFileSync(file).includes(PASS) && !fs.readFileSync(file).includes('secret1'), f);
    }
  });

  await step('removing a server forgets it', async () => {
    const list = await win.evaluate(() => window.reader.srvList());
    for (const s of list.servers) await win.evaluate((id) => window.reader.srvRemove(id), s.id);
    const after = await win.evaluate(() => window.reader.srvList());
    assert.equal(after.servers.length, 0);
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
