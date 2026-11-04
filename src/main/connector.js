'use strict';
// The Claude connector (3.4): lets Claude Desktop and Claude Code work with your documents.
//
// Claude starts connector-bridge.js, a small program that speaks MCP over stdin and stdout. The bridge
// talks to the running app here, over a named pipe (a socket on macOS and Linux) that exists only while
// the connector is on. The token that opens it is in a file in this user's app-data folder, and changes
// every time the connector starts.
//
// What Claude can reach: documents open in a tab and documents in an open folder, never anything else,
// and never a password-locked document. It can't write: suggest_edit asks the person, in the app.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { isLockedPath, isMarkdownPath } = require('./files');

const INFO_FILE = 'connector.json';
const MAX_LINE = 8 * 1024 * 1024;
const MAX_TEXT = 1_000_000;
const MAX_LISTED = 500;
const SERVER_NAME = 'rt-markdown-reader';

/** A problem to report to Claude in plain words, as opposed to a bug. */
class ToolError extends Error {}

/** Where the bridge finds the app: a named pipe on Windows, a socket file elsewhere. */
function endpointFor(dir, platform = process.platform) {
  if (platform !== 'win32') return path.join(dir, 'connector.sock');
  return `\\\\.\\pipe\\neo-markdown-reader-${crypto.createHash('sha256').update(dir.toLowerCase()).digest('hex').slice(0, 16)}`;
}

class ConnectorServer {
  /** @param {{ dir: string, handle: (method: string, params: object) => Promise<any> }} o */
  constructor({ dir, handle }) {
    this.dir = dir;
    this.handle = handle;
    this.server = null;
    this.token = '';
    this.info = path.join(dir, INFO_FILE);
  }

  async start() {
    if (this.server) return;
    this.token = crypto.randomBytes(32).toString('hex');
    const endpoint = endpointFor(this.dir);
    if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true });      // left behind by a crash
    const server = net.createServer((sock) => this.serve(sock));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
    server.removeAllListeners('error');
    server.on('error', () => {});
    if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600);
    fs.writeFileSync(this.info, JSON.stringify({ endpoint, token: this.token }), { mode: 0o600 });
    this.server = server;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.token = '';
    fs.rmSync(this.info, { force: true });
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  allowed(token) {
    const a = Buffer.from(String(token));
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
    if (!this.allowed(req?.token)) { sock.destroy(); return; }
    let reply;
    try {
      reply = { id: req.id, result: await this.handle(req.method, req.params || {}) };
    } catch (err) {
      reply = { id: req.id, error: err instanceof ToolError ? err.message : 'RT Markdown Reader couldn’t do that.' };
    }
    if (!sock.destroyed) sock.write(`${JSON.stringify(reply)}\n`);
  }
}

/**
 * The tools themselves, given what the app knows:
 *   places()      → { open: [paths], folders: [{ root, name, files: [paths] }] }
 *   read(p)       → the document's text
 *   search(folder, query) → { results, total, truncated }
 *   notes(p)      → the document's highlights
 *   suggest(o)    → { outcome } once the person answers
 */
function createTools({ places, read, search, notes, suggest, platform = process.platform }) {
  const key = (p) => { const r = path.resolve(p); return platform === 'win32' || platform === 'darwin' ? r.toLowerCase() : r; };
  const shared = (p) => isMarkdownPath(p) && !isLockedPath(p);

  function reachable(p) {
    if (typeof p !== 'string' || !p || p.length > 4096) throw new ToolError('Give the document’s full path, as list_documents shows it.');
    if (isLockedPath(p)) throw new ToolError('Password-locked documents are never shared.');
    const { open, folders } = places();
    const k = key(p);
    const inFolder = folders.some((f) => f.files.some((x) => key(x) === k));
    if (!shared(p) || !(open.some((x) => key(x) === k) || inFolder)) throw new ToolError('That document isn’t open in RT Markdown Reader or in its open folder.');
    return path.resolve(p);
  }

  const tools = {
    list_documents() {
      const { open, folders } = places();
      return {
        open: open.filter(shared).map((p) => ({ path: p, name: path.basename(p) })),
        folders: folders.map((f) => {
          const files = f.files.filter(shared);
          return { root: f.root, name: f.name, documents: files.slice(0, MAX_LISTED), total: files.length };
        }),
      };
    },

    async read_document({ path: p }) {
      const full = reachable(p);
      const text = await read(full);
      return { path: full, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
    },

    async search_folder({ query }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new ToolError('Give some words to search for.');
      const { folders } = places();
      if (!folders.length) throw new ToolError('No folder is open in RT Markdown Reader.');
      const out = [];
      for (const f of folders) out.push({ root: f.root, ...(await search(f, query)) });
      return { folders: out };
    },

    get_highlights({ path: p }) {
      const full = reachable(p);
      return { path: full, highlights: notes(full).map(({ quote, color, note }) => ({ quote, color, note })) };
    },

    async suggest_edit({ path: p, old_text: oldText, new_text: newText, note }) {
      const full = reachable(p);
      if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') throw new ToolError('Give old_text, copied exactly from the document, and new_text.');
      if (oldText.length > MAX_TEXT || newText.length > MAX_TEXT) throw new ToolError('That change is too long to show. Suggest it in smaller pieces.');
      if (oldText === newText) throw new ToolError('old_text and new_text are the same.');
      const text = await read(full);
      applyEdit(text, oldText, newText);
      return suggest({ path: full, oldText, newText, note: typeof note === 'string' ? note.slice(0, 2000) : '' });
    },
  };

  return async (method, params) => {
    if (!Object.hasOwn(tools, method)) throw new ToolError('Unknown tool.');
    return tools[method](params);
  };
}

/** The document with old text replaced by new. It must appear exactly once, so the change can't land in the wrong place. */
function applyEdit(text, oldText, newText) {
  const norm = (s) => s.replace(/\r\n?/g, '\n');
  const doc = norm(text);
  const from = norm(oldText);
  const at = doc.indexOf(from);
  if (at < 0) throw new ToolError('old_text isn’t in the document. Read it again and copy the text exactly.');
  if (doc.indexOf(from, at + 1) >= 0) throw new ToolError('old_text appears more than once. Include more of the text around it.');
  return doc.slice(0, at) + norm(newText) + doc.slice(at + from.length);
}

// ---------------------------------------------------------------- adding the connector to Claude

/** How Claude starts the bridge: this app's own program, run as plain Node. */
function serverEntry({ exe, bridge, dir }) {
  return { command: exe, args: [bridge, '--dir', dir], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** Claude Desktop's settings file with this connector added; everything else in it is kept. */
function mergeDesktopConfig(text, entry) {
  let conf = {};
  if (text.trim()) {
    try { conf = JSON.parse(text); } catch { throw new ToolError('Claude Desktop’s settings file couldn’t be read, so it was left alone.'); }
    if (!conf || typeof conf !== 'object' || Array.isArray(conf)) throw new ToolError('Claude Desktop’s settings file couldn’t be read, so it was left alone.');
  }
  const servers = conf.mcpServers && typeof conf.mcpServers === 'object' ? conf.mcpServers : {};
  return `${JSON.stringify({ ...conf, mcpServers: { ...servers, [SERVER_NAME]: entry } }, null, 2)}\n`;
}

/** Where Claude Desktop keeps its settings on this computer: the folders that exist, as it may be installed either way. */
function desktopConfigPaths({ env = process.env, platform = process.platform, home, exists = fs.existsSync }) {
  if (env.NMR_CLAUDE_DESKTOP_CONFIG) return [env.NMR_CLAUDE_DESKTOP_CONFIG];
  const dirs = [];
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Claude'));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'));   // the Microsoft Store install
  } else if (platform === 'darwin') dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
  else dirs.push(path.join(home, '.config', 'Claude'));
  return dirs.filter((d) => exists(d)).map((d) => path.join(d, 'claude_desktop_config.json'));
}

/** Add the connector to Claude Desktop. The settings file's earlier version is kept beside it. */
function addToDesktop(files, entry) {
  if (!files.length) throw new ToolError('Claude Desktop doesn’t seem to be installed.');
  for (const file of files) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const next = mergeDesktopConfig(text, entry);
    if (text) fs.writeFileSync(`${file}.bak`, text);
    fs.writeFileSync(file, next);
  }
}

function inDesktop(files) {
  return files.some((f) => { try { return !!JSON.parse(fs.readFileSync(f, 'utf8'))?.mcpServers?.[SERVER_NAME]; } catch { return false; } });
}

module.exports = { ConnectorServer, ToolError, SERVER_NAME, INFO_FILE, endpointFor, createTools, applyEdit, serverEntry, mergeDesktopConfig, desktopConfigPaths, addToDesktop, inDesktop };
