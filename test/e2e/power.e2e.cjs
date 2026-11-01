// End-to-end test for v2.0: colour themes, password-locked documents, running code blocks and the
// optional AI assist. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const locked = require('../../src/main/locked.js');

// A stand-in for the Anthropic Messages API: records each request and streams a canned answer
// in the API's server-sent-events format.
const aiRequests = [];
let aiMode = 'ok';
let aiReply = '## Summary\n\nThe page shows **five** code blocks.';
const aiServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    aiRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
    if (aiMode === 'bad-key') {
      res.writeHead(401, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_test' });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 20, output_tokens: 1 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of aiReply.match(/[\s\S]{1,12}/g)) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null }, usage: { output_tokens: 30 } });
    send('message_stop', {});
    res.end();
  });
});

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-power-'));
const profile = path.join(tmp, 'profile');
const doc = path.join(tmp, 'secret.md');
const lockedPath = path.join(tmp, 'secret.mdlock');
const PASSWORD = 'correct horse battery';
fs.writeFileSync(doc, '# Secret plan\n\nThe launch date is the 14th.\n');
const codeDoc = path.join(tmp, 'code.md');
const fence = '```';
fs.writeFileSync(codeDoc, [
  '# Code', '',
  `${fence}js`, "console.log('hello', 6 * 7);", "console.log('fetch is', typeof fetch, typeof XMLHttpRequest, typeof WebSocket);", "'done'", fence, '',
  `${fence}python`, 'print("py", sum(range(10)))', 'import js', 'print("js.fetch is", getattr(js, "fetch", None))', fence, '',
  `${fence}js`, 'while (true) {}', fence, '',
  `${fence}js`, "throw new TypeError('bad thing')", fence, '',
  `${fence}bash`, 'rm -rf /', fence, '',
].join('\n'));

const step = async (name, fn) => { await fn(); console.log('ok -', name); };
const launch = (files = []) => electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...files],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1', NMR_AI_BASE_URL: `http://127.0.0.1:${aiServer.address().port}` },
});

(async () => {
  await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
  let app = await launch([doc]);
  let win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const stub = (a) => a.evaluate(({ dialog }) => {
    global.__save = null;
    global.__asked = [];
    global.__answer = 0;
    global.__open = null;
    dialog.showMessageBox = async (_w, o) => {
      global.__asked.push(o.message);
      if (o.title === 'Unsaved changes') return { response: 1 };          // Don't Save
      return { response: o.title === 'Run code?' ? global.__answer : 0 };
    };
    dialog.showOpenDialog = async () => (global.__open ? { canceled: false, filePaths: [global.__open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
  });
  await stub(app);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const activeLabel = () => win.$eval('.tab.active .tab-label', (n) => n.textContent);
  const page = '.page:not([hidden])';

  await win.waitForSelector(`${page} #secret-plan`);

  await step('four new colour themes switch the page, with dark ones marked dark', async () => {
    await win.click('#btn-theme');
    for (const [theme, tone] of [['mist', 'light'], ['forest', 'dark'], ['dusk', 'dark'], ['contrast', 'dark'], ['light', 'light']]) {
      await win.click(`#theme-menu [data-key="theme"] [data-value="${theme}"]`);
      await win.waitForFunction(([t, d]) => document.documentElement.dataset.theme === t && document.documentElement.dataset.tone === d, [theme, tone]);
    }
    await win.keyboard.press('Escape');
  });

  await step('Protect with Password saves an encrypted copy and opens it', async () => {
    await menu('lock-protect');
    await win.waitForSelector('#lock-dlg[open]');
    assert.equal(await win.isDisabled('#lock-go'), true);
    await win.fill('#lock-pw', 'short');
    assert.equal(await win.textContent('#lock-meter span'), 'Too short');
    await win.fill('#lock-pw', PASSWORD);
    await win.fill('#lock-pw2', PASSWORD + 'x');
    assert.match(await win.textContent('#lock-msg'), /don’t match/);
    await win.fill('#lock-pw2', PASSWORD);
    await win.click('#lock-go');
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret.mdlock');
    await win.waitForSelector(`${page} #secret-plan`);
    const text = fs.readFileSync(lockedPath, 'utf8');
    assert.doesNotMatch(text, /launch date|Secret/);
    assert.equal((await locked.unlock(text, PASSWORD)).content, '# Secret plan\n\nThe launch date is the 14th.\n');
    assert.ok(fs.existsSync(doc), 'the original stays unless you ask');
    assert.ok(await win.$('.tab.active.locked'));
  });

  await step('Lock Now hides the text; a wrong password is refused, the right one opens it', async () => {
    await menu('lock-now');
    await win.waitForSelector(`${page} .lock-screen`);
    assert.equal(await win.$(`${page} #secret-plan`), null);
    await win.fill(`${page} .lock-input`, 'not the password');
    await win.click(`${page} .lock-form button`);
    await win.waitForSelector(`${page} .lock-error:not([hidden])`);
    assert.match(await win.textContent(`${page} .lock-error`), /isn’t right/);
    await win.fill(`${page} .lock-input`, PASSWORD);
    await win.click(`${page} .lock-form button`);
    await win.waitForSelector(`${page} #secret-plan`);
  });

  await step('highlights are refused in locked documents (they would be stored unencrypted)', async () => {
    await win.evaluate(() => {
      const p = document.querySelector('.page:not([hidden]) p');
      const r = document.createRange(); r.selectNodeContents(p);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await menu('highlight');
    await win.waitForFunction(() => /locked documents/.test(document.getElementById('toast').textContent));
    assert.equal(await win.$('mark.nmr-hl'), null);
  });

  await step('editing and saving a locked document keeps it encrypted', async () => {
    await menu('toggle-edit');
    await win.waitForSelector('.cm-content');
    await win.click('.cm-content');
    await win.keyboard.press('ControlOrMeta+End');
    await win.keyboard.type('\nMoved to the 21st.');
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('dirty'));
    const text = fs.readFileSync(lockedPath, 'utf8');
    assert.doesNotMatch(text, /21st/);
    assert.match((await locked.unlock(text, PASSWORD)).content, /Moved to the 21st\./);
    await menu('toggle-edit');
    await win.waitForSelector('.cm-content', { state: 'detached' });
  });

  await step('Save an Unlocked Copy writes plain Markdown where you choose', async () => {
    const out = path.join(tmp, 'secret-copy.md');
    await app.evaluate((_e, f) => { global.__save = f; }, out);
    await menu('lock-remove');
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret-copy');
    assert.match(fs.readFileSync(out, 'utf8'), /Moved to the 21st\./);
    await menu('close-tab');
  });

  await step('after a restart the locked tab asks for the password again', async () => {
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret.mdlock');
    await new Promise((r) => setTimeout(r, 800));
    await app.close();
    app = await launch();
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(e.message));
    await stub(app);
    await win.waitForSelector('.tab.locked');
    await win.click('.tab.locked');
    await win.waitForSelector(`${page} .lock-screen`);
    assert.equal(await win.$(`${page} #secret-plan`), null);
    const settingsText = fs.readFileSync(path.join(profile, 'settings.json'), 'utf8');
    assert.doesNotMatch(settingsText, /launch date|21st/, 'no document text in settings');
  });

  const block = (n) => `${page} pre.code-block:nth-of-type(${n})`;
  const outputOf = (n) => win.$eval(`${block(n)} + .run-output`, (o) => ({ status: o.querySelector('.run-status').textContent, text: o.querySelector('.run-body').textContent }));

  await step('JavaScript and Python code blocks get a Run button (other languages don’t)', async () => {
    await app.evaluate((_e, f) => { global.__open = f; }, codeDoc);
    await menu('open');
    await win.waitForSelector(`${page} #code`);
    assert.equal(await win.$$eval(`${page} .run-btn`, (b) => b.length), 4);
    assert.equal(await win.$(`${block(5)} .run-btn`), null, 'bash is never runnable');
  });

  await step('Run asks first; Cancel runs nothing', async () => {
    await app.evaluate(() => { global.__answer = 1; global.__asked = []; });
    await win.click(`${block(1)} .run-btn`);
    await win.waitForFunction(() => !document.querySelector('.page:not([hidden]) pre.code-block .run-btn').disabled);
    const asked = await app.evaluate(() => global.__asked);
    assert.match(asked[0], /Run this JavaScript code from “code\.md”\?/);
    assert.equal(await win.$(`${block(1)} + .run-output`), null);
    await app.evaluate(() => { global.__answer = 0; });
  });

  await step('JavaScript runs in the sandbox, with no network functions', async () => {
    await win.click(`${block(1)} .run-btn`);
    await win.waitForSelector(`${block(1)} + .run-output`, { timeout: 30000 });
    const out = await outputOf(1);
    assert.match(out.text, /hello 42/);
    assert.match(out.text, /fetch is undefined undefined undefined/);
    assert.match(out.text, /→ done/);
    assert.match(out.status, /JavaScript · finished in/);
  });

  await step('Python runs too (Pyodide), also without network access', async () => {
    await win.click(`${block(2)} .run-btn`);
    await win.waitForSelector(`${block(2)} + .run-output`, { timeout: 90000 });
    const out = await outputOf(2);
    assert.match(out.text, /py 45/);
    assert.match(out.text, /js\.fetch is None/);
  });

  await step('a program that never ends is stopped; errors are shown', async () => {
    await win.click(`${block(3)} .run-btn`);
    await win.waitForSelector(`${block(3)} + .run-output`, { timeout: 30000 });
    assert.match((await outputOf(3)).status, /Stopped/);
    await win.click(`${block(4)} .run-btn`);
    await win.waitForSelector(`${block(4)} + .run-output`, { timeout: 30000 });
    assert.match((await outputOf(4)).text, /TypeError: bad thing/);
  });

  await step('the sandbox itself can’t reach the web or local files', async () => {
    const results = await app.evaluate(async ({ BrowserWindow }) => {
      const sb = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('nmr-sandbox://'));
      const tryFetch = (u) => sb.webContents.executeJavaScript(`fetch(${JSON.stringify(u)}).then((r) => (r.ok ? 'reached' : 'blocked'), () => 'blocked')`);
      return { web: await tryFetch('https://example.com/'), file: await tryFetch('file:///etc/hosts'), own: await tryFetch('nmr-sandbox://app/sandbox.html'), outside: await tryFetch('nmr-sandbox://app/../../package.json'), encoded: await tryFetch('nmr-sandbox://app/..%2f..%2fpackage.json') };
    });
    assert.deepEqual(results, { web: 'blocked', file: 'blocked', own: 'reached', outside: 'blocked', encoded: 'blocked' });
  });

  await step('Edit → Allow Running Code Blocks off hides the Run buttons', async () => {
    await menu('allow-run');
    await win.waitForFunction(() => document.body.classList.contains('run-off'));
    assert.equal(await win.isVisible(`${block(1)} .run-btn`), false);
    await menu('allow-run');
    await win.waitForFunction(() => !document.body.classList.contains('run-off'));
  });

  const KEY = 'sk-ant-test-0123456789abcdefghijklmn';

  await step('AI assist is off until you turn it on with your own key', async () => {
    await menu('ai-summarize');
    await win.waitForSelector('#ai-dlg[open]');
    assert.match(await win.textContent('#ai-msg'), /Turn on AI assist/);
    assert.equal(aiRequests.length, 0, 'nothing was sent');
    await win.fill('#ai-key', 'not-a-key');
    await win.check('#ai-enabled');
    await win.click('#ai-form button[type=submit]');
    assert.match(await win.textContent('#ai-msg'), /doesn’t look like an Anthropic API key/);
    await win.fill('#ai-key', KEY);
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    const settingsText = fs.readFileSync(path.join(profile, 'settings.json'), 'utf8');
    assert.doesNotMatch(settingsText, /sk-ant-/, 'the key is never written to settings');
  });

  await step('Summarize streams Claude’s answer into the panel (opus-5-5, fallbacks, your key)', async () => {
    await menu('ai-summarize');
    await win.waitForSelector('#ai-panel[open] #ai-body h2');
    await win.waitForFunction(() => /five/.test(document.getElementById('ai-body').textContent) && document.getElementById('ai-stop').hidden);
    assert.equal(await win.textContent('#ai-body h2'), 'Summary');
    assert.equal(await win.isVisible('#ai-open'), false);
    const r = aiRequests.at(-1);
    assert.match(r.url, /^\/v1\/messages(\?|$)/);
    assert.ok(r.headers['x-api-key'] === KEY || r.headers.authorization === `Bearer ${KEY}`, 'your key authenticates the request');
    assert.match(r.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(r.body.model, 'claude-opus-5-5');
    assert.equal(r.body.fallbacks, 'default');
    assert.equal(r.body.stream, true);
    assert.deepEqual(r.body.output_config, { effort: 'medium' });
    assert.equal(r.body.thinking, undefined);
    assert.match(r.body.messages[0].content, /<document title="Code">[\s\S]*console\.log\('hello'/);
    assert.match(r.body.messages[0].content, /Summarize this document/);
    await win.click('#ai-close');
  });

  await step('Turn Notes into a Report opens the draft as a new document', async () => {
    aiReply = '---\ntitle: Code Report\n---\n\n## Executive summary\n\nAll good.\n';
    await menu('ai-report');
    await win.waitForFunction(() => !document.getElementById('ai-open').disabled && !document.getElementById('ai-open').hidden);
    await win.click('#ai-open');
    await win.waitForFunction(() => /code — report/.test(document.querySelector('.tab.active .tab-label')?.textContent || ''));
    await win.waitForSelector('.cm-content');
    assert.match(await win.$eval('.cm-content', (n) => n.textContent), /title: Code Report/);
    await menu('close-tab');                                   // Don't Save
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'code');
  });

  await step('a rejected key gets a plain explanation; locked documents are never sent', async () => {
    aiMode = 'bad-key';
    await menu('ai-summarize');
    await win.waitForFunction(() => /didn’t accept the API key/.test(document.getElementById('ai-status').textContent), null, { timeout: 30000 });
    await win.click('#ai-close');
    aiMode = 'ok';
    const before = aiRequests.length;
    await win.click('.tab.locked');
    await menu('ai-summarize');
    await win.waitForFunction(() => /locked documents/.test(document.getElementById('toast').textContent));
    assert.equal(aiRequests.length, before);
  });

  assert.deepEqual(errors, [], 'no page errors');
  await app.close();
  aiServer.close();
  console.log('power e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
