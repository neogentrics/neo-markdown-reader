// Renderer: tabs, toolbar, outline, find, drag & drop, image viewer.
// All OS access goes through window.reader (see src/main/preload.js).
import { createRenderer } from './markdown.js';
import { createEditMode } from './editmode.js';
import { createSidebar } from './sidebar.js';
import { createPalette } from './palette.js';
import { createSplit } from './split.js';
import { createHighlights } from './highlights.js';
import { compareDocs } from './compare.js';
import { createPublish } from './publish-ui.js';
import { createPresenter } from './present.js';
import { createThemeUi } from './theme-ui.js';
import './styles/app.css';

const api = window.reader;
const DARK_THEMES = new Set(['dark', 'forest', 'dusk', 'contrast']);
const render = createRenderer(window);
const $ = (id) => document.getElementById(id);

const els = {
  pages: $('pages'), welcome: $('welcome'), desk: $('desk'), toc: $('toc'), tocFilter: $('toc-filter'),
  sideFoot: $('side-foot'), title: $('doc-title'), meta: $('doc-meta'), back: $('btn-back'),
  themeMenu: $('theme-menu'), findBar: $('find-bar'), findInput: $('find-input'), findCount: $('find-count'),
  drop: $('drop-overlay'), toast: $('toast'), recentWrap: $('recent-wrap'), recentList: $('recent-list'),
  shortcuts: $('shortcuts'), tabs: $('tabs'), lightbox: $('lightbox'), lightboxImg: $('lightbox-img'),
  lightboxStage: $('lightbox-stage'), lightboxCaption: $('lightbox-caption'), updateBar: $('update-bar'),
  updateText: $('update-text'), updateAction: $('update-action'),
};

let settings = {};
let platform = '';

// ================================================================ tab model
/** @type {{ id:number, doc:any, result:any, el:HTMLElement, scroll:number, history:{path:string, scroll:number}[], btn:HTMLElement }[]} */
const tabs = [];
let activeId = null;
const closedTabs = [];       // [{ path, scroll, index }] most recent last
let nextId = 1;
let editMode = null;         // these feature modules are created once the tab functions below exist
let sidebar = null;
let palette = null;
let split = null;
let highlights = null;
let publish = null;
let presenter = null;
let themeUi = null;

const activeTab = () => tabs.find((t) => t.id === activeId) || null;
const tabIndex = (id) => tabs.findIndex((t) => t.id === id);
const tabAt = (i) => (i == null ? activeTab() : tabs[i] || null);
const baseName = (p) => p.split(/[\\/]/).pop();
const samePath = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

function scrollRatio() {
  const max = els.desk.scrollHeight - els.desk.clientHeight;
  return max > 0 ? els.desk.scrollTop / max : 0;
}
function setScrollRatio(r) {
  els.desk.scrollTop = r * Math.max(0, els.desk.scrollHeight - els.desk.clientHeight);
}

// Restoring a reading position has to survive the page still growing (images, fonts and diagrams
// finish loading after the first layout). Keep the target and re-apply it whenever the page
// resizes, until the reader scrolls themselves or a few seconds pass.
let pendingRestore = null;                         // { id, ratio, until }
function restoreScroll(tab) {
  setScrollRatio(tab.scroll);
  pendingRestore = tab.scroll > 0 ? { id: tab.id, ratio: tab.scroll, until: Date.now() + 5000 } : null;
}
function reapplyRestore() {
  const p = pendingRestore;
  if (!p) return;
  if (p.id !== activeId || Date.now() > p.until) { pendingRestore = null; return; }
  setScrollRatio(p.ratio);
}
/** The tab's reading position: the pending target while a restore is in progress, else the live scroll. */
function currentScroll(tab) {
  if (pendingRestore && pendingRestore.id === tab.id && Date.now() <= pendingRestore.until) return pendingRestore.ratio;
  return tab.id === activeId ? scrollRatio() : tab.scroll;
}
new ResizeObserver(reapplyRestore).observe(els.pages);
for (const ev of ['wheel', 'mousedown', 'touchstart']) els.desk.addEventListener(ev, () => { pendingRestore = null; }, { passive: true });
document.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) pendingRestore = null;
});

/** Render `doc` into the tab's page. With preview=true (live preview while editing) the tab keeps its saved doc. */
function renderInto(tab, doc, { preview = false } = {}) {
  if (doc.compare) {
    // A Compare tab shows a diff of two documents instead of rendered Markdown.
    const { left, right } = doc.compare;
    const cmp = compareDocs(left.content, right.content, { leftName: left.name, rightName: right.name });
    tab.doc = doc;
    tab.result = { html: cmp.html, toc: [], title: doc.name, stats: { words: 0, minutes: 0 } };
    tab.el.classList.add('compare-page');
    tab.el.innerHTML = cmp.html;
    updateTabButton(tab);
    return Promise.resolve();
  }
  const result = render(doc.content, { baseUrl: doc.baseUrl });
  if (!preview) tab.doc = doc;
  tab.result = result;
  tab.el.innerHTML = result.html;
  enhance(tab.el);
  updateTabButton(tab);
  return renderMermaid(tab.el, false).then(() => highlights?.apply(tab));
}

/** Re-render a tab in place (e.g. after its highlights changed), keeping its scroll position. */
async function rerender(tab) {
  const isActive = tab.id === activeId;
  const top = isActive ? els.desk.scrollTop : null;
  await renderInto(tab, tab.editing ? { ...tab.doc, content: tab.editor.getText() } : tab.doc, { preview: !!tab.editing });
  if (isActive) { els.desk.scrollTop = top; showActiveDoc(); }
}

function makeTabButton(tab) {
  const btn = document.createElement('div');
  btn.className = 'tab';
  btn.setAttribute('role', 'tab');
  btn.draggable = true;
  btn.innerHTML = '<svg class="tab-icon" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><span class="tab-label"></span><button class="tab-close" tabindex="-1" aria-label="Close tab"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></button>';
  btn.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.tab-close')) activate(tab.id); });
  btn.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
  btn.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!tab.doc.path) { toast('Save this document first (Ctrl+S)'); return; }
    api.tabContextMenu({ index: tabIndex(tab.id), count: tabs.length, path: tab.doc.path });
  });
  wireTabDrag(btn, tab);
  return btn;
}

function updateTabButton(tab) {
  const label = tab.doc.name.replace(/\.(md|markdown|mdown|mkdn?|mdwn|mdx|txt)$/i, '');
  tab.btn.querySelector('.tab-label').textContent = label;
  tab.btn.title = `${tab.result?.title && tab.result.title !== label ? tab.result.title + '\n' : ''}${tab.doc.path || 'Not saved yet'}${tab.dirty ? '\nUnsaved changes' : ''}`;
  tab.btn.classList.toggle('dirty', !!tab.dirty);
  tab.btn.classList.toggle('untitled', !!tab.untitled);
  if (tab.id === activeId) editMode?.refresh();
}

/** Open a document in a new tab (or focus the existing tab for the same file). */
async function openInTab(doc, { activate: shouldActivate = true, index, scroll, duplicate = false } = {}) {
  if (!duplicate) {
    const existing = tabs.find((t) => samePath(t.doc.path, doc.path));
    if (existing) { if (shouldActivate) activate(existing.id); return existing; }
  }
  const tab = { id: nextId++, doc, result: null, el: document.createElement('article'), scroll: scroll ?? doc.position ?? 0, history: [], btn: null };
  tab.el.className = 'page markdown-body';
  tab.el.hidden = true;
  tab.btn = makeTabButton(tab);
  const at = index == null ? (activeTab() ? tabIndex(activeId) + 1 : tabs.length) : Math.max(0, Math.min(index, tabs.length));
  tabs.splice(at, 0, tab);
  els.pages.appendChild(tab.el);
  els.tabs.insertBefore(tab.btn, els.tabs.children[at] || null);
  await renderInto(tab, doc);
  if (shouldActivate || tabs.length === 1) {
    activate(tab.id);
    if (tab.scroll > 0.02 && scroll == null) toast('Resumed where you left off');
  }
  updateChrome();
  return tab;
}

function activate(id) {
  const next = tabs.find((t) => t.id === id);
  if (!next) return;
  const prev = activeTab();
  if (prev && prev !== next) { prev.scroll = currentScroll(prev); prev.el.hidden = true; prev.btn.classList.remove('active'); prev.btn.setAttribute('aria-selected', 'false'); }
  activeId = id;
  next.el.hidden = false;
  next.btn.classList.add('active');
  next.btn.setAttribute('aria-selected', 'true');
  next.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (!els.findBar.hidden) closeFind();
  split?.afterActivate(prev, next);
  showActiveDoc();
  editMode?.show(next);
  sidebar?.markActive();
  highlights?.renderPanel(next);
  // Restore synchronously (reading scrollHeight forces layout): animation frames are paused for
  // windows hidden behind others on macOS, and the position must not wait for the window to show.
  restoreScroll(next);
  updateActiveHeading();
  syncSoon();
}

/** Close a tab, asking first if it holds unsaved edits. Resolves to false if the user cancelled. */
async function closeTab(id) {
  let i = tabIndex(id);
  if (i < 0) return true;
  const tab = tabs[i];
  if (editMode.hasUnsaved(tab)) {
    if (tab.id !== activeId) activate(tab.id);
    const choice = await api.confirmUnsaved({ name: tab.doc.name });
    if (choice === 'cancel') return false;
    if (choice === 'save' && !(await editMode.save(tab))) return false;
  }
  if (tab.editing) await editMode.exit(tab, { force: true });
  i = tabIndex(id);
  if (i < 0) return true;
  tab.scroll = currentScroll(tab);
  if (tab.doc.path) closedTabs.push({ path: tab.doc.path, scroll: tab.scroll, index: i });
  if (closedTabs.length > 25) closedTabs.shift();
  tabs.splice(i, 1);
  split?.onClose(tab);
  tab.el.remove();
  tab.btn.remove();
  if (tab.id === activeId) {
    activeId = null;
    const neighbor = tabs[i] || tabs[i - 1];
    if (neighbor) activate(neighbor.id); else editMode.show(null);
  }
  updateChrome();
  syncSoon();
  return true;
}

async function reopenClosedTab() {
  const last = closedTabs.pop();
  if (!last) return;
  const res = await api.readDoc(last.path, { remember: false });
  if (res.error) { toast(res.error); return; }
  await openInTab(res.doc, { index: last.index, scroll: last.scroll });
}

function moveTab(id, toIndex) {
  const from = tabIndex(id);
  if (from < 0) return;
  const [tab] = tabs.splice(from, 1);
  const to = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, tabs.length));
  tabs.splice(to, 0, tab);
  for (const t of tabs) els.tabs.appendChild(t.btn);   // DOM order follows the model
  syncSoon();
}

async function detachTab(id, at = {}) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tabs.length < 2) return;
  if (tab.editing || !tab.doc.path) { toast('Finish editing (click Done) before moving this tab to another window'); return; }
  const scroll = currentScroll(tab);
  const ok = await api.detachTab({ path: tab.doc.path, scroll, screenX: at.x, screenY: at.y });
  if (ok && (await closeTab(id))) closedTabs.pop();
}

/** Show the chrome (title, outline, footer, back) for the active tab, or the welcome screen. */
function showActiveDoc() {
  const tab = activeTab();
  if (!tab) return updateChrome();
  const { doc, result } = tab;
  document.title = `${doc.name} — Neo Markdown Reader`;
  els.title.querySelector('.tb-title-name').textContent = result.title && result.title !== doc.name ? result.title : doc.name;
  els.title.title = doc.path || 'Not saved yet';
  els.meta.textContent = result.title && result.title !== doc.name ? doc.name : '';
  els.back.disabled = tab.history.length === 0 || !!tab.editing;
  buildToc(result.toc);
  els.sideFoot.innerHTML = doc.compare ? '' : `<span>${result.stats.words.toLocaleString()} words</span><span>${result.stats.minutes} min read</span>${doc.path ? '<button class="link-btn" id="reveal">Show in folder</button>' : ''}`;
  if (doc.path) $('reveal').onclick = () => api.reveal(doc.path);
  updateBookmarkButton();
  updateChrome();
}

function isBookmarked(p) { return !!p && (settings.bookmarks || []).some((b) => b.toLowerCase() === p.toLowerCase()); }
function updateBookmarkButton() {
  const tab = activeTab();
  const btn = $('btn-bookmark');
  btn.hidden = !tab?.doc.path;
  const on = isBookmarked(tab?.doc.path);
  btn.classList.toggle('on', on);
  btn.title = on ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this file (Ctrl+D)';
}
async function toggleBookmark() {
  const tab = activeTab();
  if (!tab?.doc.path) { toast('Save the document first to bookmark it'); return; }
  const was = isBookmarked(tab.doc.path);
  await api.toggleBookmark(tab.doc.path);
  toast(was ? 'Bookmark removed' : 'Bookmarked — find it under Files or with Ctrl+K');
}

function updateChrome() {
  const has = tabs.length > 0;
  document.body.classList.toggle('has-doc', has);
  els.welcome.hidden = has;
  editMode?.refresh();
  if (!has) {
    document.title = 'Neo Markdown Reader';
    els.title.querySelector('.tb-title-name').textContent = 'Neo Markdown Reader';
    els.title.title = '';
    els.meta.textContent = '';
    els.back.disabled = true;
    els.toc.innerHTML = '';
    els.sideFoot.innerHTML = '';
  }
}

let syncTimer = 0;
let syncDue = 0;
function sendSync() {
  const active = activeTab();
  if (active) active.scroll = currentScroll(active);
  const saved = tabs.filter((t) => t.doc.path);          // unsaved new documents aren't restored
  api.syncTabs({
    tabs: saved.map((t) => ({ path: t.doc.path, scroll: t.scroll })),
    active: Math.max(0, saved.indexOf(active)),
    title: active ? active.doc.name : '',
  });
}
// Report the final state (e.g. the reading position just scrolled to) the moment the window closes.
window.addEventListener('beforeunload', (e) => {
  clearTimeout(syncTimer);
  syncTimer = 0;
  sendSync();
  // Unsaved edits: refuse to unload; the main process then asks whether to close anyway.
  if (editMode && tabs.some((t) => editMode.hasUnsaved(t))) { e.preventDefault(); e.returnValue = ''; }
});
/** Report open tabs to the main process. A later, longer delay (scrolling) never postpones a sooner one. */
function syncSoon(delay = 120) {
  const due = Date.now() + delay;
  if (syncTimer && syncDue <= due) return;
  clearTimeout(syncTimer);
  syncDue = due;
  syncTimer = setTimeout(() => { syncTimer = 0; sendSync(); }, delay);
}

// ================================================================ navigation inside a tab
async function navigateTab(tab, doc) {
  tab.history.push({ path: tab.doc.path, scroll: currentScroll(tab) });
  if (tab.history.length > 50) tab.history.shift();
  await renderInto(tab, doc);
  tab.scroll = 0;
  if (tab.id === activeId) {
    pendingRestore = null;
    showActiveDoc();
    els.desk.scrollTop = 0;
    if (doc.hash) scrollToId(doc.hash);
    updateActiveHeading();
  }
  syncSoon();
}

async function goBack() {
  const tab = activeTab();
  const prev = tab?.history.pop();
  if (!prev) return;
  const res = await api.readDoc(prev.path, { remember: false });
  if (res.error) { toast(res.error); return; }
  await renderInto(tab, res.doc);
  tab.scroll = prev.scroll;
  showActiveDoc();
  restoreScroll(tab);
  updateActiveHeading();
  syncSoon();
}

async function reloadActive() {
  const tab = activeTab();
  if (!tab || !tab.doc.path) return;
  if (tab.editing) { toast('You’re editing this document — save it, or click Done first'); return; }
  const res = await api.readDoc(tab.doc.path, { remember: false });
  if (res.error) { toast(res.error); return; }
  await refreshTab(tab, res.doc);
}

async function refreshTab(tab, doc) {
  const isActive = tab.id === activeId;
  const ratio = currentScroll(tab);
  await renderInto(tab, { ...doc, position: 0 });
  if (isActive) {
    showActiveDoc();
    setScrollRatio(ratio);
    updateActiveHeading();
  }
}

// ================================================================ rendering helpers
function enhance(root) {
  for (const pre of root.querySelectorAll('pre.code-block')) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.onclick = async () => {
      await api.copyText(pre.querySelector('code')?.innerText ?? pre.innerText);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
    };
    pre.appendChild(btn);
  }
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

let mermaidSeq = 0;
async function renderMermaid(root, themeChanged) {
  const blocks = root.querySelectorAll(themeChanged ? '.mermaid-diagram' : 'pre.mermaid-src');
  if (!blocks.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch (err) { toast(err.message); return; }
  const dark = document.documentElement.dataset.tone === 'dark';
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
  for (const block of blocks) {
    const source = themeChanged ? block.dataset.source : block.textContent;
    const holder = document.createElement('div');
    holder.className = 'mermaid-diagram';
    holder.dataset.source = source;
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, source);
      holder.innerHTML = svg;
    } catch (err) {
      holder.classList.add('mermaid-error');
      holder.textContent = `Diagram error: ${String(err?.message || err).split('\n')[0]}`;
    }
    block.replaceWith(holder);
  }
}

// ================================================================ outline
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

/** The scrolling pane a tab is shown in (left desk, or the right pane in split view). */
const deskFor = (tab) => (split?.rightTab() === tab ? split.pane : els.desk);

function scrollToElement(target, { desk = els.desk, smooth = true } = {}) {
  desk.scrollTo({ top: target.getBoundingClientRect().top - desk.getBoundingClientRect().top + desk.scrollTop - 16, behavior: smooth ? 'smooth' : 'auto' });
}

function scrollToId(id, tab = activeTab()) {
  if (!tab) return;
  let key = id.replace(/^#/, '');
  try { key = decodeURIComponent(key); } catch { /* keep raw */ }
  const target = tab.el.querySelector(`[id="${CSS.escape(key)}"]`);
  if (!target) return;
  scrollToElement(target, { desk: deskFor(tab) });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1200);
}

/** Open a file and scroll to a source line (used by Find in Folder), highlighting the search text. */
async function openAtLine(path, line, query) {
  const tab = await openPath(path);
  if (!tab) return;
  if (tab.id !== activeId) activate(tab.id);
  let best = null;
  for (const el of tab.el.querySelectorAll('[data-line]')) { if (Number(el.dataset.line) <= line) best = el; else break; }
  pendingRestore = null;
  if (best) {
    scrollToElement(best, { smooth: false });
    best.classList.add('flash');
    setTimeout(() => best.classList.remove('flash'), 1400);
  } else els.desk.scrollTop = 0;
  if (query) api.find(query, { findNext: false });
}

let scrollRaf = 0;
function updateActiveHeading() {
  scrollRaf = 0;
  const tab = activeTab();
  if (!tab) return;
  const heads = tab.el.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]');
  const top = els.desk.getBoundingClientRect().top + 90;
  let active = null;
  for (const h of heads) { if (h.getBoundingClientRect().top <= top) active = h.id; else break; }
  if (!active && heads[0]) active = heads[0].id;
  for (const a of els.toc.querySelectorAll('.toc-item')) {
    const on = a.dataset.id === active;
    if (on && !a.classList.contains('active')) a.scrollIntoView({ block: 'nearest' });
    a.classList.toggle('active', on);
  }
  document.documentElement.style.setProperty('--progress', scrollRatio());
}
els.desk.addEventListener('scroll', () => {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(updateActiveHeading);
  syncSoon(600);             // remember reading position
}, { passive: true });

// ================================================================ links & images in documents
async function followLink(a, { newTab = false, tab = activeTab() } = {}) {
  const href = a.getAttribute('href');
  if (!tab || !href) return;
  if (href.startsWith('#')) { scrollToId(href.slice(1), tab); return; }
  const res = await api.resolveLink(href, tab.doc.path);
  if (res.kind === 'doc') {
    // While editing (or in the right-hand pane of a split), links open in a new tab.
    if (newTab || tab.editing || tab !== activeTab()) await openInTab(res.doc, { activate: true, duplicate: false, scroll: 0 });
    else await navigateTab(tab, res.doc);
  } else if (res.kind === 'error') {
    toast(res.message);
  }
}

const tabForElement = (el) => tabs.find((t) => t.el.contains(el)) || null;

function onPageClick(e) {
  const tab = tabForElement(e.target);
  if (!tab) return;
  if (highlights?.onPageClick(e, tab)) return;
  const a = e.target.closest('a[href]');
  if (a) { e.preventDefault(); followLink(a, { newTab: e.ctrlKey || e.metaKey, tab }); return; }
  const img = e.target.closest('img');
  if (img && !e.target.closest('.mermaid-diagram')) openLightbox(img);
}
function onPageAuxClick(e) {
  const a = e.target.closest('a[href]');
  if (a && e.button === 1) { e.preventDefault(); followLink(a, { newTab: true, tab: tabForElement(a) }); }
}
for (const container of [els.pages, $('pages2')]) {
  container.addEventListener('click', onPageClick);
  container.addEventListener('auxclick', onPageAuxClick);
}

function openLightbox(img) {
  els.lightboxImg.src = img.currentSrc || img.src;
  els.lightboxImg.alt = img.alt || '';
  els.lightboxCaption.textContent = img.alt || decodeURIComponent((img.getAttribute('src') || '').split('/').pop());
  els.lightbox.classList.remove('zoomed');
  els.lightbox.hidden = false;
}
function closeLightbox() { els.lightbox.hidden = true; els.lightboxImg.removeAttribute('src'); }
els.lightboxImg.addEventListener('click', (e) => {
  e.stopPropagation();
  const zoomed = els.lightbox.classList.toggle('zoomed');
  if (zoomed) {
    const r = els.lightboxImg.getBoundingClientRect();
    requestAnimationFrame(() => {
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      els.lightboxStage.scrollLeft = fx * els.lightboxStage.scrollWidth - els.lightboxStage.clientWidth / 2;
      els.lightboxStage.scrollTop = fy * els.lightboxStage.scrollHeight - els.lightboxStage.clientHeight / 2;
    });
  }
});
els.lightbox.addEventListener('click', closeLightbox);

// ================================================================ copy as formatted text
const RICH_STYLES = {
  TABLE: 'border-collapse:collapse;', TH: 'border:1px solid #cfd6e2;padding:6px 10px;background:#f3f6fb;text-align:left;',
  TD: 'border:1px solid #cfd6e2;padding:6px 10px;vertical-align:top;', PRE: 'background:#f5f7fb;border:1px solid #e3e8f0;padding:10px 12px;font-family:Consolas,monospace;font-size:10pt;white-space:pre-wrap;',
  CODE: 'font-family:Consolas,monospace;', BLOCKQUOTE: 'border-left:4px solid #b8c4e8;margin:0;padding:4px 12px;color:#4b5466;',
};
async function copyRich() {
  const tab = activeTab();
  if (!tab) return;
  const sel = window.getSelection();
  const holder = document.createElement('div');
  let text;
  if (sel && !sel.isCollapsed && tab.el.contains(sel.anchorNode)) {
    for (let i = 0; i < sel.rangeCount; i++) holder.appendChild(sel.getRangeAt(i).cloneContents());
    text = sel.toString();
  } else {
    holder.innerHTML = tab.el.innerHTML;
    text = tab.el.innerText;
  }
  holder.querySelectorAll('.copy-btn, .footnote-backref').forEach((n) => n.remove());
  holder.querySelectorAll('*').forEach((n) => {
    if (RICH_STYLES[n.nodeName]) n.setAttribute('style', (n.getAttribute('style') || '') + RICH_STYLES[n.nodeName]);
    n.removeAttribute('class');
  });
  const html = `<div style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1d2330">${holder.innerHTML}</div>`;
  await api.copyRich({ html, text });
  toast(sel && !sel.isCollapsed ? 'Copied selection as formatted text' : 'Copied the whole document as formatted text');
}

// ================================================================ tab drag: reorder, or drag out to a new window
let dragTabId = null;
let dropHandled = false;
function wireTabDrag(btn, tab) {
  btn.addEventListener('dragstart', (e) => {
    dragTabId = tab.id;
    dropHandled = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-nmr-tab', String(tab.id));
    btn.classList.add('dragging');
  });
  btn.addEventListener('dragend', (e) => {
    btn.classList.remove('dragging');
    clearDropMarker();
    const outside = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth
      || e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (!dropHandled && outside && tabs.length > 1) detachTab(tab.id, { x: e.screenX, y: e.screenY });
    dragTabId = null;
  });
}
function dropIndexFor(clientX) {
  const btns = [...els.tabs.children];
  for (let i = 0; i < btns.length; i++) {
    const r = btns[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return btns.length;
}
function clearDropMarker() { els.tabs.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after')); }
els.tabs.addEventListener('dragover', (e) => {
  if (dragTabId == null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarker();
  const i = dropIndexFor(e.clientX);
  const btns = els.tabs.children;
  if (btns[i]) btns[i].classList.add('drop-before'); else btns[btns.length - 1]?.classList.add('drop-after');
});
els.tabs.addEventListener('drop', (e) => {
  if (dragTabId == null) return;
  e.preventDefault();
  dropHandled = true;
  moveTab(dragTabId, dropIndexFor(e.clientX));
  clearDropMarker();
});
// A tab dropped anywhere else inside the window just stays put.
document.addEventListener('drop', () => { if (dragTabId != null) dropHandled = true; });

// Mouse wheel scrolls the tab strip sideways when there are more tabs than fit.
els.tabs.addEventListener('wheel', (e) => {
  if (els.tabs.scrollWidth <= els.tabs.clientWidth) return;
  e.preventDefault();
  els.tabs.scrollLeft += e.deltaY || e.deltaX;
}, { passive: false });

// ================================================================ welcome / recent
function renderRecent(recent) {
  els.recentWrap.hidden = !recent.length;
  els.recentList.innerHTML = '';
  for (const p of recent.slice(0, 8)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const name = baseName(p);
    b.innerHTML = '<span class="r-name"></span><span class="r-path"></span>';
    b.querySelector('.r-name').textContent = name;
    b.querySelector('.r-path').textContent = p.slice(0, p.length - name.length).replace(/[\\/]$/, '');
    b.title = p;
    b.onclick = () => openPath(p);
    li.appendChild(b);
    els.recentList.appendChild(li);
  }
}

async function openPath(p, opts = {}) {
  const res = await api.readDoc(p, { remember: true });
  if (res.error) { toast(res.error); return null; }
  return openInTab(res.doc, opts);
}

// ================================================================ find
function openFind() {
  if (!activeTab()) return;
  els.findBar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
}
function closeFind() {
  els.findBar.hidden = true;
  els.findCount.textContent = '';
  api.stopFind();
}
function findAgain(forward) {
  if (els.findBar.hidden || !els.findInput.value) { openFind(); return; }
  api.find(els.findInput.value, { forward, findNext: true });
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
$('find-next').onclick = () => findAgain(true);
$('find-prev').onclick = () => findAgain(false);
$('find-close').onclick = closeFind;
api.onFindResult(({ active, total }) => { els.findCount.textContent = total ? `${active} of ${total}` : 'No results'; });

// ================================================================ toolbar
$('btn-open').onclick = () => api.openDialog();
$('tab-add').onclick = () => api.openDialog();
$('welcome-open').onclick = () => api.openDialog();
$('welcome-showcase').onclick = async () => { const res = await api.showcase(); if (res?.doc) openInTab(res.doc, { scroll: 0 }); };
$('welcome-new').onclick = () => editMode.newDocument('blank');
$('recent-clear').onclick = () => api.clearRecent();
$('btn-back').onclick = () => goBack();
$('btn-toc').onclick = () => api.setSettings({ showToc: !settings.showToc });
$('btn-find').onclick = openFind;
$('btn-larger').onclick = () => api.setSettings({ fontScale: settings.fontScale + 0.1 });
$('btn-smaller').onclick = () => api.setSettings({ fontScale: settings.fontScale - 0.1 });
$('btn-pdf').onclick = () => publish.openDesigner();
$('btn-present').onclick = () => presenter.start();
$('btn-customize').onclick = () => { els.themeMenu.hidden = true; themeUi.open(); };
$('btn-print').onclick = () => (activeTab() ? api.print() : toast('Open a document first'));
$('btn-theme').onclick = (e) => { e.stopPropagation(); els.themeMenu.hidden = !els.themeMenu.hidden; };
document.addEventListener('click', (e) => { if (!els.themeMenu.hidden && !e.target.closest('.tb-menu-wrap')) els.themeMenu.hidden = true; });
for (const seg of document.querySelectorAll('.seg[data-key]')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) api.setSettings({ [seg.dataset.key]: b.dataset.value });
  });
}
$('shortcuts-close').onclick = () => els.shortcuts.close();
$('update-dismiss').onclick = () => { els.updateBar.hidden = true; };

// Keys the menu doesn't own. (Menu shortcuts such as Alt+Left are handled only by the menu,
// so one key press never triggers an action twice.)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.lightbox.hidden) closeLightbox();
    else if (!els.findBar.hidden) closeFind();
    els.themeMenu.hidden = true;
  }
  if (e.key === 'BrowserBack') goBack();
});
document.addEventListener('mouseup', (e) => { if (e.button === 3) goBack(); });

// ================================================================ menu commands
api.onCommand(({ cmd, arg }) => {
  const target = Number.isInteger(arg) && arg >= 0 ? tabs[arg] : activeTab();
  switch (cmd) {
    case 'find': openFind(); break;
    case 'find-next': findAgain(true); break;
    case 'find-prev': findAgain(false); break;
    case 'shortcuts': if (!els.shortcuts.open) els.shortcuts.showModal(); break;
    case 'back': goBack(); break;
    case 'reload': reloadActive(); break;
    case 'reveal': if (activeTab()?.doc.path) api.reveal(activeTab().doc.path); else if (activeTab()) toast('Not saved yet'); break;
    case 'copy-path': if (activeTab()?.doc.path) { api.copyText(activeTab().doc.path); toast('Path copied'); } else if (activeTab()) toast('Not saved yet'); break;
    case 'copy-rich': copyRich(); break;
    case 'next-tab':
    case 'prev-tab': {
      if (tabs.length < 2) break;
      const i = tabIndex(activeId);
      activate(tabs[(i + (cmd === 'next-tab' ? 1 : -1) + tabs.length) % tabs.length].id);
      break;
    }
    case 'select-tab': { const t = arg === -1 ? tabs[tabs.length - 1] : tabs[arg]; if (t) activate(t.id); break; }
    case 'close-tab': if (target) closeTab(target.id); else api.closeWindow(); break;
    case 'reopen-closed-tab': reopenClosedTab(); break;
    case 'duplicate-tab': if (target?.doc.path) openInTab(target.doc, { duplicate: true, index: tabIndex(target.id) + 1, scroll: currentScroll(target) }); break;
    case 'move-tab-to-window': if (target) detachTab(target.id); break;
    case 'close-other-tabs': if (target) closeTabsInOrder([...tabs].filter((t) => t.id !== target.id)); break;
    case 'close-tabs-right': if (target) closeTabsInOrder(tabs.slice(tabIndex(target.id) + 1)); break;
    // editing
    case 'new-doc': editMode.newDocument('blank'); break;
    case 'new-template': editMode.newDocument(arg); break;
    case 'toggle-edit': if (activeTab()) editMode.toggle(); else editMode.newDocument('blank'); break;
    case 'save': editMode.save(); break;
    case 'save-as': editMode.saveAs(); break;
    case 'grants': editMode.showGrants(); break;
    // organizing (v1.3)
    case 'quick-open': palette.open(); break;
    case 'find-in-folder': sidebar.findInFolder(); break;
    case 'close-folder': api.closeFolder(); sidebar.setFolder(null); break;
    case 'panel-outline': case 'panel-files': case 'panel-highlights':
      showSidebar(); sidebar.show(cmd.slice(6)); break;
    case 'split-toggle': split.toggle(); break;
    case 'split-link': if (!split.isOpen()) split.toggle(); split.toggleLink(); break;
    case 'open-side': if (target && target.id !== activeId) split.open(target); else if (tabs.length > 1) split.toggle(); break;
    case 'compare-tabs': compareTabWith(target); break;
    case 'compare-file': compareWithFile(); break;
    case 'compare-saved': compareWithSaved(); break;
    case 'highlight': highlights.create(); break;
    case 'bookmark': toggleBookmark(); break;
    case 'export-pdf': publish.openDesigner(); break;
    case 'export-docx': publish.exportAs('docx'); break;
    case 'export-html': publish.exportAs('html'); break;
    case 'export-txt': publish.exportAs('txt'); break;
    case 'present': if (presenter.active()) presenter.stop(); else presenter.start(); break;
    case 'customize-theme': themeUi.open(); break;
    default: break;
  }
});

function showSidebar() { if (!settings.showToc) api.setSettings({ showToc: true }); }

// ================================================================ compare
async function openCompare(left, right) {
  const doc = {
    path: null, name: `${left.name} ↔ ${right.name}`, dir: '', baseUrl: '', content: '', mtime: NaN,
    compare: { left: { name: left.name, content: left.content }, right: { name: right.name, content: right.content } },
  };
  await openInTab(doc, { duplicate: true, scroll: 0 });
}
const docText = (t) => (t.editing ? t.editor.getText() : t.doc.content);

async function compareTabWith(base = activeTab()) {
  if (!base || base.doc.compare) return;
  const others = tabs.filter((t) => t !== base && !t.doc.compare);
  if (!others.length) { toast('Open another document to compare with'); return; }
  const other = others.length === 1 ? others[0]
    : (await palette.pick(others.map((t) => ({ label: t.doc.name, detail: t.doc.path || 'Not saved', tab: t })), { placeholder: `Compare “${base.doc.name}” with…` }))?.tab;
  if (other) await openCompare({ name: base.doc.name, content: docText(base) }, { name: other.doc.name, content: docText(other) });
}

async function compareWithFile() {
  const base = activeTab();
  if (!base || base.doc.compare) { toast('Open a document first'); return; }
  const res = await api.pickDoc();
  if (!res) return;
  if (res.error) { toast(res.error); return; }
  await openCompare({ name: res.doc.name, content: res.doc.content }, { name: base.doc.name, content: docText(base) });
}

async function compareWithSaved() {
  const tab = activeTab();
  if (!tab?.editing) { toast('Compare with Saved Version shows your unsaved edits — click Edit and make a change first'); return; }
  await openCompare({ name: `${tab.doc.name} (saved)`, content: tab.savedText ?? tab.doc.content }, { name: `${tab.doc.name} (your edits)`, content: tab.editor.getText() });
}

/** Close tabs one at a time, so unsaved-changes questions come one after another; stop on Cancel. */
async function closeTabsInOrder(list) {
  for (const t of list) if (!(await closeTab(t.id))) return;
}

// ================================================================ drag & drop files
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter((p) => /\.(md|markdown|mdown|mkdn?|mdwn|mdx|txt)$/i.test(p));
  if (!paths.length) { toast('That isn’t a Markdown file (.md)'); return; }
  for (const p of paths) await openPath(p);
});

// ================================================================ settings, updates, misc
function applySettings(s) {
  settings = s;
  const root = document.documentElement;
  const prevTheme = root.dataset.theme;
  const prevTone = root.dataset.tone;
  root.dataset.theme = s.resolvedTheme || 'light';
  root.dataset.tone = DARK_THEMES.has(root.dataset.theme) ? 'dark' : 'light';
  root.dataset.font = s.font;
  root.dataset.width = s.pageWidth;
  root.style.setProperty('--font-scale', s.fontScale);
  document.body.classList.toggle('toc-hidden', !s.showToc);
  for (const seg of document.querySelectorAll('.seg[data-key]')) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', s[seg.dataset.key] === b.dataset.value);
  }
  renderRecent(s.recent || []);
  sidebar?.setBookmarks(s.bookmarks || []);
  if (activeTab()) updateBookmarkButton();
  if (prevTheme && prevTheme !== root.dataset.theme && (prevTone !== root.dataset.tone)) for (const t of tabs) renderMermaid(t.el, true);
  themeUi?.apply(s.brand || {});
}

function showUpdate(status) {
  if (!status) return;
  if (status.state === 'ready') {
    els.updateText.textContent = `Version ${status.version} is ready to install.`;
    els.updateAction.textContent = 'Restart to update';
    els.updateAction.onclick = () => api.installUpdate();
    els.updateBar.hidden = false;
  } else if (status.state === 'available') {
    els.updateText.textContent = `Version ${status.version} is available.`;
    els.updateAction.textContent = 'Download';
    els.updateAction.onclick = () => api.openUpdatePage();
    els.updateBar.hidden = false;
  }
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

api.onOpenTab((doc) => openInTab(doc));
api.onFocusPath((p) => {
  const t = tabs.find((x) => samePath(x.doc.path, p));
  if (t) activate(t.id);
  else openPath(p);          // the tab was closed a moment ago and the main process hadn't heard yet
});
api.onDocumentChanged(async (doc) => {
  const affected = tabs.filter((t) => samePath(t.doc.path, doc.path));
  for (const t of affected) {
    if (editMode.onDiskChange(t, doc)) continue;        // editing: keep the user's text, offer to load
    await refreshTab(t, doc);
  }
  if (affected.some((t) => t.id === activeId && !t.editing)) toast('Updated from disk');
});

editMode = createEditMode({
  api,
  activeTab,
  openInTab,
  renderInto,
  updateTabButton,
  showActiveDoc,
  toast,
  syncSoon,
  platform: () => platform,
  desk: els.desk,
  beforeEdit: () => split?.close(),
});
sidebar = createSidebar({
  api,
  activeTab,
  openPath,
  openAtLine,
  showSidebar,
  renderHighlights: () => highlights.renderPanel(activeTab()),
});
palette = createPalette({
  tabs: () => tabs,
  activeTab,
  bookmarks: () => settings.bookmarks || [],
  recent: () => settings.recent || [],
  folderFiles: () => sidebar.allFiles(),
  openPath,
  goToHeading: (id) => scrollToId(id),
});
split = createSplit({
  tabs: () => tabs,
  activeTab,
  activeId: () => activeId,
  activate,
  pages: els.pages,
  desk: els.desk,
  toast,
});
highlights = createHighlights({
  api,
  activeTab,
  toast,
  rerender,
  desk: els.desk,
  scrollToElement: (el) => scrollToElement(el, { desk: deskFor(tabForElement(el)) }),
});
themeUi = createThemeUi({ api, settings: () => settings, toast });
publish = createPublish({ api, activeTab, settings: () => settings, toast, themeCss: () => themeUi.exportCss() });
presenter = createPresenter({ api, activeTab, toast });
$('btn-bookmark').onclick = () => toggleBookmark();
$('btn-quick').onclick = () => palette.open();
$('btn-split').onclick = () => split.toggle();
api.onError(({ message }) => toast(message));
api.onSettings(applySettings);
api.onUpdate(showUpdate);

api.init().then(async ({ settings: s, platform: p, startup, update }) => {
  platform = p;
  document.documentElement.dataset.platform = platform;
  applySettings(s);
  showUpdate(update);
  if (startup.folder) sidebar.setFolder(startup.folder);
  const failed = [];
  for (const t of startup.tabs) {
    const res = await api.readDoc(t.path, { remember: false });
    if (res.error) { failed.push(t.path); continue; }
    await openInTab(res.doc, { activate: false, scroll: t.scroll, index: tabs.length });
  }
  const want = tabs[Math.min(startup.active, tabs.length - 1)] || tabs[0];
  if (want) {
    activate(want.id);
    if (want.scroll > 0.02) toast('Resumed where you left off');
  }
  if (failed.length) toast(`Couldn’t reopen ${failed.length === 1 ? baseName(failed[0]) : failed.length + ' files'} (moved or deleted)`);
  syncSoon();
});
