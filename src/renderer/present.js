// Presentation mode: the document as full-screen slides. A line with `---` starts a new slide;
// documents without any are split at their top-level headings instead.

/** Split a rendered page into slides: arrays of (cloned) top-level nodes. */
export function splitSlides(root) {
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
  return slides.map((list) => list.map((n) => n.cloneNode(true)));
}

const BASE_FONT = 30;
const MIN_FONT = 13;

export function createPresenter({ api, activeTab, toast }) {
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
    slideEl.style.fontSize = '';
    slideEl.classList.toggle('title-slide', slides[index].length === 1 && slides[index][0].classList?.contains('doc-meta'));
    slideEl.classList.toggle('short', slides[index].length <= 2);
    // A slide that holds more than fits gets smaller text (down to a limit), keeping its full width.
    const room = slideEl.clientHeight;
    let size = BASE_FONT;
    for (let i = 0; i < 12 && slideEl.scrollHeight > room + 1 && size > MIN_FONT; i++) {
      size = Math.max(MIN_FONT, Math.floor(size * Math.min(0.95, room / slideEl.scrollHeight)));
      slideEl.style.fontSize = `${size}px`;
    }
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
  }

  const active = () => !wrap.hidden;

  window.addEventListener('keydown', (e) => {
    if (!active()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;     // menu shortcuts keep working
    const k = e.key;
    let handled = true;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { if (e.shiftKey && k === ' ') show(index - 1); else show(index + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) show(index - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else if (k === 'Escape') stop();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('a')) { e.preventDefault(); return; }
    if (e.target.closest('#present-close')) { stop(); return; }
    show(e.clientX < window.innerWidth / 3 ? index - 1 : index + 1);
  });
  window.addEventListener('resize', () => { if (active()) fit(); });

  return { start, stop, active, get index() { return index; }, get count() { return slides.length; } };
}
