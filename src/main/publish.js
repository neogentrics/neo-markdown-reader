'use strict';
// Publishing: the PDF designer, self-contained web pages, Word documents and plain text.
// The page builders at the top are pure (unit-tested); the Electron parts are below them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

const PAPERS = {
  letter: { css: 'letter', w: 8.5, h: 11, label: 'Letter' },
  a4: { css: 'A4', w: 8.27, h: 11.69, label: 'A4' },
  legal: { css: 'legal', w: 8.5, h: 14, label: 'Legal' },
  a5: { css: 'A5', w: 5.83, h: 8.27, label: 'A5' },
};
const MARGINS = { narrow: 0.5, normal: 0.8, wide: 1.1 };
const LETTER_COUNTRIES = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PR', 'DO', 'PA', 'SV', 'NI', 'HN', 'BO']);
const MAX_INLINE_IMAGE = 25 * 1024 * 1024;
const DARK_THEMES = new Set(['dark', 'forest', 'dusk', 'contrast']);
const tone = (theme) => (DARK_THEMES.has(theme) ? 'dark' : 'light');
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function resolvePaper(paper, country = '') {
  if (PAPERS[paper]) return paper;
  return LETTER_COUNTRIES.has(String(country).toUpperCase()) ? 'letter' : 'a4';
}

/** Page margins in inches; room is kept for the header and footer when they're on. */
function pageMargins(options) {
  const m = MARGINS[options.margins] ?? MARGINS.normal;
  return { top: options.header ? Math.max(m, 0.75) : m, bottom: options.pageNumbers ? Math.max(m, 0.7) : m, side: m };
}

/** Entries for the contents page: the top three heading levels used in the document. */
function contentsEntries(toc = []) {
  const usable = toc.filter((h) => h && h.id && h.text);
  if (!usable.length) return [];
  const min = Math.min(...usable.map((h) => h.level));
  return usable.filter((h) => h.level <= min + 2).map((h) => ({ id: h.id, text: h.text, depth: h.level - min }));
}

/** Title, subtitle and byline for the cover and PDF properties, from front matter with sensible fallbacks. */
function docInfo(meta = {}) {
  const fm = meta.frontMatter && typeof meta.frontMatter === 'object' ? meta.frontMatter : {};
  const str = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : typeof v === 'object' ? '' : String(v)).trim();
  const fileTitle = String(meta.name || '').replace(/\.[^.]+$/, '');
  const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : str(fm.date);
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : str(fm.tags) ? str(fm.tags).split(',').map((t) => t.trim()) : [];
  return {
    title: str(fm.title) || str(meta.title) || fileTitle || 'Untitled',
    subtitle: str(fm.subtitle) || str(fm.description),
    author: str(fm.author) || str(fm.authors),
    organization: str(fm.organization) || str(fm.company),
    date,
    version: str(fm.version),
    tags,
    logo: str(fm.logo),
  };
}

function head({ title, cssHref, css, theme, font, pageCss = '' }) {
  return `<!doctype html>
<html lang="en" class="publish-root" data-theme="${esc(theme || 'light')}" data-tone="${tone(theme)}" data-font="${esc(font || 'sans')}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' file:; img-src file: data: https: http:; font-src file: data:; media-src file: data: https:">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(cssHref)}">
<style>:root { --font-scale: 1; } ${pageCss}</style>
${css ? `<style>${String(css).replace(/<\/style/gi, '<\\/style')}</style>` : ''}
</head>`;
}

/** The body of the PDF: optional contents page, then the document. `numbers` fills in page numbers. */
function buildBodyHtml({ content, meta, options, css, cssHref, theme, font, numbers = null }) {
  const paper = PAPERS[options.paper] || PAPERS.letter;
  const m = pageMargins(options);
  const info = docInfo(meta);
  const entries = options.contents ? contentsEntries(meta.toc) : [];
  const toc = entries.length
    ? `<nav class="pub-toc" aria-label="Contents"><div class="pub-toc-title">Contents</div><ol>${entries.map((e, i) =>
      `<li class="lvl-${Math.min(2, e.depth)}"><a href="#${esc(e.id)}"><span class="t">${esc(e.text)}</span><span class="dots"></span><span class="n">${numbers ? (numbers[i] || '') : ''}</span></a></li>`).join('')}</ol></nav>`
    : '';
  const classes = ['publish', 'print', options.cover ? 'has-cover' : '', options.chapterBreaks ? 'h1-breaks' : ''].filter(Boolean).join(' ');
  return `${head({ title: info.title, cssHref, css, theme, font, pageCss: `@page { size: ${paper.css}; margin: ${m.top}in ${m.side}in ${m.bottom}in; }` })}
<body class="${classes}">
${toc}<article class="markdown-body pub-body">${content}</article>
</body>
</html>`;
}

/** A designed title page built from the front matter. */
function buildCoverHtml({ meta, options, css, cssHref, theme, font, baseUrl = '' }) {
  const paper = PAPERS[options.paper] || PAPERS.letter;
  const info = docInfo(meta);
  let logo = '';
  if (info.logo) {
    try {
      const u = new URL(info.logo.replace(/\\/g, '/'), baseUrl || undefined);
      if (['file:', 'https:', 'http:', 'data:'].includes(u.protocol)) logo = `<img class="pub-cover-logo" src="${esc(u.href)}" alt="">`;
    } catch { /* ignore a bad logo path */ }
  }
  const kicker = info.organization || info.tags.slice(0, 3).join(' · ');
  const left = [info.author && `<strong>${esc(info.author)}</strong>`, info.organization && info.author ? esc(info.organization) : ''].filter(Boolean).join('<br>');
  const right = [info.date && esc(info.date), info.version && `Version ${esc(info.version)}`].filter(Boolean).join('<br>');
  return `${head({ title: info.title, cssHref, css, theme, font, pageCss: `@page { size: ${paper.css}; margin: 0; } .pub-cover { width: ${paper.w}in; height: ${(paper.h - 0.02).toFixed(2)}in; }` })}
<body class="publish cover">
<section class="pub-cover">
<div class="pub-cover-band"></div>
${logo}
<div class="pub-cover-main">
${kicker ? `<div class="pub-cover-kicker">${esc(kicker)}</div>` : ''}
<div class="pub-cover-title">${esc(info.title)}</div>
<div class="pub-cover-rule"></div>
${info.subtitle ? `<div class="pub-cover-sub">${esc(info.subtitle)}</div>` : ''}
</div>
<div class="pub-cover-foot"><div>${left}</div><div style="text-align:right">${right}</div></div>
</section>
</body>
</html>`;
}

/** Chromium header/footer templates (they're rendered in the page margins). */
function headerFooter({ meta, options }) {
  const info = docInfo(meta);
  const m = pageMargins(options);
  const base = `font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:7.5pt;color:#7a8396;width:100%;box-sizing:border-box;padding:0 ${m.side}in;-webkit-print-color-adjust:exact;`;
  const right = [info.author, info.date].filter(Boolean).join(' · ');
  const header = options.header
    ? `<div style="${base}display:flex;justify-content:space-between;gap:24px;"><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(info.title)}</span><span style="white-space:nowrap">${esc(right)}</span></div>`
    : '<div></div>';
  const footer = options.pageNumbers
    ? `<div style="${base}text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
    : '<div></div>';
  return { displayHeaderFooter: !!(options.header || options.pageNumbers), headerTemplate: header, footerTemplate: footer };
}

/** The export stylesheet with KaTeX fonts inlined (only when the document has maths) or dropped. */
function inlineExportCss(cssText, distDir, needMath) {
  if (!needMath) return cssText.replace(/@font-face\s*{[^}]*KaTeX[^}]*}/g, '');
  return cssText.replace(/src:\s*url\("?\.\/(fonts\/[^")]+\.woff2)"?\)\s*format\("woff2"\)[^;}]*/g, (all, rel) => {
    try {
      const data = fs.readFileSync(path.join(distDir, rel)).toString('base64');
      return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
    } catch { return all; }
  });
}

/** Replace file:// image sources with data: URIs so the page works anywhere. */
async function inlineLocalImages(html) {
  const found = new Map();
  const re = /(<img\b[^>]*?\bsrc=")(file:\/\/[^"]+)(")/gi;
  for (const m of html.matchAll(re)) found.set(m[2], null);
  for (const url of found.keys()) {
    try {
      const file = fileURLToPath(url.replace(/&amp;/g, '&'));
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = IMAGE_MIME[ext];
      if (!mime) continue;
      const st = await fs.promises.stat(file);
      if (st.size > MAX_INLINE_IMAGE) continue;
      found.set(url, `data:${mime};base64,${(await fs.promises.readFile(file)).toString('base64')}`);
    } catch { /* leave it as a file link */ }
  }
  return html.replace(re, (all, a, url, b) => (found.get(url) ? a + found.get(url) + b : all));
}

/** A single .html file that looks like the page in the reader and needs nothing else. */
async function buildStandaloneHtml({ content, meta, css, theme, font, exportCss, distDir }) {
  const info = docInfo(meta);
  const needMath = /class="katex/.test(content);
  const style = inlineExportCss(exportCss, distDir, needMath);
  const body = await inlineLocalImages(content);
  const description = info.subtitle ? `<meta name="description" content="${esc(info.subtitle)}">\n` : '';
  const author = info.author ? `<meta name="author" content="${esc(info.author)}">\n` : '';
  return `<!doctype html>
<html lang="en" class="publish-root" data-theme="${esc(theme || 'light')}" data-tone="${tone(theme)}" data-font="${esc(font || 'sans')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Neo Markdown Reader">
${description}${author}<title>${esc(info.title)}</title>
<style>
${style}
:root { --font-scale: 1; }
</style>
${css ? `<style>\n${String(css).replace(/<\/style/gi, '<\\/style')}\n</style>` : ''}
</head>
<body class="publish web">
<main class="pub-web"><article class="markdown-body">
${body}
</article></main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- Electron side
let tools = null;
/** pdf-lib and docx, from the bundled dist/export-tools.cjs (or the source when running tests). */
function exportTools(root) {
  if (tools) return tools;
  const bundled = path.join(root, 'dist', 'export-tools.cjs');
  tools = fs.existsSync(bundled) ? require(bundled) : require('./export-tools.js');
  return tools;
}

let seq = 0;
function tempHtml(html) {
  const file = path.join(os.tmpdir(), `nmr-export-${process.pid}-${Date.now()}-${++seq}.html`);
  fs.writeFileSync(file, html);
  return file;
}

function hiddenWindow(extra = {}) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    show: false, width: 1000, height: 1200, paintWhenInitiallyHidden: true,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, ...extra },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

/** Print an HTML page to PDF in a hidden window that runs no scripts. */
async function printHtml(html, pdfOptions = {}) {
  const file = tempHtml(html);
  const win = hiddenWindow();
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true, generateTaggedPDF: true, ...pdfOptions });
  } finally {
    win.destroy();
    fs.rm(file, { force: true }, () => {});
  }
}

/**
 * Build the designed PDF.
 * payload: { content, meta: { name, title, frontMatter, toc, baseUrl }, css, theme, font }
 */
async function renderPdf({ root, payload, options }) {
  const { readOutline, pagesForEntries, finishPdf } = exportTools(root);
  const cssHref = pathToFileURL(path.join(root, 'dist', 'export.css')).href;
  const common = { meta: payload.meta, options, css: payload.css, cssHref, theme: payload.theme, font: payload.font };
  const hf = headerFooter(common);
  let body = await printHtml(buildBodyHtml({ ...common, content: payload.content }), hf);
  const entries = options.contents ? contentsEntries(payload.meta.toc) : [];
  let numbers = null;
  if (entries.length) {
    // First pass finds which page each heading landed on (from the PDF's outline);
    // the second pass prints the contents page with those numbers.
    const outline = await readOutline(body);
    numbers = pagesForEntries(entries, outline.items);
    body = await printHtml(buildBodyHtml({ ...common, content: payload.content, numbers }), hf);
  }
  const cover = options.cover ? await printHtml(buildCoverHtml({ ...common, baseUrl: payload.meta.baseUrl }), { displayHeaderFooter: false, generateDocumentOutline: false }) : null;
  const info = docInfo(payload.meta);
  const pdf = await finishPdf(body, cover, { title: info.title, author: info.author, subject: info.subtitle, keywords: info.tags });
  return { pdf, numbers, entries };
}

/** Draw HTML snippets (diagrams, equations, unusual image formats) to PNG for Word. */
async function rasterize(root, items, { css = '', theme = 'light' } = {}) {
  if (!items.length) return [];
  const cssHref = pathToFileURL(path.join(root, 'dist', 'export.css')).href;
  const win = hiddenWindow({ offscreen: true });
  const scale = 2;
  const out = [];
  try {
    for (const item of items) {
      const w = Math.max(16, Math.min(1600, Math.ceil(item.width || 600)));
      const h = Math.max(16, Math.min(2400, Math.ceil(item.height || 300)));
      const html = `${head({ title: 'graphic', cssHref, css, theme, font: 'sans' })}<body class="publish" style="margin:0;overflow:hidden;background:var(--page);zoom:${scale}"><div class="markdown-body" style="width:${w}px;font-size:16.5px">${item.html}</div></body></html>`;
      const file = tempHtml(html);
      try {
        win.setContentSize(w * scale, h * scale);
        await win.loadFile(file);
        await new Promise((r) => setTimeout(r, 120));
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: w * scale, height: h * scale });
        out.push(img.isEmpty() ? null : { data: img.toPNG(), width: w, height: h });
      } catch { out.push(null); } finally { fs.rm(file, { force: true }, () => {}); }
    }
  } finally { win.destroy(); }
  return out;
}

function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return null;
}

async function loadImageBytes(src) {
  if (/^data:/i.test(src)) {
    const m = /^data:[^;,]*(;base64)?,(.*)$/is.exec(src);
    if (!m) return null;
    return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
  }
  if (/^file:/i.test(src)) {
    const file = fileURLToPath(src);
    const st = await fs.promises.stat(file);
    return st.size > MAX_INLINE_IMAGE ? null : fs.promises.readFile(file);
  }
  if (/^https?:/i.test(src)) {
    const { net } = require('electron');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await net.fetch(src, { signal: ctl.signal });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > MAX_INLINE_IMAGE ? null : buf;
    } finally { clearTimeout(timer); }
  }
  return null;
}

/** Build the Word document: images are read here, diagrams and equations are drawn to pictures. */
async function renderDocx({ root, payload, options }) {
  const { collectAssets, buildDocx } = exportTools(root);
  const { nativeImage } = require('electron');
  const model = payload.model;
  const { images: srcs, graphics } = collectAssets(model);
  const images = {};
  const sizes = new Map();
  const walkRuns = (blocks) => {
    for (const b of blocks || []) {
      for (const r of b.runs || []) if (r.img) sizes.set(r.img, r);
      if (b.items) b.items.forEach((it) => { walkRuns(it.blocks); walkRuns(it.defs); if (it.term) walkRuns([{ runs: it.term }]); });
      if (b.blocks) walkRuns(b.blocks);
      if (b.rows) b.rows.forEach((r) => r.cells.forEach((c) => walkRuns([c])));
    }
  };
  walkRuns(model);
  const toDraw = [];
  for (const src of srcs) {
    let data = null;
    try { data = await loadImageBytes(src); } catch { data = null; }
    const type = sniffImage(data);
    const run = sizes.get(src) || {};
    if (data && type) {
      let { naturalWidth: w, naturalHeight: h } = run;
      if (!w || !h) { try { const s = nativeImage.createFromBuffer(data).getSize(); w = s.width; h = s.height; } catch { /* keep */ } }
      const shown = run.width && run.height ? { width: run.width, height: run.height } : { width: w, height: h };
      images[src] = { data, type, width: shown.width || w, height: shown.height || h };
    } else if (data || /^file:|^data:/i.test(src)) {
      toDraw.push({ src, html: `<img src="${esc(src)}" style="display:block;width:${run.width || 400}px;height:${run.height || 300}px">`, width: run.width || 400, height: run.height || 300 });
    }
  }
  const drawn = await rasterize(root, [...graphics.map((g) => ({ html: g.html, width: g.width, height: g.height })), ...toDraw], { css: payload.css });
  const graphicAssets = drawn.slice(0, graphics.length);
  toDraw.forEach((t, i) => { const d = drawn[graphics.length + i]; if (d) images[t.src] = { data: d.data, type: 'png', width: d.width, height: d.height }; });
  const info = docInfo(payload.meta);
  return buildDocx(model, { images, graphics: graphicAssets }, { ...options, title: info.title, author: info.author, subject: info.subtitle });
}

module.exports = {
  PAPERS, MARGINS, resolvePaper, pageMargins, contentsEntries, docInfo,
  buildBodyHtml, buildCoverHtml, headerFooter, buildStandaloneHtml, inlineExportCss, inlineLocalImages, sniffImage,
  renderPdf, renderDocx, rasterize, exportTools,
};
