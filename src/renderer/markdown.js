// Markdown -> sanitized HTML pipeline. Pure: no Electron APIs, so it can be unit-tested
// under jsdom and reused by any future front-end (macOS / Linux / web preview).
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import { full as emoji } from 'markdown-it-emoji';
import deflist from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import alerts from 'markdown-it-github-alerts';
import frontMatter from 'markdown-it-front-matter';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
import { load as yamlLoad, JSON_SCHEMA } from 'js-yaml';
import createDOMPurify from 'dompurify';
import { parseWikiTarget } from '../main/notes-core.js';
import { renderChart, fromRows, chartSvg } from './charts.js';

const MEDIA_ATTRS = { IMG: 'src', VIDEO: 'src', AUDIO: 'src', SOURCE: 'src', TRACK: 'src' };
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE_PATH = /^[a-z]:[\\/]/i;

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// GitHub-compatible heading slugs so links like [x](#my-heading) keep working.
export function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Resolve a (possibly relative) media path to an absolute URL against the document folder. */
export function resolveMediaUrl(value, baseUrl) {
  const v = String(value || '').trim();
  if (!v || v.startsWith('#')) return v;
  if (DRIVE_PATH.test(v)) return 'file:///' + v.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A/i, '$1:');
  if (SCHEME.test(v) || v.startsWith('//')) return v;
  if (!baseUrl) return v;
  try { return new URL(v.replace(/\\/g, '/'), baseUrl).href; } catch { return v; }
}

/**
 * [[Name]], [[Name#Heading]] and [[Name|label]] become links. env.wiki(target) says where each one goes
 * ({ href, missing }); without it (no folder open) a link points to "Name.md" next to the document.
 */
/**
 * Charts (2.4): a ```chart block is drawn as a chart, and so is a table that has
 * <!-- chart: bar; title: Sales --> on the line just before it (the table stays below the chart).
 */
function charts(md) {
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (/^chart\b/i.test(t.info.trim())) return `${renderChart(t.content)}\n`;
    return fence(tokens, idx, options, env, self);
  };
  md.core.ruler.push('table_charts', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length - 1; i++) {
      const m = toks[i].type === 'html_block' && /^<!--\s*chart\s*:?\s*([\s\S]*?)-->\s*$/i.exec(toks[i].content.trim());
      if (!m || toks[i + 1].type !== 'table_open') continue;
      const opts = {};
      m[1].split(';').forEach((part, k) => {
        const kv = /^\s*([a-z]+)\s*[:=]\s*(.*?)\s*$/i.exec(part);
        if (kv) opts[kv[1].toLowerCase()] = kv[2];
        else if (k === 0 && part.trim()) opts.type = part.trim();
      });
      const rows = [];
      let row = null;
      for (let j = i + 1; j < toks.length && toks[j].type !== 'table_close'; j++) {
        if (toks[j].type === 'tr_open') row = [];
        else if (toks[j].type === 'tr_close') { rows.push(row); row = null; }
        else if (toks[j].type === 'inline' && row) row.push(toks[j].content.replace(/[*_`~]/g, '').trim());
      }
      let html;
      try { html = `<figure class="chart">${chartSvg(fromRows(rows, opts))}</figure>`; } catch (err) {
        html = `<div class="chart-error"><b>This chart can’t be drawn:</b> ${escapeHtml(err.message)}</div>`;
      }
      toks[i].content = `${html}\n`;
    }
  });
}

/**
 * Right-to-left text (3.0): each paragraph, heading, list, quote and table cell takes its direction from
 * its own first letters, so Arabic or Hebrew reads right to left and English beside it left to right.
 */
const DIR_AUTO = new Set(['paragraph_open', 'heading_open', 'list_item_open', 'th_open', 'td_open', 'dt_open', 'dd_open']);
// Containers can't use dir="auto" (it skips children that have their own dir), so they take the direction
// of their first text: a list, quote or table that starts in Arabic or Hebrew lays out right to left.
const DIR_CONTAINER = new Set(['bullet_list_open', 'ordered_list_open', 'blockquote_open', 'table_open']);
const RTL_FIRST = (text) => { const m = /\p{L}/u.exec(text || ''); return !!m && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]); };
function directions(md) {
  md.core.ruler.push('dir_auto', (state) => {
    const toks = state.tokens;
    toks.forEach((tok, i) => {
      if (tok.attrGet('dir')) return;
      if (DIR_AUTO.has(tok.type)) tok.attrSet('dir', 'auto');
      else if (DIR_CONTAINER.has(tok.type)) {
        const first = toks.slice(i + 1).find((x) => x.type === 'inline' && x.content.trim());
        if (first && RTL_FIRST(first.content)) tok.attrSet('dir', 'rtl');
      }
    });
  });
}
const RTL_LANGS = /^(ar|he|iw|fa|ur|ps|yi|dv|ckb|sd|ug)(-|$)/i;

function wikiLinks(md) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos } = state;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const end = src.indexOf(']]', pos + 2);
    if (end < 0) return false;
    const inner = src.slice(pos + 2, end);
    if (!inner.trim() || inner.length > 300 || /[[\]\n]/.test(inner)) return false;
    if (!silent) {
      const w = parseWikiTarget(inner);
      const r = state.env?.wiki ? state.env.wiki(w) : null;
      const href = r?.href ?? `${w.name ? `${encodeURI(w.name)}.md` : ''}${w.heading ? `#${slugify(w.heading)}` : ''}`;
      const open = state.push('link_open', 'a', 1);
      open.attrs = [['href', href || '#'], ['class', r?.missing ? 'wikilink wikilink-missing' : 'wikilink'], ['data-wiki', w.name]];
      if (r?.missing) open.attrs.push(['title', `No document named “${w.name}” yet — click to create it`]);
      const text = state.push('text', '', 0);
      text.content = w.label || (w.name && w.heading ? `${w.name} › ${w.heading}` : w.name || w.heading);
      state.push('link_close', 'a', -1);
    }
    state.pos = end + 2;
    return true;
  });
}

function buildMarkdownIt(state) {
  const md = new MarkdownIt({
    html: true,          // inline HTML is what gives docs their colors & layout; DOMPurify makes it safe
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(code, lang) {
      const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      if (language === 'mermaid') {
        return `<pre class="mermaid-src">${escapeHtml(code)}</pre>`;
      }
      let body;
      if (language && hljs.getLanguage(language)) {
        try { body = hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch { body = null; }
      }
      if (body == null) body = code.length < 20000 ? hljs.highlightAuto(code).value : escapeHtml(code);
      const label = language ? ` data-lang="${escapeHtml(language)}"` : '';
      return `<pre class="code-block"${label}><code class="hljs${language ? ' language-' + escapeHtml(language) : ''}">${body}</code></pre>`;
    },
  });

  md.use(frontMatter, (raw) => { state.frontMatterRaw = raw; })
    .use(anchor, { slugify, tabIndex: false })
    .use(footnote)
    .use(taskLists, { enabled: false, label: true })
    .use(emoji)
    .use(deflist)
    .use(mark)
    .use(sub)
    .use(sup)
    .use(alerts)
    .use(wikiLinks)
    .use(charts)
    .use(directions)
    .use(texmath, { engine: katex, delimiters: ['dollars', 'beg_end'], katexOptions: { throwOnError: false, output: 'htmlAndMathml' } });

  // Tag block elements with their source line so the editor and preview can scroll together.
  md.core.ruler.push('source_lines', (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting === 1 && token.level === 0) token.attrSet('data-line', String(token.map[0]));
    }
  });

  // Tables get a wrapper so wide tables scroll instead of breaking the page layout.
  md.renderer.rules.table_open = (tokens, idx) => `<div class="table-wrap"${tokens[idx].attrGet('dir') === 'rtl' ? ' dir="rtl"' : ''}><table>\n`;
  md.renderer.rules.table_close = () => '</table></div>\n';
  return md;
}

function parseFrontMatter(raw) {
  if (!raw) return null;
  try {
    const data = yamlLoad(raw, { schema: JSON_SCHEMA });
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

function fmValue(v) {
  if (Array.isArray(v)) return v.map(fmValue).join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v ?? '');
}

function renderFrontMatter(data) {
  const { title, subtitle, description, author, date, tags, logo, ...rest } = data;   // logo: used on PDF cover pages
  let out = '<header class="doc-meta">';
  if (title) out += `<div class="doc-meta-title">${escapeHtml(fmValue(title))}</div>`;
  if (subtitle || description) out += `<div class="doc-meta-sub">${escapeHtml(fmValue(subtitle || description))}</div>`;
  const line = [author && fmValue(author), date && fmValue(date instanceof Date ? date.toISOString().slice(0, 10) : date)].filter(Boolean);
  if (line.length) out += `<div class="doc-meta-line">${line.map(escapeHtml).join(' &middot; ')}</div>`;
  const tagList = Array.isArray(tags) ? tags : (tags ? String(tags).split(',') : []);
  if (tagList.length) out += `<div class="doc-meta-tags">${tagList.map((t) => `<span class="tag">${escapeHtml(String(t).trim())}</span>`).join('')}</div>`;
  const keys = Object.keys(rest);
  if (keys.length) {
    out += '<dl class="doc-meta-extra">' + keys.map((k) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(fmValue(rest[k]))}</dd>`).join('') + '</dl>';
  }
  return out + '</header>';
}

function collectToc(tokens) {
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const level = Number(t.tag.slice(1));
    const inline = tokens[i + 1];
    const text = (inline?.children || []).filter((c) => c.type === 'text' || c.type === 'code_inline' || c.type === 'emoji')
      .map((c) => c.content).join('').trim() || inline?.content || '';
    const id = t.attrGet('id');
    if (id && text) toc.push({ level, text, id });
  }
  return toc;
}

/**
 * Create a renderer bound to a DOM window (the real browser window in the app, jsdom in tests).
 * render(markdown, { baseUrl }) -> { html, toc, title, frontMatter, stats }
 */
export function createRenderer(window) {
  const purify = createDOMPurify(window);
  let currentBase = '';

  purify.addHook('afterSanitizeAttributes', (node) => {
    const attr = MEDIA_ATTRS[node.nodeName];
    if (attr && node.hasAttribute(attr)) {
      node.setAttribute(attr, resolveMediaUrl(node.getAttribute(attr), currentBase));
    }
    if (node.nodeName === 'IMG') {
      node.setAttribute('decoding', 'async');
    }
    if (node.nodeName === 'A' && node.hasAttribute('target')) node.removeAttribute('target');
  });

  const purifyConfig = {
    // Allow file: links/images and Windows drive paths in addition to DOMPurify's safe defaults.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file):|[a-z]:[\\/]|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['align', 'valign', 'bgcolor', 'color', 'face', 'width', 'height'],
    FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['autofocus', 'formaction'],
    ALLOW_DATA_ATTR: true,
    WHOLE_DOCUMENT: false,
  };

  return function render(markdown, { baseUrl = '', wiki = null } = {}) {
    const state = { frontMatterRaw: null };
    const md = buildMarkdownIt(state);
    const src = String(markdown ?? '').replace(/^﻿/, '');
    const env = wiki ? { wiki } : {};
    const tokens = md.parse(src, env);
    let body = md.renderer.render(tokens, md.options, env);

    const fm = parseFrontMatter(state.frontMatterRaw);
    if (fm) body = renderFrontMatter(fm) + body;

    currentBase = baseUrl;
    const html = purify.sanitize(body, purifyConfig);
    currentBase = '';

    const toc = collectToc(tokens);
    const plain = src.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ');
    const words = (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    const title = (fm && fm.title && fmValue(fm.title)) || toc.find((h) => h.level === 1)?.text || toc[0]?.text || '';
    // The whole document's direction: front matter `dir: rtl`, or a right-to-left `lang:` (ar, he, fa…).
    const fmDir = fm && String(fm.dir ?? '').toLowerCase();
    const fmLang = fm && String(fm.lang ?? fm.language ?? '');
    const dir = fmDir === 'rtl' || fmDir === 'ltr' ? fmDir : RTL_LANGS.test(fmLang) ? 'rtl' : '';
    return { html, toc, title, frontMatter: fm, dir, lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(fmLang) ? fmLang : '', stats: { words, minutes: Math.max(1, Math.round(words / 230)) } };
  };
}
