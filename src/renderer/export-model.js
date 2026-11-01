// Turns a rendered page into a small, plain document model that the Word and plain-text exports
// are built from. Pure DOM walking: runs in the app and under jsdom in the tests.
//
// Blocks: { t: 'meta' | 'h' | 'p' | 'list' | 'quote' | 'code' | 'table' | 'hr' | 'graphic' | 'deflist' }
// Runs:   { text, b, i, s, code, u, sup, sub, mark, href, math } · { img } · { br: true }

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'DL',
  'DIV', 'SECTION', 'HEADER', 'DETAILS', 'FIGURE', 'ARTICLE', 'ASIDE', 'NAV', 'FOOTER', 'MAIN']);
const RASTER = /\.(png|jpe?g|gif|bmp)(?:[?#].*)?$/i;
const SKIP = '.copy-btn, .run-output, .footnote-backref, .octicon, script, style, button';

const clean = (s) => s.replace(/[ \t\r\n\f]+/g, ' ');

function size(el) {
  const w = el.naturalWidth || el.width?.baseVal?.value || Number(el.getAttribute?.('width')) || 0;
  const h = el.naturalHeight || el.height?.baseVal?.value || Number(el.getAttribute?.('height')) || 0;
  const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
  return { width: Math.round(r.width || w || 0), height: Math.round(r.height || h || 0), naturalWidth: w, naturalHeight: h };
}

function graphic(el, kind) {
  // Measure just the drawing (not its full-width box) so the picture is cropped to its content.
  const inner = kind === 'math' ? el.querySelector('.katex') : el.querySelector('svg');
  let { width, height } = size(inner || el);
  if (kind === 'math' && inner && el.ownerDocument.createRange) {
    // KaTeX's display box spans the whole line; measure the formula itself.
    try {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(inner.querySelector('.katex-html') || inner);
      const r = range.getBoundingClientRect?.();
      if (r && r.width) { width = r.width; height = Math.max(height, r.height); }
    } catch { /* keep the box size */ }
  }
  width = Math.ceil(width || 0);
  height = Math.ceil(height || 0);
  const pad = kind === 'math' ? 8 : 2;
  const html = inner && width
    ? `<div style="box-sizing:content-box;width:${width}px;height:${height}px;padding:${pad}px;${kind === 'math' ? 'text-align:center;white-space:nowrap' : 'line-height:0'}">${inner.outerHTML}</div>`
    : el.outerHTML;
  if (width) { width += pad * 2; height += pad * 2; }
  return { t: 'graphic', kind, html, width: width || 600, height: height || 300, alt: kind === 'math' ? tex(el) : '' };
}

function tex(el) {
  return (el.querySelector('annotation[encoding="application/x-tex"]')?.textContent || el.textContent || '').trim();
}

/** Inline content of an element as runs. */
export function runsOf(node, style = {}, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = clean(child.nodeValue);
      if (text) out.push({ ...style, text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child;
    if (el.matches(SKIP)) continue;
    const tag = el.tagName;
    if (el.classList.contains('katex')) { out.push({ ...style, text: tex(el), math: true }); continue; }
    if (tag === 'BR') { out.push({ br: true }); continue; }
    if (tag === 'IMG') {
      const s = size(el);
      out.push({ img: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '', raster: RASTER.test(el.getAttribute('src') || ''), ...s });
      continue;
    }
    if (tag === 'INPUT' && el.type === 'checkbox') { out.push({ ...style, text: el.checked || el.hasAttribute('checked') ? '☑ ' : '☐ ' }); continue; }
    if (tag === 'svg' || tag === 'SVG') continue;
    const next = { ...style };
    if (tag === 'STRONG' || tag === 'B') next.b = true;
    else if (tag === 'EM' || tag === 'I' || tag === 'CITE') next.i = true;
    else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') next.s = true;
    else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') next.code = true;
    else if (tag === 'U' || tag === 'INS') next.u = true;
    else if (tag === 'SUP') next.sup = true;
    else if (tag === 'SUB') next.sub = true;
    else if (tag === 'MARK') { if (!el.hasAttribute('data-hl')) next.mark = true; }   // private highlights stay private
    else if (tag === 'A' && el.getAttribute('href')) next.href = el.getAttribute('href');
    runsOf(el, next, out);
  }
  return out;
}

function trimRuns(runs) {
  while (runs.length && runs[0].text != null && !runs[0].text.trim()) runs.shift();
  while (runs.length && runs.at(-1).text != null && !runs.at(-1).text.trim()) runs.pop();
  if (runs[0]?.text != null) runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') };
  const last = runs.at(-1);
  if (last?.text != null) runs[runs.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
  return runs;
}

function align(el) {
  const a = (el.style?.textAlign || el.getAttribute('align') || '').toLowerCase();
  return ['left', 'center', 'right'].includes(a) ? a : undefined;
}

/** Child nodes of `el` as blocks; loose inline content is gathered into paragraphs. */
export function blocksOf(el, out = []) {
  let inline = null;
  const flush = () => {
    if (inline) { const runs = trimRuns(inline); if (runs.length) out.push({ t: 'p', runs }); }
    inline = null;
  };
  for (const child of el.childNodes) {
    const isBlock = child.nodeType === 1 && (BLOCK_TAGS.has(child.tagName) || child.classList?.contains('mermaid-diagram')
      || child.classList?.contains('katex-display'));
    if (!isBlock) {
      if (child.nodeType === 1 && child.matches(SKIP)) continue;
      inline ??= [];
      const holder = { childNodes: [child] };
      runsOf(holder, {}, inline);
      continue;
    }
    flush();
    block(child, out);
  }
  flush();
  return out;
}

function listOf(el) {
  const items = [];
  for (const li of el.children) {
    if (li.tagName !== 'LI') continue;
    const box = li.querySelector(':scope > input[type=checkbox], :scope > label > input[type=checkbox], :scope > p > input[type=checkbox]');
    const blocks = blocksOf(li);
    if (box) {
      // The checkbox became a ☐/☑ glyph at the start of the first paragraph; keep it as a flag instead.
      const first = blocks.find((b) => b.t === 'p');
      if (first && /^[☐☑]/.test(first.runs[0]?.text || '')) {
        first.runs[0] = { ...first.runs[0], text: first.runs[0].text.replace(/^[☐☑]\s*/, '') };
        if (!first.runs[0].text) first.runs.shift();
        trimRuns(first.runs);
      }
    }
    items.push({ blocks, checked: box ? (box.checked || box.hasAttribute('checked')) : null });
  }
  const start = Number(el.getAttribute('start'));
  return { t: 'list', ordered: el.tagName === 'OL', start: Number.isFinite(start) && start > 0 ? start : 1, items };
}

function tableOf(el) {
  const rows = [];
  for (const tr of el.querySelectorAll('tr')) {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => ({ runs: trimRuns(runsOf(c)), align: align(c), header: c.tagName === 'TH' }));
    rows.push({ header: cells.length > 0 && cells.every((c) => c.header), cells });
  }
  return { t: 'table', rows };
}

function block(el, out) {
  const tag = el.tagName;
  if (el.matches(SKIP)) return;
  if (el.classList.contains('mermaid-diagram')) {
    const svg = el.querySelector('svg');
    if (svg) out.push(graphic(el, 'diagram'));
    else out.push({ t: 'p', runs: [{ text: el.textContent.trim(), i: true }] });
    return;
  }
  if (el.classList.contains('katex-display')) { out.push(graphic(el, 'math')); return; }
  if (el.classList.contains('doc-meta')) {
    const q = (s) => el.querySelector(s)?.textContent.trim() || '';
    out.push({ t: 'meta', title: q('.doc-meta-title'), sub: q('.doc-meta-sub'), line: q('.doc-meta-line'),
      tags: [...el.querySelectorAll('.doc-meta-tags .tag')].map((t) => t.textContent.trim()) });
    return;
  }
  if (el.classList.contains('markdown-alert')) {
    const title = el.querySelector('.markdown-alert-title');
    const kind = title ? title.textContent.trim() : 'Note';
    const inner = blocksOf(el).filter((b, i) => !(i === 0 && title && b.t === 'p' && b.runs.map((r) => r.text).join('').trim() === kind));
    out.push({ t: 'quote', alert: kind, blocks: inner });
    return;
  }
  if (/^H[1-6]$/.test(tag)) {
    out.push({ t: 'h', level: Number(tag[1]), id: el.id || '', runs: trimRuns(runsOf(el)) });
    return;
  }
  switch (tag) {
    case 'P': {
      const runs = trimRuns(runsOf(el));
      if (runs.length) out.push({ t: 'p', runs, align: align(el) });
      return;
    }
    case 'UL': case 'OL': out.push(listOf(el)); return;
    case 'PRE': {
      const code = el.querySelector('code') || el;
      out.push({ t: 'code', text: code.textContent.replace(/\n$/, ''), lang: el.dataset?.lang || '' });
      return;
    }
    case 'BLOCKQUOTE': out.push({ t: 'quote', blocks: blocksOf(el) }); return;
    case 'TABLE': out.push(tableOf(el)); return;
    case 'HR': if (!el.classList.contains('footnotes-sep')) out.push({ t: 'hr' }); return;
    case 'DL': {
      const items = [];
      for (const c of el.children) {
        if (c.tagName === 'DT') items.push({ term: trimRuns(runsOf(c)), defs: [] });
        else if (c.tagName === 'DD' && items.length) items.at(-1).defs.push(...blocksOf(c));
      }
      out.push({ t: 'deflist', items });
      return;
    }
    case 'DETAILS': {
      const summary = el.querySelector(':scope > summary');
      if (summary) out.push({ t: 'p', runs: trimRuns(runsOf(summary, { b: true })) });
      const rest = { childNodes: [...el.childNodes].filter((n) => n !== summary) };
      blocksOf(rest, out);
      return;
    }
    case 'SECTION':
      if (el.classList.contains('footnotes')) { out.push({ t: 'hr' }); blocksOf(el, out); return; }
      blocksOf(el, out);
      return;
    default:
      blocksOf(el, out);
  }
}

/** The whole page as a list of blocks. */
export function buildModel(root) {
  return blocksOf(root);
}

// ---------------------------------------------------------------- plain text
const runText = (runs) => runs.map((r) => {
  if (r.br) return '\n';
  if (r.img != null) return r.alt ? `[Image: ${r.alt}]` : '[Image]';
  let t = r.text || '';
  if (r.href && /^(https?|mailto):/i.test(r.href) && !t.includes(r.href.replace(/^mailto:/, ''))) t += ` (${r.href.replace(/^mailto:/, '')})`;
  return t;
}).join('').replace(/[ \t]+\n/g, '\n');

const indent = (text, pad, first = pad) => text.split('\n').map((l, i) => (l ? (i === 0 ? first : pad) + l : l)).join('\n');

function textBlocks(blocks, width) {
  return blocks.map((b) => textBlock(b, width)).filter((s) => s != null && s !== '').join('\n\n');
}

function textBlock(b, width) {
  switch (b.t) {
    case 'meta': return [b.title && b.title.toUpperCase(), b.sub, b.line, b.tags?.length ? b.tags.map((t) => '#' + t).join(' ') : ''].filter(Boolean).join('\n');
    case 'h': {
      const t = runText(b.runs);
      if (b.level === 1) return `${t}\n${'='.repeat(Math.min(width, Math.max(3, t.length)))}`;
      if (b.level === 2) return `${t}\n${'-'.repeat(Math.min(width, Math.max(3, t.length)))}`;
      return t;
    }
    case 'p': return runText(b.runs);
    case 'list': return b.items.map((item, i) => {
      const mark = item.checked != null ? `[${item.checked ? 'x' : ' '}] ` : '';
      const bullet = (b.ordered ? `${b.start + i}.` : '-') + ' ';
      const body = textBlocks(item.blocks, width - bullet.length) || '';
      return indent(mark + body, ' '.repeat(bullet.length), bullet);
    }).join('\n');
    case 'quote': return indent((b.alert ? b.alert.toUpperCase() + ': ' : '') + textBlocks(b.blocks, width - 2), '> ').replace(/^$/gm, '>');
    case 'code': return indent(b.text, '    ');
    case 'hr': return '* * *';
    case 'graphic': return b.kind === 'math' ? indent(b.alt, '    ') : '[Diagram]';
    case 'deflist': return b.items.map((it) => `${runText(it.term)}\n${indent(textBlocks(it.defs, width - 4), '    ')}`).join('\n\n');
    case 'table': {
      const rows = b.rows.map((r) => r.cells.map((c) => runText(c.runs).replace(/\n/g, ' ')));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      const w = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.map((r) => (r[i] || '').length)));
      const line = (r) => r.map((c, i) => (c || '').padEnd(w[i])).join(' | ').trimEnd();
      const out = rows.map(line);
      const head = b.rows.findIndex((r) => r.header);
      if (head >= 0) out.splice(head + 1, 0, w.map((n) => '-'.repeat(n)).join('-|-'));
      return out.join('\n');
    }
    default: return '';
  }
}

/** The page as readable plain text. */
export function toPlainText(blocks, { width = 78 } = {}) {
  return textBlocks(blocks, width).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
