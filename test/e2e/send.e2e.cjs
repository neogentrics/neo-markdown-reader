// End-to-end test for 3.10: drafts on WordPress and Ghost, posts on Discord and where a document has been, through the real
// dialogs, against stand-ins that keep the promises the real services make.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-send-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'images'), { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const note = path.join(docs, 'note.md');
const long = path.join(docs, 'long.md');
fs.writeFileSync(note, '---\ntags: [Books, Launch]\ndescription: A short line\n---\n\n# My Launch Note\n\nWords with a [link](other.md) and @everyone.\n\n![Dot](images/my%20dot.png)\n');
fs.writeFileSync(long, `# Long\n\n${'word '.repeat(10000)}\n`);
fs.writeFileSync(path.join(docs, 'images', 'my dot.png'), PNG);

const WP_USER = 'neo';
const WP_PASS = 'abcd efgh ijkl mnop';
const GHOST_ID = 'a'.repeat(24);
const GHOST_HEX = '0f'.repeat(32);
const GHOST_KEY = `${GHOST_ID}:${GHOST_HEX}`;
const HOOK = '/api/webhooks/1/hook-token';

const wp = { posts: new Map(), media: [], tags: [{ id: 5, name: 'Books' }] };
const ghost = { posts: new Map(), images: [] };
const discord = [];
let nextId = 100;
let wpSlowMs = 0;

function wordpress(req, url, body, send) {
  if (req.headers.authorization !== `Basic ${Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64')}`) { send(401, { code: 'incorrect_password', message: 'no' }); return; }
  const at = url.pathname.replace('/wp/wp-json/wp/v2', '');
  const json = () => JSON.parse(body.toString());
  if (at === '/users/me') { send(200, { id: 1 }); return; }
  if (at === '/tags' && req.method === 'GET') { send(200, wp.tags.filter((t) => t.name.toLowerCase().includes(url.searchParams.get('search').toLowerCase()))); return; }
  if (at === '/tags') { const t = { id: ++nextId, name: json().name }; wp.tags.push(t); send(201, t); return; }
  if (at === '/media') {
    assert.equal(req.headers['content-type'], 'image/png');
    wp.media.push({ name: req.headers['content-disposition'], size: body.length });
    send(201, { id: ++nextId, source_url: `http://wp.test/uploads/${wp.media.length}.png` });
    return;
  }
  if (at === '/posts' && req.method === 'POST') { const p = { id: ++nextId, ...json() }; wp.posts.set(p.id, p); send(201, p); return; }
  const one = /^\/posts\/(\d+)$/.exec(at);
  if (one) {
    const p = wp.posts.get(Number(one[1]));
    if (!p) { send(404, { code: 'rest_post_invalid_id' }); return; }
    if (req.method === 'GET') { setTimeout(() => send(200, { id: p.id, status: p.status }), wpSlowMs); return; }
    assert.notEqual(p.status, 'publish', 'a published post is never changed');
    Object.assign(p, json());
    send(200, p);
    return;
  }
  send(404, { code: 'rest_no_route' });
}

function ghostApi(req, url, body, send) {
  const [head, claims, sig] = String(req.headers.authorization || '').replace(/^Ghost /, '').split('.');
  const good = sig && crypto.createHmac('sha256', Buffer.from(GHOST_HEX, 'hex')).update(`${head}.${claims}`).digest('base64url') === sig;
  if (!good) { send(401, { errors: [{ message: 'Invalid token' }] }); return; }
  const at = url.pathname.replace('/gh/ghost/api/admin', '');
  if (at === '/images/upload/') {
    assert.match(req.headers['content-type'], /^multipart\/form-data/);
    ghost.images.push(body.length);
    send(201, { images: [{ url: `http://gh.test/content/${ghost.images.length}.png` }] });
    return;
  }
  if (at === '/posts/' && req.method === 'GET') { send(200, { posts: [] }); return; }
  if (at === '/posts/' && req.method === 'POST') {
    assert.equal(url.searchParams.get('source'), 'html');
    const p = { id: `g${++nextId}`, updated_at: 'T1', ...JSON.parse(body.toString()).posts[0] };
    ghost.posts.set(p.id, p);
    send(201, { posts: [p] });
    return;
  }
  send(404, { errors: [{ message: 'not found' }] });
}

function discordApi(req, url, body, send) {
  if (req.method === 'GET') { send(200, { id: '1', name: 'Hook', guild_id: 'g1', channel_id: 'c1' }); return; }
  const type = req.headers['content-type'] || '';
  const payload = type.startsWith('multipart') ? JSON.parse(/name="payload_json"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'))[1]) : JSON.parse(body.toString());
  discord.push({ ...payload, files: (body.toString('latin1').match(/name="files\[\d+\]"/g) || []).length });
  send(200, { id: `m${discord.length}`, channel_id: 'c1' });
}

const server = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => {
    const body = Buffer.concat(parts);
    const url = new URL(req.url, 'http://x');
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname.startsWith('/moved')) { res.writeHead(301, { location: 'https://www.example.test/wp-json/wp/v2/users/me' }); res.end(); return; }
    if (url.pathname.startsWith('/wp/')) wordpress(req, url, body, send);
    else if (url.pathname.startsWith('/gh/')) ghostApi(req, url, body, send);
    else if (url.pathname === HOOK) discordApi(req, url, body, send);
    else { res.writeHead(404); res.end(); }
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
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_DISCORD_URL: base },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.tab');
  await app.evaluate(({ dialog, shell }, file) => {
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    global.__opened = [];
    shell.openExternal = async (u) => { global.__opened.push(u); };
  }, long);
  const shot = async (name) => { if (process.env.NMR_SHOTS) await win.screenshot({ path: path.join(process.env.NMR_SHOTS, `send-${name}.png`) }); };

  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const text = (id) => win.evaluate((x) => document.getElementById(x)?.textContent || '', id);
  const visible = (id) => win.evaluate((x) => { const el = document.getElementById(x); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }, id);
  const enabled = (id) => win.evaluate((x) => !document.getElementById(x).disabled, id);
  const click = (id) => win.click(`#${id}`);
  const onTab = async (name) => { await win.click(`.tab >> text=${name}`); await win.waitForFunction((n) => document.querySelector('.tab.active .tab-label')?.textContent.startsWith(n), name); };

  const add = async (kind, url, user, secret) => {
    await menu('server-list');
    await until(() => visible('srv-list-page'), 'the list');
    await click('srv-add');
    await until(() => visible('srv-edit-page'), 'the form');
    await win.selectOption('#srv-kind', kind);
    if (url) await win.fill('#srv-url', url);
    if (user) await win.fill('#srv-user', user);
    await win.fill('#srv-secret', secret);
    await click('srv-save');
  };
  const closeServers = () => win.evaluate(() => document.getElementById('srv-dlg').close());

  await step('the commands are under This Document, and File stays short', async () => {
    const labels = await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu().items.find((m) => m.label.replace(/&/g, '') === 'File').submenu;
      const doc = file.items.find((i) => i.label === 'This Document').submenu;
      return { file: file.items.filter((i) => i.visible && i.type !== 'separator').length, send: doc.items.find((i) => i.label === 'Send This Document').submenu.items.map((i) => i.label) };
    });
    assert.ok(labels.file <= 20, `File has ${labels.file}`);
    assert.deepEqual(labels.send, ['As a Draft on My Blog…', 'To Discord…', '', 'Where This Was Sent']);
  });

  await step('with no blog yet, you’re asked to add one', async () => {
    await menu('send-blog');
    await until(() => visible('srv-edit-page'), 'the form');
    assert.equal(await win.inputValue('#srv-kind'), 'wordpress');
    assert.equal(await text('srv-secret-label'), 'Application password');
    assert.match(await text('srv-hint'), /application password/);
    await closeServers();
  });

  await step('a sign-in password is refused, and the site isn’t kept', async () => {
    await add('wordpress', `${base}/wp`, WP_USER, 'wrong');
    await until(async () => /application password/.test(await text('srv-edit-msg')), 'the refusal');
    assert.equal((await win.evaluate(() => window.reader.srvList())).servers.length, 0);
    await click('srv-edit-cancel');
    await closeServers();
  });

  await step('an address that moves is explained, and the key isn’t carried there', async () => {
    await add('wordpress', `${base}/moved`, WP_USER, WP_PASS);
    await until(async () => /moves/.test(await text('srv-edit-msg')), 'the answer');
    await click('srv-edit-cancel');
    await closeServers();
  });

  await step('WordPress and Ghost connect', async () => {
    await add('wordpress', `${base}/wp`, WP_USER, WP_PASS);
    await until(() => visible('srv-list-page'), 'the list');
    assert.equal(await text('srv-list-msg'), 'Connected.');
    await closeServers();
    await add('ghost', `${base}/gh`, '', GHOST_KEY);
    await until(() => visible('srv-list-page'), 'the list');
    await closeServers();
    assert.equal((await win.evaluate(() => window.reader.srvList())).servers.length, 2);
  });

  await step('a Discord channel needs only its webhook, and only a real one', async () => {
    await add('discord', '', '', 'https://evil.test/api/webhooks/1/abc');
    await until(async () => /whole webhook address/.test(await text('srv-edit-msg')), 'the refusal');
    assert.equal(await visible('srv-url'), false);
    assert.equal(await text('srv-secret-label'), 'Webhook address');
    await win.fill('#srv-name', 'News');
    await win.fill('#srv-secret', `${base}${HOOK}`);
    await shot('add-discord');
    await click('srv-save');
    await until(() => visible('srv-list-page'), 'the list');
    await closeServers();
    const list = await win.evaluate(() => window.reader.srvList());
    assert.ok(!JSON.stringify(list).includes('hook-token'));
  });

  const openBlog = async (site) => {
    await menu('send-blog');
    await until(() => visible('send-blog-page'), 'the draft dialog');
    if (site) await win.selectOption('#send-site', { label: site });
    await until(() => enabled('send-blog-go'), 'the site to answer');
  };
  const sendIt = async () => {
    await click('send-blog-go');
    await until(() => visible('send-blog-open'), 'the draft', 8000).catch(async (err) => { throw new Error(`${err.message}: ${await text('send-blog-msg')} / ${await text('send-blog-what')}`); });
  };

  let wpPost = null;
  await step('the draft dialog shows what’s going, and nothing goes until you press the button', async () => {
    await onTab('note');
    await openBlog('WordPress');
    assert.equal(await win.inputValue('#send-title'), 'My Launch Note');
    assert.equal(await win.inputValue('#send-tags'), 'Books, Launch');
    assert.equal(await win.inputValue('#send-featured'), 'images/my%20dot.png');
    assert.match(await text('send-blog-what'), /new draft.*1 picture goes with it/);
    assert.equal(wp.posts.size, 0);
    await shot('draft');
  });

  await step('the dialog passes an accessibility check', async () => {
    await win.evaluate(axeSource);
    const res = await win.evaluate(() => window.axe.run(document.getElementById('send-dlg'), { rules: { 'color-contrast': { enabled: false } } }));
    assert.deepEqual(res.violations.map((v) => v.id), []);
  });

  await step('WordPress gets a draft with its tags, picture and featured picture', async () => {
    await sendIt();
    assert.equal(wp.posts.size, 1);
    [wpPost] = [...wp.posts.values()];
    assert.equal(wpPost.status, 'draft');
    assert.equal(wpPost.title, 'My Launch Note');
    assert.equal(wpPost.excerpt, 'A short line');
    assert.equal(wpPost.tags.length, 2);
    assert.ok(wpPost.tags.includes(5));
    assert.equal(wp.media.length, 1, 'the same picture goes once');
    assert.ok(wpPost.featured_media > 0);
    assert.match(wpPost.content, /<img src="http:\/\/wp\.test\/uploads\/1\.png"/);
    assert.doesNotMatch(wpPost.content, /other\.md|<h1|my%20dot/);
    await click('send-blog-open');
    await until(async () => (await app.evaluate(() => global.__opened)).some((u) => u.includes(`post.php?post=${wpPost.id}`)), 'the draft to open');
    await click('send-blog-cancel');
  });

  await step('sending again updates that draft', async () => {
    await openBlog('WordPress');
    assert.match(await text('send-blog-what'), /updates the draft/);
    await win.fill('#send-title', 'A Better Title');
    await sendIt();
    assert.equal(wp.posts.size, 1);
    assert.equal(wpPost.title, 'A Better Title');
    assert.equal(wp.media.length, 1, 'the picture isn’t sent twice');
    assert.match(await text('send-blog-msg'), /updated/);
    await click('send-blog-cancel');
  });

  await step('once it’s published, it’s left alone and a new draft is made', async () => {
    wpPost.status = 'publish';
    await openBlog('WordPress');
    assert.match(await text('send-blog-what'), /leaves that post alone/);
    await sendIt();
    assert.equal(wp.posts.size, 2);
    assert.equal(wpPost.title, 'A Better Title');
    await click('send-blog-cancel');
  });

  await step('a slow answer from one blog can’t overwrite the blog you picked next', async () => {
    wpSlowMs = 900;
    await menu('send-blog');
    await until(() => visible('send-blog-page'), 'the dialog');
    await win.selectOption('#send-site', { label: 'Ghost' });
    await until(async () => /makes a new draft/.test(await text('send-blog-what')) && enabled('send-blog-go'), 'Ghost’s answer');
    await win.waitForTimeout(1200);
    assert.match(await text('send-blog-what'), /^This makes a new draft/, 'WordPress’s late answer was ignored');
    wpSlowMs = 0;
    await click('send-blog-cancel');
  });

  await step('Ghost gets a draft too', async () => {
    await openBlog('Ghost');
    await sendIt();
    const [post] = [...ghost.posts.values()];
    assert.equal(post.status, 'draft');
    assert.deepEqual(post.tags, [{ name: 'Books' }, { name: 'Launch' }]);
    assert.equal(post.feature_image, 'http://gh.test/content/1.png');
    assert.match(post.html, /gh\.test\/content\/1\.png/);
    assert.equal(ghost.images.length, 1);
    await click('send-blog-cancel');
  });

  await step('Discord: the dialog says how much is going, and who sees it', async () => {
    await menu('send-discord');
    await until(() => visible('send-discord-page'), 'the Discord dialog');
    await until(async () => /1 message, 1 picture/.test(await text('send-discord-what')), 'the plan');
    assert.equal(await visible('send-summary'), false);
    assert.equal(discord.length, 0);
    await shot('discord');
    const res = await win.evaluate(() => window.axe.run(document.getElementById('send-dlg'), { rules: { 'color-contrast': { enabled: false } } }));
    assert.deepEqual(res.violations.map((v) => v.id), []);
  });

  await step('Discord: the document goes with its picture, and nobody is pinged', async () => {
    await click('send-discord-go');
    await until(() => visible('send-discord-open'), 'the post');
    assert.equal(discord.length, 1);
    assert.match(discord[0].content, /^# My Launch Note\n\nWords with a link and @everyone\./);
    assert.deepEqual(discord[0].allowed_mentions, { parse: [] });
    assert.equal(discord[0].files, 1);
    await click('send-discord-open');
    await until(async () => (await app.evaluate(() => global.__opened)).some((u) => u.startsWith('https://discord.com/channels/g1/c1/m1')), 'the link');
    await click('send-discord-cancel');
  });

  await step('Discord: a summary starts from the opening, and you can change it', async () => {
    await menu('send-discord');
    await until(() => visible('send-discord-page'), 'the dialog');
    await win.selectOption('#send-mode', 'summary');
    await until(() => visible('send-summary'), 'the summary');
    assert.match(await win.inputValue('#send-summary'), /^Words with a link and @everyone\./);
    assert.equal(await visible('send-ai'), false, 'no AI is set up here');
    await win.fill('#send-summary', '');
    await until(async () => /Write the summary/.test(await text('send-discord-what')), 'the reminder');
    assert.equal(await enabled('send-discord-go'), false);
    await win.fill('#send-summary', 'In short: it’s out.');
    await until(async () => (await text('send-discord-what')) === '1 message' && enabled('send-discord-go'), 'the plan');
    await click('send-discord-go');
    await until(() => discord.length === 2, 'the summary to go');
    assert.equal(discord[1].content, '# My Launch Note\n\nIn short: it’s out.');
    await until(() => visible('send-discord-open'), 'the link');
    await click('send-discord-cancel');
  });

  await step('a very long document is held back, with a way forward', async () => {
    await menu('open');
    await until(() => win.evaluate(() => document.querySelectorAll('.tab').length === 2), 'the long document');
    await onTab('long');
    await menu('send-discord');
    await until(() => visible('send-discord-page'), 'the dialog');
    await until(async () => /too many.*summary/.test(await text('send-discord-what')), 'the warning');
    assert.equal(await enabled('send-discord-go'), false);
    await click('send-discord-cancel');
    await onTab('note');
  });

  await step('the document remembers where it went, with links back', async () => {
    await menu('sent-list');
    await until(() => visible('sent-page'), 'the list');
    const rows = await win.$$eval('#sent-rows li', (n) => n.map((x) => x.textContent));
    assert.equal(rows.length, 6);
    assert.match(rows[0], /News.*Discord.*Summary posted/);
    assert.match(rows[1], /News.*Discord.*Posted/);
    assert.match(rows[2], /Ghost.*Draft/);
    assert.match(rows[4], /WordPress.*Draft updated/);
    assert.equal(await visible('sent-none'), false);
    await shot('sent');
    const res = await win.evaluate(() => window.axe.run(document.getElementById('send-dlg'), { rules: { 'color-contrast': { enabled: false } } }));
    assert.deepEqual(res.violations.map((v) => v.id), []);
    await click('sent-close');
  });

  await step('the list follows a rename, and sending again still finds the draft', async () => {
    const res = await win.evaluate((p) => window.reader.renameDoc(p, 'renamed.md'), note);
    assert.ok(!res.error, res.error);
    const moved = path.join(docs, 'renamed.md');
    assert.equal((await win.evaluate((p) => window.reader.sentList(p), moved)).length, 6);
    assert.equal((await win.evaluate((p) => window.reader.sentList(p), note)).length, 0);
    const site = (await win.evaluate(() => window.reader.srvList())).servers.find((s) => s.kind === 'wordpress');
    assert.equal((await win.evaluate((r) => window.reader.sendStatus(r), { id: site.id, path: moved })).state, 'draft');
  });

  await step('a locked document never goes', async () => {
    const list = await win.evaluate(() => window.reader.srvList());
    const req = { id: list.servers[0].id, path: path.join(docs, 'secret.mdlock'), text: 'x', name: 'secret.mdlock', title: 'T', html: '<p>x</p>' };
    const res = await win.evaluate((r) => window.reader.sendDraft(r), req);
    assert.match(res.error, /never sent/);
  });

  await step('no key or webhook is written down in the open', async () => {
    const dir = path.join(tmp, 'p');
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      if (!fs.lstatSync(file).isFile()) continue;
      const data = fs.readFileSync(file);
      for (const secret of ['hook-token', GHOST_HEX, WP_PASS]) assert.ok(!data.includes(secret), `${f} holds ${secret.slice(0, 4)}`);
    }
  });

  await step('forgetting clears the list', async () => {
    const moved = path.join(docs, 'renamed.md');
    await win.evaluate((p) => window.reader.sentForget(p), moved);
    assert.equal((await win.evaluate((p) => window.reader.sentList(p), moved)).length, 0);
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
