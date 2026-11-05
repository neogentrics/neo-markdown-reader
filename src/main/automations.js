'use strict';
// Automations (3.7): your webhooks as commands. n8n, Make, Zapier, Home Assistant or your own script never need to
// know about this app; it sends them what you choose and shows you what comes back. This file doesn't use Electron.

const SENDS = ['document', 'selection', 'folder'];
const RESULTS = ['document', 'change', 'none'];
const MAX_ANSWER = 25 * 1024 * 1024;
const MAX_ACTIONS = 100;
const CALL_MS = 5 * 60 * 1000;
const MAX_FOLDER_FILES = 500;
const MAX_FOLDER_BYTES = 20 * 1024 * 1024;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A web address that can be called: http or https, with no password written into it. */
function cleanUrl(value) {
  let url;
  try { url = new URL(text(value, 2000)); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  return url.href;
}

/** An action as it may be kept, or null. */
function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  const name = text(a.name, 60).replace(/[\u0000-\u001f]/g, ' ');
  const url = cleanUrl(a.url);
  if (!name || !url) return null;
  return {
    id: typeof a.id === 'string' && /^[a-z0-9]{6,24}$/.test(a.id) ? a.id : Math.random().toString(36).slice(2, 14).padEnd(6, '0'),
    name, url,
    send: SENDS.includes(a.send) ? a.send : 'document',
    result: RESULTS.includes(a.result) ? a.result : 'document',
  };
}

const cleanActions = (list) => (Array.isArray(list) ? list.map(cleanAction).filter(Boolean).slice(0, MAX_ACTIONS) : []);

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

/** The text in a webhook's answer. n8n answers with JSON, usually an object or a list of them, or plain text. */
function readAnswer(body, type = '') {
  const raw = String(body ?? '').trim();
  if (!raw) return '';
  if (!/json/i.test(type) && !/^[[{]/.test(raw)) return raw;
  let data;
  try { data = JSON.parse(raw); } catch { return raw; }
  const pick = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.length ? pick(v[0]) : '';
    if (v && typeof v === 'object') {
      if (Object.keys(v).length === 1 && v.message === 'Workflow was started') return '';     // n8n: it has nothing to say yet
      for (const key of ['markdown', 'text', 'content', 'output', 'result', 'answer', 'body', 'data', 'json']) {
        if (v[key] !== undefined && v[key] !== null) {
          const inner = pick(v[key]);
          if (inner) return inner;
        }
      }
      return `\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\`\n`;
    }
    return v === undefined || v === null ? '' : String(v);
  };
  return pick(data).trim();
}

/** Why a webhook said no, in words that say what to do. */
function httpProblem(status, host) {
  if (status === 404) return `${host} says that address doesn’t exist. In n8n, check the workflow is active and you’re using its production URL.`;
  if (status === 401 || status === 403) return `${host} refused the request. Check the header the webhook expects.`;
  if (status >= 500) return `${host} had a problem running that (error ${status}).`;
  return `${host} answered with an error (${status}).`;
}

async function readLimited(res) {
  if (!res.body?.getReader) { const t = await res.text(); return t.length > MAX_ANSWER ? t.slice(0, MAX_ANSWER) : t; }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ANSWER) { reader.cancel().catch(() => {}); throw new Error('The answer was too large (over 25 MB).'); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString('utf8');
}

/**
 * Send a payload to a webhook, and read what it answers. Redirects aren't followed, because a document
 * should only ever reach the address that was shown before sending.
 */
async function callWebhook({ fetch: fetchFn, url, payload, secret = '', signal }) {
  const host = hostOf(url);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, CALL_MS);
  timer.unref?.();
  try {
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(secret ? { authorization: secret } : {}) },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (signal?.aborted) throw new Error('Stopped.');
      if (controller.signal.aborted) throw new Error(`${host} didn’t answer in time.`);
      throw new Error(`${host} couldn’t be reached. Check the address, and that it’s running.`);
    }
    if (res.status >= 300 && res.status < 400) throw new Error(`${host} tried to send this somewhere else, so it wasn’t followed.`);
    if (!res.ok) throw new Error(httpProblem(res.status, host));
    return readAnswer(await readLimited(res), res.headers?.get?.('content-type') || '');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** The address of an n8n server, from whatever was pasted: a page of it, its API, or a webhook. */
function n8nBase(value) {
  const url = cleanUrl(value);
  if (!url) return '';
  const u = new URL(url);
  const path = u.pathname.replace(/\/(?:api\/v\d+|webhook(?:-test)?|workflows?|home)(?:\/.*)?$/, '').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

/** Workflows that can be called: active ones with a webhook that takes POST. Needs an n8n API key. */
async function listWorkflows({ fetch: fetchFn, base, key }) {
  const host = hostOf(base);
  const out = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    let res;
    try {
      res = await fetchFn(`${base}/api/v1/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { 'X-N8N-API-KEY': key, accept: 'application/json' } });
    } catch { throw new Error(`${host} couldn’t be reached. Check the address, and that n8n is running.`); }
    if (res.status === 401 || res.status === 403) throw new Error('n8n refused that API key.');
    if (!res.ok) throw new Error(`n8n answered with an error (${res.status}).`);
    const body = await res.json();
    for (const w of Array.isArray(body?.data) ? body.data : []) {
      for (const n of Array.isArray(w?.nodes) ? w.nodes : []) {
        if (n?.type !== 'n8n-nodes-base.webhook' || n.disabled) continue;
        const method = String(n.parameters?.httpMethod || 'GET').toUpperCase();
        const path = text(n.parameters?.path, 500);
        if (method !== 'POST' || !path) continue;
        out.push({ name: text(w.name, 60) || 'Workflow', url: `${base}/webhook/${path.replace(/^\/+/, '')}`, active: !!w.active });
      }
    }
    cursor = body?.nextCursor || '';
    if (!cursor) break;
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** Plain words for what an action will send. */
function describeSend(payload) {
  if (payload.documents) return { count: payload.documents.length, bytes: payload.documents.reduce((n, d) => n + Buffer.byteLength(d.text), 0), sample: payload.documents.slice(0, 8).map((d) => d.path).join('\n') };
  const body = payload.selection || payload.text || '';
  return { count: 1, bytes: Buffer.byteLength(body), sample: body.slice(0, 400) };
}

module.exports = {
  cleanAction, cleanActions, cleanUrl, hostOf, readAnswer, callWebhook, n8nBase, listWorkflows, describeSend,
  SENDS, RESULTS, MAX_FOLDER_FILES, MAX_FOLDER_BYTES,
};
