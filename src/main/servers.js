'use strict';
// Home server presets (3.9): one place for your servers' addresses, with their passwords and keys kept encrypted by main.js.
// Blogs and Discord channels (3.10) live in the same list.
const crypto = require('node:crypto');
const webdav = require('./webdav');
const wikis = require('./wikis');
const blogs = require('./blogs');
const discord = require('./discord');

const KINDS = {
  nextcloud: { name: 'Nextcloud', folders: true, user: true },
  webdav: { name: 'WebDAV', folders: true, user: true },
  bookstack: { name: 'BookStack', wiki: true },
  wikijs: { name: 'Wiki.js', wiki: true },
  outline: { name: 'Outline', wiki: true },
  wordpress: { name: 'WordPress', blog: true, user: true },
  ghost: { name: 'Ghost', blog: true },
  discord: { name: 'Discord', channel: true, url: 'https://discord.com' },
};
const MAX_SERVERS = 40;

function cleanUrl(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  return url.href.replace(/\/+$/, '');
}

/** A server as settings keep it: nothing here is a secret. */
function cleanServer(s) {
  if (!s || typeof s !== 'object' || !Object.hasOwn(KINDS, s.kind)) return null;
  const url = cleanUrl(KINDS[s.kind].url || s.url);
  if (!url) return null;
  const id = typeof s.id === 'string' && /^[a-z0-9-]{6,40}$/.test(s.id) ? s.id : crypto.randomUUID();
  const name = String(s.name || '').trim().slice(0, 60) || KINDS[s.kind].name;
  return { id, kind: s.kind, name, url, user: KINDS[s.kind].user ? String(s.user || '').trim().slice(0, 200) : '' };
}

const cleanServers = (list) => (Array.isArray(list) ? list.map(cleanServer).filter(Boolean).slice(0, MAX_SERVERS) : []);

const plainAddress = (url) => /^http:/i.test(url) && !/^http:\/\/(?:localhost|127\.|\[::1\])/i.test(url);

const davClient = ({ fetch, server, secret }) => webdav.createClient({ fetch, url: webdav.davUrl(server), user: server.user, password: secret });
const wikiClient = ({ fetch, server, secret }) => wikis.createWiki({ kind: server.kind, fetch, url: server.url, secret });
const blogClient = ({ fetch, server, secret }) => blogs.createBlog({ kind: server.kind, fetch, url: server.url, user: server.user, secret });
const channelClient = ({ fetch, secret }) => discord.createChannel({ fetch, webhook: secret });

/** Does this server answer, and take this password or key? */
async function testServer({ fetch, server, secret }) {
  const { folders, blog, channel } = KINDS[server.kind];
  const make = folders ? davClient : blog ? blogClient : channel ? channelClient : wikiClient;
  await make({ fetch, server, secret }).test();
}

module.exports = { KINDS, cleanServer, cleanServers, cleanUrl, plainAddress, davClient, wikiClient, blogClient, channelClient, testServer };
