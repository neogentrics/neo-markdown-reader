'use strict';
// App Link (3.6): Recon Towers apps on one computer find each other, link once and send each other documents.
// docs/app-link.md has the rules other apps follow. This file is the whole of it apart from the prompts, and it
// doesn't use Electron: main.js gives it somewhere to keep keys, a way to ask the person and a way to open documents.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const PROTOCOL = 1;
const APP_ID = 'rt-markdown-reader';
const APP_NAME = 'RT Markdown Reader';
const ACCEPTS = ['markdown', 'text'];
const MAX_LINE = 8 * 1024 * 1024;
const ASK_MS = 120_000;
const CALL_MS = 5_000;
const DECLINED_MS = 30_000;       // an app that's been told no can't keep asking

const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

/** A refusal with a reason other apps can act on. */
class LinkError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Where running apps leave the file that says how to reach them. */
function sharedFolder({ env = process.env, platform = process.platform, home }) {
  if (env.NMR_LINK_DIR) return env.NMR_LINK_DIR;
  const base = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'Recon Towers', 'app-link');
}

function endpointFor(dir, platform = process.platform) {
  if (platform !== 'win32') return path.join(dir, 'app-link.sock');
  return `\\\\.\\pipe\\rt-app-link-${crypto.createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 16)}`;
}

/** Only ever a pipe or socket on this computer, whatever a file in the folder says. */
function validEndpoint(endpoint, platform = process.platform) {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1024) return false;
  if (platform === 'win32') return /^\\\\\.\\pipe\\[^\\/]+$/.test(endpoint);
  return path.isAbsolute(endpoint);
}

/** A name another app gave us, safe to show: no control characters, nothing that reverses the text around it. */
function cleanName(name, fallback = '') {
  if (typeof name !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, 80) || fallback;
}

/** A name for a document that was sent, without any folders. */
function documentName(name) {
  const base = cleanName(typeof name === 'string' ? name.split(/[\\/]/).pop() : '', 'Sent document');
  return /\.[a-z0-9]{1,8}$/i.test(base) ? base : `${base}.md`;
}

const sameKey = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/** One request to another app, on its own connection. */
function call(endpoint, method, params, timeout = CALL_MS) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(endpoint);
    let buf = '';
    const stop = (fn, value) => { clearTimeout(timer); sock.destroy(); fn(value); };
    const timer = setTimeout(() => stop(reject, new LinkError('timed_out', 'That app didn’t answer.')), timeout);
    sock.setEncoding('utf8');
    sock.on('error', () => stop(reject, new LinkError('not_running', 'That app isn’t running.')));
    sock.on('connect', () => sock.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > MAX_LINE) { stop(reject, new LinkError('failed', 'That app sent too much.')); return; }
      const at = buf.indexOf('\n');
      if (at < 0) return;
      let reply;
      try { reply = JSON.parse(buf.slice(0, at)); } catch { stop(reject, new LinkError('failed', 'That app sent something unreadable.')); return; }
      if (reply?.error) stop(reject, new LinkError(String(reply.error.code || 'failed'), cleanName(reply.error.message, 'That app couldn’t do it.')));
      else stop(resolve, reply?.result);
    });
  });
}

class AppLink {
  /**
   * @param {object} o
   * @param {string} o.folder   the shared folder
   * @param {string} o.dataDir  this app's own folder
   * @param {string} o.version
   * @param {() => object} o.load             the saved links: { id: { name, key } }
   * @param {(links: object) => void} o.save
   * @param {(asker: { id, name }) => Promise<boolean>} o.ask
   * @param {(doc: { from, name, text, path, attachments, kind }) => Promise<void>} o.open
   */
  constructor({ folder, dataDir, version, load, save, ask, open, platform = process.platform }) {
    Object.assign(this, { folder, dataDir, version, load, save, ask, open, platform });
    this.server = null;
    this.asking = false;
    this.declined = new Map();
    this.file = path.join(folder, `${APP_ID}.json`);
  }

  get running() { return !!this.server; }

  async start() {
    if (this.server) return;
    const endpoint = endpointFor(this.dataDir, this.platform);
    if (this.platform !== 'win32') fs.rmSync(endpoint, { force: true });      // left behind by a crash
    const server = net.createServer((sock) => this.serve(sock));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
    server.removeAllListeners('error');
    server.on('error', () => {});
    if (this.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
    fs.mkdirSync(this.folder, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ protocol: PROTOCOL, id: APP_ID, name: APP_NAME, version: this.version, endpoint }, null, 2));
    this.server = server;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    fs.rmSync(this.file, { force: true });
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  serve(sock) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > MAX_LINE) { sock.destroy(); return; }
      for (let at = buf.indexOf('\n'); at >= 0; at = buf.indexOf('\n')) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        this.answer(sock, line);
      }
    });
  }

  async answer(sock, line) {
    let req;
    try { req = JSON.parse(line); } catch { sock.destroy(); return; }
    let reply;
    try {
      reply = { id: req?.id, result: await this.handle(req?.method, req?.params || {}) };
    } catch (err) {
      reply = err instanceof LinkError
        ? { id: req?.id, error: { code: err.code, message: err.message } }
        : { id: req?.id, error: { code: 'failed', message: 'RT Markdown Reader couldn’t do that.' } };
    }
    if (!sock.destroyed) sock.write(`${JSON.stringify(reply)}\n`);
  }

  handle(method, params) {
    if (method === 'hello') return { protocol: PROTOCOL, app: APP_ID, name: APP_NAME, version: this.version, accepts: ACCEPTS };
    if (method === 'pair') return this.pairRequest(params);
    if (method === 'open_document') return this.openRequest(params);
    if (method === 'unlink') return this.unlinkRequest(params);
    throw new LinkError('unknown_method', 'RT Markdown Reader doesn’t have that method.');
  }

  /** The app making this request, once its key has been checked. */
  caller({ app: id, key }) {
    const link = validId(id) && Object.hasOwn(this.load(), id) ? this.load()[id] : null;
    if (!link || !sameKey(key, link.key)) throw new LinkError('not_linked', 'That app isn’t linked. Link it first.');
    return { id, ...link };
  }

  async pairRequest({ app: id, name }) {
    if (!validId(id) || id === APP_ID) throw new LinkError('bad_request', 'Give the app’s id.');
    const shown = cleanName(name);
    if (!shown) throw new LinkError('bad_request', 'Give the app’s name.');
    if (this.asking) throw new LinkError('busy', 'RT Markdown Reader is already asking something.');
    if (Date.now() - (this.declined.get(id) || -Infinity) < DECLINED_MS) throw new LinkError('declined', 'The link was declined.');
    this.asking = true;
    let timer;
    try {
      const answer = await Promise.race([
        this.ask({ id, name: shown }),
        new Promise((resolve) => { timer = setTimeout(() => resolve('timed_out'), ASK_MS); }),
      ]);
      if (answer === 'timed_out') throw new LinkError('timed_out', 'Nobody answered.');
      if (answer !== true) {
        this.declined.set(id, Date.now());
        throw new LinkError('declined', 'The link was declined.');
      }
    } finally {
      clearTimeout(timer);
      this.asking = false;
    }
    const key = crypto.randomBytes(32).toString('hex');
    this.save({ ...this.load(), [id]: { name: shown, key } });
    return { key, app: APP_ID, name: APP_NAME };
  }

  async openRequest(params) {
    const from = this.caller(params);
    const { name, text, path: file, attachments, kind } = params;
    if (typeof file === 'string' && file) await this.open({ from: from.name, path: file, attachments, kind });
    else if (typeof text === 'string') await this.open({ from: from.name, name: documentName(name), text, attachments, kind });
    else throw new LinkError('bad_request', 'Give the document’s text or its path.');
    return { opened: true };
  }

  unlinkRequest(params) {
    const { id } = this.caller(params);
    const links = this.load();
    delete links[id];
    this.save(links);
    return { unlinked: true };
  }

  // ---------------------------------------------------------------- reaching other apps

  /** Every app that's left a file in the folder and answers. */
  async found() {
    let names = [];
    try { names = fs.readdirSync(this.folder); } catch { return []; }
    const seen = await Promise.all(names.filter((n) => n.endsWith('.json') && n !== `${APP_ID}.json`).map(async (n) => {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.folder, n), 'utf8'));
        if (info?.protocol !== PROTOCOL || !validId(info.id) || `${info.id}.json` !== n || !validEndpoint(info.endpoint, this.platform)) return null;
        await call(info.endpoint, 'hello', {}, 1500);
        return { id: info.id, name: cleanName(info.name, info.id), endpoint: info.endpoint };
      } catch { return null; }
    }));
    return seen.filter(Boolean);
  }

  /** Linked apps and apps that could be, for the person to see. */
  async list() {
    const running = await this.found();
    const links = this.load();
    const apps = running.map((a) => ({ id: a.id, name: links[a.id]?.name || a.name, linked: Object.hasOwn(links, a.id), running: true }));
    for (const [id, link] of Object.entries(links)) if (!apps.some((a) => a.id === id)) apps.push({ id, name: link.name, linked: true, running: false });
    return apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  async reach(id) {
    const app = (await this.found()).find((a) => a.id === id);
    if (!app) throw new LinkError('not_running', 'That app isn’t running.');
    return app;
  }

  /** Ask another app to link with this one. The person answers over there. */
  async pairWith(id) {
    const app = await this.reach(id);
    const res = await call(app.endpoint, 'pair', { app: APP_ID, name: APP_NAME }, ASK_MS + 5000);
    if (typeof res?.key !== 'string' || res.key.length < 32) throw new LinkError('failed', 'That app didn’t finish linking.');
    this.save({ ...this.load(), [id]: { name: app.name, key: res.key } });
    return { name: app.name };
  }

  async send(id, { name, text, attachments = [] }) {
    const link = this.load()[id];
    if (!link) throw new LinkError('not_linked', 'That app isn’t linked.');
    const app = await this.reach(id);
    const pictures = attachments.length ? { attachments } : {};
    await call(app.endpoint, 'open_document', { app: APP_ID, key: link.key, name: documentName(name), text, ...pictures }, 15_000);
    return { name: link.name };
  }

  /** Forget a link here, and tell the other app if it's there to hear it. */
  async unlink(id) {
    const links = this.load();
    const link = links[id];
    if (!link) return;
    delete links[id];
    this.save(links);
    try {
      const app = await this.reach(id);
      await call(app.endpoint, 'unlink', { app: APP_ID, key: link.key });
    } catch { /* it isn't running, or it's forgotten already */ }
  }
}

module.exports = { AppLink, LinkError, PROTOCOL, APP_ID, sharedFolder, endpointFor, validEndpoint, validId, cleanName, documentName, call };
