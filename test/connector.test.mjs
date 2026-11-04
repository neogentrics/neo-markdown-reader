import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const c = require('../src/main/connector.js');
const bridge = require('../src/main/connector-bridge.js');
const cc = require('../src/main/claude-code.js');

const root = path.resolve('/docs');
const inFolder = path.join(root, 'a.md');
const open = path.resolve('/elsewhere/open.md');
const secret = path.join(root, 'secret.mdlock');
const outside = path.resolve('/private/other.md');

function tools(over = {}) {
  return c.createTools({
    places: () => ({ open: [open, secret], folders: [{ root, name: 'docs', files: [inFolder, secret] }] }),
    read: async () => 'Hello brave world\n',
    search: async () => ({ results: [{ path: inFolder }], total: 1, truncated: false }),
    notes: () => [{ id: 'x', quote: 'brave', color: 'yellow', note: 'nice', prefix: 'p', suffix: 's' }],
    suggest: async (o) => ({ outcome: 'accepted', got: o }),
    platform: 'linux',
    ...over,
  });
}

test('connector: lists open and folder documents, never locked ones', async () => {
  const res = await tools()('list_documents', {});
  assert.deepEqual(res.open.map((d) => d.path), [open]);
  assert.deepEqual(res.folders[0].documents, [inFolder]);
  assert.equal(res.folders[0].total, 1);
});

test('connector: reads only what is open or in the open folder', async () => {
  const call = tools();
  assert.equal((await call('read_document', { path: inFolder })).text, 'Hello brave world\n');
  assert.equal((await call('read_document', { path: open })).truncated, false);
  await assert.rejects(call('read_document', { path: outside }), /isn’t open/);
  await assert.rejects(call('read_document', { path: secret }), /never shared/);
  await assert.rejects(call('read_document', { path: path.join(root, 'notes.txt') }), /isn’t open/);
  await assert.rejects(call('read_document', {}), /full path/);
  await assert.rejects(call('constructor', {}), /Unknown tool/);
});

test('connector: highlights keep only what Claude needs', async () => {
  const res = await tools()('get_highlights', { path: inFolder });
  assert.deepEqual(res.highlights, [{ quote: 'brave', color: 'yellow', note: 'nice' }]);
});

test('connector: search needs words and an open folder', async () => {
  assert.equal((await tools()('search_folder', { query: 'hello' })).folders[0].total, 1);
  await assert.rejects(tools()('search_folder', { query: '  ' }), /words/);
  const none = tools({ places: () => ({ open: [], folders: [] }) });
  await assert.rejects(none('search_folder', { query: 'x' }), /No folder/);
});

test('connector: a suggestion is checked before the person sees it', async () => {
  const call = tools();
  const res = await call('suggest_edit', { path: inFolder, old_text: 'brave', new_text: 'bold', note: 'shorter' });
  assert.equal(res.outcome, 'accepted');
  assert.deepEqual(res.got, { path: inFolder, oldText: 'brave', newText: 'bold', note: 'shorter' });
  await assert.rejects(call('suggest_edit', { path: inFolder, old_text: 'missing', new_text: 'x' }), /isn’t in the document/);
  await assert.rejects(call('suggest_edit', { path: inFolder, old_text: 'o', new_text: 'x' }), /more than once/);
  await assert.rejects(call('suggest_edit', { path: inFolder, old_text: 'brave', new_text: 'brave' }), /the same/);
  await assert.rejects(call('suggest_edit', { path: secret, old_text: 'a', new_text: 'b' }), /never shared/);
});

test('connector: an edit replaces exactly once, whatever the line endings or $ signs', () => {
  assert.equal(c.applyEdit('one\r\ntwo\r\n', 'one\ntwo', 'three'), 'three\n');
  assert.equal(c.applyEdit('price', 'price', '$& $1'), '$& $1');
});

test('connector: Claude Desktop settings keep everything else', () => {
  const entry = c.serverEntry({ exe: 'app.exe', bridge: 'bridge.js', dir: 'data' });
  assert.deepEqual(entry, { command: 'app.exe', args: ['bridge.js', '--dir', 'data'], env: { ELECTRON_RUN_AS_NODE: '1' } });
  const merged = JSON.parse(c.mergeDesktopConfig('{"theme":"dark","mcpServers":{"other":{"command":"x"}}}', entry));
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.mcpServers.other, { command: 'x' });
  assert.deepEqual(merged.mcpServers[c.SERVER_NAME], entry);
  assert.ok(JSON.parse(c.mergeDesktopConfig('', entry)).mcpServers[c.SERVER_NAME]);
  assert.throws(() => c.mergeDesktopConfig('{ not json', entry), /left alone/);
  assert.throws(() => c.mergeDesktopConfig('[]', entry), /left alone/);
});

test('connector: finds Claude Desktop’s settings for either Windows install', () => {
  const env = { APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' };
  const found = c.desktopConfigPaths({ env, platform: 'win32', home: 'C:\\U', exists: () => true });
  assert.equal(found.length, 2);
  assert.ok(found[1].includes('Claude_pzs8sxrjxfjjc'));
  assert.deepEqual(c.desktopConfigPaths({ env, platform: 'win32', home: 'C:\\U', exists: () => false }), []);
  assert.deepEqual(c.desktopConfigPaths({ env: { NMR_CLAUDE_DESKTOP_CONFIG: 'x.json' }, home: '' }), ['x.json']);
});

test('connector: the pipe answers only with the token, and is gone when stopped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-conn-'));
  const server = new c.ConnectorServer({ dir, handle: async (m, p) => { if (m === 'bad') throw new c.ToolError('plain words'); if (m === 'bug') throw new Error('secret detail'); return { m, p }; } });
  await server.start();
  const info = JSON.parse(fs.readFileSync(path.join(dir, c.INFO_FILE), 'utf8'));
  const ask = (o) => new Promise((resolve) => {
    const s = net.connect(info.endpoint, () => s.write(`${JSON.stringify(o)}\n`));
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', (d) => { buf += d; });
    s.on('close', () => resolve(buf));
    s.on('error', () => resolve(''));
    setTimeout(() => s.destroy(), 300);
  });
  assert.deepEqual(JSON.parse(await ask({ token: info.token, id: 7, method: 'x', params: { a: 1 } })), { id: 7, result: { m: 'x', p: { a: 1 } } });
  assert.equal(JSON.parse(await ask({ token: info.token, id: 8, method: 'bad' })).error, 'plain words');
  assert.ok(!(await ask({ token: info.token, id: 9, method: 'bug' })).includes('secret detail'));
  assert.equal(await ask({ token: 'wrong', id: 1, method: 'x' }), '');
  await server.stop();
  assert.equal(fs.existsSync(path.join(dir, c.INFO_FILE)), false);
  assert.equal(await ask({ token: info.token, id: 1, method: 'x' }), '');
});

test('bridge: answers MCP messages and reports tool problems as tool errors', async () => {
  const ask = async (name) => { if (name === 'list_documents') return { open: [] }; throw new Error('Open the app'); };
  const init = await bridge.respond({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ask);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  const old = await bridge.respond({ id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, ask);
  assert.ok(bridge.PROTOCOLS.includes(old.result.protocolVersion));
  assert.equal(await bridge.respond({ method: 'notifications/initialized' }, ask), null);
  assert.deepEqual((await bridge.respond({ id: 3, method: 'ping' }, ask)).result, {});
  const names = (await bridge.respond({ id: 4, method: 'tools/list' }, ask)).result.tools.map((t) => t.name);
  assert.deepEqual(names, ['list_documents', 'read_document', 'search_folder', 'get_highlights', 'suggest_edit']);
  const good = await bridge.respond({ id: 5, method: 'tools/call', params: { name: 'list_documents' } }, ask);
  assert.deepEqual(JSON.parse(good.result.content[0].text), { open: [] });
  const bad = await bridge.respond({ id: 6, method: 'tools/call', params: { name: 'read_document' } }, ask);
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.content[0].text, 'Open the app');
  assert.equal((await bridge.respond({ id: 7, method: 'nope' }, ask)).error.code, -32601);
});

// A stand-in for child_process.spawn: replays lines of Claude Code's output.
function fakeSpawn(lines, { code = 0, stderr = '', fail = false } = {}) {
  const calls = [];
  const fn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; child.stdout.end(); setImmediate(() => child.emit('close', null)); };
    let input = '';
    child.stdin.on('data', (d) => { input += d; });
    calls.push({ bin, args, opts, input: () => input });
    setImmediate(() => {
      if (fail) { child.emit('error', new Error('ENOENT')); return; }
      child.stderr.end(stderr);
      if (lines === null) return;                     // keeps running until stopped
      child.stdout.end(lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
      child.stdout.on('end', () => setImmediate(() => child.emit('close', code)));
      child.stdout.resume();
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });

test('Claude Code: streams the answer, with every tool off and the document on stdin', async () => {
  const spawn = fakeSpawn([{ type: 'system', subtype: 'init', model: 'claude-x', tools: [] }, delta('Hel'), delta('lo'), { type: 'result', is_error: false, result: 'Hello', stop_reason: 'end_turn' }]);
  const seen = [];
  const res = await cc.runClaudeCode({ spawn, bin: 'claude', model: 'sonnet', content: 'the document', onText: (t) => seen.push(t) });
  assert.deepEqual(seen, ['Hel', 'lo']);
  assert.equal(res.text, 'Hello');
  assert.equal(res.model, 'claude-x');
  const { args, input, opts } = spawn.calls[0];
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.ok(!args.join(' ').includes('the document'));
  assert.ok(input().endsWith('the document'));
  assert.equal(opts.cwd, os.tmpdir());
  assert.equal(opts.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('Claude Code: uses the final text if nothing was streamed; a cut-off answer says so', async () => {
  const res = await cc.runClaudeCode({ spawn: fakeSpawn([{ type: 'result', is_error: false, result: 'All at once', stop_reason: 'max_tokens' }]), bin: 'claude', model: 'haiku', content: 'x', onText: () => {} });
  assert.equal(res.text, 'All at once');
  assert.match(res.note, /cut off/);
});

test('Claude Code: problems come back in plain words', async () => {
  const run = (spawn, bin = 'claude') => cc.runClaudeCode({ spawn, bin, model: 'sonnet', content: 'x', onText: () => {} });
  await assert.rejects(run(fakeSpawn([{ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }])), { message: cc.NOT_SIGNED_IN });
  await assert.rejects(run(fakeSpawn([{ type: 'result', is_error: true, result: 'Usage limit reached' }])), /Usage limit reached/);
  await assert.rejects(run(fakeSpawn([], { code: 1, stderr: 'boom' })), /boom/);
  await assert.rejects(run(fakeSpawn([], { fail: true })), { message: cc.NOT_INSTALLED });
  await assert.rejects(run(fakeSpawn([]), null), { message: cc.NOT_INSTALLED });
});

test('Claude Code: Stop ends the run', async () => {
  const ctl = new AbortController();
  const spawn = fakeSpawn(null);
  const run = cc.runClaudeCode({ spawn, bin: 'claude', model: 'sonnet', content: 'x', onText: () => {}, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 20);
  await assert.rejects(run, /Stopped/);
});

test('Claude Code: found where its installers put it, even off the PATH', () => {
  const has = (want) => (p) => p.replace(/\\/g, '/') === want;
  assert.equal(cc.findClaude({ env: {}, platform: 'linux', home: '/h', exists: has('/h/.local/bin/claude') }), '/h/.local/bin/claude');
  assert.equal(cc.findClaude({ env: { APPDATA: 'C:\\R' }, platform: 'win32', home: 'C:\\U', exists: has('C:/R/npm/claude.cmd') }), 'C:\\R\\npm\\claude.cmd');
  assert.equal(cc.findClaude({ env: { PATH: '/x:/y' }, platform: 'darwin', home: '/h', exists: has('/y/claude') }), '/y/claude');
  assert.equal(cc.findClaude({ env: {}, platform: 'linux', home: '/h', exists: () => false }), null);
});

test('Claude Code: a .cmd goes through the shell with quoted arguments; an .exe doesn’t', () => {
  const spawn = (bin, args, opts) => ({ bin, args, opts });
  const cmd = cc.launch(spawn, 'C:\\a b\\claude.cmd', ['mcp', 'x y']);
  assert.equal(cmd.bin, '"C:\\a b\\claude.cmd"');
  assert.deepEqual(cmd.args, ['"mcp"', '"x y"']);
  assert.equal(cmd.opts.shell, true);
  const exe = cc.launch(spawn, 'C:\\a b\\claude.exe', ['mcp', 'x y']);
  assert.deepEqual(exe.args, ['mcp', 'x y']);
  assert.equal(exe.opts.shell, undefined);
});

test('Claude Code: the terminal opens in the folder, and the folder never reaches a shell on Windows', () => {
  const calls = [];
  const spawn = (bin, args, opts) => { calls.push({ bin, args, opts }); const e = new EventEmitter(); e.unref = () => {}; return e; };
  cc.openTerminal({ spawn, bin: 'C:\\c\\claude.exe', dir: 'C:\\my docs & more', platform: 'win32' });
  assert.equal(calls[0].opts.cwd, 'C:\\my docs & more');
  assert.ok(!calls[0].args.join(' ').includes('my docs'));
  cc.openTerminal({ spawn, bin: '/c/claude', dir: "/it's here", platform: 'darwin' });
  assert.ok(calls[1].args[1].includes(`'/it'\\\\''s here'`));
});
