'use strict';
// Let workflows open documents (3.7): a small web address your workflows can call. It's off until you turn it on,
// needs a key on every request, and turns web pages away, so a site you visit can't reach it. This file doesn't use
// Electron: main.js gives it the three things it can do, and those ask you first where a file would change.
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');

const DEFAULT_PORT = 41731;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_FAILS = 20;
const LOCK_MS = 60 * 1000;

const newKey = () => crypto.randomBytes(32).toString('hex');

function sameKey(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Addresses this computer has on its network, for showing to the person setting up a workflow. */
function networkAddresses(list = os.networkInterfaces()) {
  const out = [];
  for (const nets of Object.values(list)) for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class Inbound {
  /**
   * @param {object} o
   * @param {() => string} o.key     the key requests must carry
   * @param {number} [o.port]
   * @param {boolean} [o.network]    also listen for other computers on your network
   * @param {object} o.actions       { create({ name, content }), open({ path }), append({ path, text }) }
   */
  constructor({ key, port = DEFAULT_PORT, network = false, actions }) {
    this.key = key;
    this.port = port;
    this.network = network;
    this.actions = actions;
    this.server = null;
    this.fails = 0;
    this.lockedUntil = 0;
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(this.port, this.network ? '0.0.0.0' : '127.0.0.1', () => {
        server.removeListener('error', reject);
        this.server = server;
        this.port = server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) { resolve(); return; }
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
      this.server = null;
    });
  }

  /** Web pages send an Origin, and a page using a borrowed name for this computer shows it in Host. Workflows do neither. */
  gate(req) {
    if (req.headers.origin) throw new Refusal(403, 'Web pages can’t use this address.');
    if (!this.network && !LOCAL_HOST.test(req.headers.host || '')) throw new Refusal(403, 'This address only answers on this computer.');
    if (Date.now() < this.lockedUntil) throw new Refusal(429, 'Too many wrong keys. Try again in a minute.');
    const given = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1] || '';
    const key = this.key();
    if (!key || !given || !sameKey(given, key)) {
      if (++this.fails >= MAX_FAILS) { this.lockedUntil = Date.now() + LOCK_MS; this.fails = 0; }
      throw new Refusal(401, 'That key isn’t right.');
    }
    this.fails = 0;
  }

  read(req) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Refusal(413, 'That’s too large (over 8 MB).')); req.destroy(); return; }
        parts.push(c);
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
          resolve(data);
        } catch { reject(new Refusal(400, 'Send JSON.')); }
      });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      this.gate(req);
      const route = `${req.method} ${req.url.split('?')[0].replace(/\/+$/, '')}`;
      if (route === 'GET /v1/status') { send(200, { ok: true, app: 'RT Markdown Reader' }); return; }
      const run = { 'POST /v1/documents': this.create, 'POST /v1/open': this.open, 'POST /v1/append': this.append }[route];
      if (!run) throw new Refusal(404, 'There’s nothing at that address.');
      send(200, { ok: true, ...(await run.call(this, await this.read(req))) });
    } catch (err) {
      send(err.status || 500, { ok: false, error: err.message || 'That didn’t work.' });
    }
  }

  async create(data) {
    if (typeof data.content !== 'string') throw new Refusal(400, 'Send the document as “content”.');
    await this.actions.create({ name: typeof data.name === 'string' ? data.name : 'From a workflow', content: data.content });
    return {};
  }

  async open(data) {
    if (typeof data.path !== 'string' || !data.path) throw new Refusal(400, 'Send the document’s “path”.');
    await this.actions.open({ path: data.path });
    return {};
  }

  async append(data) {
    if (typeof data.path !== 'string' || !data.path || typeof data.text !== 'string') throw new Refusal(400, 'Send the document’s “path” and the “text” to add.');
    await this.actions.append({ path: data.path, text: data.text });
    return {};
  }
}

module.exports = { Inbound, Refusal, newKey, networkAddresses, DEFAULT_PORT };
