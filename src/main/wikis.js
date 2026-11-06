'use strict';
// Publish to your wiki (3.9): a document or a whole folder to BookStack, Wiki.js or Outline, as pages with their pictures,
// and updated later without making copies. Nothing on a wiki is ever deleted from here. This file doesn't use Electron:
// main.js gives it fetch, the key and a way to read files.
const crypto = require('node:crypto');
const path = require('node:path');

const TIMEOUT_MS = 60 * 1000;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };

class WikiError extends Error {
  constructor(message, code = 'failed') { super(message); this.code = code; }
}

function refusal(status, detail = '') {
  if (status === 401) return new WikiError('The wiki didn’t accept that key.', 'key');
  if (status === 403) return new WikiError('That key isn’t allowed to do that. Check its permissions on the wiki.', 'refused');
  if (status === 404) return new WikiError('That isn’t on the wiki any more.', 'not_found');
  if (status === 413) return new WikiError('That’s too large for the wiki to take.', 'too_large');
  return new WikiError(detail ? `The wiki said: ${String(detail).slice(0, 300)}` : `The wiki answered ${status}.`, 'failed');
}

const noSlash = (s) => String(s || '').trim().replace(/\/+$/, '');

/** Build a form with a file by hand, so it works the same with any fetch. */
function form(fields, file) {
  const boundary = `----rt${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of fields) parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  const safe = file.filename.replace(/["\r\n]/g, '');
  parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${safe}"\r\ncontent-type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

function requester({ fetch, base, headers }) {
  return async function call(method, url, { json, raw, type } = {}) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : base + url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', ...headers, ...(json ? { 'content-type': 'application/json' } : {}), ...(type ? { 'content-type': type } : {}) },
        body: json ? JSON.stringify(json) : raw,
      });
    } catch {
      throw new WikiError('The wiki can’t be reached. Check the address and that you’re on its network.', 'offline');
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw refusal(res.status, data?.error?.message || data?.message || data?.error);
    return data ?? {};
  };
}

// ---------------------------------------------------------------- the three wikis

function bookstack({ fetch, url, secret }) {
  const base = noSlash(url);
  const call = requester({ fetch, base, headers: { authorization: `Token ${secret}` } });
  return {
    placeWord: 'Book',
    async test() { await call('GET', '/api/books?count=1'); },
    async places() { return ((await call('GET', '/api/books?count=500')).data || []).map((b) => ({ id: String(b.id), name: b.name })); },
    async makePlace(name) { const b = await call('POST', '/api/books', { json: { name } }); return { id: String(b.id), name: b.name }; },
    async section({ place, name }) {
      const book = await call('GET', `/api/books/${place}`);
      const found = (book.contents || []).find((c) => c.type === 'chapter' && c.name === name);
      if (found) return String(found.id);
      return String((await call('POST', '/api/chapters', { json: { book_id: Number(place), name } })).id);
    },
    async save({ id, place, section, title, text }) {
      const page = id
        ? await call('PUT', `/api/pages/${id}`, { json: { name: title, markdown: text } })
        : await call('POST', '/api/pages', { json: { ...(section ? { chapter_id: Number(section) } : { book_id: Number(place) }), name: title, markdown: text } });
      return { id: String(page.id), url: `${base}/link/${page.id}` };   // a permanent link, which survives renaming and moving
    },
    async picture({ pageId, name, data, type }) {
      const f = form([['type', 'gallery'], ['uploaded_to', pageId], ['name', name]], { field: 'image', filename: name, type, data });
      return (await call('POST', '/api/image-gallery', { raw: f.body, type: f.type })).url;
    },
  };
}

const slug = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';

function wikijs({ fetch, url, secret }) {
  const base = noSlash(url);
  const call = requester({ fetch, base, headers: { authorization: `Bearer ${secret}` } });
  async function graph(query, variables) {
    const res = await call('POST', '/graphql', { json: { query, variables } });
    if (res.errors?.length) {
      const said = res.errors[0].message || '';
      throw /forbidden|unauthorized/i.test(said) ? new WikiError('That key isn’t allowed to do that. Check its permissions on the wiki.', 'refused') : refusal(400, said);
    }
    return res.data;
  }
  const fields = 'content:$content,description:"",editor:"markdown",isPublished:true,isPrivate:false,locale:$locale,path:$path,tags:[],title:$title';
  const vars = '$content:String!,$locale:String!,$path:String!,$title:String!';
  const answer = 'responseResult{succeeded errorCode message} page{id path}';
  let locale = null;
  const siteLocale = async () => {
    locale ??= (await graph('{localization{config{locale}}}').catch(() => null))?.localization?.config?.locale || 'en';
    return locale;
  };
  const check = (res) => {
    if (!res.responseResult.succeeded) {
      const message = res.responseResult.message || '';
      throw /not found|does not exist/i.test(message) ? new WikiError('That isn’t on the wiki any more.', 'not_found') : refusal(400, message);
    }
    return res.page;
  };
  return {
    placeWord: 'Folder',
    freePlace: true,
    async test() { await graph('{pages{list(limit:1){id}}}'); },
    async places() { return []; },
    async makePlace(name) { return { id: slug(name), name }; },
    async section({ place, name }) { return `${place}/${slug(name)}`; },
    async save({ id, place, section, title, text, name }) {
      const where = `${section || place}/${slug(String(name || title).replace(/\.[^.]+$/, ''))}`.replace(/^\/+/, '');
      const v = { content: text, locale: await siteLocale(), path: where, title };
      const page = id
        ? check((await graph(`mutation(${vars},$id:Int!){pages{update(id:$id,${fields}){${answer}}}}`, { ...v, id: Number(id) })).pages.update)
        : check((await graph(`mutation(${vars}){pages{create(${fields}){${answer}}}}`, v)).pages.create);
      return { id: String(page.id || id), url: `${base}/${v.locale}/${where}` };
    },
    async picture({ name, data, type }) {
      const file = `rt-${crypto.createHash('sha256').update(data).digest('hex').slice(0, 8)}-${slug(name.replace(/\.[^.]+$/, ''))}${path.extname(name).toLowerCase()}`;
      const f = form([['mediaUpload', '{"folderId":0}']], { field: 'mediaUpload', filename: file, type, data });
      await call('POST', '/u', { raw: f.body, type: f.type });
      return `/${file}`;
    },
  };
}

function outline({ fetch, url, secret }) {
  const base = noSlash(url);
  const call = requester({ fetch, base, headers: { authorization: `Bearer ${secret}` } });
  return {
    placeWord: 'Collection',
    async test() { await call('POST', '/api/auth.info', { json: {} }); },
    async places() { return ((await call('POST', '/api/collections.list', { json: { limit: 100 } })).data || []).map((c) => ({ id: c.id, name: c.name })); },
    async makePlace(name) { const { data } = await call('POST', '/api/collections.create', { json: { name } }); return { id: data.id, name: data.name }; },
    async section({ place, name }) {
      const { data } = await call('POST', '/api/documents.create', { json: { collectionId: place, title: name, text: '', publish: true } });
      return data.id;
    },
    async save({ id, place, section, title, text }) {
      const { data } = id
        ? await call('POST', '/api/documents.update', { json: { id, title, text, publish: true } })
        : await call('POST', '/api/documents.create', { json: { collectionId: place, ...(section ? { parentDocumentId: section } : {}), title, text, publish: true } });
      return { id: data.id, url: data.url?.startsWith('http') ? data.url : base + (data.url || '') };
    },
    async picture({ pageId, name, data, type }) {
      const { data: made } = await call('POST', '/api/attachments.create', { json: { name, contentType: type, size: data.length, documentId: pageId, preset: 'documentAttachment' } });
      const f = form(Object.entries(made.form || {}), { field: 'file', filename: name, type, data });
      await call('POST', made.uploadUrl, { raw: f.body, type: f.type });
      return made.attachment.url;
    },
  };
}

const WIKIS = { bookstack, wikijs, outline };
const isWiki = (kind) => Object.hasOwn(WIKIS, kind);
const createWiki = ({ kind, ...rest }) => WIKIS[kind](rest);

// ---------------------------------------------------------------- documents to pages

const FRONT = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
// A target is either plain, or in <angle brackets> when it has spaces in it.
const PICTURE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;
const LINK = /(?<!!)\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)/g;
const MARKDOWN = /\.(?:md|markdown|mdown|mkd)$/i;

/** A document as a wiki page: its title (the first heading, or its name) and what follows. */
const stripFront = (text) => String(text || '').replace(/\r\n/g, '\n').replace(FRONT, '').trim();

function pageFrom(text, name) {
  const body = stripFront(text);
  const heading = /^# +(.+?)[ \t]*(?:\n+|$)/.exec(body);
  const title = heading ? heading[1].replace(/\s+#+$/, '') : String(name || 'Untitled').replace(/\.[^.]+$/, '');
  return { title, text: heading ? body.slice(heading[0].length).trim() : body };
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The pictures this page holds on your computer, as paths from the document. */
function localPictures(text) {
  const seen = new Set();
  for (const m of String(text).matchAll(PICTURE)) {
    const src = m[2] ?? m[3];
    if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) seen.add(src);
  }
  return [...seen];
}

const swapPictures = (text, swaps) => String(text).replace(PICTURE, (whole, alt, angled, plain) => {
  const url = angled ?? plain;
  return swaps.has(url) ? `![${alt}](${swaps.get(url)})` : whole;
});

/** Where a picture named in a document is on this computer. */
const pictureFile = (dir, src) => path.join(dir, ...decode(src).split('/'));

/** Links to other documents you're publishing become links to their pages. */
function swapLinks(text, rel, urlOf) {
  const dir = path.posix.dirname(rel);
  const find = (target) => urlOf(path.posix.normalize(path.posix.join(dir, target)));
  return String(text)
    .replace(LINK, (whole, label, angled, plain) => {
      const [target, hash] = String(angled ?? plain).split(/(?=#)/);
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || !MARKDOWN.test(target)) return whole;
      const url = find(decode(target));
      return url ? `[${label}](${url}${hash || ''})` : whole;
    })
    .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (whole, target, label) => {
      const name = target.trim();
      const url = find(MARKDOWN.test(name) ? name : `${name}.md`) || urlOf(`*/${name.toLowerCase()}`);
      return url ? `[${(label || name).trim()}](${url})` : whole;
    });
}

const hashOf = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
const typeOf = (name) => TYPES[path.extname(name).slice(1).toLowerCase()] || null;

/**
 * Publish documents to a place on a wiki. `docs` are { key, rel, name, text, dir }, `known` is what was published before,
 * by key. Pages are made first and then filled in, so pictures have a page to go on and links have a page to go to.
 */
async function publish({ wiki, place, docs, known = {}, readFile, onStep = () => {} }) {
  const next = { ...known };
  const report = { made: 0, updated: 0, same: 0, pictures: 0, failed: [], missing: 0, pages: [] };
  const sections = new Map();
  const pages = docs.map((d) => ({ ...d, ...pageFrom(d.text, d.name), record: known[d.key] || null }));

  const urlOf = (target) => {
    if (target.startsWith('*/')) {
      const name = target.slice(2);
      const hit = pages.find((p) => path.posix.basename(p.rel).replace(/\.[^.]+$/, '').toLowerCase() === name);
      return hit?.record?.url || null;
    }
    return pages.find((p) => p.rel === target)?.record?.url || null;
  };
  // A folder's place on the wiki is remembered, because on some wikis asking for it makes a new one.
  const sectionFor = async (rel) => {
    const folder = path.posix.dirname(rel);
    if (folder === '.') return null;
    const key = `section|${place}|${folder}`;
    if (next[key]?.id) return next[key].id;
    const name = folder.split('/').join(' / ');
    if (!sections.has(folder)) sections.set(folder, await wiki.section({ place, name }));
    next[key] = { id: sections.get(folder) };
    return sections.get(folder);
  };

  // First: every new page exists, so that every link has somewhere to go.
  for (const p of pages) {
    onStep(p.rel);
    try {
      if (!p.record) {
        p.section = await sectionFor(p.rel);
        const made = await wiki.save({ place, section: p.section, title: p.title, name: p.name, text: p.text });
        p.record = { id: made.id, url: made.url, hash: '', pictures: {} };
        p.isNew = true;
      }
    } catch (err) {
      if (err.code === 'offline' || err.code === 'key') throw err;
      report.failed.push({ rel: p.rel, message: err.message });
      p.failed = true;
    }
  }

  // Then: pictures and links, and the words that hold them.
  for (const p of pages) {
    if (p.failed) continue;
    onStep(p.rel);
    try {
      const swaps = new Map();
      const pictures = { ...p.record.pictures };
      for (const src of localPictures(p.text)) {
        const data = await readFile(pictureFile(p.dir, src));
        const type = data && typeOf(src);
        if (!data || !type) { report.missing += 1; continue; }
        const hash = hashOf(data.toString('latin1'));
        if (!pictures[hash]) {
          pictures[hash] = await wiki.picture({ pageId: p.record.id, name: path.posix.basename(decode(src)), data, type });
          report.pictures += 1;
        }
        swaps.set(src, pictures[hash]);
      }
      const text = swapLinks(swapPictures(p.text, swaps), p.rel, urlOf);
      const hash = hashOf(p.title, text);
      if (hash === p.record.hash) { report.same += 1; continue; }
      let saved;
      try {
        saved = await wiki.save({ id: p.record.id, place, section: p.section, title: p.title, name: p.name, text });
      } catch (err) {
        if (err.code !== 'not_found') throw err;
        saved = await wiki.save({ place, section: await sectionFor(p.rel), title: p.title, name: p.name, text });   // it was removed on the wiki, so it's made again
        p.isNew = true;
      }
      next[p.key] = { id: saved.id, url: saved.url, hash, pictures };
      p.record = next[p.key];
      report.pages.push({ key: p.key, title: p.title, url: saved.url });
      if (p.isNew) report.made += 1; else report.updated += 1;
    } catch (err) {
      if (p.isNew) next[p.key] = { ...p.record, hash: '' };
      if (err.code === 'offline' || err.code === 'key') throw Object.assign(err, { known: next });
      report.failed.push({ rel: p.rel, message: err.message });
    }
  }
  return { known: next, report };
}

module.exports = { WikiError, PICTURE, createWiki, isWiki, pageFrom, stripFront, localPictures, pictureFile, typeOf, swapPictures, swapLinks, publish, form, slug };
