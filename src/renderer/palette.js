// Quick Open (Ctrl+K): type a few letters to jump to an open tab, bookmark, recent file, any file in the
// open folder, (starting with #) a heading in the current document, or (starting with >) any menu
// command. Also used as a simple picker.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Fuzzy match. Space-separated parts must each match ("inst v2" finds "install-v2.md").
 * Returns { score, hits } or null. Higher is better.
 */
export function fuzzy(query, text) {
  const terms = String(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length > 1) {
    let score = 0;
    const hits = new Set();
    for (const term of terms) {
      const m = fuzzyTerm(term, text);
      if (!m) return null;
      score += m.score;
      m.hits.forEach((h) => hits.add(h));
    }
    return { score, hits: [...hits] };
  }
  return fuzzyTerm(terms[0] || '', text);
}

function fuzzyTerm(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const atWord = direct === 0 || /[\s\\/._-]/.test(t[direct - 1]);
    return { score: 1000 - direct + (atWord ? 200 : 0) - t.length * 0.5, hits: [...Array(q.length).keys()].map((k) => direct + k) };
  }
  const hits = [];
  let score = 0;
  let prev = -2;
  for (let i = 0, j = 0; i < q.length; i++) {
    j = t.indexOf(q[i], j);
    if (j < 0) return null;
    score += j === prev + 1 ? 15 : 0;                                   // consecutive letters
    score += j === 0 || /[\s\\/._-]/.test(t[j - 1]) ? 25 : 0;           // start of a word
    hits.push(j);
    prev = j;
    j++;
  }
  return { score: score - t.length * 0.5, hits };
}

/** "CmdOrCtrl+Shift+K" → "Ctrl+Shift+K" (or "⌘⇧K" on a Mac). */
export function prettyShortcut(acc, platform = 'win32') {
  if (!acc) return '';
  const mac = platform === 'darwin';
  const parts = acc.split('+');
  if (acc.endsWith('++')) parts.splice(-2, 2, '+');
  const names = mac
    ? { CmdOrCtrl: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Plus: '+', Left: '←', Right: '→', Up: '↑', Down: '↓' }
    : { CmdOrCtrl: 'Ctrl', CommandOrControl: 'Ctrl', Control: 'Ctrl', Plus: '+', Left: '←', Right: '→', Up: '↑', Down: '↓' };
  return parts.map((p) => names[p] ?? p).join(mac ? '' : '+');
}

function highlight(text, hits) {
  const set = new Set(hits);
  return [...text].map((c, i) => (set.has(i) ? `<b>${esc(c)}</b>` : esc(c))).join('');
}

export function createPalette(ctx) {
  const $ = (id) => document.getElementById(id);
  const box = $('palette');
  const input = $('palette-input');
  const listEl = $('palette-list');
  const hint = $('palette-hint');
  let items = [];
  let shown = [];
  let selected = 0;
  let mode = null;            // { kind: 'open' } | { kind: 'pick', resolve }

  function sourceItems() {
    const out = [];
    const seen = new Map();
    const add = (path, name, detail, kind) => {
      const k = path.toLowerCase();
      const existing = seen.get(k);
      if (existing) {
        // Already listed (e.g. an open tab): still show that it's bookmarked.
        if (kind === 'bookmark' && !existing.detail.includes('★')) existing.detail += ' · ★ Bookmark';
        return;
      }
      const item = { kind, label: name, detail, path };
      seen.set(k, item);
      out.push(item);
    };
    for (const t of ctx.tabs()) if (t.doc.path) add(t.doc.path, t.doc.name, 'Open tab', 'tab');
    for (const p of ctx.bookmarks()) add(p, p.split(/[\\/]/).pop(), '★ Bookmark', 'bookmark');
    for (const p of ctx.recent()) add(p, p.split(/[\\/]/).pop(), p, 'recent');
    for (const f of ctx.folderFiles()) add(f.path, f.name, f.rel, 'file');
    return out;
  }

  function headingItems() {
    return (ctx.activeTab()?.result?.toc || []).map((h) => ({ kind: 'heading', label: h.text, detail: `H${h.level}`, id: h.id, indent: h.level }));
  }

  let commands = [];
  async function loadCommands() {
    const list = (await ctx.listCommands?.()) || [];
    commands = list.filter((c) => c.enabled).map((c) => ({
      kind: 'command', label: c.label, key: c.key,
      detail: [c.path, prettyShortcut(c.accelerator, ctx.platform?.())].filter(Boolean).join('  ·  '),
    }));
    if (!box.hidden && input.value.trim().startsWith('>')) filter();
  }

  function filter() {
    const raw = input.value;
    let pool = items;
    let q = raw.trim();
    if (mode.kind === 'open' && q.startsWith('#')) { pool = headingItems(); q = q.slice(1).trim(); }
    else if (mode.kind === 'open' && q.startsWith('>')) { pool = commands; q = q.slice(1).trim(); }
    shown = pool
      .map((it) => {
        const m = fuzzy(q, it.label) || (it.detail && fuzzy(q, it.detail) && { score: (fuzzy(q, it.detail).score) - 300, hits: [] });
        return m ? { it, m } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (q ? b.m.score - a.m.score : 0))
      .slice(0, 60);
    selected = 0;
    render();
  }

  function render() {
    listEl.replaceChildren();
    if (!shown.length) {
      const q = input.value.trim();
      const msg = q.startsWith('#') ? 'No matching headings.' : q.startsWith('>') ? 'No matching commands.' : 'Nothing matches. Try fewer letters, or open a folder to search all of its files.';
      listEl.innerHTML = `<li class="palette-empty" role="option" aria-disabled="true" aria-selected="false">${msg}</li>`;
      return;
    }
    shown.forEach(({ it, m }, i) => {
      const li = document.createElement('li');
      li.className = `palette-item kind-${it.kind}${i === selected ? ' selected' : ''}`;
      li.setAttribute('role', 'option');
      li.id = `palette-opt-${i}`;
      li.setAttribute('aria-selected', String(i === selected));
      li.innerHTML = `<span class="pi-label">${highlight(it.label, m.hits)}</span><span class="pi-detail">${esc(it.detail || '')}</span>`;
      li.onmousedown = (e) => { e.preventDefault(); choose(i); };
      listEl.appendChild(li);
    });
    listEl.children[selected]?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', shown.length ? `palette-opt-${selected}` : '');
  }

  function choose(i) {
    const pick = shown[i]?.it;
    const m = mode;
    mode = null;                 // so close() doesn't report a cancelled pick
    box.hidden = true;
    if (!m) return;
    if (!pick) { if (m.kind === 'pick') m.resolve(null); return; }
    if (m.kind === 'pick') { m.resolve(pick); return; }
    if (pick.kind === 'heading') ctx.goToHeading(pick.id);
    else if (pick.kind === 'command') ctx.runCommand(pick.key);
    else ctx.openPath(pick.path);
  }

  function close() {
    box.hidden = true;
    if (mode?.kind === 'pick') mode.resolve(null);
    mode = null;
  }

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(shown.length - 1, selected + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.hidden && document.activeElement !== input) close(); }, 100));

  function open(initial = '') {
    mode = { kind: 'open' };
    items = sourceItems();
    hint.textContent = 'Type to find a file · # for a heading · > for a command · ↑↓ Enter · Esc';
    input.placeholder = 'Go to file, #heading or >command…';
    loadCommands();
    box.hidden = false;
    input.value = initial;
    filter();
    input.focus();
  }

  /** Let the user pick one of `choices` ({ label, detail, ... }). Resolves to the choice or null. */
  function pick(choices, { placeholder = 'Choose…', hint: h = '↑↓ Enter · Esc' } = {}) {
    return new Promise((resolve) => {
      mode = { kind: 'pick', resolve };
      items = choices;
      hint.textContent = h;
      input.placeholder = placeholder;
      box.hidden = false;
      input.value = '';
      filter();
      input.focus();
    });
  }

  return { open, pick, close, isOpen: () => !box.hidden };
}
