// Presentation mode: the document as full-screen slides. A line with `---` starts a new slide;
// documents without any are split at their top-level headings instead.

/** The text nodes of a slide's block that read aloud can reach, in order. */
function textNodes(top) {
  const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('.fold-btn') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
}

/** The same stretch of text as `range` (inside `from`), in the copy of it on a slide. */
export function copyRange(range, from, to) {
  const offset = (node, at) => {
    let n = 0;
    for (const t of textNodes(from)) {
      if (t === node) return n + at;
      n += t.length;
    }
    return -1;
  };
  const place = (n) => {
    for (const t of textNodes(to)) {
      if (n <= t.length) return [t, n];
      n -= t.length;
    }
    return null;
  };
  const a = offset(range.startContainer, range.startOffset);
  const b = offset(range.endContainer, range.endOffset);
  const start = a < 0 ? null : place(a);
  const end = b < 0 ? null : place(b);
  if (!start || !end) return null;
  const r = document.createRange();
  r.setStart(...start);
  r.setEnd(...end);
  return r;
}

/** Split a rendered page into slides: arrays of (cloned) top-level nodes. */
export function splitSlides(root) {
  sourceOf = new WeakMap();
  const nodes = [...root.children].filter((n) => !n.matches('.copy-btn, .run-output'));
  const rules = nodes.filter((n) => n.tagName === 'HR' && !n.classList.contains('footnotes-sep'));
  const slides = [];
  let cur = [];
  const push = () => { if (cur.some((n) => (n.textContent || '').trim() || n.querySelector?.('img, svg, video, table'))) slides.push(cur); cur = []; };
  if (rules.length) {
    for (const n of nodes) {
      if (rules.includes(n)) { push(); continue; }
      if (n.classList.contains('doc-meta')) { push(); cur.push(n); push(); continue; }
      cur.push(n);
    }
  } else {
    const levels = nodes.filter((n) => /^H[1-6]$/.test(n.tagName)).map((n) => Number(n.tagName[1]));
    const top = levels.length ? Math.min(...levels) : 0;
    const splitAt = (n) => {
      const m = /^H([1-6])$/.exec(n.tagName);
      return m && Number(m[1]) <= Math.min(top + 1, 2);
    };
    for (const n of nodes) {
      if (n.classList.contains('doc-meta')) { push(); cur.push(n); push(); continue; }
      if (splitAt(n) && cur.length) push();
      cur.push(n);
    }
  }
  push();
  // Folded sections and reading aids don't belong on slides.
  return slides.map((list) => list.map((n) => {
    const c = n.cloneNode(true);
    c.querySelectorAll?.('.fold-btn').forEach((b) => b.remove());
    c.classList?.remove('fold-hidden', 'folded', 'in-focus');
    sourceOf.set(c, n);
    return c;
  }));
}

/** Which block of the document each slide block was copied from. */
let sourceOf = new WeakMap();

const BASE_FONT = 30;
const MIN_FONT = 13;

/** Shrink a slide's text (down to a limit) until it fits its 1280×720 box. Returns the font size used. */
export function fitSlide(slideEl) {
  slideEl.style.fontSize = '';
  const room = slideEl.clientHeight;
  let size = BASE_FONT;
  for (let i = 0; i < 12 && slideEl.scrollHeight > room + 1 && size > MIN_FONT; i++) {
    size = Math.max(MIN_FONT, Math.floor(size * Math.min(0.95, room / slideEl.scrollHeight)));
    slideEl.style.fontSize = `${size}px`;
  }
  return size;
}

export function createPresenter({ api, activeTab, toast, reading }) {
  const wrap = document.getElementById('present');
  const stage = document.getElementById('present-stage');
  const slideEl = document.getElementById('present-slide');
  const counter = document.getElementById('present-count');
  const bar = document.getElementById('present-progress');
  let slides = [];
  let index = 0;
  let hintTimer = null;

  const fit = () => {
    // The slide is designed at 1280×720 and scaled to the window, keeping its proportions.
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  function show(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slideEl.replaceChildren(...slides[index].map((n) => n.cloneNode(true)));
    slideEl.classList.toggle('title-slide', slides[index].length === 1 && slides[index][0].classList?.contains('doc-meta'));
    slideEl.classList.toggle('short', slides[index].length <= 2);
    // A slide that holds more than fits gets smaller text (down to a limit), keeping its full width.
    fitSlide(slideEl);
    counter.textContent = `${index + 1} / ${slides.length}`;
    bar.style.width = `${((index + 1) / slides.length) * 100}%`;
  }

  function start() {
    const tab = activeTab();
    if (!tab) { toast('Open a document first'); return; }
    if (tab.doc.compare) { toast('A comparison can’t be presented'); return; }
    slides = splitSlides(tab.el);
    if (!slides.length) { toast('This document is empty'); return; }
    wrap.hidden = false;
    document.body.classList.add('presenting');
    fit();
    show(0);
    api.setFullScreen(true);
    reading()?.presentChanged();
    wrap.classList.add('hint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => wrap.classList.remove('hint'), 3500);
    wrap.focus();
  }

  function stop() {
    if (wrap.hidden) return;
    wrap.hidden = true;
    document.body.classList.remove('presenting');
    slideEl.replaceChildren();
    api.setFullScreen(false);
    reading()?.presentChanged();
  }

  /** Which slide holds this node of the document (-1 if none does). */
  function slideOf(node) {
    return slides.findIndex((list) => list.some((c) => sourceOf.get(c)?.contains(node)));
  }

  /** Go to the slide with this range on it, and return the same text on the slide. */
  function follow(range) {
    const i = slideOf(range.startContainer);
    if (i < 0) return null;
    if (i !== index) show(i);
    const at = slides[i].findIndex((c) => sourceOf.get(c).contains(range.startContainer));
    return copyRange(range, sourceOf.get(slides[i][at]), slideEl.children[at]);
  }

  /** Moved by hand: a reading in progress comes along. */
  function go(i) {
    show(i);
    reading()?.slideMoved(index);
  }

  const active = () => !wrap.hidden;

  window.addEventListener('keydown', (e) => {
    if (!active()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;     // menu shortcuts keep working
    if (e.target.closest?.('#speak-bar')) return;       // the read-aloud bar keeps its own keys
    const k = e.key;
    let handled = true;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { if (e.shiftKey && k === ' ') go(index - 1); else go(index + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) go(index - 1);
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'r' || k === 'R') reading()?.toggleSpeak();
    else if (k === 'Escape') stop();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('a')) { e.preventDefault(); return; }
    if (e.target.closest('#present-close')) { stop(); return; }
    go(e.clientX < window.innerWidth / 3 ? index - 1 : index + 1);
  });
  window.addEventListener('resize', () => { if (active()) fit(); });

  return { start, stop, active, follow, slideOf, get index() { return index; }, get count() { return slides.length; } };
}
