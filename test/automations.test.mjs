// Tests for 3.7: webhooks as commands, n8n workflows by name, the address workflows can call, and finding Google Drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanAction, cleanActions, cleanUrl, readAnswer, callWebhook, n8nBase, listWorkflows, describeSend } = require('../src/main/automations.js');
const { Inbound, newKey, networkAddresses } = require('../src/main/inbound.js');
const { detectRoots } = require('../src/main/sync.js');

const reply = (status, body, type = 'application/json') => ({
  ok: status < 400, status,
  headers: { get: () => type },
  text: async () => body,
  json: async () => JSON.parse(body),
});

test('only whole web addresses are kept, with no password written in', () => {
  assert.equal(cleanUrl('https://n8n.example.com/webhook/tidy'), 'https://n8n.example.com/webhook/tidy');
  assert.equal(cleanUrl('http://192.168.1.10:5678/webhook/x'), 'http://192.168.1.10:5678/webhook/x');
  for (const bad of ['', 'not a url', 'ftp://x/y', 'file:///c:/x', 'javascript:alert(1)', 'https://me:secret@n8n.example.com/x']) assert.equal(cleanUrl(bad), '', bad);
});

test('an action needs a name and an address, and anything else falls back', () => {
  assert.equal(cleanAction({ name: '', url: 'https://x.y/z' }), null);
  assert.equal(cleanAction({ name: 'A', url: 'nope' }), null);
  assert.equal(cleanAction(null), null);
  const a = cleanAction({ name: '  Tidy\nnotes ', url: 'https://x.y/z', send: 'everything', result: 'explode', extra: 1 });
  assert.equal(a.name, 'Tidy notes');
  assert.equal(a.send, 'document');
  assert.equal(a.result, 'document');
  assert.equal(a.extra, undefined);
  assert.match(a.id, /^[a-z0-9]{6,24}$/);
  assert.equal(cleanAction({ id: 'abc123', name: 'A', url: 'https://x.y/z', send: 'folder', result: 'none' }).id, 'abc123');
  assert.equal(cleanActions('nonsense').length, 0);
  assert.equal(cleanActions(Array.from({ length: 150 }, (_, i) => ({ name: `A${i}`, url: 'https://x.y/z' }))).length, 100);
});

test('answers are read from plain text and from what n8n sends', () => {
  assert.equal(readAnswer('# Hello\n', 'text/plain'), '# Hello');
  assert.equal(readAnswer(''), '');
  assert.equal(readAnswer('{"text":"Done"}', 'application/json'), 'Done');
  assert.equal(readAnswer('{"markdown":"# A","text":"B"}', 'application/json'), '# A');
  assert.equal(readAnswer('[{"output":"From a list"}]', 'application/json'), 'From a list');
  assert.equal(readAnswer('{"json":{"text":"Nested"}}', 'application/json'), 'Nested');
  assert.equal(readAnswer('"Just a string"', 'application/json'), 'Just a string');
  assert.equal(readAnswer('{"message":"Workflow was started"}', 'application/json'), '', 'n8n has nothing to say yet');
  assert.equal(readAnswer('[]', 'application/json'), '');
  assert.match(readAnswer('{"count":3}', 'application/json'), /```json[\s\S]*"count": 3/);
  assert.equal(readAnswer('{not json', 'application/json'), '{not json');
});

test('a webhook gets the payload, and any saved header, and redirects aren’t followed', async () => {
  let seen;
  const text = await callWebhook({
    fetch: async (url, o) => { seen = { url, ...o }; return reply(200, '{"text":"Done"}'); },
    url: 'https://x.y/hook', payload: { text: 'Doc' }, secret: 'Bearer abc',
  });
  assert.equal(text, 'Done');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.redirect, 'error');
  assert.equal(seen.headers.authorization, 'Bearer abc');
  assert.deepEqual(JSON.parse(seen.body), { text: 'Doc' });
  await callWebhook({ fetch: async (_u, o) => { seen = o; return reply(200, ''); }, url: 'https://x.y/hook', payload: {} });
  assert.equal(seen.headers.authorization, undefined);
});

test('when a webhook can’t help, the message says what to do', async () => {
  const call = (fetchFn) => callWebhook({ fetch: fetchFn, url: 'https://n8n.home/hook', payload: {} });
  await assert.rejects(call(async () => reply(404, '')), /n8n\.home.*active.*production URL/);
  await assert.rejects(call(async () => reply(401, '')), /refused/);
  await assert.rejects(call(async () => reply(500, '')), /problem running that \(error 500\)/);
  await assert.rejects(call(async () => { throw new Error('ECONNREFUSED'); }), /couldn’t be reached/);
  await assert.rejects(call(async () => reply(302, '')), /tried to send this somewhere else/);
});

test('sending can be stopped', async () => {
  const controller = new AbortController();
  const fetchFn = (_u, o) => new Promise((_r, reject) => { o.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const call = callWebhook({ fetch: fetchFn, url: 'https://x.y/z', payload: {}, signal: controller.signal });
  controller.abort();
  await assert.rejects(call, /Stopped/);
});

test('an n8n address is found in whatever was pasted', () => {
  assert.equal(n8nBase('https://n8n.example.com/'), 'https://n8n.example.com');
  assert.equal(n8nBase('http://192.168.1.10:5678/home/workflows'), 'http://192.168.1.10:5678');
  assert.equal(n8nBase('https://n8n.example.com/webhook/tidy'), 'https://n8n.example.com');
  assert.equal(n8nBase('https://n8n.example.com/webhook-test/tidy'), 'https://n8n.example.com');
  assert.equal(n8nBase('https://n8n.example.com/api/v1/workflows'), 'https://n8n.example.com');
  assert.equal(n8nBase('https://example.com/n8n/workflow/12'), 'https://example.com/n8n');
  assert.equal(n8nBase('nope'), '');
});

test('workflows are listed by name: those with a POST webhook, active ones first, page by page', async () => {
  const pages = [
    { data: [
      { name: 'Zebra', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { httpMethod: 'POST', path: 'zebra' } }] },
      { name: 'Only GET', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { path: 'get' } }] },
      { name: 'No webhook', active: true, nodes: [{ type: 'n8n-nodes-base.set' }] },
    ], nextCursor: 'more' },
    { data: [
      { name: 'Asleep', active: false, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { httpMethod: 'POST', path: '/asleep' } }] },
      { name: 'Apple', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { httpMethod: 'POST', path: 'apple' } }, { type: 'n8n-nodes-base.webhook', disabled: true, parameters: { httpMethod: 'POST', path: 'off' } }] },
    ] },
  ];
  const asked = [];
  const list = await listWorkflows({
    fetch: async (url, o) => { asked.push(url); assert.equal(o.headers['X-N8N-API-KEY'], 'k'); return reply(200, JSON.stringify(pages[asked.length - 1])); },
    base: 'http://n8n:5678', key: 'k',
  });
  assert.deepEqual(list.map((w) => [w.name, w.url, w.active]), [
    ['Apple', 'http://n8n:5678/webhook/apple', true], ['Zebra', 'http://n8n:5678/webhook/zebra', true], ['Asleep', 'http://n8n:5678/webhook/asleep', false],
  ]);
  assert.match(asked[1], /cursor=more/);
  await assert.rejects(listWorkflows({ fetch: async () => reply(401, ''), base: 'http://n8n', key: 'bad' }), /refused that API key/);
  await assert.rejects(listWorkflows({ fetch: async () => { throw new Error('x'); }, base: 'http://n8n', key: 'k' }), /couldn’t be reached/);
});

test('what will be sent is described', () => {
  assert.deepEqual(describeSend({ text: 'Hello' }), { count: 1, bytes: 5, sample: 'Hello' });
  assert.equal(describeSend({ selection: 'Hi', text: 'ignored' }).bytes, 2);
  const many = describeSend({ documents: [{ path: 'a.md', text: 'ab' }, { path: 'b/c.md', text: 'cde' }] });
  assert.deepEqual(many, { count: 2, bytes: 5, sample: 'a.md\nb/c.md' });
});

async function server(options = {}) {
  const calls = [];
  const key = newKey();
  const s = new Inbound({
    key: () => key, port: 0,
    actions: {
      create: async (d) => { calls.push(['create', d]); },
      open: async (d) => { calls.push(['open', d]); },
      append: async (d) => { if (d.path === 'no') throw Object.assign(new Error('The change wasn’t allowed.'), { status: 403 }); calls.push(['append', d]); },
    },
    ...options,
  });
  const port = await s.start();
  const ask = (method, path, { body, headers = {}, auth = `Bearer ${key}` } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(auth ? { authorization: auth } : {}), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
  return { s, ask, calls, key, port };
}

test('with the key, workflows can create, open and add to documents', async () => {
  const { s, ask, calls } = await server();
  assert.deepEqual((await ask('GET', '/v1/status')).data, { ok: true, app: 'RT Markdown Reader' });
  assert.equal((await ask('POST', '/v1/documents', { body: { name: 'A', content: '# Hi' } })).status, 200);
  assert.equal((await ask('POST', '/v1/open', { body: { path: 'x.md' } })).status, 200);
  assert.equal((await ask('POST', '/v1/append/', { body: { path: 'x.md', text: 'More' } })).status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'open', 'append']);
  await s.stop();
});

test('without the right key, nothing happens', async () => {
  const { s, ask, calls } = await server();
  for (const auth of ['', 'Bearer wrong', 'wrong', 'Basic abc']) assert.equal((await ask('POST', '/v1/documents', { auth, body: { content: 'x' } })).status, 401, auth);
  assert.equal(calls.length, 0);
  await s.stop();
});

test('an empty key never matches', async () => {
  const { s, ask } = await server({ key: () => '' });
  assert.equal((await ask('GET', '/v1/status', { auth: 'Bearer ' })).status, 401);
  await s.stop();
});

test('web pages are turned away, even with the key', async () => {
  const { s, ask, calls } = await server();
  assert.equal((await ask('POST', '/v1/documents', { headers: { origin: 'https://evil.example' }, body: { content: 'x' } })).status, 403);
  assert.equal((await ask('POST', '/v1/documents', { headers: { host: 'evil.example' }, body: { content: 'x' } })).status, 403, 'a borrowed name for this computer');
  assert.equal(calls.length, 0);
  await s.stop();
});

test('too many wrong keys shuts the door for a while', async () => {
  const { s, ask, key } = await server();
  for (let i = 0; i < 20; i++) await ask('GET', '/v1/status', { auth: 'Bearer wrong' });
  assert.equal((await ask('GET', '/v1/status', { auth: `Bearer ${key}` })).status, 429);
  await s.stop();
});

test('bad requests get plain answers', async () => {
  const { s, ask } = await server();
  assert.equal((await ask('GET', '/nothing')).status, 404);
  assert.equal((await ask('POST', '/v1/documents', { body: '{not json' })).status, 400);
  assert.equal((await ask('POST', '/v1/documents', { body: '[1]' })).status, 400);
  assert.equal((await ask('POST', '/v1/documents', { body: { name: 'no content' } })).status, 400);
  assert.equal((await ask('POST', '/v1/open', { body: {} })).status, 400);
  assert.equal((await ask('POST', '/v1/append', { body: { path: 'x.md' } })).status, 400);
  const refused = await ask('POST', '/v1/append', { body: { path: 'no', text: 'x' } });
  assert.deepEqual([refused.status, refused.data.error], [403, 'The change wasn’t allowed.']);
  assert.equal((await ask('POST', '/v1/documents', { body: JSON.stringify({ content: 'x'.repeat(9 * 1024 * 1024) }) }).catch(() => ({ status: 413 }))).status, 413);
  await s.stop();
});

test('it listens only on this computer unless you allow your network', async () => {
  const { s } = await server();
  assert.equal(s.server.address().address, '127.0.0.1');
  await s.stop();
  const open = await server({ network: true });
  assert.equal(open.s.server.address().address, '0.0.0.0');
  assert.equal((await open.ask('GET', '/v1/status', { headers: { host: '192.168.1.5:41731' } })).status, 200);
  await open.s.stop();
});

test('network addresses leave out this computer’s own', () => {
  assert.deepEqual(networkAddresses({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], eth: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }, { family: 'IPv6', internal: false, address: 'fe80::1' }] }), ['192.168.1.5']);
});

test('your real network address comes before the virtual ones', () => {
  // As on a Windows PC with Hyper-V and WSL: the virtual adapters are listed first.
  const list = {
    'vEthernet (Default Switch)': [{ family: 'IPv4', internal: false, address: '172.25.112.1' }],
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.23.192.1' }],
    Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.10.71' }],
    'Wi-Fi': [{ family: 'IPv4', internal: false, address: '10.0.0.211' }],
  };
  assert.deepEqual(networkAddresses(list), ['192.168.10.71', '10.0.0.211', '172.25.112.1', '172.23.192.1']);
});

const rootsWith = (platform, paths, home = platform === 'win32' ? 'C:\\Users\\me' : '/home/me') => detectRoots({
  env: {}, home, platform, list: () => [], exists: (p) => paths.includes(p),
}).filter((r) => r.id !== 'home').map((r) => r.id);

test('Google Drive is found on any drive letter, and when mirrored', () => {
  assert.deepEqual(rootsWith('win32', ['G:\\My Drive']), ['google-drive']);
  assert.deepEqual(rootsWith('win32', ['K:\\My Drive']), ['google-drive']);
  assert.deepEqual(rootsWith('win32', ['Z:\\My Drive']), ['google-drive']);
  assert.ok(rootsWith('win32', [require('node:path').join('C:\\Users\\me', 'My Drive')]).includes('google-drive'));
  assert.deepEqual(rootsWith('win32', []), []);
});
