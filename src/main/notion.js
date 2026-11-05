'use strict';
// Notion (3.8): pages in and out as Markdown, through Notion's own Markdown service. Your key goes to Notion and
// nowhere else. A page is only ever changed block by block: what you didn't touch isn't sent, so its colours, mentions
// and pictures stay as they are, and nothing here asks Notion to delete a subpage. This file doesn't use Electron:
// main.js gives it fetch and the key.

const API = 'https://api.notion.com';
const VERSION = '2026-03-11';
const MARKDOWN_VERSION = 'v2';     // v1 is on its way out, and the next Notion-Version refuses it
const TIMEOUT_MS = 60 * 1000;
const MAX_RETRIES = 3;
const MAX_ROWS = 1000;
const MAX_ALIGN = 4000000;

class NotionError extends Error {
  constructor(message, code = 'failed') { super(message); this.code = code; }
}

const NOT_SHARED = 'Notion can’t find that page. Open it in Notion, then use the ••• menu and Connections to share it with your connection.';

function refusal(status, data) {
  const code = data?.code || '';
  const detail = String(data?.message || '');
  if (status === 401 || code === 'unauthorized') return new NotionError('Notion didn’t accept that key.', 'key');
  if (code === 'object_not_found' || status === 404) return new NotionError(NOT_SHARED, 'not_found');
  if (code === 'restricted_resource' || status === 403) return new NotionError('Your connection isn’t allowed to do that. Check its capabilities in Notion.', 'restricted');
  if (status === 429 || status === 529) return new NotionError('Notion is busy. Try again in a minute.', 'busy');
  if (status === 504) return new NotionError('Notion took too long. Try again, or split the document.', 'timeout');
  if (/allow_deleting_content|child (?:page|database)|subpage/i.test(detail)) {
    return new NotionError('Notion refused, because this would delete a subpage or database. Put its link back in the document and send again.', 'would_delete');
  }
  if (/too (?:large|complex|many)|5,?000/i.test(detail)) return new NotionError('That’s too large for Notion to take at once. Try splitting the document.', 'too_large');
  return new NotionError(detail ? `Notion said: ${detail.slice(0, 300)}` : 'Notion couldn’t do that.', code || 'failed');
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Find the page in anything you might paste: a link from Notion, or its id with or without dashes. */
function pageIdOf(text) {
  const given = String(text || '').trim();
  if (!given) return null;
  let target = given;
  if (/^https?:/i.test(given)) {
    let url;
    try { url = new URL(given); } catch { return null; }
    if (!/(?:^|\.)notion\.(?:so|site|com)$/i.test(url.hostname)) return null;
    target = url.searchParams.get('p') || url.pathname;
  }
  const m = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})(?![0-9a-f])/i.exec(target);
  return m ? m.slice(1).join('-').toLowerCase() : null;
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((r) => r?.plain_text ?? r?.text?.content ?? '').join('') : '');

/** The name of a page or a database, wherever Notion keeps it on that kind of thing. */
function titleOf(item) {
  if (Array.isArray(item?.title)) return plain(item.title) || 'Untitled';
  const prop = Object.values(item?.properties || {}).find((p) => p?.type === 'title');
  return plain(prop?.title) || 'Untitled';
}

function createClient({ fetch, token, base = API, wait = pause }) {
  async function call(method, path, body, tries = 0) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${token}`,
          'notion-version': VERSION,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new NotionError('Notion can’t be reached. Check your connection and try again.', 'offline');
    }
    if ((res.status === 429 || res.status === 529) && tries < MAX_RETRIES) {
      await wait(Math.min(Number(res.headers.get('retry-after')) || 2, 60) * 1000);
      return call(method, path, body, tries + 1);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw refusal(res.status, data);
    return data ?? {};
  }

  const summary = (item) => ({
    id: item.id,
    kind: item.object === 'data_source' ? 'database' : 'page',
    title: titleOf(item),
    url: item.url || '',
    edited: item.last_edited_time || '',
  });

  return {
    async me() {
      const me = await call('GET', '/v1/users/me');
      return { name: me.name || 'Your connection', workspace: me.bot?.workspace_name || '' };
    },

    async search(query, { pagesOnly = false } = {}) {
      const res = await call('POST', '/v1/search', {
        ...(query ? { query } : { sort: { timestamp: 'last_edited_time', direction: 'descending' } }),
        ...(pagesOnly ? { filter: { property: 'object', value: 'page' } } : {}),
        page_size: 30,
      });
      return (res.results || []).filter((r) => r.object && (r.properties || r.title) && !r.in_trash).map(summary);
    },

    async meta(id) {
      const page = await call('GET', `/v1/pages/${id}`);
      return { id: page.id, title: titleOf(page), url: page.url || '', edited: page.last_edited_time || '', trashed: !!page.in_trash };
    },

    /** The page's content in Notion's Markdown, exactly as Notion wrote it. */
    async content(id) {
      const res = await call('GET', `/v1/pages/${id}/markdown?markdown_version=${MARKDOWN_VERSION}`);
      return { markdown: String(res.markdown || ''), truncated: !!res.truncated, unknown: (res.unknown_block_ids || []).length };
    },

    async create({ parent, title, markdown }) {
      const page = await call('POST', '/v1/pages', {
        parent: { page_id: parent },
        markdown_version: MARKDOWN_VERSION,
        properties: { title: { title: [{ text: { content: String(title).slice(0, 2000) } }] } },
        markdown,
      });
      return { id: page.id, url: page.url || '', edited: page.last_edited_time || '' };
    },

    /** Change a page. allow_deleting_content stays false, so Notion itself protects subpages and databases. */
    async edit(id, plan) {
      const body = plan.edits
        ? { type: 'update_content', update_content: { content_updates: plan.edits, allow_deleting_content: false } }
        : { type: 'replace_content', replace_content: { new_str: plan.whole, allow_deleting_content: false } };
      const res = await call('PATCH', `/v1/pages/${id}/markdown`, { markdown_version: MARKDOWN_VERSION, ...body });
      return (res.warnings || []).filter((w) => w.code === 'no_match' || w.code === 'indentation_mismatch').length;
    },

    rename(id, title) {
      return call('PATCH', `/v1/pages/${id}`, { properties: { title: { title: [{ text: { content: String(title).slice(0, 2000) } }] } } });
    },

    /** A database as rows: the table of one data source, up to MAX_ROWS of them. */
    async rows(id, { isSource = false } = {}) {
      let sourceId = id;
      if (!isSource) {
        const db = await call('GET', `/v1/databases/${id}`);
        sourceId = db.data_sources?.[0]?.id;
        if (!sourceId) throw new NotionError('That database has nothing in it to open.', 'empty');
      }
      const source = await call('GET', `/v1/data_sources/${sourceId}`);
      const rows = [];
      let cursor;
      let more = true;
      while (more && rows.length < MAX_ROWS) {
        const res = await call('POST', `/v1/data_sources/${sourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        rows.push(...(res.results || []).filter((r) => r.object === 'page'));
        cursor = res.next_cursor;
        more = !!res.has_more && !!cursor;
      }
      return { title: titleOf(source), url: source.url || '', source, rows: rows.slice(0, MAX_ROWS), more };
    },
  };
}

// ---------------------------------------------------------------- blocks

const BLOCK_TAGS = new Set(['callout', 'toggle', 'quote', 'columns', 'column', 'table', 'details', 'synced-block', 'synced-block-reference',
  'ul', 'ol', 'li', 'todo', 'meeting-notes', 'tabs', 'tab', 'page', 'database', 'folder', 'p', 'h1', 'h2', 'h3', 'h4', 'equation', 'file',
  'pdf', 'audio', 'video', 'image', 'bookmark', 'embed', 'unknown', 'custom-block', 'table-of-contents', 'colgroup', 'col', 'tr', 'td', 'th']);
const ANY_TAG = /(?<!\\)<(\/?)([a-z][a-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const noCode = (line) => line.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/(`+)(?:[\s\S]*?[^`])?\1(?!`)/g, '');
const known = (name) => BLOCK_TAGS.has(name) || name.startsWith('meeting-notes-section');

/** How far this line moves the nesting of block tags, and whether it has any. */
function tagsIn(line) {
  let change = 0;
  let any = false;
  for (const m of noCode(line).matchAll(ANY_TAG)) {
    const name = m[2].toLowerCase();
    if (!known(name)) continue;
    any = true;
    if (m[3]) continue;
    change += m[1] ? -1 : 1;
  }
  return { change, any };
}

/**
 * Cut Markdown into its blocks, each with its exact place in the text. Works for Notion's Markdown and for ours:
 * code fences and tags hold their blank lines, and an indented line after a blank one still belongs to its list.
 */
function splitBlocks(text) {
  const out = [];
  let pos = 0;
  let start = -1;
  let end = 0;
  let depth = 0;
  let fence = null;
  const close = () => {
    if (start >= 0) out.push({ start, end, raw: text.slice(start, end) });
    start = -1;
  };
  for (const line of text.split('\n')) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos = lineEnd + 1;
    if (fence) {
      end = lineEnd;
      const shut = FENCE.exec(line);
      if (shut && shut[1][0] === fence[0] && shut[1].length >= fence.length && !line.trim().slice(shut[1].length).trim()) {
        fence = null;
        if (depth === 0) close();
      }
      continue;
    }
    if (!line.trim()) {
      if (depth === 0) close();
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening && depth === 0) close();
    if (start < 0) {
      if (/^(?: {2}|\t)/.test(line) && !opening && out.length) start = out.pop().start;
      else start = lineStart;
    }
    end = lineEnd;
    if (opening) {
      fence = opening[1];
      continue;
    }
    const { change, any } = tagsIn(line);
    depth = Math.max(0, depth + change);
    if (any && depth === 0) close();
  }
  close();
  return out;
}

// ---------------------------------------------------------------- Notion's Markdown to ours

const ALERTS = {
  NOTE: { icon: 'ℹ️', color: 'blue_bg' },
  TIP: { icon: '💡', color: 'green_bg' },
  IMPORTANT: { icon: '❗', color: 'purple_bg' },
  WARNING: { icon: '⚠️', color: 'yellow_bg' },
  CAUTION: { icon: '🚨', color: 'red_bg' },
};
const LINKED = { page: '📄', database: '🗃️', folder: '📁' };
const MEDIA = { file: '📎', pdf: '📄', audio: '🔊', video: '🎬' };

function attrsOf(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([a-z-]+)="([^"]*)"/gi)) out[m[1].toLowerCase()] = m[2].replace(/&amp;/g, '&');
  return out;
}

function outsideCode(text, fn) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/(`+)(?:[\s\S]*?[^`])?\1(?!`)/g)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

function marked(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function codeSpan(code) {
  const longest = Math.max(0, ...(code.match(/`+/g) || []).map((s) => s.length));
  const ticks = '`'.repeat(longest + 1);
  return longest ? `${ticks} ${code} ${ticks}` : `${ticks}${code}${ticks}`;
}

function inlineTags(text, { cell = false } = {}) {
  let s = text;
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/<b>((?:(?!<b>)[\s\S])*?)<\/b>/g, (_, x) => marked('**', x))
      .replace(/<i>((?:(?!<i>)[\s\S])*?)<\/i>/g, (_, x) => marked('*', x))
      .replace(/<s>((?:(?!<s>)[\s\S])*?)<\/s>/g, (_, x) => marked('~~', x))
      .replace(/<span\b[^>]*>((?:(?!<span\b)[\s\S])*?)<\/span>/g, '$1');
    if (s === before) break;
  }
  return s
    .replace(/<mention\b([^>]*?)\/>/g, (_, a) => `[Mention](${attrsOf(a).url || ''})`)
    .replace(/<mention\b([^>]*)>([\s\S]*?)<\/mention>/g, (_, a, label) => `[${label}](${attrsOf(a).url || ''})`)
    .replace(/<link-preview\b([^>]*?)\/>/g, (_, a) => attrsOf(a).url || '')
    .replace(/<link-preview\b([^>]*)>([\s\S]*?)<\/link-preview>/g, (_, a, label) => `[${label}](${attrsOf(a).url || ''})`)
    .replace(/<date\b([^>]*?)\/>/g, (_, a) => {
      const d = attrsOf(a);
      return [d.start, d['start-time'], d.end ? `to ${d.end}` : ''].filter(Boolean).join(' ');
    })
    .replace(/<br\s*\/?>\n?/g, cell ? '<br>' : '\\\n');
}

/** Words inside a block: Notion's tags back to the Markdown marks, leaving code alone. */
function inline(text, opts) {
  const coded = String(text).replace(/<code>([\s\S]*?)<\/code>/g, (_, c) => codeSpan(c));
  return outsideCode(coded, (part) => inlineTags(part, opts));
}

const quoted = (text) => text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');

function nameFromUrl(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || url; } catch { return url; }
}

function tableToMd(inner) {
  const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)]
    .map((c) => inline(c[1].trim(), { cell: true }).replace(/\n+/g, '<br>').replace(/(?<!\\)\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function listToMd(name, inner) {
  return [...inner.matchAll(/<(li|todo)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => {
    const body = inline(m[3].trim());
    if (m[1] === 'todo') return `- [${attrsOf(m[2]).checked === 'true' ? 'x' : ' '}] ${body}`;
    return `${name === 'ol' ? '1.' : '-'} ${body}`;
  }).join('\n');
}

function calloutToMd(attrs, inner) {
  const body = toMarkdown(inner);
  const type = Object.keys(ALERTS).find((k) => ALERTS[k].icon === attrs.icon);
  const shown = type ? body : `${attrs.icon ? `${attrs.icon} ` : ''}${body}`;
  return quoted(`[!${type || 'NOTE'}]\n${shown}`);
}

function toggleToMd(inner) {
  const text = inner.replace(/^\n+/, '');
  const cut = text.indexOf('\n');
  const title = cut < 0 ? text : text.slice(0, cut);
  const rest = cut < 0 ? '' : toMarkdown(text.slice(cut + 1));
  return `<details><summary>${inline(title.trim())}</summary>${rest ? `\n\n${rest}\n\n` : '\n'}</details>`;
}

function blockToMd(raw) {
  const text = raw.trim();
  if (!text || FENCE.test(text)) return text;
  const open = /^<([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"]*")*)\s*(\/?)>/i.exec(text);
  const name = open?.[1].toLowerCase();
  if (!open || !known(name)) return inline(text);
  const attrs = attrsOf(open[2]);
  const closing = text.lastIndexOf(`</${open[1]}>`);
  const inner = open[3] || closing < 0 ? '' : text.slice(open[0].length, closing).trim();
  switch (name) {
    case 'callout': return calloutToMd(attrs, inner);
    case 'toggle': return toggleToMd(inner);
    case 'quote': return quoted(toMarkdown(inner));
    case 'table': return tableToMd(inner);
    case 'ul': case 'ol': return listToMd(name, inner);
    case 'li': return `- ${inline(inner)}`;
    case 'todo': return `- [${attrs.checked === 'true' ? 'x' : ' '}] ${inline(inner)}`;
    case 'p': return inline(inner);
    case 'h1': case 'h2': case 'h3': case 'h4': return `${'#'.repeat(Number(name[1]))} ${inline(inner)}`;
    case 'equation': return `$$\n${inner}\n$$`;
    case 'page': case 'database': case 'folder': return `[${LINKED[name]} ${inline(inner) || 'Untitled'}](${attrs.url || ''})`;
    case 'image': return `![${inline(inner)}](${attrs.source || ''})`;
    case 'file': case 'pdf': case 'audio': case 'video':
      return `[${MEDIA[name]} ${inline(inner) || nameFromUrl(attrs.source || '')}](${attrs.source || ''})`;
    case 'bookmark': case 'embed': return `[${inline(inner) || attrs.source || ''}](${attrs.source || ''})`;
    case 'unknown': return attrs.url ? `[Notion block: ${attrs.alt || 'not shown'}](${attrs.url})` : '';
    case 'custom-block': case 'table-of-contents': return '';
    default: return toMarkdown(inner);   // columns, synced blocks, tabs, meeting notes: show what's inside them
  }
}

/** A page's content as the Markdown this app reads. */
function toMarkdown(nfm) {
  const text = String(nfm || '').replace(/\r\n/g, '\n');
  return splitBlocks(text).map((b) => blockToMd(b.raw)).filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------- ours to Notion's Markdown

const isWeb = (url) => /^https?:/i.test(url);

const ANY_IMAGE = /!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;
const canSend = (url) => isWeb(url) && !HOSTED.test(url);   // a signed link from Notion would stop working within the hour
const FOOTNOTE_NOTE = /^\[\^(?!http)[^\]]+\]:/m;

/** Notion can't take a picture from your computer or a footnote, so these are what it gets in their place. */
function asSent(text) {
  return text
    .replace(ANY_IMAGE, (whole, alt, url) => (canSend(url) ? whole : `*(Picture left on your computer: ${alt || url.split('/').pop().slice(0, 80) || 'picture'})*`))
    .replace(/^\[\^((?!http)[^\]]+)\]:[ \t]*/gm, '\\[$1\\] ')
    .replace(/\[\^((?!http)[^\]]+)\]/g, '\\[$1\\]');
}

function alertToNotion(raw) {
  const lines = raw.split('\n').map((l) => l.replace(/^>\s?/, ''));
  const type = /^\[!(\w+)\]/.exec(lines[0])[1].toUpperCase();
  let body = [lines[0].replace(/^\[!\w+\]\s*/, ''), ...lines.slice(1)].join('\n').trim();
  let { icon } = ALERTS[type];
  const own = /^(\p{Extended_Pictographic}\S*)\s+/u.exec(body);
  if (own && type === 'NOTE') {
    [, icon] = own;
    body = body.slice(own[0].length);
  }
  return `<callout icon="${icon}" color="${ALERTS[type].color}">\n${body}\n</callout>`;
}

function blockToNotion(raw, notes) {
  const text = raw.trim();
  if (FENCE.test(text)) return text;
  if (/^> ?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(text)) return alertToNotion(text);
  const toggle = /^<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*)<\/details>$/i.exec(text);
  if (toggle) return `<toggle>\n${toggle[1].trim()}\n\n${fromMarkdown(toggle[2].trim(), notes)}\n</toggle>`;
  const linked = /^\[(📄|🗃️|📁) (.*)\]\((https?:[^)\s]+)\)$/u.exec(text);
  if (linked && pageIdOf(linked[3])) {
    const tag = Object.keys(LINKED).find((k) => LINKED[k] === linked[1]);
    return `<${tag} url="${linked[3]}">${linked[2]}</${tag}>`;
  }
  if (FOOTNOTE_NOTE.test(text)) notes.footnotes += 1;
  notes.pictures += [...text.matchAll(ANY_IMAGE)].filter((m) => !canSend(m[2])).length;
  return asSent(text.replace(/^#{5,6}(?= )/gm, '####').replace(/^(#{1,4} .*)\n(?=\S)/gm, '$1\n\n'));
}

/** A document as Notion's Markdown, which is CommonMark with GFM tables, so mostly it passes through. */
function fromMarkdown(md, notes = { pictures: 0, footnotes: 0 }) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  return splitBlocks(text).map((b) => blockToNotion(b.raw, notes)).join('\n\n');
}

// ---------------------------------------------------------------- pictures

const NOTION_FILE = /^https:\/\/(?:prod-files-secure\.s3[\w.-]*\.amazonaws\.com|s3[\w.-]*\.amazonaws\.com\/secure\.notion-static\.com|file\.notion\.so)\//i;
const HOSTED = /https:\/\/(?:prod-files-secure\.s3[\w.-]*\.amazonaws\.com|s3[\w.-]*\.amazonaws\.com\/secure\.notion-static\.com|file\.notion\.so)\//i;
const LOCAL_COPY = /(?:^|[\\/])notion-([0-9a-f]{8})[^\\/]*$/i;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const isNotionFile = (url) => NOTION_FILE.test(String(url || ''));

/** The short name of a file Notion holds: it stays the same when Notion hands out a new link to it. */
function fileId(url) {
  if (!isNotionFile(url)) return null;
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const hex = parts.map((p) => p.replace(/-/g, '')).reverse().find((p) => /^[0-9a-f]{16,}$/i.test(p));
  return hex ? hex.slice(0, 8).toLowerCase() : null;
}

/** Pictures in this Markdown that live on Notion, whose links stop working after about an hour. */
function picturesIn(md) {
  const seen = new Map();
  for (const m of String(md || '').matchAll(IMAGE)) {
    const id = fileId(m[2]);
    if (id && !seen.has(m[2])) seen.set(m[2], { url: m[2], id, name: nameFromUrl(m[2]) });
  }
  return [...seen.values()];
}

/** Copy Notion's pictures beside the document. One that can't be copied keeps its link, and is counted. */
async function keepPictures(md, { fetch, save, have }) {
  const swaps = new Map();
  let missed = 0;
  for (const p of picturesIn(md)) {
    const existing = have(p.id);
    if (existing) {
      swaps.set(p.url, existing);
      continue;
    }
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error('refused');
      const saved = await save({ name: `notion-${p.id}-${p.name}`, data: Buffer.from(await res.arrayBuffer()) });
      if (saved.ok) swaps.set(p.url, saved.rel); else missed += 1;
    } catch {
      missed += 1;
    }
  }
  return { md: swapPictures(md, swaps), missed };
}

function swapPictures(md, swaps) {
  return String(md || '').replace(IMAGE, (whole, alt, url) => (swaps.has(url) ? `![${alt}](${swaps.get(url)})` : whole));
}

/** What a block says, so that a picture saved beside your document counts as the same picture on Notion. */
function sameness(md) {
  return md.replace(/[ \t]+$/gm, '')
    .replace(IMAGE, (whole, alt, url) => {
      const id = fileId(url) || LOCAL_COPY.exec(url)?.[1]?.toLowerCase();
      return id ? `![${alt}](notion:${id})` : asSent(whole);
    })
    .replace(/\((https:\/\/[^)\s?]+)\?[^)\s]*X-Amz[^)\s]*\)/g, '($1)')
    .replace(/\[\^(?!http)[^\]]+\]/g, (m) => asSent(m))
    .replace(/^\\\[([^\]\\]+)\\\]:? /gm, '\\[$1\\] ');
}

// ---------------------------------------------------------------- the changes to send

/** Which items of `a` and `b` line up: ['=', i, j], ['-', i] and ['+', j], in order. */
function align(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const ops = [];
  for (let i = 0; i < head; i++) ops.push(['=', i, i]);
  if (n * m > MAX_ALIGN) {
    for (let i = 0; i < n; i++) ops.push(['-', head + i]);
    for (let j = 0; j < m; j++) ops.push(['+', head + j]);
  } else {
    const width = m + 1;
    const best = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        best[i * width + j] = a[head + i] === b[head + j]
          ? best[(i + 1) * width + j + 1] + 1
          : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) { ops.push(['=', head + i, head + j]); i += 1; j += 1; }
      else if (i < n && (j >= m || best[(i + 1) * width + j] >= best[i * width + j + 1])) { ops.push(['-', head + i]); i += 1; }
      else { ops.push(['+', head + j]); j += 1; }
    }
  }
  for (let t = tail; t > 0; t--) ops.push(['=', a.length - t, b.length - t]);
  return ops;
}

/** A block you edited keeps its colour and icon, where what it became is still the same kind of block. */
function keepStyle(raw, text) {
  const open = /^<(callout|toggle|quote|p|h[1-4])\b[^>]*>/.exec(raw.trim());
  if (!open || open[0] === `<${open[1]}>`) return text;
  const [tag, name] = open;
  if (name === 'callout') {
    const m = /^<callout\b([^>]*)>\n?([\s\S]*?)\n?<\/callout>$/.exec(text);
    return m && attrsOf(m[1]).icon === attrsOf(tag).icon ? `${tag}\n${m[2]}\n</callout>` : text;
  }
  if (name === 'toggle') return text.startsWith('<toggle>') ? tag + text.slice('<toggle>'.length) : text;
  if (name === 'quote') return text.startsWith('>') ? `${tag}\n${text.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')}\n</quote>` : text;
  if (name === 'p') return /^(?:[<#>|-]|\d+\.\s|```|\$\$)/.test(text) ? text : `${tag}\n${text}\n</p>`;
  const heading = new RegExp(`^#{${name[1]}} (.*)$`).exec(text);
  return heading ? `${tag}\n${heading[1]}\n</${name}>` : text;
}

/** Notion applies edits in order, so an earlier one mustn't give a later one a second place to match. */
function landsOnce(source, edits) {
  let page = source;
  for (const e of edits) {
    const at = page.indexOf(e.old_str);
    if (at < 0 || at !== page.lastIndexOf(e.old_str)) return false;
    page = page.slice(0, at) + e.new_str + page.slice(at + e.old_str.length);
  }
  return true;
}

/**
 * What to change on a page so that it reads like `body`. Blocks that still read the same are left exactly as Notion
 * has them. Returns small edits where each one can be found in exactly one place, and the whole page as a fallback.
 */
function planEdits(nfm, body, notes = { pictures: 0, footnotes: 0 }) {
  const source = String(nfm || '').replace(/\r\n/g, '\n');
  const blocks = splitBlocks(source);
  const oldParts = [];
  blocks.forEach((b, block) => {
    for (const part of splitBlocks(blockToMd(b.raw))) oldParts.push({ block, text: part.raw, key: sameness(part.raw) });
  });
  const newParts = splitBlocks(String(body || '').replace(/\r\n/g, '\n').trim()).map((p) => ({ text: p.raw, key: sameness(p.raw) }));
  const ops = align(oldParts.map((p) => p.key), newParts.map((p) => p.key));
  const touched = new Set(ops.filter((o) => o[0] === '-').map((o) => oldParts[o[1]].block));

  // Runs of change. A Notion block that became several of ours is replaced whole if any part of it changed.
  const hunks = [];
  let hunk = null;
  let previous = -1;
  for (const op of ops) {
    const oldPart = op[0] === '+' ? null : oldParts[op[1]];
    if (op[0] === '=' && !touched.has(oldPart.block)) {
      hunk = null;
      previous = oldPart.block;
      continue;
    }
    if (!hunk) {
      hunk = { first: null, last: null, after: previous, adds: [] };
      hunks.push(hunk);
    }
    if (oldPart) {
      hunk.first ??= oldPart.block;
      hunk.last = oldPart.block;
    }
    if (op[0] === '=') hunk.adds.push(oldPart.text);
    if (op[0] === '+') hunk.adds.push(newParts[op[1]].text);
  }

  // Notion gives out a new link to its own files on every read, so a block holding one can never be matched, and sending
  // that link back would swap the file for a copy that expires. Those blocks stay out of every edit.
  const hosted = (i) => HOSTED.test(blocks[i].raw);
  const moved = new Set(oldParts.filter((p) => hosted(p.block) && touched.has(p.block)).map((p) => p.key));
  const safe = [];
  for (const h of hunks) {
    h.adds = h.adds.filter((text) => !moved.has(sameness(text)));   // a picture you moved stays where it is on Notion
    if (h.first === null) {
      if (h.adds.length) safe.push(h);
      continue;
    }
    const runs = [];
    let run = null;
    for (let i = h.first; i <= h.last; i++) {
      if (hosted(i)) {
        notes.hosted = (notes.hosted || 0) + 1;
        run = null;
      } else if (run) {
        run.last = i;
      } else {
        run = { first: i, last: i, after: i - 1, adds: [] };
        runs.push(run);
      }
    }
    if (runs.length) {
      runs[0].adds = h.adds;
      safe.push(...runs);
    } else if (h.adds.length) {
      safe.push({ first: null, last: null, after: h.last, adds: h.adds });
    }
  }

  const silent = new Set(blocks.map((b, i) => (blockToMd(b.raw) ? -1 : i)));
  const convert = (h) => {
    const kept = [];
    if (h.first !== null) for (let i = h.first; i <= h.last; i++) if (silent.has(i)) kept.push(blocks[i].raw);
    let text = fromMarkdown(h.adds.join('\n\n'), notes);
    if (h.first !== null && h.first === h.last) text = keepStyle(blocks[h.first].raw, text);
    return [text, ...kept].filter(Boolean).join('\n\n');
  };
  const converted = safe.map(convert);

  // The whole page, keeping every untouched block as it is.
  const pieces = [];
  let at = 0;
  safe.forEach((h, n) => {
    const first = h.first ?? h.after + 1;
    const last = h.last ?? h.after;
    for (; at < first; at += 1) pieces.push(blocks[at].raw);
    if (converted[n]) pieces.push(converted[n]);
    at = last + 1;
  });
  for (; at < blocks.length; at += 1) pieces.push(blocks[at].raw);
  const whole = pieces.join('\n\n');

  const before = oldParts.map((p) => p.text).join('\n\n');
  const after = newParts.map((p) => p.text).join('\n\n');
  const answer = { changed: true, edits: null, whole, before, after, blocked: HOSTED.test(whole) };
  if (!safe.length) return { ...answer, changed: false, edits: [], blocked: false };
  if (!blocks.length) return answer;

  // Small edits, each widened until Notion can find it in exactly one place, and never over a file on Notion.
  const once = (s) => s && source.indexOf(s) === source.lastIndexOf(s);
  const free = (i) => i >= 0 && i < blocks.length && !hosted(i);
  const spans = [];
  const edits = [];
  for (let n = 0; n < safe.length; n++) {
    const h = safe[n];
    const inserting = h.first === null;
    let point = inserting ? h.after + 1 : h.first;   // new words go before this block
    if (inserting && !free(point - 1) && !free(point)) {
      // Between two files on Notion nothing can be matched, so the words go to the nearest place that can.
      let k = point + 1;
      while (k < blocks.length && !free(k)) k += 1;
      if (k >= blocks.length) {
        k = point - 2;
        while (k >= 0 && !free(k)) k -= 1;
        if (k < 0) return answer;
        point = k + 1;
      } else point = k;
    }
    let lo = h.first ?? (free(point - 1) ? point - 1 : point);
    let hi = h.last ?? lo;
    const build = () => {
      const old = source.slice(blocks[lo].start, blocks[hi].end);
      if (!inserting) return { old_str: old, new_str: `${source.slice(blocks[lo].start, blocks[h.first].start)}${converted[n]}${source.slice(blocks[h.last].end, blocks[hi].end)}` };
      const left = lo < point ? source.slice(blocks[lo].start, blocks[Math.min(point - 1, hi)].end) : '';
      const right = hi >= point ? source.slice(blocks[Math.max(point, lo)].start, blocks[hi].end) : '';
      return { old_str: old, new_str: [left, converted[n], right].filter(Boolean).join('\n\n') };
    };
    let edit = build();
    while (!once(edit.old_str)) {
      const down = free(lo - 1);
      const up = free(hi + 1);
      if (!down && !up) return answer;
      if (down) lo -= 1;
      if (up) hi += 1;
      edit = build();
    }
    spans.push([lo, hi]);
    edits.push(edit);
  }
  const overlap = spans.some(([lo], i) => i > 0 && lo <= spans[i - 1][1]);
  return overlap || !landsOnce(source, edits) ? answer : { ...answer, edits, blocked: false };
}

// ---------------------------------------------------------------- documents

function splitFront(text) {
  const s = String(text || '');
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  return m ? { front: m[0], body: s.slice(m[0].length) } : { front: '', body: s };
}

/** The Notion page a document is linked to, from `notion:` in its front matter. */
function linkOf(text) {
  const { front } = splitFront(text);
  const m = /^notion:[ \t]*["']?([^\s"']+)/m.exec(front);
  return m ? pageIdOf(m[1]) : null;
}

/** The document with its link added, or put right. Everything else in it stays as it was. */
function withLink(text, url) {
  const { front, body } = splitFront(text);
  const line = `notion: ${url}`;
  if (!front) return `---\n${line}\n---\n\n${String(text || '').replace(/^\n+/, '')}`;
  if (/^notion:.*$/m.test(front)) return front.replace(/^notion:.*$/m, line) + body;
  return front.replace(/(\r?\n)---[ \t]*(\r?\n|$)/, (m, nl, end) => `${nl}${line}${nl}---${end}`) + body;
}

/** A document's title (its first heading, if that comes first) and what follows it. */
function splitTitle(body) {
  const text = String(body || '').replace(/\r\n/g, '\n').trim();
  const m = /^# +(.+?)[ \t]*(?:\n+|$)/.exec(text);
  return m ? { title: m[1].replace(/\s+#+$/, ''), rest: text.slice(m[0].length).trim() } : { title: '', rest: text };
}

const asDocument = (title, md) => `# ${title}\n\n${md}`.trim();

// ---------------------------------------------------------------- databases

function valueOf(p) {
  if (!p) return '';
  const v = p[p.type];
  switch (p.type) {
    case 'title': case 'rich_text': return plain(v);
    case 'number': return v ?? '';
    case 'select': case 'status': return v?.name ?? '';
    case 'multi_select': return (v || []).map((o) => o.name).join(', ');
    case 'date': return v ? [v.start, v.end].filter(Boolean).join(' to ') : '';
    case 'checkbox': return v ? '✓' : '';
    case 'url': case 'email': case 'phone_number': case 'created_time': case 'last_edited_time': return v ?? '';
    case 'people': return (v || []).map((u) => u.name || '').filter(Boolean).join(', ');
    case 'created_by': case 'last_edited_by': return v?.name ?? '';
    case 'files': return (v || []).map((f) => f.name).join(', ');
    case 'relation': return (v || []).length || '';
    case 'unique_id': return v ? `${v.prefix ? `${v.prefix}-` : ''}${v.number}` : '';
    case 'formula': return v ? valueOf({ type: v.type, [v.type]: v[v.type] }) : '';
    case 'rollup':
      if (v?.type === 'array') return (v.array || []).map(valueOf).filter((x) => x !== '').join(', ');
      return v ? valueOf({ type: v.type, [v.type]: v[v.type] }) : '';
    default: return '';
  }
}

/** A database as a Markdown table. The title column comes first, then the others as Notion lists them. */
function tableOf({ source, rows }) {
  const props = Object.entries(source.properties || {});
  const names = [...props.filter(([, p]) => p.type === 'title'), ...props.filter(([, p]) => p.type !== 'title')].map(([name]) => name);
  const cell = (v) => String(v).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const body = rows.map((row) => line(names.map((name) => {
    const prop = row.properties?.[name];
    const text = cell(valueOf(prop));
    return prop?.type === 'title' && row.url ? `[${text || 'Untitled'}](${row.url})` : text;
  })));
  return [line(names.map(cell)), line(names.map(() => '---')), ...body].join('\n');
}

module.exports = {
  API, VERSION, MARKDOWN_VERSION, MAX_ROWS, NotionError, createClient, pageIdOf, titleOf, splitBlocks, toMarkdown, fromMarkdown, planEdits,
  picturesIn, swapPictures, keepPictures, isNotionFile, fileId, splitFront, linkOf, withLink, splitTitle, asDocument, tableOf, align,
};
