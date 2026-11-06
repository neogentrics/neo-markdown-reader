'use strict';
// Publishing history (3.10): each document remembers where it was sent and when, with links back to it, and which draft
// it became on each blog. It lives on this computer, by the document's path, and follows a rename.
const fs = require('node:fs');
const path = require('node:path');

const MAX_PER_DOC = 100;
const KINDS = new Set(['wordpress', 'ghost', 'discord', 'bookstack', 'wikijs', 'outline', 'notion']);
const WHATS = new Set(['draft', 'update', 'post', 'summary', 'page']);

const keyOf = (doc) => {
  const full = path.resolve(doc);
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

function createSent({ file, now = () => new Date().toISOString() }) {
  let cache = null;
  const load = () => {
    if (!cache) {
      try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = null; }
      if (!cache || typeof cache !== 'object') cache = {};
      cache.docs ??= {};
      cache.posts ??= {};
    }
    return cache;
  };
  const save = () => {
    try {
      fs.writeFileSync(`${file}.part`, JSON.stringify(cache));
      fs.renameSync(`${file}.part`, file);
    } catch { /* the sending worked; it only means this one isn't remembered */ }
  };
  return {
    /** Newest first. */
    list: (doc) => [...(load().docs[keyOf(doc)] || [])].reverse(),
    add(doc, { kind, where, what, url = '' }) {
      if (!KINDS.has(kind) || !WHATS.has(what)) return;
      const key = keyOf(doc);
      const list = load().docs[key] || [];
      list.push({ kind, where: String(where || '').slice(0, 80), what, url: /^https?:\/\//i.test(url) ? url : '', at: now() });
      cache.docs[key] = list.slice(-MAX_PER_DOC);
      save();
    },
    forget(doc) {
      delete load().docs[keyOf(doc)];
      save();
    },
    post: (doc, server) => load().posts[keyOf(doc)]?.[server] || null,
    setPost(doc, server, record) {
      const key = keyOf(doc);
      load().posts[key] = { ...cache.posts[key], [server]: record };
      save();
    },
    move(from, to) {
      const [a, b] = [keyOf(from), keyOf(to)];
      if (a === b) return;
      load();
      for (const table of [cache.docs, cache.posts]) {
        if (table[a]) { table[b] = table[a]; delete table[a]; }
      }
      save();
    },
  };
}

module.exports = { createSent };
