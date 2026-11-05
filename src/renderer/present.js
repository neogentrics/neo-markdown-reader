// Presentation mode: the document as full-screen slides. A line with `---` starts a new slide;
// documents without any are split at their top-level headings instead.

/** The text nodes of a slide's block that read aloud can reach, in order. */
function textNodes(top) {
  // 4 = text nodes, 1 = accept, 2 = reject.
  const walker = top.ownerDocument.createTreeWalker(top, 4, { acceptNode: (n) => (n.parentElement?.closest('.fold-btn') ? 2 : 1) });
  const out = [];
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
}

const textLength = (top) => textNodes(top).reduce((n, t) => n + t.length, 0);

/** The same stretch of text as `range` (inside `from`), in the copy of it on a slide. `shift` is where it starts in the copy. */
export function copyRange(range, from, to, shift = 0) {
  const offset = (node, at) => {
    let n = 0;
    for (const t of textNodes(from)) {
      if (t === node) return n + at;
      n += t.length;
    }
    return -1;
  };
  const nodes = textNodes(to);
  const place = (n) => {
    let left = Math.max(0, n);
    for (const t of nodes) {
      if (left <= t.length) return [t, left];
      left -= t.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.length] : null;     // a sentence running on past the end of this part of a block
  };
  const a = offset(range.startContainer, range.startOffset);
  const b = offset(range.endContainer, range.endOffset);
  const start = a < 0 ? null : place(a + shift);
  const end = b < 0 ? (start && [start[0], start[0].length]) : place(b + shift);
  if (!start || !end) return null;
  const r = document.createRange();
  r.setStart(...start);
  r.setEnd(...end);
  return r;
}

/** Split a rendered page into slides: arrays of (cloned) top-level nodes. */
export function splitSlides(root) {
  sourceOf = new WeakMap();
  spans = new WeakMap();
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
/** For a block split across slides: which part of the document's block each piece holds. */
let spans = new WeakMap();

const BASE_FONT = 30;
const MIN_FONT = 22;        // a slide that would need smaller text than this is split instead
const PAGE_FONT = 22;       // the text size on slides made by splitting
const MIN_SPLIT_TEXT = 200; // shorter paragraphs move to the next slide whole

const isHeading = (n) => /^H[1-6]$/.test(n.tagName);
const spanOf = (n) => spans.get(n) || { source: sourceOf.get(n), start: 0, lead: 0 };

/** Record that `head` and `tail` are the two halves of `n`. `lead` is text a piece repeats, such as a table's header row. */
function divided(n, head, tail) {
  const s = spanOf(n);
  const whole = textLength(n) - s.lead;
  const used = textLength(head) - s.lead;
  spans.set(head, { ...s });
  spans.set(tail, { source: s.source, start: s.start + used, lead: Math.max(0, textLength(tail) - (whole - used)) });
  sourceOf.set(head, s.source);
  sourceOf.set(tail, s.source);
  tail.removeAttribute?.('id');
  return { head, tail };
}

/** The most that passes `ok`, from `low` to `high`. 0 if not even `low` does. */
function most(low, high, ok) {
  if (!ok(low)) return 0;
  let best = low;
  let hi = high;
  let lo = low + 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** A copy of `n` with only some of the children of the part at `path`. */
function withUnits(n, inner, from, to) {
  const copy = n.cloneNode(true);
  const box = inner ? copy.querySelector(inner) : copy;
  // The spaces between the parts go with them, so positions in the text still line up with the document.
  const all = [...box.childNodes];
  const units = [...box.children];
  const first = from > 0 ? all.indexOf(units[from]) : 0;
  const last = to < units.length ? all.indexOf(units[to]) : all.length;
  all.forEach((c, i) => { if (i < first || i >= last) c.remove(); });
  return copy;
}

/** Split a list, table or other container between two of its parts. */
function splitUnits(n, inner, fits) {
  const box = inner ? n.querySelector(inner) : n;
  const count = box.children.length;
  if (count < 2) return null;
  const k = most(1, count - 1, (i) => fits(withUnits(n, inner, 0, i)));
  if (!k) return null;
  const tail = withUnits(n, inner, k, count);
  if (n.tagName === 'OL') tail.setAttribute('start', String(Number(n.getAttribute('start') || 1) + k));
  return divided(n, withUnits(n, inner, 0, k), tail);
}

/** Split a paragraph at the last word that fits, or the end of a sentence near it. */
function splitText(n, fits) {
  const nodes = textNodes(n);
  const text = nodes.map((t) => t.nodeValue).join('');
  const stops = [...text.matchAll(/\s+/g)].map((m) => m.index + m[0].length).filter((i) => i > 0 && i < text.length);
  if (!stops.length) return null;
  const doc = n.ownerDocument;
  const at = (offset) => {
    let left = offset;
    for (const t of nodes) {
      if (left <= t.length) return [t, left];
      left -= t.length;
    }
    return [nodes[nodes.length - 1], nodes[nodes.length - 1].length];
  };
  const part = (from, to) => {
    const r = doc.createRange();
    if (from === null) r.setStart(n, 0); else r.setStart(...at(from));
    if (to === null) r.setEnd(n, n.childNodes.length); else r.setEnd(...at(to));
    const copy = n.cloneNode(false);
    copy.append(r.cloneContents());
    return copy;
  };
  const k = most(1, stops.length, (i) => fits(part(null, stops[i - 1])));
  if (!k) return null;
  let cut = stops[k - 1];
  for (let i = k - 1; i >= Math.max(0, k - 30); i--) {
    if (/[.!?…]["'”’)]?\s+$/.test(text.slice(0, stops[i]))) { cut = stops[i]; break; }
  }
  return divided(n, part(null, cut), part(cut, null));
}

/** Split a block so its first part passes `fits`, or null if it can't be split. */
function splitBlock(n, fits, alone) {
  if (n.tagName === 'PRE' || n.tagName === 'TABLE') return null;
  const table = n.querySelector?.('table');
  if (table) return table.querySelector('tbody') ? splitUnits(n, 'tbody', fits) : null;
  if (/^(?:P|H[1-6])$/.test(n.tagName)) return !isHeading(n) && (alone || textLength(n) >= MIN_SPLIT_TEXT) ? splitText(n, fits) : null;
  // Lists, quotes and the like split between their parts, or within one that's too long for a slide by itself.
  const parts = n.children?.length > 1 ? splitUnits(n, '', fits) : null;
  if (parts || !alone || n.querySelector?.('svg, img, pre, .katex')) return parts;
  return splitText(n, fits);
}

/**
 * Share a slide's blocks out between as many slides as they need. `fits(nodes)` says whether blocks fit on
 * one slide. A list, table or long paragraph is cut between its parts, and a heading stays with what's under it.
 */
export function paginate(list, fits) {
  const pages = [];
  const queue = [...list];
  let cur = [];
  while (queue.length) {
    const n = queue.shift();
    if (fits([...cur, n])) { cur.push(n); continue; }
    const parts = splitBlock(n, (piece) => fits([...cur, piece]), !cur.length);
    if (parts) {
      pages.push([...cur, parts.head]);
      cur = [];
      queue.unshift(parts.tail);
      continue;
    }
    if (!cur.length) { pages.push([n]); continue; }       // too big for a slide of its own: it can be scrolled
    const carried = [];
    while (cur.length && isHeading(cur[cur.length - 1])) carried.unshift(cur.pop());
    if (cur.length) { pages.push(cur); cur = carried; queue.unshift(n); continue; }
    // Only headings so far, and the next block won't fit under them: split it or let it have the next slide.
    pages.push(carried);
    queue.unshift(n);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/**
 * Fit slides to a slide-sized element that's on the page. A slide that fits at a readable size stays as it
 * is; a longer one becomes several. Returns [{ nodes, font, title }]: `font` is set on split slides, so they
 * match, and `title` names the section a later part continues.
 */
export function layoutSlides(slides, el) {
  const out = [];
  const fits = (nodes) => {
    el.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
    return el.scrollHeight <= el.clientHeight + 1;
  };
  for (const list of slides) {
    el.style.fontSize = `${MIN_FONT}px`;
    if (fits(list)) { out.push({ nodes: list, font: 0, title: '' }); continue; }
    el.style.fontSize = `${PAGE_FONT}px`;
    const title = list.find(isHeading)?.textContent.trim() || '';
    paginate(list, fits).forEach((nodes, i) => out.push({ nodes, font: PAGE_FONT, title: i ? title : '' }));
  }
  el.replaceChildren();
  el.style.fontSize = '';
  return out;
}

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
    const { nodes, font, title } = slides[index];
    slideEl.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
    slideEl.classList.toggle('title-slide', nodes.length === 1 && nodes[0].classList?.contains('doc-meta'));
    slideEl.classList.toggle('short', nodes.length <= 2 && !font);
    if (title) slideEl.dataset.continues = title; else delete slideEl.dataset.continues;
    // A slide that holds a little too much gets smaller text. One that holds far more was split into several.
    if (font) slideEl.style.fontSize = `${font}px`; else fitSlide(slideEl);
    slideEl.scrollTop = 0;
    counter.textContent = `${index + 1} / ${slides.length}`;
    bar.style.width = `${((index + 1) / slides.length) * 100}%`;
  }

  function start() {
    const tab = activeTab();
    if (!tab) { toast('Open a document first'); return; }
    if (tab.doc.compare) { toast('A comparison can’t be presented'); return; }
    const parts = splitSlides(tab.el);
    if (!parts.length) { toast('This document is empty'); return; }
    wrap.hidden = false;
    document.body.classList.add('presenting');
    fit();
    slides = layoutSlides(parts, slideEl);
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

  /** How far into `source` a place in the document is, counted in characters of text. */
  function offsetIn(source, node, inner) {
    let n = 0;
    for (const t of textNodes(source)) {
      if (t === node) return n + inner;
      if (node.contains?.(t)) return n;
      n += t.length;
    }
    return n;
  }

  /** Which slide and block hold this node or range of the document, or null. */
  function locate(target) {
    const node = target.startContainer ?? target;
    const inner = target.startOffset ?? 0;
    let found = null;
    for (let i = 0; i < slides.length; i++) {
      const { nodes } = slides[i];
      for (let at = 0; at < nodes.length; at++) {
        const span = spanOf(nodes[at]);
        if (!span.source?.contains(node)) continue;
        const offset = offsetIn(span.source, node, inner);
        found = { i, at, span, offset };
        if (!spans.has(nodes[at]) || offset < span.start + textLength(nodes[at]) - span.lead) return found;
      }
    }
    return found;
  }

  /** Which slide holds this node or range of the document (-1 if none does). */
  function slideOf(target) { return locate(target)?.i ?? -1; }

  /** Go to the slide with this range on it, and return the same text on the slide. */
  function follow(range) {
    const hit = locate(range);
    if (!hit) return null;
    if (hit.i !== index) show(hit.i);
    const copy = copyRange(range, hit.span.source, slideEl.children[hit.at], hit.span.lead - hit.span.start);
    // A block too big for any slide scrolls, so the sentence being read stays in view.
    if (copy && slideEl.scrollHeight > slideEl.clientHeight + 1) copy.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    return copy;
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
  // The mouse wheel turns the slides, one notch at a time. A slide with more than fits scrolls first.
  let wheel = 0;
  let turned = 0;
  wrap.addEventListener('wheel', (e) => {
    if (e.target.closest?.('#speak-bar')) return;
    e.preventDefault();
    const dy = e.deltaY;
    const room = dy > 0 ? slideEl.scrollHeight - slideEl.clientHeight - slideEl.scrollTop : slideEl.scrollTop;
    if (room > 1) { slideEl.scrollTop += dy; return; }
    wheel += dy;
    const now = Date.now();
    if (Math.abs(wheel) < 40 || now - turned < 220) return;
    turned = now;
    go(index + (wheel > 0 ? 1 : -1));
    wheel = 0;
  }, { passive: false });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('a')) { e.preventDefault(); return; }
    if (e.target.closest('#present-close')) { stop(); return; }
    go(e.clientX < window.innerWidth / 3 ? index - 1 : index + 1);
  });
  window.addEventListener('resize', () => { if (active()) fit(); });

  return { start, stop, active, follow, slideOf, get index() { return index; }, get count() { return slides.length; } };
}
