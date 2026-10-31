// Renderer: UI wiring. All OS access goes through window.reader (see src/main/preload.js).
import { createRenderer } from './markdown.js';
import './styles/app.css';

const api = window.reader;
const render = createRenderer(window);
const $ = (id) => document.getElementById(id);

const els = {
  page: $('page'), welcome: $('welcome'), desk: $('desk'), toc: $('toc'), tocFilter: $('toc-filter'),
  sidebar: $('sidebar'), sideFoot: $('side-foot'), title: $('doc-title'), meta: $('doc-meta'),
  back: $('btn-back'), themeMenu: $('theme-menu'), findBar: $('find-bar'), findInput: $('find-input'),
  findCount: $('find-count'), drop: $('drop-overlay'), toast: $('toast'), recentWrap: $('recent-wrap'),
  recentList: $('recent-list'), shortcuts: $('shortcuts'),
};

let settings = {};
let currentDoc = null;
let renderSeq = 0;

// ---------------------------------------------------------------- settings / theme
function applySettings(s) {
  settings = s;
  const root = document.documentElement;
  const prevTheme = root.dataset.theme;
  root.dataset.theme = s.resolvedTheme || 'light';
  root.dataset.font = s.font;
  root.dataset.width = s.pageWidth;
  root.style.setProperty('--font-scale', s.fontScale);
  document.body.classList.toggle('toc-hidden', !s.showToc);
  for (const seg of document.querySelectorAll('.seg')) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', s[seg.dataset.key] === b.dataset.value);
  }
  renderRecent(s.recent || []);
  if (currentDoc && prevTheme && prevTheme !== root.dataset.theme) renderMermaid(true);
}

// ---------------------------------------------------------------- document rendering
async function showDocument(doc, { keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const scrollRatio = keepScroll ? els.desk.scrollTop / Math.max(1, els.desk.scrollHeight - els.desk.clientHeight) : 0;
  const result = render(doc.content, { baseUrl: doc.baseUrl });
  if (seq !== renderSeq) return;
  currentDoc = { ...doc, ...result };

  els.page.innerHTML = result.html;
  els.page.hidden = false;
  els.welcome.hidden = true;
  document.body.classList.add('has-doc');
  document.title = `${doc.name} — Neo Markdown Reader`;
  els.title.querySelector('.tb-title-name').textContent = result.title && result.title !== doc.name ? result.title : doc.name;
  els.title.title = doc.path;
  els.meta.textContent = result.title && result.title !== doc.name ? doc.name : '';
  if (typeof doc.canGoBack === 'boolean') els.back.disabled = !doc.canGoBack;

  enhance(els.page);
  buildToc(result.toc);
  els.sideFoot.innerHTML = `<span>${result.stats.words.toLocaleString()} words</span><span>${result.stats.minutes} min read</span><button class="link-btn" id="reveal">Show in folder</button>`;
  $('reveal').onclick = () => api.revealCurrent();
  await renderMermaid(false);

  if (keepScroll) {
    els.desk.scrollTop = scrollRatio * (els.desk.scrollHeight - els.desk.clientHeight);
  } else {
    els.desk.scrollTop = 0;
    if (doc.hash) scrollToId(doc.hash);
  }
  updateActiveHeading();
}

function enhance(root) {
  // Copy button on code blocks
  for (const pre of root.querySelectorAll('pre.code-block')) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.onclick = async () => {
      await navigator.clipboard.writeText(pre.querySelector('code')?.innerText ?? pre.innerText);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
    };
    pre.appendChild(btn);
  }
  // Images: show a tidy placeholder instead of a broken-image icon
  for (const img of root.querySelectorAll('img')) {
    img.addEventListener('error', () => {
      const ph = document.createElement('span');
      ph.className = 'img-missing';
      ph.textContent = `Image not found: ${img.getAttribute('alt') || decodeURIComponent((img.getAttribute('src') || '').split('/').pop())}`;
      img.replaceWith(ph);
    }, { once: true });
  }
}

let mermaidLoading = null;
function loadMermaid() {
  mermaidLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'mermaid.js';
    s.onload = () => resolve(window.__mermaid);
    s.onerror = () => { mermaidLoading = null; reject(new Error('Diagram engine failed to load')); };
    document.head.appendChild(s);
  });
  return mermaidLoading;
}

async function renderMermaid(themeChanged) {
  const blocks = els.page.querySelectorAll(themeChanged ? '.mermaid-diagram' : 'pre.mermaid-src');
  if (!blocks.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch (err) { toast(err.message); return; }
  const dark = document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    theme: dark ? 'base' : 'default',
    themeVariables: dark ? {
      darkMode: true, background: '#171a21', primaryColor: '#1f2638', primaryTextColor: '#e6e9ef', primaryBorderColor: '#5b6fb5',
      secondaryColor: '#1b2a2a', tertiaryColor: '#232a36', lineColor: '#8892a6', textColor: '#dfe3ea',
      edgeLabelBackground: '#171a21', actorBkg: '#1f2638', actorBorder: '#5b6fb5', actorTextColor: '#e6e9ef',
      signalColor: '#b4bccb', signalTextColor: '#dfe3ea', noteBkgColor: '#3a3320', noteTextColor: '#f5e7b8',
    } : {},
  });
  let i = 0;
  for (const block of blocks) {
    const source = themeChanged ? block.dataset.source : block.textContent;
    const holder = document.createElement('div');
    holder.className = 'mermaid-diagram';
    holder.dataset.source = source;
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now()}-${i++}`, source);
      holder.innerHTML = svg;
    } catch (err) {
      holder.classList.add('mermaid-error');
      holder.textContent = `Diagram error: ${String(err?.message || err).split('\n')[0]}`;
    }
    block.replaceWith(holder);
  }
}

// ---------------------------------------------------------------- outline
function buildToc(toc) {
  els.toc.innerHTML = '';
  els.tocFilter.value = '';
  if (!toc.length) {
    els.toc.innerHTML = '<div class="toc-empty">No headings in this document.</div>';
    return;
  }
  const min = Math.min(...toc.map((h) => h.level));
  for (const h of toc) {
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.text;
    a.dataset.id = h.id;
    a.style.setProperty('--indent', h.level - min);
    a.className = 'toc-item lvl-' + h.level;
    a.onclick = (e) => { e.preventDefault(); scrollToId(h.id); };
    els.toc.appendChild(a);
  }
}

els.tocFilter.addEventListener('input', () => {
  const q = els.tocFilter.value.trim().toLowerCase();
  for (const a of els.toc.querySelectorAll('.toc-item')) a.hidden = q && !a.textContent.toLowerCase().includes(q);
});

function scrollToId(id) {
  const target = document.getElementById(decodeURIComponent(id.replace(/^#/, '')));
  if (!target) return;
  els.desk.scrollTo({ top: target.getBoundingClientRect().top - els.desk.getBoundingClientRect().top + els.desk.scrollTop - 16, behavior: 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1200);
}

let scrollRaf = 0;
function updateActiveHeading() {
  scrollRaf = 0;
  const heads = els.page.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]');
  const top = els.desk.getBoundingClientRect().top + 90;
  let active = null;
  for (const h of heads) { if (h.getBoundingClientRect().top <= top) active = h.id; else break; }
  if (!active && heads[0]) active = heads[0].id;
  for (const a of els.toc.querySelectorAll('.toc-item')) {
    const on = a.dataset.id === active;
    if (on && !a.classList.contains('active')) a.scrollIntoView({ block: 'nearest' });
    a.classList.toggle('active', on);
  }
  const max = els.desk.scrollHeight - els.desk.clientHeight;
  document.documentElement.style.setProperty('--progress', max > 0 ? els.desk.scrollTop / max : 0);
}
els.desk.addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(updateActiveHeading); }, { passive: true });

// ---------------------------------------------------------------- links
els.page.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href.startsWith('#')) { scrollToId(href.slice(1)); return; }
  api.openLink(href);
});

// ---------------------------------------------------------------- welcome / recent
function renderRecent(recent) {
  els.recentWrap.hidden = !recent.length;
  els.recentList.innerHTML = '';
  for (const p of recent.slice(0, 8)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const name = p.split(/[\\/]/).pop();
    b.innerHTML = '<span class="r-name"></span><span class="r-path"></span>';
    b.querySelector('.r-name').textContent = name;
    b.querySelector('.r-path').textContent = p.slice(0, p.length - name.length).replace(/[\\/]$/, '');
    b.title = p;
    b.onclick = () => api.openPath(p);
    li.appendChild(b);
    els.recentList.appendChild(li);
  }
}

// ---------------------------------------------------------------- find
function openFind() {
  els.findBar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
}
function closeFind() {
  els.findBar.hidden = true;
  els.findCount.textContent = '';
  api.stopFind();
}
let findTimer = 0;
els.findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => {
    const q = els.findInput.value;
    if (q) api.find(q, { findNext: false }); else { api.stopFind(); els.findCount.textContent = ''; }
  }, 120);
});
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && els.findInput.value) { e.preventDefault(); api.find(els.findInput.value, { forward: !e.shiftKey, findNext: true }); }
  if (e.key === 'Escape') closeFind();
});
$('find-next').onclick = () => els.findInput.value && api.find(els.findInput.value, { forward: true, findNext: true });
$('find-prev').onclick = () => els.findInput.value && api.find(els.findInput.value, { forward: false, findNext: true });
$('find-close').onclick = closeFind;
api.onFindResult(({ active, total }) => { els.findCount.textContent = total ? `${active} of ${total}` : 'No results'; });

// ---------------------------------------------------------------- toolbar
$('btn-open').onclick = () => api.openDialog();
$('welcome-open').onclick = () => api.openDialog();
$('welcome-showcase').onclick = () => api.openShowcase();
$('recent-clear').onclick = () => api.clearRecent();
$('btn-back').onclick = () => api.goBack();
$('btn-toc').onclick = () => api.setSettings({ showToc: !settings.showToc });
$('btn-find').onclick = openFind;
$('btn-larger').onclick = () => api.setSettings({ fontScale: settings.fontScale + 0.1 });
$('btn-smaller').onclick = () => api.setSettings({ fontScale: settings.fontScale - 0.1 });
$('btn-pdf').onclick = () => currentDoc ? api.exportPdf() : toast('Open a document first');
$('btn-print').onclick = () => currentDoc ? api.print() : toast('Open a document first');
$('btn-theme').onclick = (e) => { e.stopPropagation(); els.themeMenu.hidden = !els.themeMenu.hidden; };
document.addEventListener('click', (e) => { if (!els.themeMenu.hidden && !e.target.closest('.tb-menu-wrap')) els.themeMenu.hidden = true; });
for (const seg of document.querySelectorAll('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) api.setSettings({ [seg.dataset.key]: b.dataset.value });
  });
}
$('shortcuts-close').onclick = () => els.shortcuts.close();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!els.findBar.hidden) closeFind(); els.themeMenu.hidden = true; }
  if (e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')) api.goBack();
});
document.addEventListener('mouseup', (e) => { if (e.button === 3) api.goBack(); });

api.onCommand(({ cmd }) => {
  if (cmd === 'find') openFind();
  if (cmd === 'shortcuts') els.shortcuts.showModal();
});

// ---------------------------------------------------------------- drag & drop
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  const files = [...(e.dataTransfer?.files || [])];
  const md = files.map((f) => api.pathForFile(f)).find((p) => /\.(md|markdown|mdown|mkdn?|mdwn|mdx|txt)$/i.test(p));
  if (md) api.openPath(md); else toast('That isn’t a Markdown file (.md)');
});

// ---------------------------------------------------------------- misc
let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

api.onDocument((doc) => showDocument(doc));
api.onDocumentChanged((doc) => {
  if (currentDoc && doc.path === currentDoc.path) showDocument({ ...doc, canGoBack: undefined }, { keepScroll: true }).then(() => toast('Updated from disk'));
});
api.onError(({ message }) => toast(message));
api.onSettings(applySettings);

api.init().then(({ settings: s, platform }) => {
  document.documentElement.dataset.platform = platform;
  applySettings(s);
});
