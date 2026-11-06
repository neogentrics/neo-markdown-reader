'use strict';
// Share to Discord (3.10): a document or a summary, posted to a channel through its webhook. A webhook address is a
// secret, because anyone who has it can post, so it's kept with your keys and never shown or written down anywhere else.
// Nobody is pinged: mentions in a document stay as words. This file doesn't use Electron.
const crypto = require('node:crypto');
const path = require('node:path');
const { WikiError, PICTURE, pictureFile, typeOf } = require('./wikis');

const TIMEOUT_MS = 60 * 1000;
const LIMIT = 1900;              // Discord's limit is 2,000 characters: this leaves room for what a split adds
const MAX_MESSAGES = 20;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_WAIT_MS = 30 * 1000;
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/;

class DiscordError extends WikiError {}

/** A webhook address, or null. `test` lets the tests point at a stand-in. */
function cleanWebhook(text, test = '') {
  const url = String(text || '').trim().replace(/\/+$/, '').split('?')[0];
  if (WEBHOOK.test(url)) return url;
  return test && url.startsWith(`${test}/api/webhooks/`) ? url : null;
}

function refusal(status, data) {
  if (status === 401 || status === 403 || status === 404) return new DiscordError('Discord doesn’t know that webhook any more. Make a new one in the channel’s settings.', 'key');
  if (status === 413 || data?.code === 40005) return new DiscordError('That’s too large for Discord to take.', 'too_large');
  return new DiscordError(data?.message ? `Discord said: ${String(data.message).slice(0, 300)}` : `Discord answered ${status}.`, 'failed');
}

/** Files and fields as Discord wants them, built by hand so it works the same with any fetch. */
function multipart(payload, files) {
  const boundary = `----rt${crypto.randomBytes(12).toString('hex')}`;
  const parts = [Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="payload_json"\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n`)];
  files.forEach((f, i) => {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="files[${i}]"; filename="${f.filename}"\r\ncontent-type: ${f.type}\r\n\r\n`), f.data, Buffer.from('\r\n'));
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

function createChannel({ fetch, webhook, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const ask = async (url, init) => {
    try {
      return await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    } catch {
      throw new DiscordError('Discord can’t be reached. Check that you’re online.', 'offline');
    }
  };
  const json = async (res) => { try { return JSON.parse(await res.text()); } catch { return null; } };
  let about = null;
  const info = async () => {
    if (about) return about;
    const res = await ask(webhook, { method: 'GET' });
    const data = await json(res);
    if (!res.ok) throw refusal(res.status, data);
    about = data || {};
    return about;
  };
  return {
    test: info,
    async send({ content, files = [] }) {
      const payload = {
        content,
        allowed_mentions: { parse: [] },
        ...(files.length ? { attachments: files.map((f, id) => ({ id, filename: f.filename })) } : {}),
      };
      for (let attempt = 0; ; attempt++) {
        const f = files.length ? multipart(payload, files) : null;
        const res = await ask(`${webhook}?wait=true`, {
          method: 'POST',
          headers: { 'content-type': f ? f.type : 'application/json' },
          body: f ? f.body : JSON.stringify(payload),
        });
        const data = await json(res);
        if (res.ok) return data || {};
        if (res.status !== 429 || attempt >= 3) throw refusal(res.status, data);
        const seconds = Number(data?.retry_after ?? res.headers.get('retry-after')) || 1;
        await wait(Math.min(seconds * 1000 + 100, MAX_WAIT_MS));
      }
    },
    async linkTo(message) {
      const { guild_id: guild } = await info().catch(() => ({}));
      return guild && message?.channel_id && message?.id ? `https://discord.com/channels/${guild}/${message.channel_id}/${message.id}` : '';
    },
  };
}

// ---------------------------------------------------------------- documents to messages

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** One line as Discord shows it: it has no pictures in the text, no small headings, and no way to follow a link to a file here. */
function plainLine(line, pictures) {
  return line
    .replace(PICTURE, (whole, alt, angled, plain) => {
      const src = angled ?? plain;
      if (SCHEME.test(src)) return src;
      pictures.push(src);
      return '';
    })
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (whole, name, label) => (label || name).trim())
    .replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, target) => (SCHEME.test(target) || target.startsWith('#') ? (target.startsWith('#') ? label : whole) : label))
    .replace(/^\s{0,3}#{4,6}\s+(.+?)\s*#*$/, '**$1**')
    .replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/, '')
    .replace(/^(\s*[-*+]\s+)\[( |x|X)\]\s+/, (whole, lead, mark) => `${lead}${mark === ' ' ? '☐' : '☑'} `);
}

/** Paragraphs, code and tables, each with the pictures it holds. */
function blocksOf(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks = [];
  let para = [];
  let pictures = [];
  const flush = () => {
    const words = para.join('\n').trim();
    if (words || pictures.length) blocks.push({ text: words, pictures });
    para = [];
    pictures = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = FENCE.exec(line);
    if (open) {
      flush();
      const code = [line.trim()];
      for (i += 1; i < lines.length; i++) {
        if (new RegExp(`^\\s{0,3}${open[1][0]}{${open[1].length},}\\s*$`).test(lines[i])) break;
        code.push(lines[i]);
      }
      blocks.push({ code, pictures: [] });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] || '')) {
      flush();
      const code = ['```'];
      for (; i < lines.length && lines[i].includes('|'); i++) code.push(lines[i].trim());
      i -= 1;
      blocks.push({ code, pictures: [] });
      continue;
    }
    para.push(plainLine(line, pictures));
  }
  flush();
  return blocks;
}

/** Words too long for one message, cut at a line, a sentence or a space. */
function cutWords(text) {
  const out = [];
  let rest = text;
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf('\n', LIMIT);
    if (cut < LIMIT / 2) cut = rest.lastIndexOf('. ', LIMIT) + 1;
    if (cut < LIMIT / 2) cut = rest.lastIndexOf(' ', LIMIT);
    if (cut <= 0) cut = LIMIT;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Code too long for one message: each piece opens and closes its own block. */
function cutCode(code) {
  const [open, ...lines] = code;
  const room = LIMIT - open.length - 8;
  const out = [];
  let piece = [];
  let size = 0;
  const flush = () => { if (piece.length) out.push(`${open}\n${piece.join('\n')}\n\`\`\``); piece = []; size = 0; };
  for (const whole of lines) {
    for (let line = whole, first = true; first || line; first = false) {
      const part = line.slice(0, room);
      line = line.slice(room);
      if (size + part.length + 1 > room) flush();
      piece.push(part);
      size += part.length + 1;
    }
  }
  flush();
  return out.length ? out : [`${open}\n\`\`\``];
}

/** A document as messages: each is { content, pictures }. */
function messagesFrom(body, title = '') {
  const messages = [];
  let now = { content: '', pictures: [] };
  const flush = () => {
    if (now.content.trim() || now.pictures.length) messages.push(now);
    now = { content: '', pictures: [] };
  };
  const add = (text) => {
    if (now.content && now.content.length + text.length + 2 > LIMIT) flush();
    now.content = now.content ? `${now.content}\n\n${text}` : text;
  };
  if (title) add(`# ${title}`);
  for (const block of blocksOf(body)) {
    const pieces = block.code ? cutCode(block.code) : block.text ? cutWords(block.text) : [];
    pieces.forEach(add);
    if (now.pictures.length + block.pictures.length > MAX_FILES) flush();
    now.pictures.push(...block.pictures.slice(0, MAX_FILES));
  }
  flush();
  return messages;
}

/** The opening of a document, as a start for a summary. */
function openingOf(body) {
  let out = '';
  for (const block of blocksOf(body)) {
    if (!block.text || /^#{1,6}\s/.test(block.text)) continue;
    const next = out ? `${out}\n\n${block.text}` : block.text;
    if (next.length > 700) return out || block.text.slice(0, 700);
    out = next;
    if (out.length > 300) break;
  }
  return out;
}

/**
 * Post messages in order. If Discord stops part-way, the error says how far it got, so what's up there can be found.
 */
async function post({ channel, messages, dir, readFile, onStep = () => {} }) {
  const report = { sent: 0, of: messages.length, pictures: 0, missing: 0, tooBig: 0 };
  let first = null;
  for (const m of messages) {
    onStep(report.sent + 1);
    const files = [];
    for (const src of m.pictures) {
      const file = pictureFile(dir, src);
      const data = await readFile(file);
      const type = data && typeOf(src);
      if (!data || !type) { report.missing += 1; continue; }
      if (data.length > MAX_FILE_BYTES) { report.tooBig += 1; continue; }
      const ext = path.extname(file).toLowerCase();
      files.push({ filename: `picture-${files.length + 1}${ext}`, type, data });
    }
    if (!m.content.trim() && !files.length) continue;
    try {
      const sent = await channel.send({ content: m.content, files });
      first ??= sent;
      report.sent += 1;
      report.pictures += files.length;
    } catch (err) {
      if (report.sent) {
        err.partial = { ...report, url: await channel.linkTo(first) };
        err.message = `Stopped after ${report.sent} of ${report.of} messages. ${err.message}`;
      }
      throw err;
    }
  }
  return { report, url: await channel.linkTo(first) };
}

module.exports = { DiscordError, MAX_MESSAGES, cleanWebhook, createChannel, messagesFrom, openingOf, post };
