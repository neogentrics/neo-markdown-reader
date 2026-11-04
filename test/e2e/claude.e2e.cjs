// End-to-end test for v3.4: the tutorial, the Claude connector through the real bridge program, and AI
// assist through Claude Code. A small stand-in plays Claude Code; Claude Desktop's settings are a file
// in the test's folder. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-claude-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const note = path.join(docs, 'note.md');
const other = path.join(tmp, 'other.md');
const locked = path.join(docs, 'secret.mdlock');
fs.writeFileSync(note, '# Note\n\nThe quick brown fox.\n');
fs.writeFileSync(other, '# Not shared\n');
fs.writeFileSync(locked, 'locked');

// The stand-in for Claude Code: answers as it would, and records how it was called.
const calls = path.join(tmp, 'claude-calls.txt');
const fake = path.join(tmp, 'fake-claude.js');
fs.writeFileSync(fake, `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'mcp') process.exit(0);
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const say = (o) => console.log(JSON.stringify(o));
  say({ type: 'system', subtype: 'init', model: 'claude-test', tools: [] });
  say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A summary ' } } });
  say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'from Claude Code.' } } });
  say({ type: 'result', is_error: false, result: 'A summary from Claude Code.', stop_reason: 'end_turn' });
});`);
const bin = path.join(tmp, process.platform === 'win32' ? 'claude.cmd' : 'claude');
fs.writeFileSync(bin, process.platform === 'win32' ? `@echo off\r\nnode "${fake}" %*\r\n` : `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 });

const desktopConfig = path.join(tmp, 'claude_desktop_config.json');
fs.writeFileSync(desktopConfig, JSON.stringify({ mcpServers: { other: { command: 'x' } }, keep: true }));

const step = async (name, fn) => { await fn(); console.log('ok -', name); };
const launch = (extra = {}) => electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: [root, note, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_CLAUDE_BIN: bin, NMR_CLAUDE_DESKTOP_CONFIG: desktopConfig, ...extra },
});

async function stubDialogs(app) {
  await app.evaluate(({ dialog }) => {
    global.__answers = [];
    dialog.showMessageBox = async (_w, o) => ({ response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) });
  });
}

/** Claude's side of the connection: the real bridge, started the way the settings file says to. */
function startBridge(entry) {
  const child = spawn(require(path.join(root, 'node_modules/electron')), entry.args, { env: { ...process.env, ...entry.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    for (let at = buf.indexOf('\n'); at >= 0; at = buf.indexOf('\n')) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}) => {
    const { result } = await rpc('tools/call', { name, arguments: args });
    return { error: !!result.isError, text: result.content[0].text };
  };
  return { rpc, tool, stop: () => child.kill() };
}

(async () => {
  let app = await launch();
  let win = await app.firstWindow();
  await stubDialogs(app);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const settingsFile = path.join(profile, 'settings.json');
  const saved = async () => {
    for (let i = 0; i < 40; i++) {
      try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('no settings file');
  };
  const savedStep = async (want) => {
    for (let i = 0; i < 40; i++) { if ((await saved()).tutorialStep === want) return; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal((await saved()).tutorialStep, want);
  };

  await step('the tutorial is offered the first time, on a practice copy; steps move on when you do them', async () => {
    await win.waitForSelector('#tour-welcome[open]');
    await win.click('#tour-start');
    await win.waitForSelector('#tour-card:not([hidden])');
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'Practice');
    assert.equal(await win.textContent('#tour-title'), 'Your practice document');
    assert.equal(await win.textContent('#tour-count'), 'Step 1 of 17');
    await win.click('#tour-next');
    assert.equal(await win.textContent('#tour-title'), 'The outline');
    await win.click('#btn-toc');
    await win.waitForFunction(() => document.getElementById('tour-title').textContent === 'Themes');
    assert.equal(await win.isVisible('#tour-ring'), true);
    await win.click('#tour-back');
    assert.equal(await win.textContent('#tour-title'), 'The outline');
    await win.click('#tour-next');
    await savedStep(2);
  });

  await step('stopping keeps your place; the next start offers to pick up there', async () => {
    await win.click('#tour-later');
    assert.equal(await win.isVisible('#tour-card'), false);
    await app.close();
    app = await launch();
    win = await app.firstWindow();
    await stubDialogs(app);
    await win.waitForSelector('#tour-welcome[open]');
    assert.equal(await win.textContent('#tour-start'), 'Pick up where I left off');
    await win.click('#tour-not-now');
  });

  await step('editing steps wait for the real thing: Edit, typing and saving, then back to reading', async () => {
    await app.close();
    fs.writeFileSync(settingsFile, JSON.stringify({ ...(await saved()), tutorialStep: 6 }));
    app = await launch();
    win = await app.firstWindow();
    await stubDialogs(app);
    await win.waitForSelector('#tour-welcome[open]');
    await win.click('#tour-start');
    await win.waitForFunction(() => document.getElementById('tour-title').textContent === 'Editing');
    await app.evaluate(() => { global.__answers.push(0); });  // Just This Time
    await win.click('#btn-edit');
    await win.waitForFunction(() => document.getElementById('tour-title').textContent === 'Write and save');
    await win.click('.editor-host:not([hidden]) .cm-content');
    await win.keyboard.type('Practice words. ');
    await menu('save');
    await win.waitForFunction(() => document.getElementById('tour-title').textContent === 'Back to reading');
    assert.match(fs.readFileSync(path.join(profile, 'tutorial', 'Practice.md'), 'utf8'), /Practice words\./);
    await win.click('#btn-edit');
    await win.waitForFunction(() => document.getElementById('tour-title').textContent === 'Go anywhere');
  });

  await step('AI is read about, not tried; finishing means it isn’t offered again, and Help replays it', async () => {
    for (let i = 0; i < 6; i++) await win.click('#tour-next');
    assert.equal(await win.textContent('#tour-title'), 'AI assist');
    await win.click('#tour-guide');
    await win.waitForSelector('#help-dlg[open]');
    await win.waitForFunction(() => document.querySelector('#help-article img')?.naturalWidth > 0);
    await win.click('#help-close');
    await win.click('#tour-next');
    assert.equal(await win.textContent('#tour-next'), 'Finish');
    await win.click('#tour-next');
    assert.equal(await win.isVisible('#tour-card'), false);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal((await saved()).tutorial, 'done');
    await app.close();
    app = await launch();
    win = await app.firstWindow();
    await stubDialogs(app);
    await win.waitForSelector('.tab.active');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await win.$('#tour-welcome[open]'), null);
    await menu('tutorial');
    await win.waitForSelector('#tour-card:not([hidden])');
    await win.click('#tour-later');
  });

  await win.evaluate(() => { window.__toasts = []; const t = document.querySelector('.toast'); if (t) new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });

  let entry;
  await step('the connector is off until it’s turned on, and adds itself to Claude Desktop without losing anything', async () => {
    assert.equal(fs.existsSync(path.join(profile, 'connector.json')), false);
    await menu('connect-claude');
    await win.waitForSelector('#claude-dlg[open]');
    assert.equal(await win.isChecked('#claude-on'), false);
    await win.check('#claude-on');
    await win.waitForFunction(() => /Connector on/.test(document.getElementById('claude-msg').textContent));
    assert.equal(fs.existsSync(path.join(profile, 'connector.json')), true);
    await win.click('#claude-add-desktop');
    await win.waitForFunction(() => /Quit and reopen Claude Desktop/.test(document.getElementById('claude-msg').textContent));
    const conf = JSON.parse(fs.readFileSync(desktopConfig, 'utf8'));
    assert.equal(conf.keep, true);
    assert.deepEqual(conf.mcpServers.other, { command: 'x' });
    entry = Object.entries(conf.mcpServers).find(([k]) => k !== 'other')[1];
    assert.equal(entry.env.ELECTRON_RUN_AS_NODE, '1');
    assert.ok(fs.existsSync(`${desktopConfig}.bak`));
  });

  await step('it adds itself to Claude Code too', async () => {
    await win.click('#claude-add-code');
    await win.waitForFunction(() => /Added to Claude Code/.test(document.getElementById('claude-msg').textContent));
    const log = fs.readFileSync(calls, 'utf8');
    assert.match(log, /mcp remove --scope user/);
    assert.match(log, /mcp add --scope user rt-markdown-reader -e ELECTRON_RUN_AS_NODE=1 -- /);
    await win.click('#claude-done');
  });

  const claude = startBridge(entry);
  await step('Claude reads what’s open, and nothing else', async () => {
    const init = await claude.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.capabilities.tools !== undefined, true);
    const list = JSON.parse((await claude.tool('list_documents')).text);
    assert.ok(list.open.some((d) => d.path === note));
    const read = await claude.tool('read_document', { path: note });
    assert.match(JSON.parse(read.text).text, /quick brown fox/);
    const outside = await claude.tool('read_document', { path: other });
    assert.equal(outside.error, true);
    assert.match(outside.text, /isn’t open/);
    const lockedDoc = await claude.tool('read_document', { path: locked });
    assert.equal(lockedDoc.error, true);
    assert.match(lockedDoc.text, /never shared/);
  });

  await step('a suggested change waits for the person: rejected, nothing changes', async () => {
    const answer = claude.tool('suggest_edit', { path: note, old_text: 'quick brown', new_text: 'slow red', note: 'A calmer fox' });
    await win.waitForSelector('#claude-suggest-dlg[open]');
    assert.equal(await win.textContent('#claude-suggest-note'), 'A calmer fox');
    assert.equal(await win.textContent('#claude-suggest-file'), 'note.md');
    assert.ok((await win.textContent('#claude-suggest-diff ins')).includes('slow'));
    await win.click('#claude-suggest-reject');
    assert.equal(JSON.parse((await answer).text).outcome, 'rejected');
    assert.match(fs.readFileSync(note, 'utf8'), /quick brown fox/);
  });

  await step('accepted, it asks for edit permission like any edit, then saves with a backup', async () => {
    const answer = claude.tool('suggest_edit', { path: note, old_text: 'quick brown', new_text: 'slow red' });
    await win.waitForSelector('#claude-suggest-dlg[open]');
    assert.equal(await win.isVisible('#claude-suggest-note'), false);
    await app.evaluate(() => { global.__answers.push(0); }); // Just This Time
    await win.click('#claude-suggest-accept');
    assert.equal(JSON.parse((await answer).text).outcome, 'accepted');
    assert.match(fs.readFileSync(note, 'utf8'), /slow red fox/);
    assert.ok(fs.readdirSync(path.join(profile, 'backups')).length > 0);
  });

  await step('turned off, Claude is told so and can’t reach anything', async () => {
    await menu('connect-claude');
    await win.waitForSelector('#claude-dlg[open]');
    await win.uncheck('#claude-on');
    await win.waitForFunction(() => /Connector off/.test(document.getElementById('claude-msg').textContent));
    await win.click('#claude-done');
    const res = await claude.tool('list_documents');
    assert.equal(res.error, true);
    assert.match(res.text, /isn’t reachable/);
    assert.equal(fs.existsSync(path.join(profile, 'connector.json')), false);
    claude.stop();
  });

  await step('AI assist works through a Claude Code sign-in, with no key and no tools', async () => {
    await menu('ai-settings');
    await win.waitForSelector('#ai-dlg[open]');
    await win.check('#ai-enabled');
    await win.selectOption('#ai-provider', 'claudecode');
    assert.equal(await win.isVisible('#ai-key'), false);
    assert.equal(await win.inputValue('#ai-model'), '');
    await win.fill('#ai-model', 'haiku');
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    await menu('ai-summarize');
    await win.waitForFunction(() => /A summary from Claude Code\./.test(document.getElementById('ai-body')?.textContent || ''));
    const log = fs.readFileSync(calls, 'utf8').trim().split('\n').pop();
    assert.match(log, /^-p /);
    assert.match(log, /--model haiku/);
    assert.match(log, /--strict-mcp-config/);
  });

  await app.close();
  console.log('claude e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
