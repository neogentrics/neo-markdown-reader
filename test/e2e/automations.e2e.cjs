// End-to-end test for 3.7: automations against a stand-in for n8n, the send preview, answers as documents and changes,
// listing workflows by name, and workflows calling the app.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-auto-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const note = path.join(docs, 'note.md');
fs.writeFileSync(note, '# Note\n\nThe quick brown fox.\n');
fs.writeFileSync(path.join(docs, 'other.md'), '# Other\n\nMore words.\n');
fs.writeFileSync(path.join(docs, 'secret.mdlock'), 'locked');
const PORT = 41800 + Math.floor(Math.random() * 100);

const received = [];
let answer = { status: 200, type: 'application/json', body: '{"text":"# From the workflow\\n\\nDone."}' };
const n8n = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.startsWith('/api/v1/workflows')) {
      if (req.headers['x-n8n-api-key'] !== 'good-key') { res.writeHead(401); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ name: 'Summarize', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { httpMethod: 'POST', path: 'summarize' } }] }] }));
      return;
    }
    received.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.writeHead(answer.status, { 'content-type': answer.type });
    res.end(answer.body);
  });
});

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

(async () => {
  await new Promise((r) => n8n.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${n8n.address().port}`;
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), note],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_INBOUND_PORT: String(PORT) },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, folder) => {
    global.__asked = [];
    global.__answer = 0;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(o.message); return { response: global.__answer }; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, docs);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const hasMenu = (id) => app.evaluate(({ Menu }, itemId) => !!Menu.getApplicationMenu().getMenuItemById(itemId), id);
  const pageText = () => win.textContent('.page:not([hidden])');
  const editorHas = (re) => win.waitForFunction((src) => [...document.querySelectorAll('.cm-content')].some((c) => c.offsetParent && new RegExp(src).test(c.innerText)), re.source);
  const editorText = () => win.evaluate(() => [...document.querySelectorAll('.cm-content')].find((c) => c.offsetParent).innerText);
  const newAction = async (name, url, send = 'document', result = 'document', secret = '') => {
    await win.click('#auto-new');
    await win.fill('#auto-name', name);
    await win.fill('#auto-url', url);
    await win.selectOption('#auto-send-what', send);
    await win.selectOption('#auto-result', result);
    if (secret) await win.fill('#auto-secret', secret);
    await win.click('#auto-edit-save');
    await win.waitForSelector(`#auto-actions li:has-text("${name}")`);
  };
  const runByName = async (name) => {
    const id = await win.evaluate(async (n) => (await window.reader.autoList()).actions.find((a) => a.name === n).id, name);
    await menu(`auto-${id}`);
    await win.waitForSelector('#auto-send-page:not([hidden])');
  };
  await win.waitForSelector('.page:not([hidden]) h1');

  await step('the window opens with nothing set up, and bad addresses are refused', async () => {
    await menu('automations');
    await win.waitForSelector('#auto-dlg[open]');
    assert.equal(await win.isVisible('#auto-none'), true);
    await win.click('#auto-new');
    await win.fill('#auto-name', 'Bad');
    await win.fill('#auto-url', 'file:///c:/x');
    await win.click('#auto-edit-save');
    assert.match(await win.textContent('#auto-edit-msg'), /whole web address/);
    await win.click('#auto-edit-cancel');
  });

  await step('a saved webhook becomes a command, with a secret kept out of the settings', async () => {
    await newAction('Tidy', `${base}/webhook/tidy`, 'document', 'document', 'Bearer top-secret');
    assert.equal(await win.isVisible('#auto-none'), false);
    const id = await win.evaluate(async () => (await window.reader.autoList()).actions[0].id);
    assert.equal(await hasMenu(`auto-${id}`), true);
    const names = await win.evaluate(async () => (await window.reader.listCommands()).map((c) => c.label));
    assert.ok(names.some((n) => /Tidy/.test(n)), 'it’s in Quick Open');
    await win.click('#auto-close');
    await new Promise((r) => setTimeout(r, 500));
    assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'p', 'settings.json'), 'utf8'), /top-secret/);
  });

  await step('nothing is sent until you’ve seen what’s going and where', async () => {
    await runByName('Tidy');
    assert.equal(received.length, 0);
    assert.match(await win.textContent('#auto-send-to'), /\/webhook\/tidy/);
    assert.match(await win.textContent('#auto-send-sample'), /quick brown fox/);
    assert.match(await win.textContent('#auto-send-msg'), /isn’t encrypted/);
    await win.click('#auto-send-cancel');
    await win.waitForFunction(() => !document.querySelector('#auto-dlg[open]'));
    assert.equal(received.length, 0);
  });

  await step('sending delivers the document and the header, and the answer opens as a new document', async () => {
    await runByName('Tidy');
    await win.click('#auto-go');
    await editorHas(/From the workflow/);
    assert.equal(received.length, 1);
    assert.equal(received[0].headers.authorization, 'Bearer top-secret');
    assert.equal(received[0].headers['content-type'], 'application/json');
    assert.match(received[0].body.text, /quick brown fox/);
    assert.equal(received[0].body.action, 'Tidy');
    assert.equal(received[0].body.app, 'RT Markdown Reader');
    assert.match(await win.textContent('.tab.active'), /note - Tidy/);
    assert.doesNotMatch(fs.readFileSync(note, 'utf8'), /workflow/, 'your document isn’t touched');
    await menu('close-tab').catch(() => {});
    await app.evaluate(() => { global.__answer = 1; });
    await new Promise((r) => setTimeout(r, 300));
  });

  await step('an error says what to do, and you can try again', async () => {
    await win.click('.tab >> text=note');
    answer = { status: 404, type: 'text/plain', body: 'nope' };
    await runByName('Tidy');
    await win.click('#auto-go');
    await win.waitForFunction(() => /production URL/.test(document.getElementById('auto-send-msg').textContent));
    assert.equal(await win.isVisible('#auto-send-cancel'), true);
    await win.click('#auto-send-cancel');
    answer = { status: 200, type: 'application/json', body: '{"text":"# Note\\n\\nThe quick red fox.\\n"}' };
  });

  await step('an answer can be a change you accept, and nothing changes until you do', async () => {
    await menu('automations');
    await win.waitForSelector('#auto-list-page:not([hidden])');
    await newAction('Rewrite', `${base}/webhook/rewrite`, 'document', 'change');
    await win.click('#auto-close');
    await runByName('Rewrite');
    await win.click('#auto-go');
    await win.waitForSelector('#auto-change-page:not([hidden])');
    assert.equal(await win.textContent('#auto-diff ins'), 'red');
    assert.equal(await win.textContent('#auto-diff del'), 'brown');
    await win.click('#auto-reject');
    await win.waitForFunction(() => !document.querySelector('#auto-dlg[open]'));
    assert.match(await pageText(), /quick brown fox/);
    await runByName('Rewrite');
    await win.click('#auto-go');
    await win.waitForSelector('#auto-change-page:not([hidden])');
    await app.evaluate(() => { global.__answer = 1; });
    await win.click('#auto-accept');
    await editorHas(/quick red fox/);
    assert.match(fs.readFileSync(note, 'utf8'), /quick brown fox/, 'not saved until you save');
  });

  await step('a selection can be sent and replaced on its own', async () => {
    await menu('automations');
    await win.waitForSelector('#auto-list-page:not([hidden])');
    await newAction('Fix selection', `${base}/webhook/fix`, 'selection', 'change');
    await win.click('#auto-close');
    await win.click('.cm-content:visible');
    await win.keyboard.press('Control+End');
    await win.keyboard.press('Shift+ArrowUp');
    answer = { status: 200, type: 'text/plain', body: 'Replaced.' };
    await runByName('Fix selection');
    await win.click('#auto-go');
    await win.waitForSelector('#auto-change-page:not([hidden])');
    await win.click('#auto-accept');
    await editorHas(/Replaced\./);
    assert.match(await editorText(), /^# Note/, 'the rest stays');
    assert.equal(received.at(-1).body.text, undefined);
    assert.ok(received.at(-1).body.selection.length > 0);
  });

  await step('asking for a selection with nothing selected says so', async () => {
    await win.click('.cm-content:visible');
    await win.keyboard.press('Control+Home');
    const before = received.length;
    const id = await win.evaluate(async () => (await window.reader.autoList()).actions.find((a) => a.name === 'Fix selection').id);
    await menu(`auto-${id}`);
    await win.waitForFunction(() => /Select some text/.test(document.getElementById('toast').textContent));
    assert.equal(received.length, before);
  });

  await step('a whole folder can be sent, without locked documents', async () => {
    await menu('open-folder');
    await win.waitForFunction(() => document.querySelectorAll('.file-name').length >= 2);
    await menu('automations');
    await win.waitForSelector('#auto-list-page:not([hidden])');
    await newAction('All notes', `${base}/webhook/all`, 'folder', 'none');
    await win.click('#auto-close');
    await runByName('All notes');
    assert.match(await win.textContent('#auto-send-summary'), /2 documents/);
    assert.match(await win.textContent('#auto-send-sample'), /other\.md/);
    await win.click('#auto-go');
    await win.waitForFunction(() => !document.querySelector('#auto-dlg[open]'));
    const { documents, folder } = received.at(-1).body;
    assert.deepEqual(documents.map((d) => d.name).sort(), ['note.md', 'other.md']);
    assert.equal(folder, 'docs');
    assert.match(documents.find((d) => d.name === 'other.md').text, /More words/);
    assert.doesNotMatch(JSON.stringify(received.at(-1).body), /locked/);
  });

  await step('n8n workflows are listed by name and added in one go', async () => {
    await menu('automations');
    await win.waitForSelector('#auto-list-page:not([hidden])');
    await win.fill('#n8n-url', `${base}/home/workflows`);
    await win.click('#n8n-go');
    await win.waitForFunction(() => /API key/.test(document.getElementById('n8n-msg').textContent));
    await win.fill('#n8n-key', 'bad-key');
    await win.click('#n8n-go');
    await win.waitForFunction(() => /refused that API key/.test(document.getElementById('n8n-msg').textContent));
    await win.fill('#n8n-key', 'good-key');
    await win.click('#n8n-go');
    await win.waitForSelector('#n8n-list li');
    assert.match(await win.textContent('#n8n-list'), /Summarize/);
    await win.click('#n8n-list button');
    await win.waitForSelector('#auto-edit-page:not([hidden])');
    assert.equal(await win.inputValue('#auto-name'), 'Summarize');
    assert.equal(await win.inputValue('#auto-url'), `${base}/webhook/summarize`);
    await win.click('#auto-edit-save');
    await win.waitForSelector('#auto-actions li:has-text("Summarize")');
    await new Promise((r) => setTimeout(r, 400));
    assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'p', 'settings.json'), 'utf8'), /good-key/);
  });

  await step('the window has no accessibility problems', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.evaluate(axeSource);
    for (const theme of ['light', 'dark', 'blue']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      const found = await win.evaluate(async () => {
        const r = await window.axe.run(document.getElementById('auto-dlg'), { resultTypes: ['violations'] });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
      });
      assert.deepEqual(found, [], `${theme}: ${found.join(' | ')}`);
    }
    await win.click('#auto-close');
  });

  const call = (route, body, key, headers = {}) => fetch(`http://127.0.0.1:${PORT}${route}`, { method: body ? 'POST' : 'GET', headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });

  await step('the address for workflows is closed until you turn it on', async () => {
    await assert.rejects(call('/v1/status', null, 'x'));
    await menu('preferences');
    await win.waitForSelector('#prefs-dlg[open]');
    await win.click('.prefs-nav button[data-pane="automate"]');
    assert.equal(await win.isChecked('#pref-inbound'), false);
    await win.check('#pref-inbound');
    await win.waitForFunction(() => document.getElementById('pref-inbound-key').value.length === 64);
    assert.match(await win.inputValue('#pref-inbound-url'), new RegExp(`127\\.0\\.0\\.1:${PORT}/v1/documents`));
  });

  await step('a workflow can open a new document, and a wrong key can’t', async () => {
    const key = await win.inputValue('#pref-inbound-key');
    assert.equal((await call('/v1/documents', { name: 'x', content: 'y' }, 'wrong')).status, 401);
    assert.equal((await call('/v1/documents', { name: 'x', content: 'y' }, key, { origin: 'https://evil.example' })).status, 403);
    await win.click('#prefs-dlg .prefs-close, #prefs-close').catch(() => win.keyboard.press('Escape'));
    const res = await call('/v1/documents', { name: 'From n8n', content: '# Sent in\n\nHello.' }, key);
    assert.equal(res.status, 200);
    await editorHas(/Sent in/);
    assert.match(await win.textContent('.tab.active'), /From n8n/);
  });

  await step('adding to a file asks you first, and keeps your words', async () => {
    const key = await win.evaluate(async () => (await window.reader.inboundStatus()).key);
    const other = path.join(docs, 'other.md');
    await app.evaluate(() => { global.__asked = []; global.__answer = 3; });      // Cancel
    const denied = await call('/v1/append', { path: other, text: 'Added' }, key);
    assert.equal(denied.status, 403);
    assert.doesNotMatch(fs.readFileSync(other, 'utf8'), /Added/);
    await app.evaluate(() => { global.__answer = 0; });
    assert.equal((await call('/v1/append', { path: other, text: 'Added' }, key)).status, 200);
    assert.match(fs.readFileSync(other, 'utf8'), /More words\.\n\nAdded\n$/);
    assert.ok((await app.evaluate(() => global.__asked)).length >= 1, 'it asked');
    assert.equal((await call('/v1/append', { path: path.join(docs, 'secret.mdlock'), text: 'x' }, key)).status, 403);
    assert.equal((await call('/v1/open', { path: path.join(docs, 'secret.mdlock') }, key)).status, 403);
  });

  await step('a new key replaces the old one, and turning it off closes the address', async () => {
    const old = await win.evaluate(async () => (await window.reader.inboundStatus()).key);
    const fresh = (await win.evaluate(() => window.reader.inboundNewKey())).key;
    assert.notEqual(old, fresh);
    assert.equal((await call('/v1/status', null, old)).status, 401);
    assert.equal((await call('/v1/status', null, fresh)).status, 200);
    await win.evaluate(() => window.reader.inboundSet({ enabled: false }));
    await assert.rejects(call('/v1/status', null, fresh));
  });

  await step('removing an automation takes its command away', async () => {
    const id = await win.evaluate(async () => (await window.reader.autoList()).actions.find((a) => a.name === 'Tidy').id);
    await win.evaluate((x) => window.reader.autoRemove(x), id);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await hasMenu(`auto-${id}`), false);
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  n8n.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
