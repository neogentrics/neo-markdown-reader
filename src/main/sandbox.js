'use strict';
// The code sandbox: runs JavaScript and Python from code blocks, sealed off from the computer.
//
//  - A hidden window on its own in-memory session ("nmr-sandbox"), separate from the reader's.
//  - Its pages and Python's files are served from dist/sandbox through a private scheme; every
//    other request from that session (web, local files, WebSockets) is refused.
//  - The window has no preload and no Node.js; it can't open windows, navigate or ask for any
//    permission (camera, notifications, clipboard…).
//  - Each program runs in a Web Worker that is stopped when its time is up.
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'nmr-sandbox';
const ORIGIN = `${SCHEME}://app`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' };
const CSP = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const LANGS = { js: 'javascript', javascript: 'javascript', mjs: 'javascript', node: 'javascript', py: 'python', python: 'python', python3: 'python' };
const TIMEOUT = { javascript: 10_000, python: 30_000 };

/** Call before the app is ready: the private scheme needs fetch and module-worker support. */
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);
}

/** The language a code block's label means, or null if it can't be run. */
function runnableLang(label) {
  return LANGS[String(label || '').trim().toLowerCase()] || null;
}

/** Map a sandbox URL to a file inside `dir`, or null if it points anywhere else. */
function sandboxFile(dir, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || u.host !== 'app') return null;
  let rel;
  try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return null; }
  const file = path.resolve(dir, rel);
  return file.startsWith(path.resolve(dir) + path.sep) ? file : null;
}

class CodeSandbox {
  constructor({ dir, devTools = false }) {
    this.dir = dir;
    this.devTools = devTools;
    this.win = null;
    this.ready = null;
    this.queue = Promise.resolve();
  }

  session() {
    const { session } = require('electron');
    const ses = session.fromPartition('nmr-sandbox', { cache: false });
    if (ses.__nmrReady) return ses;
    ses.__nmrReady = true;
    ses.protocol.handle(SCHEME, async (req) => {
      const file = sandboxFile(this.dir, req.url);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        const data = await fs.promises.readFile(file);
        return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    // Everything that isn't the sandbox's own files is refused: web, file://, WebSockets, all of it.
    ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith(`${ORIGIN}/`) }));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    return ses;
  }

  async ensure() {
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready;
    const { BrowserWindow } = require('electron');
    this.win = new BrowserWindow({
      show: false, width: 400, height: 300,
      webPreferences: { session: this.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, devTools: this.devTools, backgroundThrottling: false },
    });
    const wc = this.win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('render-process-gone', () => { this.ready = null; try { this.win.destroy(); } catch { /* gone */ } this.win = null; });
    this.ready = (async () => {
      await this.win.loadURL(`${ORIGIN}/sandbox.html`);
      for (let i = 0; i < 100; i++) {
        if (await wc.executeJavaScript('typeof window.__run === "function"')) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('The code sandbox didn’t start.');
    })();
    return this.ready;
  }

  /** Run one program. Resolves to { output: [{stream, text}], result, error, ms, timedOut, clipped }. */
  run({ lang, code, timeoutMs }) {
    const job = async () => {
      await this.ensure();
      const req = { lang, code: String(code), timeoutMs: timeoutMs || TIMEOUT[lang] };
      return this.win.webContents.executeJavaScript(`window.__run(${JSON.stringify(req)})`);
    };
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }

  dispose() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
  }
}

module.exports = { CodeSandbox, registerScheme, runnableLang, sandboxFile, SCHEME, TIMEOUT };
