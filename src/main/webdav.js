'use strict';
// WebDAV folders (3.9): a folder on Nextcloud, ownCloud or any WebDAV server, opened like one on your computer. The app
// keeps a private copy of its documents and pictures and works on that, so search, links and editing all work as they do
// for a local folder, and offline too. Changes go both ways. Nothing on your server is ever deleted from here, and when
// both sides changed, neither is lost. This file doesn't use Electron: main.js gives it fetch and the password.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 60 * 1000;
const MAX_FILES = 5000;
const MAX_BYTES = 25 * 1024 * 1024;
const WANTED = /\.(?:md|markdown|mdown|mkd|txt|mdlock|png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const BAD_NAME = /[<>:"|?*\\\u0000-\u001f]/;
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

class DavError extends Error {
  constructor(message, code = 'failed', status = 0) { super(message); this.code = code; this.status = status; }
}

function refusal(status) {
  if (status === 401) return new DavError('The server didn’t accept that name and password. Nextcloud needs an app password if two-step sign-in is on.', 'key', status);
  if (status === 403) return new DavError('The server refused that.', 'refused', status);
  if (status === 404) return new DavError('That folder isn’t on the server.', 'not_found', status);
  if (status === 405) return new DavError('That address doesn’t answer as a WebDAV folder.', 'not_dav', status);
  if (status === 412) return new DavError('That changed on the server.', 'changed', status);
  if (status === 507) return new DavError('The server is out of space.', 'full', status);
  return new DavError(`The server answered ${status}.`, 'failed', status);
}

const withSlash = (s) => (s.endsWith('/') ? s : `${s}/`);

/** The WebDAV address of an account. Nextcloud and ownCloud keep your files under a fixed path. */
function davUrl({ kind, url, user }) {
  const given = withSlash(String(url || '').trim());
  if (kind !== 'nextcloud' || /\/remote\.php\//.test(given)) return given;
  return `${given}remote.php/dav/files/${encodeURIComponent(user || '')}/`;
}

const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Read a PROPFIND answer. Servers name their XML namespaces differently, so the prefixes are dropped first. */
function parseListing(xml, basePath) {
  const text = String(xml || '').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  const out = [];
  for (const [response] of text.matchAll(/<response\b[\s\S]*?<\/response>/gi)) {
    const href = /<href[^>]*>([\s\S]*?)<\/href>/i.exec(response)?.[1];
    if (!href) continue;
    let pathname;
    try { pathname = new URL(unescapeXml(href.trim()), 'http://x').pathname; } catch { continue; }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { continue; }
    if (!decoded.startsWith(basePath)) continue;
    const rel = decoded.slice(basePath.length).replace(/\/+$/, '');
    const prop = (name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(response)?.[1];
    out.push({
      rel,
      dir: /<resourcetype\b[^>]*>[\s\S]*?<collection\b/i.test(response),
      etag: unescapeXml(prop('getetag') || '').trim(),
      modified: prop('getlastmodified') || '',
      size: Number(prop('getcontentlength')) || 0,
    });
  }
  return out;
}

function createClient({ fetch, url, user, password, wait }) {
  const base = withSlash(url);
  const basePath = decodeURIComponent(new URL(base).pathname);
  const auth = `Basic ${Buffer.from(`${user || ''}:${password || ''}`).toString('base64')}`;
  const address = (rel) => base + String(rel || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');

  async function call(method, rel, { headers = {}, body, ok = [200, 201, 204, 207] } = {}) {
    let res;
    try {
      res = await fetch(address(rel), { method, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { authorization: auth, ...headers }, body });
    } catch {
      throw new DavError('The server can’t be reached. Check the address and that you’re on its network.', 'offline');
    }
    if (!ok.includes(res.status)) throw refusal(res.status);
    return res;
  }

  const PROPS = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';

  async function propfind(rel, depth) {
    const res = await call('PROPFIND', rel, { headers: { depth: String(depth), 'content-type': 'application/xml' }, body: PROPS });
    return parseListing(await res.text(), basePath);
  }

  return {
    wait,
    /** The folders inside one folder, for browsing. */
    async folders(rel = '') {
      const inside = String(rel).replace(/^\/+|\/+$/g, '');
      const items = await propfind(inside, 1);
      return items.filter((i) => i.dir && i.rel !== inside && !i.rel.split('/').pop().startsWith('.')).map((i) => i.rel).sort((a, b) => a.localeCompare(b));
    },

    /** Every wanted file under a folder, walked one level at a time because many servers refuse a deep listing. */
    async tree(rel = '') {
      const root = String(rel).replace(/^\/+|\/+$/g, '');
      const files = new Map();
      const waiting = [root];
      let more = false;
      while (waiting.length) {
        const dir = waiting.shift();
        for (const item of await propfind(dir, 1)) {
          if (item.rel === dir) continue;
          const name = item.rel.split('/').pop();
          if (name.startsWith('.')) continue;
          if (item.dir) { waiting.push(item.rel); continue; }
          if (!WANTED.test(name)) continue;
          if (files.size >= MAX_FILES) { more = true; continue; }
          const inside = root ? item.rel.slice(root.length + 1) : item.rel;
          files.set(inside, { etag: item.etag, size: item.size });
        }
      }
      return { files, more };
    },

    async read(rel) {
      const res = await call('GET', rel, { ok: [200] });
      const size = Number(res.headers.get('content-length')) || 0;
      if (size > MAX_BYTES) throw new DavError('That file is too large.', 'too_large');
      const data = Buffer.from(await res.arrayBuffer());
      return { data, etag: res.headers.get('etag') || '' };
    },

    /** Save a file, only if the server's copy is still the one we started from. Returns its new etag. */
    async write(rel, data, { etag = '', fresh = false } = {}) {
      const headers = { 'content-type': 'application/octet-stream' };
      if (etag) headers['if-match'] = etag;
      if (fresh) headers['if-none-match'] = '*';
      const res = await call('PUT', rel, { headers, body: data });
      const given = res.headers.get('etag');
      if (given) return given;
      return (await propfind(rel, 0))[0]?.etag || '';
    },

    async makeFolder(rel) {
      await call('MKCOL', rel, { ok: [201, 405] });   // 405 means it's already there
    },

    async test() {
      await propfind('', 0);
    },
  };
}

// ---------------------------------------------------------------- the two copies

const hashOf = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** A path from the server, checked before it's used on this computer. */
function safeRel(rel) {
  const parts = String(rel).split('/');
  if (!parts.length || parts.some((p) => !p || p === '.' || p === '..' || BAD_NAME.test(p) || RESERVED.test(p) || /[. ]$/.test(p))) return null;
  return parts.join('/');
}

async function walk(root, rel = '', out = new Map()) {
  for (const entry of await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue;
    const inside = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, inside, out);
    else if (entry.isFile() && WANTED.test(entry.name)) out.set(inside, path.join(root, inside));
  }
  return out;
}

async function saveFile(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
}

function myCopyName(rel, taken) {
  const ext = path.posix.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const name = `${stem} (my copy${n === 1 ? '' : ` ${n}`})${ext}`;
    if (!taken.has(name)) return name;
  }
  return `${stem} (my copy ${Date.now()})${ext}`;
}

/**
 * Bring the server's folder and this computer's copy into step. `known` is how each file looked after the last time,
 * so a change can be told from a file the other side simply hasn't seen. Returns the new `known`, and what happened.
 */
async function syncFolder({ client, remote = '', root, known = {} }) {
  const prefix = (rel) => (remote ? `${remote}/${rel}` : rel);
  const { files: theirs, more } = await client.tree(remote);
  const mine = await walk(root);
  const next = {};
  const report = { down: 0, up: 0, removed: 0, conflicts: [], failed: 0, skipped: 0, more };

  const makeFolders = async (rel) => {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) await client.makeFolder(prefix(parts.slice(0, i).join('/')));
  };
  const fetchIt = async (rel, file) => {
    const got = await client.read(prefix(rel));
    await saveFile(file, got.data);
    return { etag: got.etag || theirs.get(rel)?.etag || '', hash: hashOf(got.data) };
  };
  const keepBoth = async (rel, file, data) => {
    const copy = myCopyName(rel, new Set([...theirs.keys(), ...mine.keys()]));
    await saveFile(path.join(root, ...copy.split('/')), data);
    report.conflicts.push(copy);
    next[rel] = await fetchIt(rel, file);
    report.down += 1;
  };

  for (const rel of new Set([...theirs.keys(), ...mine.keys()])) {
    const clean = safeRel(rel);
    if (!clean) { report.skipped += 1; continue; }
    const file = path.join(root, ...clean.split('/'));
    const server = theirs.get(rel);
    const was = known[rel];
    const local = mine.has(rel) ? await fs.promises.readFile(file) : null;
    const hash = local && hashOf(local);
    try {
      if (server && !local) {
        next[rel] = await fetchIt(rel, file);             // new there, or removed here: nothing on the server is deleted from here
        report.down += 1;
      } else if (server && !was) {
        const got = await client.read(prefix(rel));
        if (hashOf(got.data) === hash) next[rel] = { etag: got.etag || server.etag, hash };
        else await keepBoth(rel, file, local);
      } else if (server) {
        const theyChanged = server.etag !== was.etag;
        const iChanged = hash !== was.hash;
        if (!theyChanged && !iChanged) {
          next[rel] = was;
        } else if (theyChanged && !iChanged) {
          next[rel] = await fetchIt(rel, file);
          report.down += 1;
        } else if (!theyChanged) {
          next[rel] = { etag: await client.write(prefix(rel), local, { etag: was.etag }), hash };
          report.up += 1;
        } else {
          const got = await client.read(prefix(rel));
          if (hashOf(got.data) === hash) next[rel] = { etag: got.etag || server.etag, hash };
          else await keepBoth(rel, file, local);
        }
      } else if (was && hash === was.hash) {
        await fs.promises.rm(file, { force: true });      // removed on the server, and not changed here
        report.removed += 1;
      } else {
        await makeFolders(clean);                          // new here, or changed here after being removed there
        next[rel] = { etag: await client.write(prefix(rel), local, { fresh: true }), hash };
        report.up += 1;
      }
    } catch (err) {
      if (err.code === 'offline' || err.code === 'key') throw err;
      if (was) next[rel] = was;
      report.failed += 1;
    }
  }
  return { known: next, report };
}

module.exports = { DavError, davUrl, parseListing, createClient, syncFolder, safeRel, WANTED, MAX_FILES };
