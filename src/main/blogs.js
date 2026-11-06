'use strict';
// Drafts on your blog (3.10): a document as a draft post on WordPress or Ghost, with its title, tags, featured picture and
// pictures. Everything goes as a draft, and a post that's already published is never changed from here: you publish from
// the site. This file doesn't use Electron: main.js gives it fetch, the key and a way to read files.
const crypto = require('node:crypto');
const path = require('node:path');
const { WikiError, form, slug, pageFrom, stripFront, localPictures, pictureFile, typeOf } = require('./wikis');
const { extract } = require('./notes-core');

const TIMEOUT_MS = 60 * 1000;
const MAX_TAGS = 20;
const MOVED = 'That address moves somewhere else. Use the one your browser shows, with https:// if it has it.';

class BlogError extends WikiError {}

const noSlash = (s) => String(s || '').trim().replace(/\/+$/, '');
const hostOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };

/** A request, and a plain answer when it doesn't work. `refusal` turns a site's "no" into words. */
function requester({ fetch, headers, refusal }) {
  return async function call(method, url, { json, raw, type, extra } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        redirect: 'manual',            // a key is never carried to another address without you saying so
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', ...headers(), ...extra, ...(json ? { 'content-type': 'application/json' } : {}), ...(type ? { 'content-type': type } : {}) },
        body: json ? JSON.stringify(json) : raw,
      });
    } catch (err) {
      if (/redirect/i.test(err?.message)) throw new BlogError(MOVED, 'moved');     // how Electron's fetch says it
      throw new BlogError('The site can’t be reached. Check the address and that you’re online.', 'offline');
    }
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      const to = hostOf(res.headers.get('location'));
      throw new BlogError(to ? `That address moves to ${to}. Use that one.` : MOVED, 'moved');
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw refusal(res.status, data);
    if (data === null) throw new BlogError('That doesn’t look like a blog. Check the address.', 'not_blog');
    return data;
  };
}

// ---------------------------------------------------------------- WordPress

function wordpressRefusal(status, data) {
  const code = String(data?.code || '');
  if (code === 'application_passwords_disabled' || code === 'application_passwords_disabled_for_user') {
    return new BlogError('Application passwords are turned off on that site.', 'key');
  }
  if (status === 401 || /incorrect_password|invalid_username|invalid_email/.test(code)) {
    return new BlogError('The site didn’t accept that. Use your user name with an application password, not your sign-in password.', 'key');
  }
  if (status === 403) return new BlogError('Your account on that site isn’t allowed to do that.', 'refused');
  if (status === 404) return new BlogError('That isn’t on the site any more.', 'not_found');
  if (status === 413) return new BlogError('That’s too large for the site to take.', 'too_large');
  return new BlogError(data?.message ? `The site said: ${String(data.message).slice(0, 300)}` : `The site answered ${status}.`, code === 'term_exists' ? 'term_exists' : 'failed');
}

function wordpress({ fetch, url, user, secret }) {
  const base = noSlash(url);
  const authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  const call = requester({ fetch, headers: () => ({ authorization }), refusal: wordpressRefusal });
  let plain = false;             // a site with plain links has no /wp-json address, and takes ?rest_route= instead
  let checked = null;
  const route = (p) => {
    if (!plain) return `${base}/wp-json/wp/v2${p}`;
    const [where, query] = p.split('?');
    return `${base}/?rest_route=/wp/v2${where}${query ? `&${query}` : ''}`;
  };
  const check = async () => {
    const me = () => call('GET', route('/users/me?context=edit'));
    try {
      await me();
    } catch (err) {
      if (err.code !== 'not_found' && err.code !== 'not_blog') throw err;
      plain = true;
      await me().catch((again) => {
        if (again.code === 'not_found' || again.code === 'not_blog') throw new BlogError('That doesn’t look like a WordPress site. Check the address.', 'not_blog');
        throw again;
      });
    }
  };
  const ready = () => {
    checked ??= check().catch((err) => { checked = null; throw err; });
    return checked;
  };
  async function tagId(name) {
    const found = await call('GET', route(`/tags?search=${encodeURIComponent(name)}&per_page=100`));
    const same = (Array.isArray(found) ? found : []).find((t) => String(t.name).toLowerCase() === name.toLowerCase());
    if (same) return same.id;
    try {
      return (await call('POST', route('/tags'), { json: { name } })).id;
    } catch (err) {
      if (err.code !== 'term_exists') throw err;
      return (await call('GET', route(`/tags?search=${encodeURIComponent(name)}&per_page=100`))).find((t) => String(t.name).toLowerCase() === name.toLowerCase())?.id;
    }
  }
  return {
    test: ready,
    async status(id) {
      await ready();
      try {
        const { status } = await call('GET', route(`/posts/${id}?context=edit&_fields=id,status`));
        if (status === 'trash') return null;
        return ['draft', 'pending', 'auto-draft'].includes(status) ? 'draft' : 'published';
      } catch (err) {
        if (err.code === 'not_found') return null;
        throw err;
      }
    },
    async picture({ name, data, type }) {
      await ready();
      const ext = path.extname(name).toLowerCase();
      const made = await call('POST', route('/media'), { raw: data, type, extra: { 'content-disposition': `attachment; filename="${slug(path.basename(name, ext))}${ext}"` } });
      return { id: made.id, url: made.source_url };
    },
    async save({ id, title, html, excerpt, tags, featured }) {
      await ready();
      const skipped = [];
      const ids = [];
      for (const name of tags) {
        try {
          const tag = await tagId(name);
          if (tag) ids.push(tag); else skipped.push(name);
        } catch (err) {
          if (err.code === 'offline' || err.code === 'key') throw err;
          skipped.push(name);
        }
      }
      const fields = { title, content: html, excerpt: excerpt || '', tags: ids, featured_media: featured?.id || 0 };
      const post = await call('POST', route(id ? `/posts/${id}` : '/posts'), { json: id ? fields : { ...fields, status: 'draft' } });
      return { id: String(post.id), url: `${base}/wp-admin/post.php?post=${post.id}&action=edit`, skipped };
    },
  };
}

// ---------------------------------------------------------------- Ghost

function ghostRefusal(status, data) {
  const said = data?.errors?.[0];
  if (status === 401) return new BlogError('The site didn’t accept that key. Use the Admin API key of a custom integration.', 'key');
  if (status === 403) return new BlogError('That key isn’t allowed to do that.', 'refused');
  if (status === 404) return new BlogError('That isn’t on the site any more.', 'not_found');
  if (status === 413) return new BlogError('That’s too large for the site to take.', 'too_large');
  const words = said?.context || said?.message;
  return new BlogError(words ? `The site said: ${String(words).slice(0, 300)}` : `The site answered ${status}.`, 'failed');
}

const b64url = (data) => Buffer.from(data).toString('base64url');

/** Ghost's Admin API takes a short-lived token signed with the key, not the key itself. */
function ghostToken(secret, now = Date.now()) {
  const [id, hex] = String(secret).trim().split(':');
  if (!/^[a-f0-9]+$/i.test(id || '') || !/^[a-f0-9]{32,}$/i.test(hex || '')) {
    throw new BlogError('That doesn’t look like an Admin API key. It has two parts with a colon between them.', 'key');
  }
  const at = Math.floor(now / 1000);
  const body = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }))}.${b64url(JSON.stringify({ iat: at, exp: at + 300, aud: '/admin/' }))}`;
  return `${body}.${crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update(body).digest('base64url')}`;
}

function ghost({ fetch, url, secret }) {
  const base = noSlash(url);
  const api = `${base}/ghost/api/admin`;
  const call = requester({ fetch, headers: () => ({ authorization: `Ghost ${ghostToken(secret)}`, 'accept-version': 'v5.0' }), refusal: ghostRefusal });
  const read = async (id) => (await call('GET', `${api}/posts/${id}/?fields=id,status,updated_at`)).posts?.[0];
  return {
    async test() { await call('GET', `${api}/posts/?limit=1&fields=id`); },
    async status(id) {
      try {
        const post = await read(id);
        return post?.status === 'draft' ? 'draft' : post ? 'published' : null;
      } catch (err) {
        if (err.code === 'not_found') return null;
        throw err;
      }
    },
    async picture({ name, data, type }) {
      const f = form([['purpose', 'image'], ['ref', name]], { field: 'file', filename: name, type, data });
      const { images } = await call('POST', `${api}/images/upload/`, { raw: f.body, type: f.type });
      return { id: images[0].url, url: images[0].url };
    },
    async save({ id, title, html: words, excerpt, tags, featured }) {
      // Ghost's converter drops <mark> and the spaces around it, so highlighted words run into their neighbours.
      const html = words.replace(/<(\/?)mark>/g, '<$1strong>');
      const fields = { title, html, custom_excerpt: (excerpt || '').slice(0, 300) || null, tags: tags.map((name) => ({ name })), feature_image: featured?.url || null };
      const answer = id
        ? await call('PUT', `${api}/posts/${id}/?source=html`, { json: { posts: [{ ...fields, updated_at: (await read(id)).updated_at }] } })
        : await call('POST', `${api}/posts/?source=html`, { json: { posts: [{ ...fields, status: 'draft' }] } });
      const post = answer.posts[0];
      return { id: post.id, url: `${base}/ghost/#/editor/post/${post.id}`, skipped: [] };
    },
  };
}

const BLOGS = { wordpress, ghost };
const createBlog = ({ kind, ...rest }) => BLOGS[kind](rest);

// ---------------------------------------------------------------- documents to posts

/** The line of front matter under one of these names, as plain text. */
function frontValue(text, names) {
  const front = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ''));
  if (!front) return '';
  for (const line of front[1].split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.+)$/.exec(line);
    if (m && names.includes(m[1].toLowerCase())) return m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

const isLocal = (src) => !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//') && !src.startsWith('#');

/** What a document says about itself as a post. The body has no front matter, and no title heading if that's the title. */
function postFrom(text, name) {
  const facts = extract(text);
  const page = pageFrom(text, name);
  const title = facts.title || page.title;
  const seen = new Set();
  const tags = facts.tags.map((t) => t.tag).filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_TAGS);
  const named = frontValue(text, ['image', 'cover', 'banner', 'featured', 'featured_image', 'feature_image']);
  const pictures = localPictures(page.text);
  const body = page.title === title ? page.text : stripFront(text);
  return {
    title,
    tags,
    excerpt: frontValue(text, ['excerpt', 'description', 'summary']),
    body,
    pictures: isLocal(named) && !pictures.includes(named) ? [named, ...pictures] : pictures,
    featured: isLocal(named) ? named : pictures[0] || '',
  };
}

const IMG = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi;
const unescapeAttr = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The pictures this HTML holds on your computer. */
function localSources(html) {
  return [...new Set([...String(html).matchAll(IMG)].map((m) => unescapeAttr(m[2])).filter(isLocal))];
}

const swapSources = (html, swaps) => String(html).replace(IMG, (whole, open, src, close) => {
  const url = swaps.get(unescapeAttr(src));
  return url ? `${open}${escapeAttr(url)}${close}` : whole;
});

/** Pictures that stayed on this computer would be broken on the site, so they come out. You're told which didn't go. */
const dropLocal = (html) => String(html)
  .replace(/<img\b[^>]*?\bsrc="([^"]*)"[^>]*>/gi, (whole, src) => (isLocal(unescapeAttr(src)) ? '' : whole))
  .replace(/<p>\s*<\/p>\s*/g, '');

/**
 * Send one post. `post` is { title, html, excerpt, tags, featured }, `record` is what happened the last time. A draft
 * is updated in place. If you've published it (or removed it) since, this makes a new draft and leaves that one alone.
 */
async function sendDraft({ blog, post, record = null, dir, readFile }) {
  const state = record ? await blog.status(record.id) : null;
  const update = state === 'draft';
  const pictures = state ? { ...record.pictures } : {};
  const report = { pictures: 0, missing: 0, refused: [], skippedTags: [] };

  const upload = async (src) => {
    const data = await readFile(pictureFile(dir, src));
    const type = data && typeOf(src);
    if (!data || !type) { report.missing += 1; return null; }
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 24);
    if (pictures[hash]) return pictures[hash];
    try {
      pictures[hash] = await blog.picture({ name: path.basename(pictureFile(dir, src)), data, type });
      report.pictures += 1;
      return pictures[hash];
    } catch (err) {
      if (err.code === 'offline' || err.code === 'key') throw err;
      report.refused.push({ name: src, message: err.message });
      return null;
    }
  };

  const swaps = new Map();
  for (const src of localSources(post.html)) {
    const got = await upload(src);
    if (got) swaps.set(src, got.url);
  }
  const featured = post.featured ? await upload(post.featured) : null;
  const saved = await blog.save({ ...post, id: update ? record.id : null, html: dropLocal(swapSources(post.html, swaps)), featured });
  report.skippedTags = saved.skipped;
  return {
    record: { id: saved.id, url: saved.url, pictures },
    url: saved.url,
    action: update ? 'updated' : 'made',
    published: state === 'published',
    report,
  };
}

module.exports = { BlogError, createBlog, ghostToken, postFrom, localSources, swapSources, sendDraft };
