// Read, listen (2.4): read aloud with the computer's own voices, focus mode, folding sections under their
// headings, and hover previews of footnotes and of links to other documents.
// Natural voices (3.2): read aloud with the Supertonic voices, made on this computer (src/main/voices.js).
import { modelLang, guessLang } from '../main/voice-text.js';

const $ = (id) => document.getElementById(id);
const NATURAL = 'natural:';

// Text that isn't read aloud: code, maths, diagrams, charts and the app's own buttons.
const SKIP = 'pre, script, style, button, svg, .katex, .mermaid-diagram, .mermaid-src, .chart, .chart-error, .copy-btn, .run-output, .footnote-ref, .footnote-backref, .fold-btn, .data-note, .nb-in, .nb-out, .img-missing';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, blockquote, .doc-meta-title, .doc-meta-sub';
const HEADING = /^H[1-6]$/;

/** Split text into sentences (the language's own rules where the browser has them). */
export function sentences(text, lang = undefined) {
  const out = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    for (const s of new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text)) {
      if (s.segment.trim()) out.push({ start: s.index, end: s.index + s.segment.length });
    }
    return out;
  }
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*\s*|$)/g;
  let m;
  while ((m = re.exec(text)) && m[0]) { if (m[0].trim()) out.push({ start: m.index, end: m.index + m[0].length }); }
  return out;
}

/**
 * The page's readable text as sentences, in reading order: [{ text, range, block, heading }].
 * @param {HTMLElement} root
 */
export function collectSentences(root) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) || n.parentElement?.closest('.fold-hidden') || !n.nodeValue.trim() ? 2 : 1),
  });
  const groups = [];
  let cur = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement.closest(BLOCK) || root;
    if (!cur || cur.block !== block) { cur = { block, nodes: [], text: '' }; groups.push(cur); }
    cur.nodes.push({ node: n, at: cur.text.length });
    cur.text += n.nodeValue;
  }
  const items = [];
  for (const g of groups) {
    const locate = (offset) => {
      let pick = g.nodes[0];
      for (const x of g.nodes) { if (x.at <= offset) pick = x; else break; }
      return { node: pick.node, offset: Math.min(offset - pick.at, pick.node.nodeValue.length) };
    };
    for (const s of sentences(g.text, doc.documentElement.lang || undefined)) {
      const text = g.text.slice(s.start, s.end).replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const a = locate(s.start + (g.text.slice(s.start, s.end).length - g.text.slice(s.start, s.end).trimStart().length));
      const b = locate(s.start + g.text.slice(s.start, s.end).trimEnd().length);
      const range = doc.createRange();
      try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); } catch { continue; }
      items.push({ text, range, block: g.block, heading: HEADING.test(g.block.tagName) });
    }
  }
  return items;
}

/**
 * Hide everything under folded headings. A heading at level L folds what follows it until the next
 * heading at level L or above.
 */
export function applyFolds(root, folded) {
  const stack = [];
  for (const el of root.children) {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) {
      const level = Number(m[1]);
      while (stack.length && stack[stack.length - 1] >= level) stack.pop();
      el.classList.toggle('fold-hidden', stack.length > 0);
      const isFolded = folded.has(el.id);
      el.classList.toggle('folded', isFolded);
      el.querySelector(':scope > .fold-btn')?.setAttribute('aria-expanded', String(!isFolded));
      if (isFolded) stack.push(level);
    } else el.classList.toggle('fold-hidden', stack.length > 0);
  }
}

/** Remove reading aids from a copy of the page (exports, slides, copying). */
export function cleanCopy(root) {
  root.querySelectorAll('.fold-btn').forEach((n) => n.remove());
  root.querySelectorAll('.fold-hidden, .folded, .in-focus').forEach((n) => n.classList.remove('fold-hidden', 'folded', 'in-focus'));
  return root;
}

export function createReadUi(ctx) {
  const { api, toast } = ctx;

  // ================================================================ read aloud
  const bar = $('speak-bar');
  const els = { play: $('speak-play'), rate: $('speak-rate'), voice: $('speak-voice'), status: $('speak-status') };
  const synth = () => window.__nmrSpeech || window.speechSynthesis;
  let items = [];
  let index = 0;
  let playing = false;
  let tabId = null;
  let gen = 0;
  const highlight = (range) => {
    if (!window.CSS?.highlights) return;
    if (range) CSS.highlights.set('nmr-speak', new Highlight(range)); else CSS.highlights.delete('nmr-speak');
  };
  const localVoices = () => (synth()?.getVoices?.() || []).filter((v) => v.localService !== false);

  // ---------------------------------------------------------------- natural voices (3.2)
  let natural = { installed: false, downloading: false, done: 0, total: 0, voices: [] };
  let naturalLang = null;               // the model's language code for the document being read, or null
  let steps = 8;                        // fewer on a slower computer (see speakNatural)
  const audio = new Map();              // sentence index -> Promise<{ samples, sampleRate } | { error }>
  let player = null;                    // the sentence playing now: { stop }
  const isNatural = () => els.voice.value.startsWith(NATURAL) && natural.installed;
  const voiceName = (id) => `${id[0] === 'F' ? 'Female' : 'Male'} voice ${id[1]}`;

  function fillVoices() {
    const want = ctx.settings().readAloud?.voice || '';
    const list = localVoices();
    const own = document.createElement('optgroup');
    own.label = 'This computer’s voices';
    own.append(new Option('System default', ''), ...list.map((v) => new Option(`${v.name}${v.lang ? ` (${v.lang})` : ''}`, v.name)));
    const nat = document.createElement('optgroup');
    nat.label = 'Natural voices (offline)';
    if (natural.installed) {
      nat.append(...natural.voices.map((id) => new Option(voiceName(id), NATURAL + id)), new Option('Remove natural voices…', `${NATURAL}remove`));
    } else if (natural.downloading) {
      const o = new Option(`Downloading natural voices… ${Math.floor((100 * natural.done) / (natural.total || 1))}%`, `${NATURAL}get`);
      o.disabled = true;
      nat.append(o);
    } else nat.append(new Option(natural.error ? 'Try downloading natural voices again…' : 'Get natural voices…', `${NATURAL}get`));
    els.voice.replaceChildren(nat, own);
    const ok = [...els.voice.options].some((o) => o.value === want && !o.value.endsWith(':get') && !o.value.endsWith(':remove'));
    els.voice.value = ok ? want : '';
    mirrorVoice();
  }

  // Preferences shows the same list.
  function mirrorVoice() {
    const pref = $('pref-voice');
    pref.replaceChildren(...[...els.voice.children].map((g) => g.cloneNode(true)));
    pref.value = els.voice.value;
  }
  window.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
  api.voiceStatus?.().then((s) => { natural = s; fillVoices(); });
  api.onVoiceProgress?.((s) => { natural = s; fillVoices(); });

  /** Ask for (and remember) the audio of sentence i. Two sentences ahead are made while one plays. */
  function synthesize(i) {
    if (i >= items.length || audio.has(i)) return audio.get(i);
    const rate = Number(els.rate.value) || 1;
    const p = api.voiceSpeak({ text: items[i].text, lang: naturalLang, voice: els.voice.value.slice(NATURAL.length), speed: 1.05 * rate, steps: i === index ? Math.min(steps, 5) : steps });
    audio.set(i, p);
    return p;
  }

  /** Play samples; resolves when they've finished (or were stopped). Tests replace this with window.__nmrAudio. */
  let actx = null;
  function play(samples, sampleRate) {
    if (window.__nmrAudio) return window.__nmrAudio.play(samples, sampleRate);
    actx ??= new AudioContext();
    if (actx.state === 'suspended') actx.resume();
    const buf = actx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(samples instanceof Float32Array ? samples : Float32Array.from(samples), 0);
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(actx.destination);
    let done;
    const ended = new Promise((r) => { done = r; });
    src.onended = () => done();
    src.start();
    return { ended, stop: () => { try { src.stop(); } catch { /* not started */ } done(); } };
  }

  /** Stop the sentence playing and drop the ones made ahead (they're cancelled in the worker too). */
  function stopAudio() {
    player?.stop();
    player = null;
    audio.clear();
    api.voiceCancel?.();
  }

  async function speakNatural(mine) {
    const item = items[index];
    const t0 = performance.now();
    const res = await synthesize(index);
    if (mine !== gen || !playing) return;
    if (res?.error === 'cancelled') { audio.delete(index); speakNatural(mine); return; }   // made ahead, then dropped: make it again
    if (!res || res.error) {
      // The natural voice failed: carry on with the computer's own voice rather than stopping.
      if (res?.error && res.error !== 'cancelled') toast(`The natural voice stopped (${res.error}) — reading on with your computer’s voice`);
      els.voice.value = '';
      speakAt(index);
      return;
    }
    // A computer that makes speech slower than about 0.7× real time gets fewer refinement steps.
    const secs = res.samples.length / res.sampleRate;
    if (res.ms / 1000 > secs * 0.7 && steps > 5) steps = 5;
    for (let k = 1; k <= 2; k++) synthesize(index + k);
    window.__lastNatural = { index, text: item.text, secs, waited: performance.now() - t0 };     // read by the end-to-end tests
    player = play(res.samples, res.sampleRate);
    const p = player;
    await p.ended;
    audio.delete(index);
    if (mine === gen && playing && player === p) speakAt(index + 1);
  }

  function setPlaying(on) {
    playing = on;
    els.play.classList.toggle('paused', !on);
    els.play.title = on ? 'Pause' : 'Read';
    els.play.setAttribute('aria-label', on ? 'Pause' : 'Read');
  }

  function speakAt(i) {
    const s = synth();
    const mine = ++gen;
    s?.cancel();
    player?.stop();
    player = null;
    if (i >= items.length) { finish(); return; }
    index = Math.max(0, i);
    const item = items[index];
    highlight(item.range);
    focusOn(item.block);
    const rect = item.range.getBoundingClientRect();
    const desk = ctx.deskFor(ctx.activeTab());
    const box = desk.getBoundingClientRect();
    if (rect.top < box.top + 60 || rect.bottom > box.bottom - 90) desk.scrollBy({ top: rect.top - box.top - box.height * 0.3, behavior: 'smooth' });
    els.status.textContent = `${index + 1} of ${items.length}`;
    if (isNatural() && naturalLang) { speakNatural(mine); return; }
    if (!s) { stop(); toast('Read aloud isn’t available on this computer'); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    const conf = ctx.settings().readAloud || {};
    u.rate = Number(els.rate.value) || conf.rate || 1;
    const voice = localVoices().find((v) => v.name === els.voice.value);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.onend = () => { if (mine === gen && playing) speakAt(index + 1); };
    u.onerror = (e) => {
      if (mine !== gen || e.error === 'interrupted' || e.error === 'canceled') return;
      stop();
      toast(e.error === 'synthesis-unavailable' || e.error === 'voice-unavailable'
        ? 'No voice is available — install a voice in your system’s speech settings (on Linux: speech-dispatcher with espeak-ng)'
        : 'Reading aloud stopped');
    };
    s.speak(u);
  }

  function finish() { setPlaying(false); highlight(null); els.status.textContent = 'Finished'; index = 0; }

  function start() {
    const tab = ctx.activeTab();
    if (!tab || tab.doc.compare || tab.doc.needsPassword) { toast('Open a document to read aloud'); return; }
    const wantsNatural = (ctx.settings().readAloud?.voice || '').startsWith(NATURAL) && natural.installed;
    if (!wantsNatural && (!synth() || typeof SpeechSynthesisUtterance === 'undefined')) { toast('Read aloud isn’t available on this computer'); return; }
    if (bar.hidden || tabId !== tab.id) {
      items = collectSentences(tab.el);
      if (!items.length) { toast('There’s no text to read here'); return; }
      tabId = tab.id;
      audio.clear();
      fillVoices();
      // The document's own language if it says (front matter), else a guess from its words.
      naturalLang = modelLang(tab.el.lang || guessLang(items.slice(0, 80).map((it) => it.text).join(' ')) || 'en');
      if (isNatural() && !naturalLang) toast('The natural voices don’t read this language yet — using your computer’s voice');
      els.rate.value = String(ctx.settings().readAloud?.rate || 1);
      if (![...els.rate.options].some((o) => o.value === els.rate.value)) els.rate.value = '1';
      // Start at the selection, or at the first sentence on screen.
      const sel = window.getSelection();
      const desk = ctx.deskFor(tab);
      const top = desk.getBoundingClientRect().top + 8;
      let at = 0;
      if (sel && !sel.isCollapsed && tab.el.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        at = Math.max(0, items.findIndex((it) => it.range.compareBoundaryPoints(Range.END_TO_START, r) <= 0 && it.range.compareBoundaryPoints(Range.START_TO_END, r) >= 0));
      } else at = Math.max(0, items.findIndex((it) => it.range.getBoundingClientRect().bottom > top));
      bar.hidden = false;
      document.body.classList.add('speaking');
      setPlaying(true);
      speakAt(at);
      return;
    }
    if (playing) { setPlaying(false); gen++; synth()?.cancel(); stopAudio(); els.status.textContent = 'Paused'; } else { setPlaying(true); speakAt(index); }
  }

  function stop() {
    gen++;
    synth()?.cancel();
    stopAudio();
    audio.clear();
    setPlaying(false);
    highlight(null);
    bar.hidden = true;
    document.body.classList.remove('speaking');
    tabId = null;
    items = [];
    if (!focusMode) clearFocus();
  }

  function jumpSection(dir) {
    if (!items.length) return;
    let i = index + dir;
    while (i >= 0 && i < items.length && !items[i].heading) i += dir;
    if (dir < 0) {
      // "Previous" from inside a section goes to its own heading first.
      let own = index;
      while (own > 0 && !items[own].heading) own--;
      if (own < index && items[own].heading) i = own;
    }
    i = Math.min(Math.max(i, 0), items.length - 1);
    if (playing) speakAt(i); else { index = i; highlight(items[i].range); focusOn(items[i].block); els.status.textContent = `${i + 1} of ${items.length}`; }
  }

  els.play.onclick = start;
  $('speak-stop').onclick = stop;
  $('speak-prev').onclick = () => jumpSection(-1);
  $('speak-next').onclick = () => jumpSection(1);
  const saveConf = () => api.setSettings({ readAloud: { rate: Number(els.rate.value) || 1, voice: els.voice.value } });
  const restart = () => { audio.clear(); api.voiceCancel?.(); if (playing) speakAt(index); };
  els.rate.onchange = () => { saveConf(); restart(); };
  $('pref-rate').onchange = () => { els.rate.value = $('pref-rate').value; saveConf(); restart(); };
  $('pref-voice').onchange = () => { const v = $('pref-voice').value; chosen = els.voice.value; els.voice.value = v; els.voice.onchange(); };
  let chosen = els.voice.value;
  els.voice.onfocus = () => { chosen = els.voice.value; };
  els.voice.onchange = async () => {
    const v = els.voice.value;
    if (v === `${NATURAL}get` || v === `${NATURAL}remove`) {
      els.voice.value = chosen;                       // these are actions, not voices
      if (v.endsWith('get')) {
        natural = await api.voiceInstall();
        fillVoices();
        if (natural.installed) {
          els.voice.value = `${NATURAL}${natural.voices[0]}`;
          saveConf();
          toast('Natural voices are ready');
          restart();
        } else if (natural.error) toast(natural.error);
      } else {
        natural = await api.voiceRemove();
        if (!natural.installed && chosen.startsWith(NATURAL)) { els.voice.value = ''; saveConf(); restart(); }
        fillVoices();
      }
      chosen = els.voice.value;
      mirrorVoice();
      return;
    }
    chosen = v;
    saveConf();
    restart();
    mirrorVoice();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !bar.hidden && !document.querySelector('dialog[open]') && !e.target.closest?.('.cm-editor')) stop();
  });

  // ================================================================ focus mode
  let focusMode = false;
  let focusRaf = 0;
  function clearFocus() { for (const n of document.querySelectorAll('.page .in-focus')) n.classList.remove('in-focus'); }
  /** In focus mode while reading aloud, the paragraph being read is the one in focus. */
  function focusOn(block) {
    if (!focusMode) return;
    const tab = ctx.activeTab();
    if (!tab) return;
    let top = block;
    while (top && top.parentElement !== tab.el) top = top.parentElement;
    clearFocus();
    top?.classList.add('in-focus');
  }
  function updateFocus() {
    focusRaf = 0;
    if (!focusMode || !bar.hidden) return;
    const tab = ctx.activeTab();
    if (!tab) return;
    const desk = ctx.deskFor(tab).getBoundingClientRect();
    const line = desk.top + desk.height * 0.38;
    let best = null;
    for (const el of tab.el.children) {
      if (el.classList.contains('fold-hidden')) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      if (r.top <= line) best = el; else { if (!best) best = el; break; }
    }
    clearFocus();
    best?.classList.add('in-focus');
  }
  function toggleFocus() {
    focusMode = !focusMode;
    document.body.classList.toggle('focus-mode', focusMode);
    if (focusMode) { updateFocus(); toast('Focus mode — F8 to leave'); } else clearFocus();
  }
  ctx.desk.addEventListener('scroll', () => { if (focusMode && !focusRaf) focusRaf = requestAnimationFrame(updateFocus); }, { passive: true });

  // ================================================================ folding sections
  function addFolds(tab) {
    if (!tab?.el || tab.doc.compare || tab.doc.needsPassword) return;
    tab.folded ??= new Set();
    for (const h of tab.el.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')) {
      if (!h.id || h.querySelector(':scope > .fold-btn')) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fold-btn';
      b.setAttribute('aria-expanded', 'true');
      b.setAttribute('aria-label', `Fold section: ${h.textContent.trim().slice(0, 80)}`);
      b.title = 'Fold or unfold this section';
      b.onclick = (e) => { e.stopPropagation(); toggleFold(tab, h.id); };
      h.prepend(b);
    }
    for (const id of [...tab.folded]) if (!tab.el.querySelector(`[id="${CSS.escape(id)}"]`)) tab.folded.delete(id);
    applyFolds(tab.el, tab.folded);
  }
  function toggleFold(tab, id) {
    if (tab.folded.has(id)) tab.folded.delete(id); else tab.folded.add(id);
    applyFolds(tab.el, tab.folded);
    if (!bar.hidden && tab.id === tabId) stop();
  }
  function foldAll(fold = true) {
    const tab = ctx.activeTab();
    if (!tab?.el) return;
    addFolds(tab);
    const heads = [...tab.el.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')];
    const h1s = heads.filter((h) => h.tagName === 'H1');
    tab.folded = new Set(fold ? heads.filter((h) => !(h1s.length === 1 && h === h1s[0])).map((h) => h.id) : []);
    applyFolds(tab.el, tab.folded);
    toast(fold ? 'Sections folded — click a heading’s arrow to open one' : 'All sections open');
  }
  /** Unfold whatever hides `el` (when the outline, a link or a search result goes there). */
  function reveal(el, tab = ctx.activeTab()) {
    if (!tab?.folded?.size || !el) return;
    let top = el;
    while (top && top.parentElement !== tab.el) top = top.parentElement;
    if (!top) return;
    let changed = false;
    const level = (h) => Number(h.tagName[1]);
    let need = /^H[1-6]$/.test(top.tagName) ? level(top) : 7;
    for (let p = top.previousElementSibling; p; p = p.previousElementSibling) {
      if (/^H[1-6]$/.test(p.tagName) && level(p) < need) {
        if (tab.folded.delete(p.id)) changed = true;
        need = level(p);
      }
    }
    if (tab.folded.delete(top.id)) changed = true;
    if (changed) applyFolds(tab.el, tab.folded);
  }

  // ================================================================ hover previews
  const peek = $('peek');
  let peekTimer = 0;
  let peekFor = null;
  const peekCache = new Map();
  function hidePeek() { clearTimeout(peekTimer); peekFor = null; peek.hidden = true; }
  function place(a) {
    const r = a.getBoundingClientRect();
    peek.hidden = false;
    const w = peek.offsetWidth;
    const h = peek.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 12);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    peek.style.left = `${left}px`;
    peek.style.top = `${top}px`;
  }
  /** Keep the first few blocks, up to about `max` characters of text. */
  function trim(container, max = 700) {
    let used = 0;
    for (const el of [...container.children]) {
      if (used > max) { el.remove(); continue; }
      used += el.textContent.length;
    }
    container.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    container.querySelectorAll('a').forEach((n) => n.setAttribute('tabindex', '-1'));
  }
  function filePathOf(a, tab) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return null;
    let url;
    try { url = new URL(href, tab.doc.baseUrl || undefined); } catch { return null; }
    if (url.protocol !== 'file:') return null;
    let p = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:\//i.test(p)) p = p.slice(1).replace(/\//g, '\\');
    if (!/\.(md|markdown|mdown|mkdn?|mdwn|mdx|txt|csv|tsv|tab|json|ya?ml|ipynb)$/i.test(p)) return null;
    return { path: p, hash: decodeURIComponent(url.hash.slice(1)) };
  }
  async function showFor(a) {
    const tab = ctx.activeTab();
    if (!tab || !a.isConnected) return;
    const href = a.getAttribute('href') || '';
    peek.classList.remove('peek-doc');
    if (/^#fn/.test(href) || a.closest('.footnote-ref')) {
      const li = tab.el.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
      if (!li) return;
      const box = li.cloneNode(true);
      box.querySelectorAll('.footnote-backref').forEach((n) => n.remove());
      peek.replaceChildren(...box.childNodes);
      trim(peek, 1200);
      place(a);
      return;
    }
    if (a.classList.contains('wikilink-missing')) return;
    const target = filePathOf(a, tab);
    if (!target) return;
    let res = peekCache.get(target.path);
    if (!res) { res = await api.peekDoc(target.path); if (!res.error) peekCache.set(target.path, res); }
    if (peekFor !== a) return;
    if (res.error) return;
    const holder = document.createElement('div');
    if (res.locked) holder.innerHTML = '<p><b>🔒 Locked document</b></p><p>Unlock it to see what’s inside.</p>';
    else {
      holder.innerHTML = ctx.render(res.content, { baseUrl: res.baseUrl }).html;
      if (target.hash) {
        const h = holder.querySelector(`[id="${CSS.escape(target.hash)}"]`);
        if (h && h.parentElement === holder) {
          while (h.previousElementSibling) h.previousElementSibling.remove();
          const lvl = Number(h.tagName[1]) || 7;
          let n = h.nextElementSibling;
          while (n && !(/^H[1-6]$/.test(n.tagName) && Number(n.tagName[1]) <= lvl)) n = n.nextElementSibling;
          while (n) { const next = n.nextElementSibling; n.remove(); n = next; }
        }
      }
      holder.querySelectorAll('.mermaid-src, script').forEach((n) => n.remove());
    }
    trim(holder);
    const head = document.createElement('div');
    head.className = 'peek-name';
    head.textContent = res.name;
    peek.replaceChildren(head, ...holder.childNodes);
    peek.classList.add('peek-doc');
    place(a);
  }
  function onEnter(e) {
    const a = e.target.closest?.('.page a[href]');
    if (!a || a === peekFor) return;
    if (peekFor && !a.contains(peekFor)) hidePeek();
    peekFor = a;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => showFor(a), e.type === 'focusin' ? 150 : 380);
  }
  function onLeave(e) {
    const a = e.target.closest?.('.page a[href]');
    if (a && a === peekFor && !(e.relatedTarget && a.contains(e.relatedTarget))) hidePeek();
  }
  ctx.desk.addEventListener('mouseover', onEnter);
  ctx.desk.addEventListener('mouseout', onLeave);
  ctx.desk.addEventListener('focusin', onEnter);
  ctx.desk.addEventListener('focusout', onLeave);
  ctx.desk.addEventListener('scroll', hidePeek, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePeek(); });
  api.onDocumentChanged?.((doc) => peekCache.delete(doc.path));

  return {
    refreshVoices: fillVoices,
    toggleSpeak: start, stopSpeak: stop, speaking: () => !bar.hidden,
    toggleFocus, focusMode: () => focusMode,
    afterRender(tab) { addFolds(tab); if (tab.id === tabId) stop(); if (focusMode) updateFocus(); hidePeek(); peekCache.clear(); },
    tabChanged() { if (!bar.hidden) stop(); if (focusMode) updateFocus(); hidePeek(); },
    foldAll: () => foldAll(true), unfoldAll: () => foldAll(false), reveal,
  };
}
