// End-to-end test for v3.3: AI assist with other services. A stand-in for an OpenAI-style server
// plays both "a model on this computer" (at its own address) and ChatGPT (through NMR_AI_BASE_URL),
// listing models and streaming answers. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const requests = [];
let reply = '## Summary\n\nThree **short** lines.';
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/v1/models') {
      if (req.headers.authorization === 'Bearer sk-wrong-key-0123456789') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'llama3.2:3b' }, { id: 'gpt-big' }, { id: 'gpt-small' }, { id: 'text-embedding-3-small' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ id: 'c1', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
      for (const piece of reply.match(/[\s\S]{1,9}/g)) send({ id: 'c1', model: body.model, choices: [{ index: 0, delta: { content: piece } }] });
      send({ id: 'c1', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404); res.end();
  });
});

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-ai-'));
const profile = path.join(tmp, 'profile');
const doc = path.join(tmp, 'notes.md');
fs.writeFileSync(doc, '# Notes\n\nThe meeting moved to Friday.\n');
const OPENAI_KEY = 'sk-proj-test-0123456789abcdefghij';

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), doc],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1', NMR_AI_BASE_URL: base },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    global.__asked = [];
    global.__answer = 1;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(`${o.message}\n${o.detail || ''}`); return { response: global.__answer }; };
  });
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const settingsJson = () => { try { return fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'); } catch { return ''; } };   // replaced while being saved
  await win.waitForSelector('.page:not([hidden]) #notes');

  const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
    && !(process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend?.())));

  await step('an Anthropic key saved by an older version is still found', async () => {
    if (!secure) { console.log('   (no secure key store on this computer: skipped)'); return; }
    await app.evaluate(({ app: a, safeStorage }) => {
      const fsm = process.mainModule.require('node:fs');
      const pm = process.mainModule.require('node:path');
      fsm.writeFileSync(pm.join(a.getPath('userData'), 'ai-key.bin'), safeStorage.encryptString('sk-ant-legacy-0123456789abcdefghij'));
    });
    const st = await win.evaluate(() => window.reader.aiStatus());
    assert.equal(st.providers.find((p) => p.id === 'anthropic').hasKey, true);
    assert.equal(st.provider, 'anthropic', 'Claude is still the default service');
  });

  await step('a model on this computer: the address, its model list, no key, and nothing leaves the network', async () => {
    await menu('ai-settings');
    await win.waitForSelector('#ai-dlg[open]');
    const labels = await win.$$eval('#ai-provider option', (o) => o.map((x) => x.textContent));
    assert.deepEqual(labels, ['Claude (Anthropic)', 'ChatGPT (OpenAI)', 'Gemini (Google)', 'Mistral', 'OpenRouter (hundreds of models, one key)', 'On this computer (Ollama, LM Studio…)']);
    await win.selectOption('#ai-provider', 'local');
    assert.equal(await win.isVisible('#ai-local'), true);
    assert.equal(await win.textContent('#ai-key-label'), 'API key (if your server needs one)');
    await win.fill('#ai-local-url', 'http://llm.example.com/v1');
    await win.check('#ai-enabled');
    await win.fill('#ai-model', 'llama3.2:3b');
    await win.click('#ai-form button[type=submit]');
    assert.match(await win.textContent('#ai-msg'), /Plain http works only for this computer or your own network/);
    await win.fill('#ai-local-url', `${base}/v1`);
    await win.click('#ai-models-refresh');
    await win.waitForFunction(() => /4 models available/.test(document.getElementById('ai-models-msg').textContent));
    assert.deepEqual(await win.$$eval('#ai-model-list option', (o) => o.map((x) => x.value)), ['gpt-big', 'gpt-small', 'llama3.2:3b', 'text-embedding-3-small']);
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    await win.waitForFunction(() => /AI assist is on with your local model/.test(document.getElementById('toast').textContent));
  });

  await step('Summarize streams the local model’s answer, with no key sent', async () => {
    await menu('ai-summarize');
    await win.waitForSelector('#ai-panel[open] #ai-body h2');
    await win.waitForFunction(() => /short/.test(document.getElementById('ai-body').textContent) && document.getElementById('ai-stop').hidden);
    assert.match(await win.textContent('#ai-status'), /Written by your local model/);
    const r = requests.filter((x) => x.url === '/v1/chat/completions').at(-1);
    assert.equal(r.body.model, 'llama3.2:3b');
    assert.equal(r.body.stream, true);
    assert.equal(r.headers.authorization, undefined);
    assert.match(r.body.messages[1].content, /<document title="Notes">[\s\S]*moved to Friday/);
    await win.click('#ai-close');
  });

  await step('ChatGPT: its own key, its model list (chat models only), and a quicker model for writing help', async () => {
    await menu('ai-settings');
    await win.waitForSelector('#ai-dlg[open]');
    await win.selectOption('#ai-provider', 'openai');
    assert.equal(await win.textContent('#ai-key-label'), 'OpenAI API key');
    assert.equal(await win.isVisible('#ai-local'), false);
    await win.fill('#ai-key', 'sk not a key at all');
    await win.click('#ai-form button[type=submit]');
    assert.match(await win.textContent('#ai-msg'), /one word, without spaces/);
    await win.fill('#ai-key', 'sk-wrong-key-0123456789');
    await win.click('#ai-models-refresh');
    await win.waitForFunction(() => /ChatGPT didn’t accept the API key/.test(document.getElementById('ai-models-msg').textContent));
    await win.fill('#ai-key', OPENAI_KEY);
    await win.click('#ai-models-refresh');
    await win.waitForFunction(() => /3 models available/.test(document.getElementById('ai-models-msg').textContent));
    assert.deepEqual(await win.$$eval('#ai-model-list option', (o) => o.map((x) => x.value)), ['gpt-big', 'gpt-small', 'llama3.2:3b']);
    await win.fill('#ai-model', 'gpt-big');
    await win.fill('#ai-quick', 'gpt-small');
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    for (let i = 0; i < 40 && !/"provider": ?"openai"/.test(settingsJson()); i++) await new Promise((r) => setTimeout(r, 100));   // written a moment later
    assert.match(settingsJson(), /"provider": ?"openai"/);
    assert.doesNotMatch(settingsJson(), /sk-proj-/, 'the key is never written to settings');

    const res = await win.evaluate(() => window.reader.aiEdit({ id: 'e1', action: 'proofread', text: 'helo world' }));
    assert.equal(res.error, undefined);
    const r = requests.filter((x) => x.url === '/v1/chat/completions').at(-1);
    assert.equal(r.headers.authorization, `Bearer ${OPENAI_KEY}`);
    assert.equal(r.body.model, 'gpt-small', 'writing help uses the quicker model');
    assert.match(r.body.messages[1].content, /Proofread the text/);
    await menu('ai-summarize');
    await win.waitForFunction(() => /Written by ChatGPT/.test(document.getElementById('ai-status').textContent));
    assert.equal(requests.filter((x) => x.url === '/v1/chat/completions').at(-1).body.model, 'gpt-big', 'summaries use the main model');
    await win.click('#ai-close');
  });

  await step('a very large request asks first, with its size; Cancel sends nothing', async () => {
    const before = requests.length;
    const big = 'Lots of words here. '.repeat(11_000);
    const no = await win.evaluate((text) => window.reader.aiRun({ id: 'b1', action: 'summarize', text, title: 'Big' }), big);
    assert.equal(no.error, 'Not sent.');
    assert.equal(requests.length, before, 'nothing was sent');
    const asked = await app.evaluate(() => global.__asked.at(-1));
    assert.match(asked, /^Send this to ChatGPT\?\nAbout 5\d,\d{3} tokens to read\. ChatGPT bills by the token/);
    await app.evaluate(() => { global.__answer = 0; });
    const yes = await win.evaluate((text) => window.reader.aiRun({ id: 'b2', action: 'summarize', text, title: 'Big' }), big);
    assert.equal(yes.error, undefined);
    assert.equal(requests.length, before + 1);
  });

  await step('removing a key turns AI assist off when it was that service’s', async () => {
    await menu('ai-settings');
    await win.waitForSelector('#ai-dlg[open]');
    assert.equal(await win.isVisible('#ai-key-remove'), true);
    await win.click('#ai-key-remove');
    await win.waitForFunction(() => /OpenAI API key removed/.test(document.getElementById('toast').textContent));
    const st = await win.evaluate(() => window.reader.aiStatus());
    assert.equal(st.enabled, false);
    assert.equal(st.providers.find((p) => p.id === 'openai').hasKey, false);
    if (secure) assert.equal(st.providers.find((p) => p.id === 'anthropic').hasKey, true, 'other services keep their keys');
    await win.click('#ai-cancel');
  });

  assert.deepEqual(errors, [], 'no page errors');
  await app.close();
  server.close();
  console.log('ai e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
