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
const got = path.join(tmp, 'story-got.txt');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const map = path.join(tmp, 'pics', 'map.png');
const extra = path.join(tmp, 'pics', 'extra.png');
const fake = path.join(tmp, 'pics', 'fake.png');
const illustrated = path.join(tmp, 'illustrated.md');
const illustratedText = '# Illustrated\n\n![Map](pics/map.png)\n\n![Fake](pics/fake.png)\n\n![Gone](pics/gone.png)\n\n![Web](https://example.com/web.png)\n';
fs.writeFileSync(locked, 'x');
fs.writeFileSync(note, '# From a path\n');
fs.writeFileSync(picture, 'x');
fs.mkdirSync(path.dirname(map));
fs.writeFileSync(map, PNG);
fs.writeFileSync(extra, PNG);
fs.writeFileSync(fake, 'not a picture');
fs.writeFileSync(illustrated, illustratedText);

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
function standIn(id = 'stand-in', name = 'Stand-In App') {
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\rt-link-test-${crypto.randomBytes(6).toString('hex')}` : path.join(tmp, `${id}.sock`);
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
      if (req.method === 'hello') result = { protocol: 1, app: id, name, version: '1.0.0', accepts: ['markdown'] };
      if (req.method === 'pair') result = { key: state.key, app: id, name };
      if (req.method === 'open_document') { state.received.push(req.params); result = { opened: true }; }
      if (req.method === 'unlink') { state.unlinked = req.params.key === state.key; result = { unlinked: true }; }
      sock.write(`${JSON.stringify({ id: req.id, result })}\n`);
    });
  });
  return new Promise((resolve) => server.listen(endpoint, () => {
    fs.writeFileSync(path.join(shared, `${id}.json`), JSON.stringify({ protocol: 1, id, name, version: '1.0.0', endpoint }));
    resolve({ state, server });
  }));
}

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'profile'), NMR_LINK_DIR: shared, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_STORY_GOT: got },
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
    const { error } = await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key: 'nope', text: 'x' });
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
    const { result } = await ask(endpoint, 'pair', { app: 'rt-story-tracker', name: 'Story‮Tracker\u0007' });
    assert.match(result.key, /^[0-9a-f]{64}$/);
    key = result.key;
    assert.match((await asked()).at(-1), /^Link StoryTracker with RT Markdown Reader\?/);
  });

  await step('a linked app can send text, which opens unsaved', async () => {
    const before = fs.readdirSync(tmp).length;
    const { result } = await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, name: '../../Chapter 1', text: '# Sent across\n' });
    assert.deepEqual(result, { opened: true });
    await win.waitForFunction(() => /Sent across/.test(document.querySelector('.cm-content')?.textContent || ''));
    assert.ok((await tabTitles()).includes('Chapter 1'), 'the name has no folders in it');
    assert.equal(fs.readdirSync(tmp).length, before, 'nothing was written to disk');
  });

  await step('a linked app can open a Markdown file by its path, and nothing else', async () => {
    assert.deepEqual((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, path: note })).result, { opened: true });
    await win.waitForFunction(() => /From a path/.test(document.body.textContent));
    assert.equal((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, path: locked })).error.code, 'not_allowed');
    assert.equal((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, path: picture })).error.code, 'not_allowed');
    assert.equal((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, path: path.join(tmp, 'gone.md') })).error.code, 'not_found');
  });

  await step('pictures sent with a document show, and anything else on the list is dropped', async () => {
    const before = fs.readdirSync(tmp).length;
    const attachments = [
      { name: 'map.png', path: map }, { name: 'extra.png', path: extra }, { name: 'fake.png', path: fake }, { name: 'note.png', path: note },
      { name: 'near.png', path: 'pics/map.png' }, { name: 'far.png', path: '\\\\127.0.0.1\\share\\map.png' }, { name: 'gone.png', path: path.join(tmp, 'gone.png') }, 'map.png',
    ];
    const { result } = await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, name: 'Mapped', text: '# Mapped\n\n![The map](images/map.png)\n\n![No such](fake.png)\n', attachments, kind: 'chapter' });
    assert.deepEqual(result, { opened: true });
    await win.waitForFunction(() => document.querySelectorAll('img[src^="data:image/png"]').length === 2);
    await win.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.getAttribute('alt') === 'The map' && i.naturalWidth === 1));
    assert.equal(fs.readdirSync(tmp).length, before, 'nothing was written to disk');
  });

  await step('saving the document puts its pictures beside it, and its links follow them', async () => {
    const saved = path.join(tmp, 'book', 'Mapped.md');
    fs.mkdirSync(path.dirname(saved));
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, saved);
    await menu('save-as');
    const wanted = (t) => t.includes('![The map](images/map.png)') && t.includes('(images/extra.png)');
    for (let i = 0; i < 50 && !(fs.existsSync(saved) && wanted(fs.readFileSync(saved, 'utf8'))); i++) await new Promise((r) => setTimeout(r, 100));
    const text = fs.readFileSync(saved, 'utf8');
    assert.ok(wanted(text), text);
    assert.ok(text.includes('![No such](fake.png)'), 'a link to a picture that wasn’t sent stays as it was');
    assert.ok(!text.includes('data:'));
    assert.deepEqual(fs.readFileSync(path.join(tmp, 'book', 'images', 'map.png')), PNG);
    assert.deepEqual(fs.readFileSync(path.join(tmp, 'book', 'images', 'extra.png')), PNG);
  });

  await step('the wrong key is refused, and so is a method that doesn’t exist', async () => {
    assert.equal((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key: `${key.slice(1)}0`, text: 'x' })).error.code, 'not_linked');
    assert.equal((await ask(endpoint, 'write_file', { app: 'rt-story-tracker', key })).error.code, 'unknown_method');
  });

  await step('the link survives turning App Link off and on', async () => {
    await win.evaluate(() => window.reader.linkSet(false));
    assert.equal(fs.existsSync(registration), false);
    await win.evaluate(() => window.reader.linkSet(true));
    endpoint = JSON.parse(fs.readFileSync(registration, 'utf8')).endpoint;
    assert.deepEqual((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, name: 'Again', text: 'again' })).result, { opened: true });
  });

  await step('an app can unlink itself, and its key stops working', async () => {
    assert.deepEqual((await ask(endpoint, 'unlink', { app: 'rt-story-tracker', key })).result, { unlinked: true });
    assert.equal((await ask(endpoint, 'open_document', { app: 'rt-story-tracker', key, text: 'x' })).error.code, 'not_linked');
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
    assert.deepEqual(await win.evaluate(() => window.reader.linkPair('stand-in')), { name: 'Stand-In App' });
    await menu('new-doc');
    await win.locator('.cm-content:visible').last().click();
    await win.keyboard.type('Typed just now');
    await menu('send-linked');
    await win.waitForFunction(() => /Sent to Stand-In App/.test(document.body.textContent));
    const sentDoc = state.received.at(-1);
    assert.equal(sentDoc.app, 'rt-markdown-reader');
    assert.equal(sentDoc.key, state.key);
    assert.match(sentDoc.text, /Typed just now/);
    assert.match(sentDoc.name, /\.md$/);
    assert.equal(sentDoc.attachments, undefined, 'a document with no pictures sends no list');
  });

  await step('the pictures a document shows go with it, and only those', async () => {
    assert.deepEqual(await win.evaluate(([p, text]) => window.reader.linkSend({ name: 'illustrated.md', path: p, text }), [illustrated, illustratedText]), { name: 'Stand-In App' });
    assert.deepEqual(state.received.at(-1).attachments, [{ name: 'map.png', path: map }]);
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

  const story = await standIn('rt-story-tracker', 'RT Story Tracker');
  const storySend = (doc) => win.evaluate((d) => window.reader.linkSend({ to: 'rt-story-tracker', ...d }), doc);
  const setStoryApp = (file) => app.evaluate((_e, f) => { process.env.NMR_STORY_APP = f; }, file);
  const waitForGot = async () => {
    for (let i = 0; i < 100 && !fs.existsSync(got); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 100));
    return fs.readFileSync(got, 'utf8');
  };
  // Node stands in for RT Story Tracker: it's a real program started with a file, and this document is a script that says
  // what it was given. That works the same on every system, where a real stand-in program wouldn't.
  const script = 'const fs = require("fs"); fs.writeFileSync(process.env.NMR_STORY_GOT, __filename + "\\n" + fs.readFileSync(__filename, "utf8"));\n';
  let handedOver;

  await step('Send to StoryTracker is in the File menu, and the menu is still short', async () => {
    const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((m) => m.label.replace(/&/g, '') === 'File').submenu.items.filter((i) => i.visible && i.type !== 'separator'));
    assert.ok(items.length <= 20, `File has ${items.length}`);
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('send-story')?.label), 'Send to StoryTracker');
  });

  await step('with a link it goes across, with its pictures', async () => {
    story.state.key = crypto.randomBytes(32).toString('hex');
    assert.deepEqual(await win.evaluate(() => window.reader.linkPair('rt-story-tracker')), { name: 'RT Story Tracker' });
    assert.deepEqual(await storySend({ name: 'illustrated.md', path: illustrated, text: illustratedText }), { name: 'RT Story Tracker' });
    const sentDoc = story.state.received.at(-1);
    assert.equal(sentDoc.name, 'illustrated.md');
    assert.equal(sentDoc.text, illustratedText);
    assert.deepEqual(sentDoc.attachments, [{ name: 'map.png', path: map }]);
    assert.equal(fs.existsSync(got), false, 'nothing went the other way');
  });

  await step('a link to 3.7.0, which still calls itself storytracker, works too', async () => {
    const older = await standIn('storytracker', 'RT Story Tracker');
    older.state.key = crypto.randomBytes(32).toString('hex');
    fs.rmSync(path.join(shared, 'rt-story-tracker.json'));
    assert.deepEqual(await win.evaluate(() => window.reader.linkPair('storytracker')), { name: 'RT Story Tracker' });
    assert.deepEqual(await storySend({ name: 'illustrated.md', path: illustrated, text: illustratedText }), { name: 'RT Story Tracker' });
    assert.deepEqual(older.state.received.at(-1).attachments, [{ name: 'map.png', path: map }]);
    await win.evaluate(() => window.reader.linkUnlink('storytracker'));
    older.server.close();
    fs.rmSync(path.join(shared, 'storytracker.json'));
    fs.writeFileSync(path.join(shared, 'rt-story-tracker.json'), JSON.stringify({ protocol: 1, id: 'rt-story-tracker', name: 'RT Story Tracker', version: '1.0.0', endpoint: story.state.endpoint }));
  });

  await step('a password-locked document is never sent, by either road', async () => {
    const count = story.state.received.length;
    const refused = { error: 'Password-locked documents can’t be sent.' };
    assert.deepEqual(await storySend({ name: 'secret', path: locked, text: 'secret' }), refused);
    assert.deepEqual(await storySend({ name: 'secret', locked: true, text: 'secret' }), refused);
    await win.evaluate(() => window.reader.linkSet(false));
    await setStoryApp(process.execPath);
    assert.deepEqual(await storySend({ name: 'secret', path: locked, text: script }), refused);
    assert.deepEqual(await storySend({ name: 'secret', locked: true, text: script }), refused);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fs.existsSync(got), false);
    assert.equal(story.state.received.length, count);
    await win.evaluate(() => window.reader.linkSet(true));
  });

  await step('a linked app that’s closed is started the same way as Open With', async () => {
    const stopped = path.join(shared, 'rt-story-tracker.json');
    const saved = fs.readFileSync(stopped);
    fs.rmSync(stopped);
    assert.deepEqual(await storySend({ name: 'Closed.md', text: script }), { name: 'RT Story Tracker', picturesLeft: 0 });
    assert.match(await waitForGot(), /Closed\.md/);
    fs.rmSync(got);
    fs.writeFileSync(stopped, saved);
  });

  await step('with no link it starts the app with a plain copy of what’s on screen', async () => {
    await win.evaluate(() => window.reader.linkUnlink('rt-story-tracker'));
    assert.deepEqual(await storySend({ name: 'Chapter: 2?.mdx', text: script }), { name: 'RT Story Tracker', picturesLeft: 0 });
    const [file, ...text] = (await waitForGot()).split('\n');
    assert.equal(path.basename(file), 'Chapter 2.md');
    assert.match(path.basename(path.dirname(file)), /^rtmr-send-[0-9a-f]{16}$/);
    assert.equal(text.join('\n'), script);
    assert.equal(story.state.received.filter((r) => r.name === 'Chapter 2.md').length, 0);
    handedOver = file;
  });

  await step('with no link, you’re told its pictures stayed behind', async () => {
    assert.deepEqual(await storySend({ name: 'illustrated.md', path: illustrated, text: illustratedText }), { name: 'RT Story Tracker', picturesLeft: 1 });
    await menu('send-story');
    await win.waitForFunction(() => /Sent to RT Story Tracker/.test(document.body.textContent));
  });

  await step('if RT Story Tracker can’t be found it says so, and writes nothing', async () => {
    await setStoryApp(path.join(tmp, 'not-here.exe'));
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rtmr-send-')).length;
    const { error } = await storySend({ name: 'Lost.md', text: 'x' });
    assert.match(error, /isn’t on this computer/);
    assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('rtmr-send-')).length, before);
  });

  await step('keys aren’t in the settings file', async () => {
    await win.evaluate(() => window.reader.setSettings({ fontScale: 1.1 }));
    const profile = path.join(tmp, 'profile');
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(!fs.readFileSync(path.join(profile, 'settings.json'), 'utf8').includes(state.key));
  });

  await step('closing the app removes its file', async () => {
    server.close();
    story.server.close();
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    await app.close();
    assert.equal(fs.existsSync(registration), false);
  });

  await step('closing the app removes the plain copies it made', () => {
    assert.equal(fs.existsSync(path.dirname(handedOver)), false);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`link e2e: all passed (${passed})`);
})().catch((err) => { console.error(err); process.exit(1); });
