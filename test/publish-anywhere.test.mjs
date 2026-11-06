import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/renderer/markdown.js';
import { postHtml } from '../src/renderer/post-html.js';

const require = createRequire(import.meta.url);
const { createBlog, ghostToken, postFrom, localSources, swapSources, sendDraft } = require('../src/main/blogs.js');
const { cleanWebhook, createChannel, messagesFrom, openingOf, post, MAX_MESSAGES } = require('../src/main/discord.js');
const { createSent } = require('../src/main/sent.js');
const { cleanServer, KINDS } = require('../src/main/servers.js');

const answer = (status, data, headers = {}) => new Response(data === undefined ? null : typeof data === 'string' ? data : JSON.stringify(data), { status, headers });

/** A fetch that remembers what it was asked and answers from a list of [test, reply]. */
function stub(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    for (const [match, reply] of routes) if (match(url, init)) return typeof reply === 'function' ? reply(url, init) : reply.clone();
    return answer(404, { code: 'rest_no_route' });
  };
  return { fetch, calls };
}

// ---------------------------------------------------------------- documents to posts

test('a document says what it is as a post', () => {
  const text = '---\ntitle: The Real Title\ntags: [Books, news]\ndescription: "A short line"\nimage: images/cover.png\n---\n\n# The Real Title\n\nWords #news and #launch.\n\n![a](images/a.png)\n';
  const p = postFrom(text, 'file.md');
  assert.equal(p.title, 'The Real Title');
  assert.deepEqual(p.tags, ['Books', 'news', 'launch']);
  assert.equal(p.excerpt, 'A short line');
  assert.equal(p.body, 'Words #news and #launch.\n\n![a](images/a.png)');
  assert.deepEqual(p.pictures, ['images/cover.png', 'images/a.png']);
  assert.equal(p.featured, 'images/cover.png');
});

test('with no front matter, the heading is the title and the first picture is featured', () => {
  const p = postFrom('# Hello\n\n![a](a.png) ![b](https://x.test/b.png)\n', 'file.md');
  assert.equal(p.title, 'Hello');
  assert.equal(p.featured, 'a.png');
  assert.deepEqual(p.pictures, ['a.png']);
  assert.equal(postFrom('Just words', 'my note.md').title, 'my note');
});

test('a heading that isn’t the title stays in the post', () => {
  const p = postFrom('---\ntitle: Other\n---\n\n# Chapter One\n\nWords\n', 'a.md');
  assert.equal(p.title, 'Other');
  assert.equal(p.body, '# Chapter One\n\nWords');
});

test('only pictures on your computer are swapped, however they’re written', () => {
  const html = '<p><img src="images/my%20pic.png" alt="a"><img alt="b" src="https://x.test/b.png"><img src="data:image/png;base64,AA"><img src="a&amp;b.png"></p>';
  assert.deepEqual(localSources(html), ['images/my%20pic.png', 'a&b.png']);
  const out = swapSources(html, new Map([['images/my%20pic.png', 'https://s/1.png?a=1&b=2'], ['a&b.png', 'https://s/2.png']]));
  assert.match(out, /src="https:\/\/s\/1\.png\?a=1&amp;b=2"/);
  assert.match(out, /src="https:\/\/s\/2\.png"/);
  assert.match(out, /src="https:\/\/x\.test\/b\.png"/);
});

test('post HTML has no reader styling and nothing pointing at this computer', () => {
  const { window } = new JSDOM('<!doctype html>');
  const render = createRenderer(window);
  const body = 'A [link](other.md) and [[Wiki]] and [web](https://x.test/) and $x^2$.\n\n> [!NOTE]\n> Careful\n\n```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD\n```\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## A heading\n\n![p](images/p.png)\n';
  const { html, diagrams } = postHtml(render, body, window.document);
  assert.equal(diagrams, 1);
  assert.doesNotMatch(html.replace(/class="language-\w+"/g, ''), /class=|data-|style=|header-anchor|<svg|table-wrap|<input|katex/);
  assert.doesNotMatch(html, /other\.md|Wiki\.md/);
  assert.match(html, /<a href="https:\/\/x\.test\/">web<\/a>/);
  assert.match(html, /<code>x\^2<\/code>/);
  assert.match(html, /<pre><code class="language-js">const a = 1;\n<\/code><\/pre>/);
  assert.match(html, /<pre><code>graph TD/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<li>☑ done<\/li>/);
  assert.match(html, /<li>☐ todo<\/li>/);
  assert.doesNotMatch(html, /dir="auto"|<label|<section/);
  assert.match(html, /<strong>Note<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<img src="images\/p\.png"/);
});

// ---------------------------------------------------------------- WordPress

const wpRoutes = (extra = []) => [
  ...extra,
  [(u) => u.includes('/users/me'), answer(200, { id: 1 })],
  [(u, i) => u.includes('/tags?') && i.method === 'GET', answer(200, [{ id: 5, name: 'Books' }, { id: 6, name: 'Bookshelf' }])],
  [(u, i) => u.endsWith('/tags') && i.method === 'POST', answer(201, { id: 7 })],
  [(u, i) => u.endsWith('/media'), answer(201, { id: 40, source_url: 'https://s/wp-content/a.png' })],
  [(u, i) => /\/posts\/\d+\?context/.test(u), answer(200, { id: 9, status: 'draft' })],
  [(u, i) => /\/posts(\/\d+)?$/.test(u), answer(201, { id: 9 })],
];

test('WordPress: a new draft with its tags and featured picture', async () => {
  const { fetch, calls } = stub(wpRoutes());
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s/', user: 'neo', secret: 'abcd efgh' });
  const read = async () => Buffer.from('png');
  const res = await sendDraft({ blog, dir: '/d', readFile: read, post: { title: 'T', html: '<img src="a.png">', excerpt: 'E', tags: ['books', 'New'], featured: 'a.png' } });
  assert.equal(res.action, 'made');
  assert.equal(res.url, 'https://s/wp-admin/post.php?post=9&action=edit');
  const sent = calls.find((c) => c.url.endsWith('/wp/v2/posts'));
  assert.equal(sent.headers.authorization, `Basic ${Buffer.from('neo:abcd efgh').toString('base64')}`);
  const fields = JSON.parse(sent.body);
  assert.equal(fields.status, 'draft');
  assert.deepEqual(fields.tags, [5, 7]);
  assert.equal(fields.featured_media, 40);
  assert.equal(fields.content, '<img src="https://s/wp-content/a.png">');
  assert.equal(calls.filter((c) => c.url.endsWith('/media')).length, 1, 'the same picture goes once');
  const media = calls.find((c) => c.url.endsWith('/media'));
  assert.match(media.headers['content-disposition'], /filename="a\.png"/);
});

test('WordPress: sending again updates the draft, without its status or the pictures again', async () => {
  const { fetch, calls } = stub(wpRoutes());
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'neo', secret: 'k' });
  const hash = crypto.createHash('sha256').update('png').digest('hex').slice(0, 24);
  const record = { id: '9', url: 'x', pictures: { [hash]: { id: 40, url: 'https://s/old.png' } } };
  const res = await sendDraft({ blog, dir: '/d', record, readFile: async () => Buffer.from('png'), post: { title: 'T', html: '<img src="a.png">', tags: [], featured: '' } });
  assert.equal(res.action, 'updated');
  assert.equal(calls.filter((c) => c.url.endsWith('/media')).length, 0);
  const fields = JSON.parse(calls.find((c) => c.url.endsWith('/posts/9')).body);
  assert.equal('status' in fields, false);
  assert.equal(fields.content, '<img src="https://s/old.png">');
});

test('WordPress: a published post is never changed: a new draft is made', async () => {
  const { fetch, calls } = stub(wpRoutes([[(u) => /\/posts\/9\?context/.test(u), answer(200, { id: 9, status: 'publish' })]]));
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'neo', secret: 'k' });
  const res = await sendDraft({ blog, dir: '/d', record: { id: '9', pictures: {} }, readFile: async () => null, post: { title: 'T', html: '<p>x</p>', tags: [], featured: '' } });
  assert.equal(res.published, true);
  assert.equal(res.action, 'made');
  assert.equal(calls.some((c) => c.url.endsWith('/posts/9')), false);
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/wp/v2/posts')).body).status, 'draft');
});

test('WordPress: a trashed or removed post gets a new draft, and its old pictures aren’t trusted', async () => {
  for (const reply of [answer(200, { status: 'trash' }), answer(404, { code: 'rest_post_invalid_id' })]) {
    const { fetch, calls } = stub(wpRoutes([[(u) => /\/posts\/9\?context/.test(u), reply]]));
    const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'neo', secret: 'k' });
    const hash = crypto.createHash('sha256').update('png').digest('hex').slice(0, 24);
    await sendDraft({ blog, dir: '/d', record: { id: '9', pictures: { [hash]: { id: 1, url: 'gone' } } }, readFile: async () => Buffer.from('png'), post: { title: 'T', html: '<img src="a.png">', tags: [], featured: '' } });
    assert.equal(calls.filter((c) => c.url.endsWith('/media')).length, 1);
  }
});

test('WordPress: a site with plain links is found through ?rest_route=', async () => {
  const { fetch, calls } = stub([
    [(u) => u.includes('/wp-json/'), answer(404, '<html>not found</html>')],
    [(u) => u.includes('rest_route=/wp/v2/users/me'), answer(200, { id: 1 })],
    [(u) => u.includes('rest_route=/wp/v2/posts'), answer(201, { id: 3 })],
  ]);
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'neo', secret: 'k' });
  await blog.test();
  await blog.save({ title: 'T', html: '', tags: [] });
  assert.ok(calls.at(-1).url.endsWith('/?rest_route=/wp/v2/posts'));
  assert.match(calls.find((c) => c.url.includes('users/me') && c.url.includes('rest_route')).url, /rest_route=\/wp\/v2\/users\/me&context=edit$/);
});

test('WordPress: what goes wrong is said plainly', async () => {
  const say = async (reply) => {
    const blog = createBlog({ kind: 'wordpress', fetch: async () => reply.clone(), url: 'https://s', user: 'u', secret: 'k' });
    return blog.test().then(() => 'fine', (err) => [err.code, err.message]);
  };
  assert.equal((await say(answer(401, { code: 'incorrect_password' })))[0], 'key');
  assert.match((await say(answer(401, { code: 'application_passwords_disabled' })))[1], /turned off/);
  assert.equal((await say(answer(200, '<html>a shop</html>')))[0], 'not_blog');
  assert.deepEqual(await say(answer(301, undefined, { location: 'https://www.s/wp-json/' })), ['moved', 'That address moves to https://www.s. Use that one.']);
  const electronSays = createBlog({ kind: 'wordpress', fetch: async () => { throw new Error('Redirect was cancelled'); }, url: 'https://s', user: 'u', secret: 'k' });
  await assert.rejects(electronSays.test(), { code: 'moved' });
  const offline = createBlog({ kind: 'wordpress', fetch: async () => { throw new Error('no'); }, url: 'https://s', user: 'u', secret: 'k' });
  await assert.rejects(offline.test(), { code: 'offline' });
});

test('a key never follows a redirect', async () => {
  let asked;
  const fetch = async (u, init) => { asked = init.redirect; return answer(200, { id: 1 }); };
  await createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'u', secret: 'k' }).test();
  assert.equal(asked, 'manual');
});

test('a picture that didn’t go leaves nothing broken behind', async () => {
  const { fetch, calls } = stub(wpRoutes([[(u) => u.endsWith('/media'), answer(500, { message: 'no' })]]));
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'n', secret: 'k' });
  await sendDraft({ blog, dir: '/d', readFile: async () => Buffer.from('x'), post: { title: 'T', html: '<p>Words</p><p><img src="a.png" alt="x"></p><p><img src="https://x.test/b.png"></p>', tags: [], featured: '' } });
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/wp/v2/posts')).body).content, '<p>Words</p><p><img src="https://x.test/b.png"></p>');
});

test('Ghost: highlighted words keep their spaces', async () => {
  const { fetch, calls } = stub([[(u) => u.includes('/posts/?source=html'), answer(201, { posts: [{ id: 'p' }] })]]);
  await createBlog({ kind: 'ghost', fetch, url: 'https://g', secret: `${'a'.repeat(24)}:${'0f'.repeat(32)}` }).save({ title: 'T', html: 'a <mark>b</mark> c', tags: [] });
  assert.equal(JSON.parse(calls[0].body).posts[0].html, 'a <strong>b</strong> c');
});

test('a refused picture or tag doesn’t stop the draft', async () => {
  const { fetch } = stub(wpRoutes([
    [(u) => u.endsWith('/media'), answer(500, { code: 'rest_upload_unknown_error', message: 'Sorry, this file type is not permitted.' })],
    [(u) => u.includes('/tags?'), answer(403, { code: 'rest_forbidden' })],
  ]));
  const blog = createBlog({ kind: 'wordpress', fetch, url: 'https://s', user: 'n', secret: 'k' });
  const res = await sendDraft({ blog, dir: '/d', readFile: async () => Buffer.from('x'), post: { title: 'T', html: '<img src="a.svg"><img src="gone.txt">', tags: ['t'], featured: '' } });
  assert.equal(res.report.refused.length, 1);
  assert.equal(res.report.missing, 1);
  assert.deepEqual(res.report.skippedTags, ['t']);
});

// ---------------------------------------------------------------- Ghost

const KEY = `${'a'.repeat(24)}:${'0f'.repeat(32)}`;

test('Ghost: the token is signed with the key and lasts five minutes', () => {
  const [head, body, sig] = ghostToken(KEY, 1000000).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'HS256', typ: 'JWT', kid: 'a'.repeat(24) });
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url')), { iat: 1000, exp: 1300, aud: '/admin/' });
  assert.equal(sig, crypto.createHmac('sha256', Buffer.from('0f'.repeat(32), 'hex')).update(`${head}.${body}`).digest('base64url'));
  assert.throws(() => ghostToken('not a key'), { code: 'key' });
});

test('Ghost: a new draft, then an update that carries the post’s time', async () => {
  const { fetch, calls } = stub([
    [(u, i) => u.includes('/images/upload/'), answer(201, { images: [{ url: 'https://g/content/a.png' }] })],
    [(u, i) => u.includes('/posts/?source=html'), answer(201, { posts: [{ id: 'p1', status: 'draft' }] })],
    [(u, i) => u.includes('/posts/p1/?fields'), answer(200, { posts: [{ id: 'p1', status: 'draft', updated_at: 'T1' }] })],
    [(u, i) => u.includes('/posts/p1/?source=html'), answer(200, { posts: [{ id: 'p1' }] })],
  ]);
  const blog = createBlog({ kind: 'ghost', fetch, url: 'https://g/', secret: KEY });
  const made = await sendDraft({ blog, dir: '/d', readFile: async () => Buffer.from('png'), post: { title: 'T', html: '<img src="a.png">', excerpt: 'E', tags: ['Books'], featured: 'a.png' } });
  assert.equal(made.url, 'https://g/ghost/#/editor/post/p1');
  const first = calls.find((c) => c.method === 'POST' && c.url.includes('/posts/'));
  assert.match(first.headers.authorization, /^Ghost /);
  assert.equal(first.headers['accept-version'], 'v5.0');
  const { posts: [p] } = JSON.parse(first.body);
  assert.equal(p.status, 'draft');
  assert.equal(p.feature_image, 'https://g/content/a.png');
  assert.deepEqual(p.tags, [{ name: 'Books' }]);
  assert.equal(p.html, '<img src="https://g/content/a.png">');
  const again = await sendDraft({ blog, dir: '/d', record: made.record, readFile: async () => Buffer.from('png'), post: { title: 'T2', html: '<p>x</p>', tags: [], featured: '' } });
  assert.equal(again.action, 'updated');
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(JSON.parse(put.body).posts[0].updated_at, 'T1');
  assert.equal('status' in JSON.parse(put.body).posts[0], false);
});

test('Ghost: a published post is left alone', async () => {
  const { fetch, calls } = stub([
    [(u) => u.includes('/posts/p1/?fields'), answer(200, { posts: [{ id: 'p1', status: 'published', updated_at: 'T' }] })],
    [(u) => u.includes('/posts/?source=html'), answer(201, { posts: [{ id: 'p2' }] })],
  ]);
  const blog = createBlog({ kind: 'ghost', fetch, url: 'https://g', secret: KEY });
  const res = await sendDraft({ blog, dir: '/d', record: { id: 'p1', pictures: {} }, readFile: async () => null, post: { title: 'T', html: '', tags: [], featured: '' } });
  assert.equal(res.published, true);
  assert.equal(res.record.id, 'p2');
  assert.equal(calls.some((c) => c.method === 'PUT'), false);
});

// ---------------------------------------------------------------- Discord

test('only a real webhook address is taken', () => {
  const good = 'https://discord.com/api/webhooks/123/abc-DEF_1';
  assert.equal(cleanWebhook(` ${good}/ `), good);
  assert.equal(cleanWebhook(`${good}?wait=true`), good);
  assert.equal(cleanWebhook('https://ptb.discord.com/api/v10/webhooks/1/a'), 'https://ptb.discord.com/api/v10/webhooks/1/a');
  for (const bad of ['', 'http://discord.com/api/webhooks/1/a', 'https://evil.test/api/webhooks/1/a', 'https://discord.com.evil.test/api/webhooks/1/a', 'https://discord.com/api/webhooks/1']) {
    assert.equal(cleanWebhook(bad), null, bad);
  }
  assert.equal(cleanWebhook('http://127.0.0.1:9/api/webhooks/1/a'), null);
  assert.equal(cleanWebhook('http://127.0.0.1:9/api/webhooks/1/a', 'http://127.0.0.1:9'), 'http://127.0.0.1:9/api/webhooks/1/a');
});

test('a document becomes messages Discord can show', () => {
  const body = 'See [[Other|that one]], [a file](other.md), [web](https://x.test), [here](#part).\n\n#### Small heading\n\n---\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![p](images/p.png) ![r](https://x.test/r.png)\n\n<!-- hidden -->\n';
  const [m, ...rest] = messagesFrom(body, 'My Title');
  assert.equal(rest.length, 0);
  assert.equal(m.content, '# My Title\n\nSee that one, a file, [web](https://x.test), here.\n\n**Small heading**\n\n- ☑ done\n- ☐ todo\n\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n\nhttps://x.test/r.png');
  assert.deepEqual(m.pictures, ['images/p.png']);
});

test('long documents are split without breaking words or code', () => {
  const para = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
  const code = `\`\`\`js\n${Array.from({ length: 400 }, (_, i) => `line ${i} of the code`).join('\n')}\n\`\`\``;
  const list = messagesFrom(`${para}\n\n${code}\n\nThe end.`, 'T');
  assert.ok(list.length > 3);
  for (const m of list) {
    assert.ok(m.content.length <= 2000, `${m.content.length}`);
    assert.equal((m.content.match(/```/g) || []).length % 2, 0, 'code blocks are closed');
  }
  const words = list.map((m) => m.content).join(' ');
  assert.ok(words.includes('word899'));
  assert.ok(words.includes('line 399 of the code'));
  assert.ok(list.at(-1).content.endsWith('The end.'));
});

test('one enormous word is cut, and an unfinished code block is closed', () => {
  const [a, b] = messagesFrom('x'.repeat(2500));
  assert.equal(a.content.length + b.content.length, 2500);
  assert.equal(messagesFrom('```\nnever closed')[0].content, '```\nnever closed\n```');
});

test('more than ten pictures go across messages', () => {
  const list = messagesFrom(Array.from({ length: 12 }, (_, i) => `![p](${i}.png)`).join('\n\n'));
  assert.deepEqual(list.map((m) => m.pictures.length), [10, 2]);
});

test('the opening of a document starts a summary', () => {
  assert.equal(openingOf('## Heading\n\nFirst paragraph.\n\nSecond.'), 'First paragraph.\n\nSecond.');
  assert.ok(openingOf('y'.repeat(5000)).length <= 700);
});

test('posting: nobody is pinged, and the link goes to the first message', async () => {
  const { fetch, calls } = stub([
    [(u, i) => i.method === 'POST', () => answer(200, { id: `m${calls.length}`, channel_id: 'c1' })],
    [(u, i) => i.method === 'GET', answer(200, { guild_id: 'g1', name: 'Hook' })],
  ]);
  const channel = createChannel({ fetch, webhook: 'https://discord.com/api/webhooks/1/a' });
  const res = await post({ channel, messages: [{ content: '@everyone hi', pictures: [] }, { content: 'two', pictures: [] }], dir: '/d', readFile: async () => null });
  assert.equal(res.report.sent, 2);
  assert.equal(res.url, 'https://discord.com/channels/g1/c1/m1');
  const first = calls[0];
  assert.ok(first.url.endsWith('?wait=true'));
  assert.deepEqual(JSON.parse(first.body).allowed_mentions, { parse: [] });
});

test('posting: pictures go as files, and big or missing ones are counted', async () => {
  const { fetch, calls } = stub([[(u, i) => i.method === 'POST', () => answer(200, { id: 'm', channel_id: 'c' })], [() => true, answer(200, {})]]);
  const channel = createChannel({ fetch, webhook: 'https://discord.com/api/webhooks/1/a' });
  const files = { 'a.png': Buffer.from('PNGDATA'), 'big.png': Buffer.alloc(11 * 1024 * 1024) };
  const res = await post({ channel, messages: [{ content: 'x', pictures: ['a.png', 'big.png', 'gone.png'] }], dir: 'd', readFile: async (f) => files[path.basename(f)] || null });
  assert.deepEqual([res.report.pictures, res.report.tooBig, res.report.missing], [1, 1, 1]);
  const body = calls[0].body.toString();
  assert.match(calls[0].headers['content-type'], /^multipart\/form-data/);
  assert.match(body, /name="payload_json"/);
  assert.match(body, /name="files\[0\]"; filename="picture-1\.png"/);
  assert.match(body, /PNGDATA/);
});

test('posting: Discord asking to slow down is obeyed, and a stop says how far it got', async () => {
  let n = 0;
  const waits = [];
  const fetch = async (u, init) => {
    if (init.method === 'GET') return answer(200, { guild_id: 'g' });
    n += 1;
    if (n === 1) return answer(429, { retry_after: 2 });
    if (n === 3) return answer(404, { code: 10015 });
    return answer(200, { id: `m${n}`, channel_id: 'c' });
  };
  const channel = createChannel({ fetch, webhook: 'https://discord.com/api/webhooks/1/a', wait: async (ms) => { waits.push(ms); } });
  await assert.rejects(post({ channel, messages: [{ content: 'a', pictures: [] }, { content: 'b', pictures: [] }], dir: 'd', readFile: async () => null }), (err) => {
    assert.match(err.message, /^Stopped after 1 of 2 messages\./);
    assert.equal(err.partial.url, 'https://discord.com/channels/g/c/m2');
    assert.doesNotMatch(err.message, /webhooks/);
    return true;
  });
  assert.deepEqual(waits, [2100]);
});

test('the message limit is there to stop a flood', () => {
  assert.ok(messagesFrom('word '.repeat(10000)).length > MAX_MESSAGES);
});

// ---------------------------------------------------------------- history and the server list

test('a document remembers where it went, newest first, and follows a rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sent-'));
  const file = path.join(dir, 'sent.json');
  let clock = 0;
  const log = createSent({ file, now: () => `t${++clock}` });
  log.add('/a/one.md', { kind: 'wordpress', where: 'My Blog', what: 'draft', url: 'https://s/1' });
  log.add('/a/one.md', { kind: 'discord', where: 'News', what: 'post', url: 'javascript:alert(1)' });
  log.add('/a/one.md', { kind: 'nonsense', where: 'x', what: 'post' });
  assert.deepEqual(log.list('/a/one.md').map((e) => [e.kind, e.at, e.url]), [['discord', 't2', ''], ['wordpress', 't1', 'https://s/1']]);
  log.setPost('/a/one.md', 'srv', { id: '9' });
  log.move('/a/one.md', '/a/two.md');
  assert.equal(log.list('/a/one.md').length, 0);
  assert.equal(log.post('/a/two.md', 'srv').id, '9');
  const again = createSent({ file });
  assert.equal(again.list('/a/two.md').length, 2);
  again.forget('/a/two.md');
  assert.equal(again.list('/a/two.md').length, 0);
  assert.equal(again.post('/a/two.md', 'srv').id, '9', 'forgetting the list keeps the draft it would update');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a history that stops at a hundred', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-sent-'));
  const log = createSent({ file: path.join(dir, 'sent.json') });
  for (let i = 0; i < 120; i++) log.add('/a.md', { kind: 'ghost', where: 'B', what: 'update' });
  assert.equal(log.list('/a.md').length, 100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('blogs and channels fit in the server list', () => {
  assert.equal(cleanServer({ kind: 'wordpress', url: 'https://s/', user: 'neo', name: 'Blog' }).user, 'neo');
  assert.equal(cleanServer({ kind: 'ghost', url: 'https://g', user: 'dropped' }).user, '');
  assert.equal(cleanServer({ kind: 'discord', url: '' }).url, 'https://discord.com');
  assert.equal(cleanServer({ kind: 'discord', url: 'https://evil.test' }).url, 'https://discord.com');
  assert.ok(KINDS.wordpress.blog && KINDS.ghost.blog && KINDS.discord.channel);
});
