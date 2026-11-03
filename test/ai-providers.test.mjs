import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const p = require('../src/main/ai-providers.js');
const { SYSTEM } = require('../src/main/ai.js');

// A fetch stand-in: records each request and answers with what the test gives it.
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return answer(url, init);
  };
  fn.calls = calls;
  return fn;
}
const sse = (events, { split = 7 } = {}) => {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  // Arrives in small pieces, cut anywhere (even inside a character or an event).
  const body = (async function* () { for (let i = 0; i < bytes.length; i += split) yield bytes.slice(i, i + split); })();
  return { ok: true, status: 200, headers: new Map([['content-type', 'text/event-stream; charset=utf-8']]), body };
};
const json = (status, obj) => ({ ok: status < 300, status, headers: new Map([['content-type', 'application/json']]), json: async () => obj, text: async () => JSON.stringify(obj) });

test('AI settings: Claude stays the default, the old single model carries over, bad values are dropped', () => {
  const d = p.cleanAiSettings(null);
  assert.deepEqual(d, { enabled: false, provider: 'anthropic', models: { anthropic: 'claude-opus-5-5' }, quick: {}, localUrl: 'http://localhost:11434/v1' });
  assert.equal(p.cleanAiSettings({ enabled: true, model: 'claude-sonnet-5-5' }).models.anthropic, 'claude-sonnet-5-5', '2.x settings keep their model');
  const s = p.cleanAiSettings({
    enabled: true, provider: 'gemini',
    models: { gemini: 'models/gemini-pro', openai: 'gpt-x', openrouter: 'anthropic/claude-opus-5-5', local: 'llama3.2:3b', anthropic: 'not-a-claude', evil: 'x', mistral: 'bad model\nX: 1' },
    quick: { gemini: 'models/gemini-flash', openai: 42 },
    localUrl: 'http://127.0.0.1:1234/v1/',
  });
  assert.equal(s.provider, 'gemini');
  assert.deepEqual(s.models, { anthropic: 'claude-opus-5-5', gemini: 'models/gemini-pro', openai: 'gpt-x', openrouter: 'anthropic/claude-opus-5-5', local: 'llama3.2:3b' });
  assert.deepEqual(s.quick, { gemini: 'models/gemini-flash' });
  assert.equal(s.localUrl, 'http://127.0.0.1:1234/v1');
  assert.equal(p.cleanAiSettings({ provider: 'skynet' }).provider, 'anthropic');
});

test('local server address: https anywhere, plain http only on this computer or your own network', () => {
  for (const ok of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080', 'http://192.168.1.20:11434/v1', 'http://10.0.0.5/v1', 'http://172.20.0.2/v1', 'http://gpu-box:8000/v1', 'http://nas.local/v1', 'https://llm.example.com/v1']) {
    assert.ok(p.cleanLocalUrl(ok), ok);
  }
  for (const bad of ['http://llm.example.com/v1', 'http://8.8.8.8/v1', 'http://172.32.0.1/v1', 'ftp://localhost/', 'file:///C:/x', 'javascript:alert(1)', 'http://user:pw@localhost/v1', 'http://localhost/v1?x=1', 'not a url', 42]) {
    assert.equal(p.cleanLocalUrl(bad), null, String(bad));
  }
});

test('keys: Anthropic keys are checked by shape, other services just need one word', () => {
  assert.equal(p.keyProblem('anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), '');
  assert.match(p.keyProblem('anthropic', 'sk-abc'), /Anthropic API key/);
  assert.equal(p.keyProblem('openai', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123'), '');
  assert.equal(p.keyProblem('gemini', 'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234'), '');
  assert.match(p.keyProblem('openai', 'sk-abc def ghi jkl mno pqr'), /one word/);
  assert.match(p.keyProblem('openrouter', 'sk-or-v1-abcdefghijklmnop\nX-Evil: 1'), /one word/, 'no line break can reach a header');
});

test('setup: which model a task uses, and what is still missing', () => {
  const conf = p.cleanAiSettings({ enabled: true, provider: 'openai', models: { openai: 'gpt-main' }, quick: { openai: 'gpt-quick' } });
  assert.equal(p.modelFor(conf, 'summarize'), 'gpt-main');
  assert.equal(p.modelFor(conf, 'folder'), 'gpt-main');
  assert.equal(p.modelFor(conf, 'proofread'), 'gpt-quick');
  assert.equal(p.modelFor({ ...conf, quick: {} }, 'translate'), 'gpt-main', 'no quick model: the main one');
  assert.match(p.setupProblem(conf, {}), /Add your OpenAI API key/);
  assert.equal(p.setupProblem(conf, { openai: 'k' }), '');
  assert.match(p.setupProblem({ ...conf, enabled: false }, { openai: 'k' }), /off/);
  const local = p.cleanAiSettings({ enabled: true, provider: 'local' });
  assert.match(p.setupProblem(local, {}), /Choose a model/, 'a local server needs no key, but a model');
  assert.equal(p.setupProblem({ ...local, models: { ...local.models, local: 'llama3' } }, {}), '');
  assert.equal(p.setupProblem(p.cleanAiSettings({ enabled: true }), { anthropic: 'k' }), '', 'Claude has a default model');
});

test('requests go to each service’s own address; a test address never replaces your local server', () => {
  const c = (provider) => p.cleanAiSettings({ provider, localUrl: 'http://localhost:1234/v1' });
  assert.equal(p.baseUrlFor(c('openai')), 'https://api.openai.com/v1');
  assert.equal(p.baseUrlFor(c('gemini')), 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(p.baseUrlFor(c('mistral')), 'https://api.mistral.ai/v1');
  assert.equal(p.baseUrlFor(c('openrouter')), 'https://openrouter.ai/api/v1');
  assert.equal(p.baseUrlFor(c('local')), 'http://localhost:1234/v1');
  assert.equal(p.baseUrlFor(c('openai'), 'http://127.0.0.1:9/'), 'http://127.0.0.1:9/v1');
  assert.equal(p.baseUrlFor(c('anthropic'), 'http://127.0.0.1:9'), 'http://127.0.0.1:9');
  assert.equal(p.baseUrlFor(c('local'), 'http://127.0.0.1:9'), 'http://localhost:1234/v1');
});

test('chat: streams the answer piece by piece, with your key, the same instructions as Claude, and no key for a keyless local server', async () => {
  const fetch = fakeFetch(() => sse([
    { id: '1', model: 'gpt-main-2026', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: '## Sum' } }] },
    ': keep-alive',
    { choices: [{ index: 0, delta: { content: 'mary — café ☕' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  ], { split: 5 }));
  const got = [];
  const res = await p.runChat({ fetch, provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-main', content: 'the doc', onText: (t) => got.push(t) });
  assert.equal(res.text, '## Summary — café ☕');
  assert.equal(got.join(''), res.text);
  assert.equal(res.model, 'gpt-main-2026');
  assert.equal(res.stopReason, 'stop');
  assert.equal(res.note, '');
  const call = fetch.calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.init.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(call.body, { model: 'gpt-main', stream: true, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'the doc' }] });

  const local = fakeFetch(() => sse([{ choices: [{ delta: { content: 'hi' }, finish_reason: 'length' }] }]));
  const r2 = await p.runChat({ fetch: local, provider: 'local', baseURL: 'http://localhost:11434/v1', apiKey: '', model: 'llama3', content: 'x', onText: () => {} });
  assert.equal(local.calls[0].init.headers.authorization, undefined);
  assert.match(r2.note, /cut off/);

  const router = fakeFetch(() => sse([{ choices: [{ delta: { content: 'ok' } }] }]));
  await p.runChat({ fetch: router, provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'a/b', content: 'x', onText: () => {} });
  assert.equal(router.calls[0].init.headers['x-title'], 'Neo Markdown Reader');
});

test('chat: plain answers, refusals and errors in words people understand', async () => {
  const plain = fakeFetch(() => json(200, { model: 'm', choices: [{ message: { content: 'whole answer' }, finish_reason: 'content_filter' }] }));
  const r = await p.runChat({ fetch: plain, provider: 'gemini', baseURL: 'x', apiKey: 'k', model: 'm', content: 'x', onText: () => {} });
  assert.equal(r.text, 'whole answer');
  assert.match(r.note, /Gemini declined/);
  const run = (provider, answer) => p.runChat({ fetch: fakeFetch(answer), provider, baseURL: 'x', apiKey: 'k', model: 'm', content: 'x', onText: () => {} });
  await assert.rejects(run('openai', () => json(401, { error: { message: 'Incorrect API key provided' } })), /ChatGPT didn’t accept the API key/);
  await assert.rejects(run('mistral', () => json(404, { message: 'Invalid model: m' })), /That model isn’t available from Mistral.*Invalid model/);
  await assert.rejects(run('openrouter', () => json(402, { error: { message: 'Insufficient credits' } })), /needs credit/);
  await assert.rejects(run('gemini', () => json(429, {})), /Too many requests/);
  await assert.rejects(run('local', () => { throw new TypeError('fetch failed'); }), /Check that Ollama or LM Studio is running/);
  await assert.rejects(run('openai', () => { throw new TypeError('fetch failed'); }), /Couldn’t reach ChatGPT/);
  await assert.rejects(run('openai', () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }), /^Error: Stopped\.$/);
  await assert.rejects(run('openrouter', () => sse([{ error: { message: 'Provider returned error' } }])), /OpenRouter stopped with an error: Provider returned error/);
});

test('model lists: chat models only, sorted, with OpenRouter’s price per million tokens', async () => {
  const openai = fakeFetch(() => json(200, { data: [{ id: 'gpt-b' }, { id: 'text-embedding-3-large' }, { id: 'whisper-1' }, { id: 'gpt-a' }, { id: 'dall-e-3' }, { id: 'tts-1' }, { id: 'bad id!' }, { id: 'gpt-a' }] }));
  assert.deepEqual(await p.listModels({ fetch: openai, provider: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'k' }), [{ id: 'gpt-a', label: 'gpt-a' }, { id: 'gpt-b', label: 'gpt-b' }]);
  assert.equal(openai.calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(openai.calls[0].init.headers.authorization, 'Bearer k');
  const router = fakeFetch(() => json(200, { data: [{ id: 'anthropic/claude-opus-5-5', name: 'Anthropic: Claude Opus 5.5', pricing: { prompt: '0.000005' } }] }));
  const [m] = await p.listModels({ fetch: router, provider: 'openrouter', baseURL: 'x', apiKey: 'k' });
  assert.equal(m.label, 'Anthropic: Claude Opus 5.5');
  assert.ok(Math.abs(m.price - 5) < 1e-9);
  const ollama = fakeFetch(() => json(200, { object: 'list', data: [{ id: 'llama3.2:3b' }, { id: 'qwen3:8b' }] }));
  assert.deepEqual((await p.listModels({ fetch: ollama, provider: 'local', baseURL: 'http://localhost:11434/v1' })).map((x) => x.id), ['llama3.2:3b', 'qwen3:8b']);
  assert.equal((await p.listModels({ provider: 'anthropic' }))[0].id, 'claude-opus-5-5', 'Claude’s list is built in');
  await assert.rejects(p.listModels({ fetch: fakeFetch(() => json(401, {})), provider: 'gemini', baseURL: 'x', apiKey: 'k' }), /Gemini didn’t accept the API key/);
});

test('size note before a large request: tokens, and a price when the service publishes one', () => {
  assert.equal(p.estimateTokens(400_000), 100_000);
  assert.match(p.sizeNote('openrouter', 100_000, 5), /About 100,000 tokens.*\$0\.50/);
  assert.match(p.sizeNote('openai', 100_000), /About 100,000 tokens.*ChatGPT bills by the token/);
  assert.match(p.sizeNote('local', 100_000), /on your own computer/);
});
