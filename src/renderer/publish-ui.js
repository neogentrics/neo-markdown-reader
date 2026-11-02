// The PDF designer dialog and the File > Export commands. The page hands its rendered content to
// the main process, which builds the file (see src/main/publish.js).
import { buildModel, toPlainText } from './export-model.js';
import { cleanCopy } from './read-ui.js';
import { splitSlides, fitSlide } from './present.js';

const $ = (id) => document.getElementById(id);
const PAPER_RATIO = { letter: 11 / 8.5, a4: 11.69 / 8.27, legal: 14 / 8.5, a5: 8.27 / 5.83 };
const MARGIN_PX = { narrow: 5, normal: 8, wide: 11 };
const LABEL = { pdf: 'PDF', docx: 'Word document', html: 'web page', txt: 'plain text', epub: 'e-book', slides: 'slides as PDF', pptx: 'PowerPoint slides' };

/** A hidden place to lay things out at their real size (slides, measuring diagrams). */
function offstage(width) {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-40000px;top:0;width:${width}px;visibility:hidden;pointer-events:none;contain:layout`;
  document.body.appendChild(box);
  return box;
}

/**
 * The document as slides, split as in presentation mode: for PowerPoint a document model per slide;
 * for PDF each slide's HTML with the text size presentation mode would use.
 */
export function slidesFor(root, kind) {
  const slides = splitSlides(root);
  const stage = offstage(1280);
  try {
    return slides.map((nodes) => {
      for (const n of nodes) n.querySelectorAll?.('.copy-btn, .run-output, .fold-btn').forEach((x) => x.remove());
      if (kind === 'pptx') {
        const div = document.createElement('div');
        div.className = 'markdown-body';
        div.style.width = '1088px';
        div.append(...nodes);
        stage.replaceChildren(div);
        return buildModel(div);
      }
      const el = document.createElement('div');
      el.className = 'present-slide markdown-body';
      const cls = [];
      if (nodes.length === 1 && nodes[0].classList?.contains('doc-meta')) cls.push('title-slide');
      if (nodes.length <= 2) cls.push('short');
      el.classList.add(...cls);
      el.append(...nodes);
      stage.replaceChildren(el);
      const fontSize = fitSlide(el);
      return { html: el.innerHTML, cls: cls.join(' '), fontSize };
    });
  } finally { stage.remove(); }
}

/**
 * The document as e-book chapters of XHTML: split at its main headings, links between chapters
 * pointed at the right file, diagrams handed over to be drawn as pictures.
 */
export function epubFor(live, { title = '' } = {}) {
  const clone = cleanCopy(live.cloneNode(true));
  clone.querySelectorAll('.copy-btn, .run-output, button, .katex-html, .mermaid-src, script, style, .img-missing').forEach((n) => n.remove());
  clone.querySelectorAll('mark[data-hl]').forEach((m) => m.replaceWith(...m.childNodes));
  clone.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
  // Diagrams: drawn to pictures by the main process (e-readers can't show their drawings reliably).
  const graphics = [];
  const liveDiagrams = [...live.querySelectorAll('.mermaid-diagram')];
  clone.querySelectorAll('.mermaid-diagram').forEach((d, i) => {
    const svg = liveDiagrams[i]?.querySelector('svg');
    if (!svg) { d.remove(); return; }
    const r = svg.getBoundingClientRect();
    graphics.push({ html: svg.outerHTML, width: Math.ceil(r.width) || 640, height: Math.ceil(r.height) || 400, alt: 'Diagram' });
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.setAttribute('data-graphic', String(graphics.length - 1));
    img.setAttribute('alt', 'Diagram');
    fig.append(img);
    d.replaceWith(fig);
  });
  // Charts keep their drawing, with plain colours instead of theme variables.
  clone.querySelectorAll('.chart-svg [style], .chart-svg, .addon-block [style]').forEach((el) => {
    const st = el.getAttribute('style');
    if (st) el.setAttribute('style', st.replace(/var\(--[\w-]+,\s*([^)]+)\)/g, '$1'));
  });
  // Links: within the book they stay; to other files on this computer they can't work in an e-book.
  for (const a of clone.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!/^(#|https?:|mailto:)/i.test(href)) a.removeAttribute('href');
  }
  const nodes = [...clone.children];
  const splitTag = nodes.filter((n) => n.tagName === 'H1').length > 1 ? 'H1' : 'H2';
  const chapters = [];
  let cur = null;
  for (const n of nodes) {
    if (!cur || (n.tagName === splitTag && cur.nodes.some((x) => x.tagName !== 'H1' && !x.classList?.contains('doc-meta')))) {
      cur = { nodes: [] };
      chapters.push(cur);
    }
    cur.nodes.push(n);
  }
  const where = new Map();
  chapters.forEach((ch, i) => ch.nodes.forEach((n) => {
    if (n.id) where.set(n.id, i);
    n.querySelectorAll?.('[id]').forEach((x) => where.set(x.id, i));
  }));
  const toc = [];
  chapters.forEach((ch, i) => {
    for (const n of ch.nodes) {
      for (const a of n.querySelectorAll?.('a[href^="#"]') || []) {
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        const j = where.get(id);
        if (j != null && j !== i) a.setAttribute('href', `chapter-${j + 1}.xhtml#${encodeURIComponent(id)}`);
      }
      const heads = /^H[1-3]$/.test(n.tagName) ? [n] : [...(n.querySelectorAll?.('h1[id], h2[id], h3[id]') || [])].filter((h) => !h.closest('.footnotes'));
      for (const h of heads) if (h.id) toc.push({ chapter: i, id: h.id, text: h.textContent.trim(), level: Number(h.tagName[1]) });
    }
  });
  const ser = new XMLSerializer();
  return {
    chapters: chapters.map((ch) => ({
      title: ch.nodes.find((n) => /^H[1-6]$/.test(n.tagName))?.textContent.trim() || title,
      html: ch.nodes.map((n) => ser.serializeToString(n)).join('\n'),
    })),
    toc, graphics,
  };
}

export function createPublish({ api, activeTab, settings, toast, themeCss }) {
  const dlg = $('publish');
  const form = $('publish-form');
  const goBtn = $('publish-go');
  let busy = false;

  /** The active tab's page, cleaned of reader-only bits (copy buttons, private highlights). */
  function payloadFor(tab) {
    const clone = cleanCopy(tab.el.cloneNode(true));
    clone.querySelectorAll('.copy-btn, .run-output').forEach((n) => n.remove());
    clone.querySelectorAll('mark[data-hl]').forEach((m) => m.replaceWith(...m.childNodes));
    clone.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
    const root = document.documentElement;
    return {
      content: clone.innerHTML,
      meta: { name: tab.doc.name, title: tab.result?.title || '', frontMatter: tab.result?.frontMatter || null, toc: tab.result?.toc || [], baseUrl: tab.doc.baseUrl || '' },
      css: themeCss(),
      theme: root.dataset.theme || 'light',
      font: root.dataset.font || 'sans',
    };
  }

  function exportable() {
    const tab = activeTab();
    if (!tab) { toast('Open a document first'); return null; }
    if (tab.doc.compare) { toast('A comparison can’t be exported — export one of the documents instead'); return null; }
    return tab;
  }

  async function run(format, options) {
    const tab = exportable();
    if (!tab || busy) return null;
    busy = true;
    document.body.classList.add('exporting');
    try {
      const payload = { format, ...payloadFor(tab), options };
      if (format === 'docx') payload.model = buildModel(tab.el);
      if (format === 'txt') payload.text = toPlainText(buildModel(tab.el));
      if (format === 'epub') Object.assign(payload, epubFor(tab.el, { title: tab.result?.title || tab.doc.name }), { lang: document.documentElement.lang || navigator.language || 'en' });
      if (format === 'slides' || format === 'pptx') {
        payload.slides = slidesFor(tab.el, format);
        if (!payload.slides.length) { toast('This document is empty'); return null; }
      }
      if (format !== 'pdf' && format !== 'html') delete payload.content;
      toast(`Exporting ${LABEL[format]}…`);
      const res = await api.exportDoc(payload);
      window.__lastExport = res;            // read by the end-to-end tests
      if (res?.ok) toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
      else if (res?.error) toast(res.error);
      else toast('Export cancelled');
      return res;
    } finally {
      busy = false;
      document.body.classList.remove('exporting');
    }
  }

  // ---------------------------------------------------------------- designer
  const current = () => {
    const o = { ...(settings().exportOptions || {}) };
    for (const seg of form.querySelectorAll('.seg[data-opt]')) {
      const on = seg.querySelector('button.active');
      if (on) o[seg.dataset.opt] = on.dataset.value;
    }
    for (const box of form.querySelectorAll('input[type=checkbox][data-opt]')) o[box.dataset.opt] = box.checked;
    return o;
  };

  function fill(o) {
    for (const seg of form.querySelectorAll('.seg[data-opt]')) {
      for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', o[seg.dataset.opt] === b.dataset.value);
    }
    for (const box of form.querySelectorAll('input[type=checkbox][data-opt]')) box.checked = !!o[box.dataset.opt];
  }

  function preview() {
    const o = current();
    const tab = activeTab();
    const paper = o.paper === 'auto' ? (settings().paperAuto || 'letter') : o.paper;
    const box = $('publish-preview');
    box.style.setProperty('--ratio', PAPER_RATIO[paper] || PAPER_RATIO.letter);
    box.style.setProperty('--m', `${MARGIN_PX[o.margins] || 8}px`);
    box.dataset.colors = o.colors;
    box.classList.toggle('dark', o.colors === 'theme' && document.documentElement.dataset.tone === 'dark');
    const fm = tab?.result?.frontMatter || {};
    const title = String(fm.title || tab?.result?.title || tab?.doc.name || 'Untitled');
    const headings = (tab?.result?.toc || []).length;
    $('pv-cover').hidden = !o.cover;
    $('pv-contents').hidden = !o.contents || headings < 1;
    $('pv-cover-title').textContent = title;
    $('pv-cover-sub').textContent = String(fm.subtitle || fm.description || '');
    $('pv-cover-by').textContent = [fm.author, fm.date].filter(Boolean).join(' · ');
    for (const el of box.querySelectorAll('.pv-head')) { el.hidden = !o.header; el.textContent = title; }
    for (const el of box.querySelectorAll('.pv-foot')) el.hidden = !o.pageNumbers;
    $('publish-contents-note').hidden = headings > 0;
    $('publish-paper-auto').textContent = settings().paperAuto === 'a4' ? 'A4' : 'Letter';
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('.seg[data-opt] button');
    if (!b) return;
    e.preventDefault();
    for (const x of b.parentElement.querySelectorAll('button')) x.classList.toggle('active', x === b);
    preview();
  });
  form.addEventListener('change', preview);
  form.addEventListener('submit', (e) => e.preventDefault());

  function openDesigner() {
    const tab = exportable();
    if (!tab) return;
    fill(settings().exportOptions || {});
    $('publish-doc').textContent = tab.doc.name;
    preview();
    if (!dlg.open) dlg.showModal();
    goBtn.focus();
  }

  goBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const options = current();
    goBtn.disabled = true;
    goBtn.textContent = 'Exporting…';
    try {
      const res = await run('pdf', options);
      if (res && !res.canceled) dlg.close();
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = 'Export PDF…';
    }
  });
  $('publish-cancel').addEventListener('click', (e) => { e.preventDefault(); dlg.close(); });
  for (const a of dlg.querySelectorAll('[data-format]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); dlg.close(); run(a.dataset.format); });
  }

  return { openDesigner, exportAs: (format) => (format === 'pdf' ? openDesigner() : run(format)), run, payloadFor };
}
