// Private highlights & notes on the rendered page. Stored by the app (main process), never in the file.
// A highlight is remembered as the quoted text plus a little context before/after it, so it can be found
// again after the document is re-rendered or edited around it.

const SKIP = 'button, .copy-btn, script, style, .mermaid-diagram, .katex-mathml';

/** Concatenate the page's visible text and remember which text node covers which characters. */
export function textIndex(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  const nodes = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: text.length, end: text.length + n.data.length });
    text += n.data;
  }
  return { text, nodes };
}

/** Convert a DOM selection range to character offsets in textIndex(root).text. */
export function rangeToOffsets(root, range, index = textIndex(root)) {
  const point = (container, offset, isEnd) => {
    if (container.nodeType === 3) {
      const e = index.nodes.find((x) => x.node === container);
      return e ? e.start + offset : null;
    }
    // Element container: find the first text node at/after the child position.
    const child = container.childNodes[offset] || null;
    for (const e of index.nodes) {
      if (child ? (child === e.node || child.contains?.(e.node) || (child.compareDocumentPosition(e.node) & 4)) : container.contains(e.node) && !isEnd) return e.start;
    }
    return isEnd ? index.text.length : null;
  };
  const start = point(range.startContainer, range.startOffset, false);
  const end = point(range.endContainer, range.endOffset, true);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

const similarity = (a, b) => {
  // How many characters match, comparing from the side nearest the quote.
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const similarityFwd = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

/** Find a quote in the text, using the remembered context to pick the right occurrence. */
export function findQuote(text, { quote, prefix = '', suffix = '' }) {
  if (!quote) return null;
  let best = null;
  let bestScore = -1;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    const score = similarity(text.slice(Math.max(0, i - prefix.length), i), prefix)
      + similarityFwd(text.slice(i + quote.length, i + quote.length + suffix.length), suffix);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best == null ? null : { start: best, end: best + quote.length };
}

/** Wrap characters [start, end) in <mark> elements (one per text node they span). */
export function wrapOffsets(root, start, end, attrs, index = textIndex(root)) {
  const doc = root.ownerDocument;
  const marks = [];
  for (const e of index.nodes) {
    if (e.end <= start || e.start >= end) continue;
    const from = Math.max(start, e.start) - e.start;
    const to = Math.min(end, e.end) - e.start;
    if (to <= from) continue;
    let node = e.node;
    if (to < node.data.length) node.splitText(to);
    if (from > 0) node = node.splitText(from);
    const mark = doc.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v);
    node.parentNode.insertBefore(mark, node);
    mark.appendChild(node);
    marks.push(mark);
  }
  return marks;
}

/** Context captured around a new highlight. */
export function describeSelection(text, start, end, context = 32) {
  return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - context), start), suffix: text.slice(end, end + context) };
}

// ======================================================================== UI controller
export function createHighlights(ctx) {
  const { api } = ctx;
  const $ = (id) => document.getElementById(id);
  const cache = new Map();            // path (lowercase) -> list
  const pop = $('hl-pop');
  const selBar = $('sel-bar');
  let editing = null;                  // { tab, id }
  const key = (p) => p.toLowerCase();

  async function list(path) {
    if (!path) return [];
    if (!cache.has(key(path))) cache.set(key(path), await api.getAnnotations(path));
    return cache.get(key(path));
  }
  async function save(path, items) {
    cache.set(key(path), items);
    cache.set(key(path), await api.setAnnotations(path, items));
  }

  /** Paint this tab's highlights onto its page. Returns ids that couldn't be found. */
  async function apply(tab) {
    if (!tab?.doc?.path || tab.doc.compare) return [];
    const items = await list(tab.doc.path);
    const index = textIndex(tab.el);
    const located = [];
    for (const a of items) {
      const at = findQuote(index.text, a);
      if (at) located.push({ a, at });
    }
    // Wrap from the end so earlier offsets stay valid.
    located.sort((x, y) => y.at.start - x.at.start);
    for (const { a, at } of located) {
      wrapOffsets(tab.el, at.start, at.end, { class: `nmr-hl hl-${a.color}${a.note ? ' has-note' : ''}`, 'data-hl': a.id, title: a.note || '' });
    }
    tab.orphans = items.filter((a) => !located.some((l) => l.a === a)).map((a) => a.id);
    if (tab === ctx.activeTab()) renderPanel(tab);
    return tab.orphans;
  }

  // ---------------------------------------------------------------- creating
  function currentSelection(tab) {
    const sel = window.getSelection();
    if (!tab || !sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!tab.el.contains(range.commonAncestorContainer)) return null;
    const index = textIndex(tab.el);
    const off = rangeToOffsets(tab.el, range, index);
    if (!off) return null;
    const d = describeSelection(index.text, off.start, off.end);
    return d.quote.trim() ? { ...d, rect: range.getBoundingClientRect() } : null;
  }

  async function create(tab = ctx.activeTab(), { withNote = false } = {}) {
    if (!tab) return;
    if (!tab.doc.path) { ctx.toast('Save the document first to highlight it'); return; }
    if (tab.doc.compare) return;
    if (tab.doc.locked) { ctx.toast('Highlights aren’t available in locked documents — they would be stored without the lock'); return; }
    const s = currentSelection(tab);
    if (!s) { ctx.toast('Select some text on the page first'); return; }
    const items = [...(await list(tab.doc.path))];
    const a = { id: Math.random().toString(36).slice(2, 12), quote: s.quote, prefix: s.prefix, suffix: s.suffix, color: 'yellow', note: '', created: Date.now() };
    items.push(a);
    await save(tab.doc.path, items);
    window.getSelection().removeAllRanges();
    hideSelBar();
    await ctx.rerender(tab);
    if (withNote) openPopover(tab, a.id);
  }

  // ---------------------------------------------------------------- selection toolbar
  function showSelBar() {
    const tab = ctx.activeTab();
    const s = tab && !tab.editing && !tab.doc.locked && currentSelection(tab);
    if (!s) { hideSelBar(); return; }
    selBar.hidden = false;
    const w = selBar.offsetWidth || 180;
    selBar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, s.rect.left + s.rect.width / 2 - w / 2))}px`;
    selBar.style.top = `${Math.max(56, s.rect.top - 44)}px`;
  }
  function hideSelBar() { selBar.hidden = true; }
  document.addEventListener('mouseup', (e) => { if (!e.target.closest('#sel-bar, #hl-pop')) setTimeout(showSelBar, 0); });
  document.addEventListener('keyup', (e) => { if (e.shiftKey) showSelBar(); });
  ctx.desk.addEventListener('scroll', hideSelBar, { passive: true });
  $('sel-highlight').onclick = () => create();
  $('sel-note').onclick = () => create(undefined, { withNote: true });

  // ---------------------------------------------------------------- note / colour popover
  function openPopover(tab, id) {
    const mark = tab.el.querySelector(`mark[data-hl="${id}"]`);
    const a = (cache.get(key(tab.doc.path)) || []).find((x) => x.id === id);
    if (!mark || !a) return;
    editing = { tab, id };
    $('hl-note').value = a.note || '';
    for (const b of pop.querySelectorAll('[data-color]')) b.classList.toggle('active', b.dataset.color === a.color);
    pop.hidden = false;
    const r = mark.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, r.left))}px`;
    pop.style.top = `${Math.min(window.innerHeight - 200, r.bottom + 8)}px`;
    $('hl-note').focus();
  }
  async function update(patch) {
    if (!editing) return;
    const { tab, id } = editing;
    const items = (await list(tab.doc.path)).map((a) => (a.id === id ? { ...a, ...patch } : a));
    await save(tab.doc.path, items);
    await ctx.rerender(tab);
  }
  function closePopover() { pop.hidden = true; editing = null; }
  pop.addEventListener('click', (e) => { const c = e.target.closest('[data-color]'); if (c) update({ color: c.dataset.color }).then(() => openPopover(editing?.tab || ctx.activeTab(), editing?.id)); });
  $('hl-note-save').onclick = async () => { await update({ note: $('hl-note').value.trim() }); closePopover(); };
  $('hl-delete').onclick = async () => {
    if (!editing) return;
    const { tab, id } = editing;
    await save(tab.doc.path, (await list(tab.doc.path)).filter((a) => a.id !== id));
    closePopover();
    await ctx.rerender(tab);
  };
  document.addEventListener('mousedown', (e) => { if (!pop.hidden && !e.target.closest('#hl-pop, mark.nmr-hl')) closePopover(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePopover(); hideSelBar(); } });

  /** Handle a click on a highlight in the page. Returns true if it was one. */
  function onPageClick(e, tab) {
    const mark = e.target.closest('mark.nmr-hl');
    if (!mark || e.target.closest('a[href]')) return false;
    openPopover(tab, mark.dataset.hl);
    return true;
  }

  // ---------------------------------------------------------------- sidebar panel
  async function renderPanel(tab = ctx.activeTab()) {
    const box = $('hl-list');
    box.replaceChildren();
    if (!tab?.doc?.path || tab.doc.compare) { box.innerHTML = '<div class="side-empty">Highlights are saved per file. Open a saved document to see them.</div>'; return; }
    const items = await list(tab.doc.path);
    if (!items.length) {
      box.innerHTML = '<div class="side-empty">No highlights yet.<br>Select text on the page and choose <b>Highlight</b> or <b>Add note</b>. Highlights are private: they’re stored by the app, never written into the file.</div>';
      return;
    }
    for (const a of items) {
      const orphan = (tab.orphans || []).includes(a.id);
      const item = document.createElement('button');
      item.className = `hl-item hl-${a.color}${orphan ? ' orphan' : ''}`;
      item.innerHTML = '<span class="hl-quote"></span><span class="hl-note-text"></span>';
      item.querySelector('.hl-quote').textContent = a.quote.length > 160 ? a.quote.slice(0, 160) + '…' : a.quote;
      item.querySelector('.hl-note-text').textContent = orphan ? 'This text is no longer in the document.' : a.note;
      item.onclick = () => {
        const mark = tab.el.querySelector(`mark[data-hl="${a.id}"]`);
        if (!mark) return;
        ctx.scrollToElement(mark);
        mark.classList.add('flash');
        setTimeout(() => mark.classList.remove('flash'), 1200);
      };
      box.appendChild(item);
    }
  }

  return { apply, create, renderPanel, onPageClick, hideSelBar, count: async (tab) => (tab?.doc?.path ? (await list(tab.doc.path)).length : 0) };
}
