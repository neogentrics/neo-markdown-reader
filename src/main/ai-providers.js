'use strict';
// AI services for AI assist (3.3): Claude, ChatGPT, Gemini, Mistral, OpenRouter, or a model running on
// this computer (Ollama, LM Studio, or any OpenAI-compatible server).
//
// Claude goes through Anthropic's SDK (src/main/ai.js). Every other service accepts the same "chat
// completions" request as OpenAI, so one small streaming client here talks to all of them. Model lists
// come from each service's own /models list, so new models appear without an app update.
// Everything here is pure apart from the fetch it's given (unit-tested with a fake).

const { SYSTEM, MODELS, DEFAULT_MODEL, KEY_RE } = require('./ai');
const claudeCode = require('./claude-code');

const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', name: 'Claude', kind: 'anthropic', keyName: 'Anthropic API key', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', baseURL: 'https://api.anthropic.com' },
  claudecode: { label: 'Claude Code (your sign-in, no key)', name: 'Claude Code', kind: 'cli', keyName: '', keyHint: '', keyUrl: '', baseURL: '', keyOptional: true, noKey: true },
  openai: { label: 'ChatGPT (OpenAI)', name: 'ChatGPT', kind: 'openai', keyName: 'OpenAI API key', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', baseURL: 'https://api.openai.com/v1' },
  gemini: { label: 'Gemini (Google)', name: 'Gemini', kind: 'openai', keyName: 'Gemini API key', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  mistral: { label: 'Mistral', name: 'Mistral', kind: 'openai', keyName: 'Mistral API key', keyHint: '', keyUrl: 'https://console.mistral.ai/api-keys', baseURL: 'https://api.mistral.ai/v1' },
  openrouter: { label: 'OpenRouter (hundreds of models, one key)', name: 'OpenRouter', kind: 'openai', keyName: 'OpenRouter API key', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys', baseURL: 'https://openrouter.ai/api/v1' },
  local: { label: 'On this computer (Ollama, LM Studio…)', name: 'your local model', kind: 'openai', keyName: 'API key (if your server needs one)', keyHint: '', keyUrl: '', baseURL: '', keyOptional: true },
};
const PROVIDER_IDS = Object.keys(PROVIDERS);
const DEFAULT_LOCAL_URL = 'http://localhost:11434/v1';         // Ollama; LM Studio is http://localhost:1234/v1
// Other services' keys have no fixed shape, so they're only checked for being one printable word
// (which also keeps them from smuggling a line break into a request header).
const ANY_KEY_RE = /^[\x21-\x7e]{16,400}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
// Writing help in the editor can use a quicker model than summaries and reports.
const QUICK_TASKS = new Set(['proofread', 'rewrite', 'shorten', 'translate']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Check an API key for a service; returns an error message, or '' when it's usable. */
function keyProblem(provider, key) {
  if (provider === 'anthropic') return KEY_RE.test(key) ? '' : 'That doesn’t look like an Anthropic API key (they start with sk-ant-).';
  return ANY_KEY_RE.test(key) ? '' : 'That doesn’t look like an API key: it should be one word, without spaces.';
}

/**
 * The address of a server on this computer or on your own network. https may point anywhere; plain
 * http only to this computer or a private network address, so documents never cross the internet
 * unencrypted. Returns the cleaned address without a trailing slash, or null.
 */
function cleanLocalUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.protocol === 'http:') {
    const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const local = h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h)
      || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
      || /^f[cd][0-9a-f]{2}:/.test(h) || h.endsWith('.local') || h.endsWith('.lan') || !h.includes('.');
    if (!local) return null;
  } else if (u.protocol !== 'https:') return null;
  return u.toString().replace(/\/+$/, '');
}

/** Settings for AI assist, cleaned: anything unknown or malformed falls back to the defaults. */
function cleanAiSettings(a) {
  const out = { enabled: false, provider: 'anthropic', models: { anthropic: DEFAULT_MODEL }, quick: {}, localUrl: DEFAULT_LOCAL_URL };
  if (!isObj(a)) return out;
  if (typeof a.enabled === 'boolean') out.enabled = a.enabled;
  if (PROVIDER_IDS.includes(a.provider)) out.provider = a.provider;
  // Before 3.3 there was only Claude, and its model was kept as `model`.
  if (MODELS.some((m) => m.id === a.model)) out.models.anthropic = a.model;
  for (const [key, into] of [['models', out.models], ['quick', out.quick]]) {
    if (!isObj(a[key])) continue;
    for (const id of PROVIDER_IDS) {
      const m = a[key][id];
      if (typeof m !== 'string' || !MODEL_ID_RE.test(m)) continue;
      if (id === 'anthropic' && !MODELS.some((x) => x.id === m)) continue;
      into[id] = m;
    }
  }
  const url = cleanLocalUrl(a.localUrl);
  if (url) out.localUrl = url;
  return out;
}

/** The model for a task: writing help uses the quick model when one is chosen. */
function modelFor(conf, task) {
  const main = conf.models?.[conf.provider] || (conf.provider === 'anthropic' ? DEFAULT_MODEL : conf.provider === 'claudecode' ? claudeCode.DEFAULT_MODEL : '');
  const quick = conf.quick?.[conf.provider];
  return QUICK_TASKS.has(task) && quick ? quick : main;
}

/** Why AI assist can't run yet with these settings and keys ('' when it can). */
function setupProblem(conf, keys) {
  const p = PROVIDERS[conf.provider];
  if (!conf.enabled) return 'AI assist is off.';
  if (!p.keyOptional && !keys[conf.provider]) return `Add your ${p.keyName} to use ${p.name}.`;
  if (!modelFor(conf, 'summarize')) return 'Choose a model in AI assist settings.';
  return '';
}

/** The address requests go to (tests may point every service at a local stand-in). */
function baseUrlFor(conf, override) {
  if (override && conf.provider !== 'local') return override.replace(/\/+$/, '') + (PROVIDERS[conf.provider].kind === 'openai' ? '/v1' : '');
  return conf.provider === 'local' ? conf.localUrl : PROVIDERS[conf.provider].baseURL;
}

function headersFor(provider, apiKey) {
  const h = { 'content-type': 'application/json', accept: 'text/event-stream, application/json' };
  if (apiKey) h.authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') { h['http-referer'] = 'https://github.com/neogentrics/rt-markdown-reader'; h['x-title'] = 'RT Markdown Reader'; }
  return h;
}

class AiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** A plain-language message for a failed request to an OpenAI-style service. */
function httpProblem(provider, status, detail) {
  const p = PROVIDERS[provider];
  const where = p.name === 'your local model' ? 'Your local server' : p.name;
  const d = detail ? `: ${String(detail).slice(0, 300)}` : '';
  if (status === 401 || (status === 403 && provider !== 'local')) return `${where} didn’t accept the API key. Check it under Edit → AI Assist → Settings.`;
  if (status === 404) return `That model isn’t available from ${where}. Pick another model in AI assist settings${d}.`;
  if (status === 402) return `${where} says the account needs credit${d}.`;
  if (status === 429) return 'Too many requests right now — try again in a minute.';
  if (status === 400 || status === 422) return `${where} couldn’t process the request${d}`;
  return `${where} returned an error (${status})${d}`;
}

async function failure(provider, res) {
  let detail = '';
  try {
    const body = await res.text();
    try { const j = JSON.parse(body); detail = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || j?.detail || ''; } catch { detail = body.trim().slice(0, 200); }
    if (Array.isArray(detail)) detail = detail[0]?.message || '';
  } catch { /* no body */ }
  return new AiError(httpProblem(provider, res.status, typeof detail === 'string' ? detail : ''), res.status);
}

function unreachable(provider, err) {
  if (err?.name === 'AbortError') return new AiError('Stopped.');
  if (provider === 'local') return new AiError('Couldn’t reach your local server. Check that Ollama or LM Studio is running, and the server address in AI assist settings.');
  return new AiError(`Couldn’t reach ${PROVIDERS[provider].name}. Check your internet connection.`);
}

/** Read a server-sent-events body, calling onEvent with each `data:` payload. */
async function readEvents(body, onEvent) {
  const decoder = new TextDecoder();
  let buf = '';
  const handle = (block) => {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (data) onEvent(data);
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
    }
  }
  buf += decoder.decode();
  if (buf.trim()) handle(buf);
}

/**
 * Run one request on an OpenAI-style service, streaming text through onText.
 * Resolves to { text, stopReason, model, note }, like runAi for Claude.
 */
async function runChat({ fetch, provider, baseURL, apiKey, model, content, onText, signal }) {
  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: headersFor(provider, apiKey),
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
      signal,
    });
  } catch (err) { throw unreachable(provider, err); }
  if (!res.ok) throw await failure(provider, res);
  let text = '';
  let stopReason = null;
  let usedModel = model;
  let streamError = '';
  const take = (j) => {
    if (j?.error) { streamError = j.error.message || String(j.error); return; }
    if (j?.model) usedModel = j.model;
    for (const c of j?.choices || []) {
      const piece = c.delta?.content ?? c.message?.content;
      if (typeof piece === 'string' && piece) { text += piece; onText(piece); }
      if (c.finish_reason) stopReason = c.finish_reason;
    }
  };
  try {
    if (/event-stream/.test(res.headers.get('content-type') || '')) {
      await readEvents(res.body, (data) => {
        if (data.trim() === '[DONE]') return;
        try { take(JSON.parse(data)); } catch { /* a comment or keep-alive */ }
      });
    } else {
      take(await res.json());                       // a server that ignored stream: true
    }
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw new AiError('Stopped.');
    throw err instanceof AiError ? err : unreachable(provider, err);
  }
  if (streamError) throw new AiError(`${PROVIDERS[provider].name === 'your local model' ? 'Your local server' : PROVIDERS[provider].name} stopped with an error: ${streamError.slice(0, 300)}`);
  let note = '';
  if (stopReason === 'length') note = 'The answer was cut off because it reached the length limit.';
  else if (stopReason === 'content_filter') note = `${PROVIDERS[provider].name} declined to answer this request.`;
  return { text, stopReason, model: usedModel, note };
}

// OpenAI's list includes models for pictures, speech and search that can't answer a chat request.
const NOT_CHAT = /(embed|whisper|tts|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|speech|search|computer-use|sora|codex-mini|^ft:)/i;

/**
 * The models a service offers, for the model list in settings: [{ id, label, price? }].
 * price is US dollars per million input tokens, when the service says (OpenRouter does).
 */
async function listModels({ fetch, provider, baseURL, apiKey, signal }) {
  if (provider === 'anthropic') return MODELS.map(({ id, label }) => ({ id, label }));
  if (provider === 'claudecode') return claudeCode.MODELS;
  let res;
  try { res = await fetch(`${baseURL}/models`, { headers: headersFor(provider, apiKey), signal }); } catch (err) { throw unreachable(provider, err); }
  if (!res.ok) throw await failure(provider, res);
  let j;
  try { j = await res.json(); } catch { throw new AiError(`${PROVIDERS[provider].name} sent a model list this app couldn’t read.`); }
  const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const id = typeof r === 'string' ? r : r?.id || r?.name;
    if (typeof id !== 'string' || !MODEL_ID_RE.test(id) || seen.has(id)) continue;
    if (provider === 'openai' && NOT_CHAT.test(id)) continue;
    if (provider === 'mistral' && (/embed|moderation|ocr/i.test(id) || r?.capabilities?.completion_chat === false)) continue;
    if (provider === 'gemini' && /embed|aqa|imagen|veo|tts/i.test(id)) continue;
    seen.add(id);
    const m = { id, label: (typeof r?.name === 'string' && r.name !== id ? r.name : id).slice(0, 120) };
    const per = Number(r?.pricing?.prompt);
    if (Number.isFinite(per) && per >= 0) m.price = per * 1e6;
    out.push(m);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** A rough token count for text (about four characters a token in English). */
const estimateTokens = (chars) => Math.ceil(Math.max(0, chars) / 4);

/** A short line for the confirmation shown before a large request. price: $ per million input tokens. */
function sizeNote(provider, tokens, price) {
  const n = tokens.toLocaleString('en-US');
  if (provider === 'local') return `About ${n} tokens, read by the model on your own computer.`;
  if (typeof price === 'number') {
    const cost = (tokens / 1e6) * price;
    return `About ${n} tokens to read — roughly $${cost < 0.01 ? '0.01' : cost.toFixed(2)} for the input, plus the answer.`;
  }
  return `About ${n} tokens to read. ${PROVIDERS[provider].name} bills by the token: check its price list for this model.`;
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, DEFAULT_LOCAL_URL, ANY_KEY_RE, MODEL_ID_RE, QUICK_TASKS, AiError,
  keyProblem, cleanLocalUrl, cleanAiSettings, modelFor, setupProblem, baseUrlFor, headersFor, httpProblem,
  readEvents, runChat, listModels, estimateTokens, sizeNote,
};
