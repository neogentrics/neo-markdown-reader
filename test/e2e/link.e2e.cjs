// App Link (3.6): a stand-in for another Recon Towers app talks to the real one, following docs/app-link.md.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-link-'));
const shared = path.join(tmp, 'shared');
const registration = path.join(shared, 'rt-markdown-reader.json');
const locked = path.join(tmp, 'secret.mdlock');
const note = path.join(tmp, 'note.md');
const picture = path.join(tmp, 'picture.png');
fs.writeFileSync(locked, 'x');
fs.writeFileSync(note, '# From a path\n');
fs.writeFileSync(picture, 'x');

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

/** One request, as another app would send it. */
function ask(endpoint, method, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(endpoint);
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('connect', () => sock.write(`${JSON.stringify({ id: 7, method, params })}\n`));
    sock.on('data', (chunk) => {
      buf += chunk;
      if (!buf.includes('\n')) return;
      sock.destroy();
      resolve(JSON.parse(buf.slice(0, buf.indexOf('\n'))));
    });
  });
}

/** The stand-in app's own side: it answers hello, pair and open_document. */
function standIn() {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\rt-link-test-${crypto.randomBytes(6).toString('hex')}` : path.join(tmp, 'stand-in.sock');
  const state = { endpoint, key: null, received: [], unlinked: false };
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      if (!buf.includes('\n')) return;
      const req = JSON.parse(buf.slice(0, buf.indexOf('\n')));
      buf = '';
      let result = {};
      if (req.method === 'hello') result = { protocol: 1, app: 'stand-in', name: 'Stand-In App', version: '1.0.0', accepts: ['markdown'] };
      if (req.method === 'open_document') { state.received.push(req.params); result = { opened: true }; }
      if (req.method === 'unlink') { state.unlinked = req.params.key === state.key; result = { unlinked: true }; }
      sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
    });
  });
  return new Promise((resolve) => server.listen(endpoint, () => {
    fs.writeFileSync(path.join(shared, 'stand-in.json'), JSON.stringify({ protocol: 1, id: 'stand-in', name: 'Stand-In App', version: '1.0.0', endpoint }));
    resolve({ state, server });
  }));
}

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'profile'), NMR_LINK_DIR: shared, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForSelector('#welcome');
  await app.evaluate(({ dialog }) => {
    global.__asked = [];
    global.__answers = [];
    dialog.showMessageBox = async (...args) => { const o = args.at(-1); global.__asked.push(`${o.message}\n${o.detail || ''}`); return { response: global.__answers.length ? global.__answers.shift() : o.cancelId }; };
  });
  const answer = (...a) => app.evaluate((_e, list) => { global.__answers.push(...list); }, a);
  const asked = () => app.evaluate(() => global.__asked);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const tabTitles = () => win.$$eval('.tab-label', (els) => els.map((e) => e.textContent));
  let endpoint;
  let key;

  await step('it stays off until it’s turned on', () => {
    assert.equal(fs.existsSync(registration), false);
  });

  await step('turned on, it says how to reach it, with no secrets in the file', async () => {
    const res = await win.evaluate(() => window.reader.linkSet(true));
    assert.equal(res.enabled, true);
    const info = JSON.parse(fs.readFileSync(registration, 'utf8'));
    assert.equal(info.protocol, 1);
    assert.equal(info.id, 'rt-markdown-reader');
    assert.deepEqual(Object.keys(info).sort(), ['endpoint', 'id', 'name', 'protocol', 'version']);
    endpoint = info.endpoint;
  });

  await step('hello needs no key', async () => {
    const { result } = await ask(endpoint, 'hello');
    assert.equal(result.name, 'RT Markdown Reader');
    assert.deepEqual(result.accepts, ['markdown', 'text']);
  });

  await step('an app that isn’t linked can’t send anything', async () => {
    const { error } = await ask(endpoint, 'open_document', { app: 'storytracker', key: 'nope', text: 'x' });
    assert.equal(error.code, 'not_linked');
  });

  await step('saying no gives no key, and the app can’t keep asking', async () => {
    await answer(1);
    const first = await ask(endpoint, 'pair', { app: 'pushy', name: 'Pushy App' });
    assert.equal(first.error.code, 'declined');
    const count = (await asked()).length;
    const second = await ask(endpoint, 'pair', { app: 'pushy', name: 'Pushy App' });
    assert.equal(second.error.code, 'declined');
    assert.equal((await asked()).length, count, 'the person isn’t asked again');
  });

  await step('saying yes gives a key, and the name shown has no hidden characters', async () => {
    await answer(0);
    const { result } = await ask(endpoint, 'pair', { app: 'storytracker', name: 'Story‮Tracker\u0007' });
    assert.match(result.key, /^[0-9a-f]{64}$/);
    key = result.key;
    assert.match((await asked()).at(-1), /^Link StoryTracker with RT Markdown Reader\?/);
  });

  await step('a linked app can send text, which opens unsaved', async () => {
    const before = fs.readdirSync(tmp).length;
    const { result } = await ask(endpoint, 'open_document', { app: 'storytracker', key, name: '../../Chapter 1', text: '# Sent across\n' });
    assert.deepEqual(result, { opened: true });
    await win.waitForFunction(() => /Sent across/.test(document.querySelector('.cm-content')?.textContent || ''));
    assert.ok((await tabTitles()).includes('Chapter 1'), 'the name has no folders in it');
    assert.equal(fs.readdirSync(tmp).length, before, 'nothing was written to disk');
  });

  await step('a linked app can open a Markdown file by its path, and nothing else', async () => {
    assert.deepEqual((await ask(endpoint, 'open_document', { app: 'storytracker', key, path: note })).result, { opened: true });
    await win.waitForFunction(() => /From a path/.test(document.body.textContent));
    assert.equal((await ask(endpoint, 'open_document', { app: 'storytracker', key, path: locked })).error.code, 'not_allowed');
    assert.equal((await ask(endpoint, 'open_document', { app: 'storytracker', key, path: picture })).error.code, 'not_allowed');
    assert.equal((await ask(endpoint, 'open_document', { app: 'storytracker', key, path: path.join(tmp, 'gone.md') })).error.code, 'not_found');
  });

  await step('the wrong key is refused, and so is a method that doesn’t exist', async () => {
    assert.equal((await ask(endpoint, 'open_document', { app: 'storytracker', key: `${key.slice(1)}0`, text: 'x' })).error.code, 'not_linked');
    assert.equal((await ask(endpoint, 'write_file', { app: 'storytracker', key })).error.code, 'unknown_method');
  });

  await step('the link survives turning App Link off and on', async () => {
    await win.evaluate(() => window.reader.linkSet(false));
    assert.equal(fs.existsSync(registration), false);
    await win.evaluate(() => window.reader.linkSet(true));
    endpoint = JSON.parse(fs.readFileSync(registration, 'utf8')).endpoint;
    assert.deepEqual((await ask(endpoint, 'open_document', { app: 'storytracker', key, name: 'Again', text: 'again' })).result, { opened: true });
  });

  await step('an app can unlink itself, and its key stops working', async () => {
    assert.deepEqual((await ask(endpoint, 'unlink', { app: 'storytracker', key })).result, { unlinked: true });
    assert.equal((await ask(endpoint, 'open_document', { app: 'storytracker', key, text: 'x' })).error.code, 'not_linked');
  });

  const { state, server } = await standIn();

  await step('Preferences shows an app it finds, and a left-over file from a crash is ignored', async () => {
    fs.writeFileSync(path.join(shared, 'crashed.json'), JSON.stringify({ protocol: 1, id: 'crashed', name: 'Crashed', version: '1', endpoint: state.endpoint.replace(/.$/, 'x') }));
    fs.writeFileSync(path.join(shared, 'sneaky.json'), JSON.stringify({ protocol: 1, id: 'sneaky', name: 'Sneaky', version: '1', endpoint: '\\\\server\\pipe\\x' }));
    const { apps } = await win.evaluate(() => window.reader.linkStatus());
    assert.deepEqual(apps, [{ id: 'stand-in', name: 'Stand-In App', linked: false, running: true }]);
  });

  await step('with no app linked, Send to Linked App says so', async () => {
    assert.deepEqual(await win.evaluate(() => window.reader.linkSend({ name: 'x.md', text: 'x' })), { error: 'No linked app is running.' });
  });

  await step('this app can ask to link too, and send what’s on screen, unsaved changes and all', async () => {
    // The stand-in says yes by answering pair with a key of its own.
    state.key = crypto.randomBytes(32).toString('hex');
    server.removeAllListeners('connection');
    server.on('connection', (sock) => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('error', () => {});
      sock.on('data', (chunk) => {
        buf += chunk;
        if (!buf.includes('\n')) return;
        const req = JSON.parse(buf.slice(0, buf.indexOf('\n')));
        buf = '';
        let result = { protocol: 1 };
        if (req.method === 'pair') result = { key: state.key, app: 'stand-in', name: 'Stand-In App' };
        if (req.method === 'open_document') { state.received.push(req.params); result = { opened: true }; }
        if (req.method === 'unlink') { state.unlinked = req.params.key === state.key; result = { unlinked: true }; }
        sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
      });
    });
    assert.deepEqual(await win.evaluate(() => window.reader.linkPair('stand-in')), { name: 'Stand-In App' });
    await menu('new-doc');
    await win.locator('.cm-content:visible').last().click();
    await win.keyboard.type('Typed just now');
    await menu('send-linked');
    await win.waitForFunction(() => /Sent to Stand-In App/.test(document.body.textContent));
    const got = state.received.at(-1);
    assert.equal(got.app, 'rt-markdown-reader');
    assert.equal(got.key, state.key);
    assert.match(got.text, /Typed just now/);
    assert.match(got.name, /\.md$/);
  });

  await step('a password-locked document is never sent', async () => {
    const res = await win.evaluate((p) => window.reader.linkSend({ name: 'secret', path: p, text: 'secret' }), locked);
    assert.deepEqual(res, { error: 'Password-locked documents can’t be sent.' });
    assert.ok(!state.received.some((r) => r.text === 'secret'));
  });

  await step('the Linked Apps pane shows the link, and Remove tells the other app', async () => {
    await menu('preferences');
    await win.click('.prefs-nav [data-pane="link"]');
    await win.waitForFunction(() => /Stand-In App/.test(document.getElementById('pref-link-list').textContent));
    assert.equal(await win.isChecked('#pref-link'), true);
    await win.click('#pref-link-list button');
    await win.waitForFunction(() => /Not linked/.test(document.getElementById('pref-link-list').textContent));
    assert.equal(state.unlinked, true);
    await win.click('#prefs-done');
  });

  await step('keys aren’t in the settings file', async () => {
    await win.evaluate(() => window.reader.setSettings({ fontScale: 1.1 }));
    const profile = path.join(tmp, 'profile');
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(!fs.readFileSync(path.join(profile, 'settings.json'), 'utf8').includes(state.key));
  });

  await step('closing the app removes its file', async () => {
    server.close();
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await app.close();
    assert.equal(fs.existsSync(registration), false);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`link e2e: all passed (${passed})`);
})().catch((err) => { console.error(err); process.exit(1); });
