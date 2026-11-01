// Sidebar panels: Outline (built in app.js) · Files (open folder + bookmarks) · Search (find and replace
// in folder) · Highlights (rendered by highlights.js) · History (history-ui.js).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseName = (p) => p.split(/[\\/]/).pop();

export function createSidebar(ctx) {
  const { api } = ctx;
  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: document.querySelector('.side-tabs'), files: $('files-body'), folderName: $('folder-name'),
    filesFilter: $('files-filter'), search: $('folder-search'), summary: $('search-summary'), results: $('search-results'),
  };
  let folder = null;              // { root, name, tree, count, truncated }
  let panel = 'outline';
  let bookmarks = [];

  // ---------------------------------------------------------------- switching panels
  function show(name) {
    panel = name;
    for (const b of els.tabs.querySelectorAll('button')) {
      const on = b.dataset.panel === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const p of document.querySelectorAll('.side-panel')) p.hidden = p.dataset.panel !== name;
    if (name === 'search') { els.search.focus(); els.search.select(); }
    if (name === 'highlights') ctx.renderHighlights();
    if (name === 'history') ctx.renderHistory();
  }
  els.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-panel]'); if (b) show(b.dataset.panel); });
  // Arrow keys move between the panel tabs (the usual keyboard pattern for tabs).
  els.tabs.addEventListener('keydown', (e) => {
    const list = [...els.tabs.querySelectorAll('button[data-panel]')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const b = list[(next + list.length) % list.length];
    show(b.dataset.panel);
    b.focus();
  });

  // ---------------------------------------------------------------- files: folder tree + bookmarks
  function fileButton(path, label, sub = '') {
    const b = document.createElement('button');
    b.className = 'file-item';
    b.dataset.path = path;
    b.title = path;
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><span class="file-name">${esc(label)}</span>${sub ? `<span class="file-sub">${esc(sub)}</span>` : ''}`;
    b.onclick = () => ctx.openPath(path);
    return b;
  }

  function dirNode(node, depth) {
    const det = document.createElement('details');
    det.className = 'tree-dir';
    det.open = depth < 2;                    // the folder and its first level of subfolders start expanded
    det.innerHTML = `<summary><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>${esc(node.name)}</summary>`;
    for (const d of node.dirs) det.appendChild(dirNode(d, depth + 1));
    for (const f of node.files) { const b = fileButton(f.path, f.name); if (f.locked) b.classList.add('locked'); det.appendChild(b); }
    return det;
  }

  function flatFiles(node, out = []) {
    for (const f of node.files) out.push(f);
    for (const d of node.dirs) flatFiles(d, out);
    return out;
  }

  function renderFiles() {
    const q = els.filesFilter.value.trim().toLowerCase();
    const box = els.files;
    box.replaceChildren();
    if (bookmarks.length) {
      const group = document.createElement('div');
      group.className = 'file-group';
      group.innerHTML = '<div class="group-head">★ Bookmarks</div>';
      for (const p of bookmarks) if (!q || p.toLowerCase().includes(q)) group.appendChild(fileButton(p, baseName(p)));
      box.appendChild(group);
    }
    if (!folder) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.innerHTML = 'Open a folder to browse all of its Markdown files here.<br><button class="big-btn sm" id="files-open-folder">Open Folder…</button>';
      box.appendChild(empty);
      empty.querySelector('button').onclick = () => api.openFolder();
      markActive();
      return;
    }
    if (q) {
      const matches = flatFiles(folder.tree).filter((f) => f.path.toLowerCase().slice(folder.root.length).includes(q));
      const list = document.createElement('div');
      list.className = 'file-group';
      for (const f of matches.slice(0, 300)) list.appendChild(fileButton(f.path, f.name, f.path.slice(folder.root.length + 1, -f.name.length - 1)));
      if (!matches.length) list.innerHTML = '<div class="side-empty">No files match.</div>';
      box.appendChild(list);
    } else {
      const tree = dirNode(folder.tree, 0);
      tree.open = true;
      tree.classList.add('tree-root');
      box.appendChild(tree);
      if (!folder.count) box.insertAdjacentHTML('beforeend', '<div class="side-empty">No Markdown files in this folder.</div>');
      if (folder.truncated) box.insertAdjacentHTML('beforeend', `<div class="side-empty">Showing the first ${folder.count} files.</div>`);
    }
    markActive();
  }

  function markActive() {
    const p = ctx.activeTab()?.doc?.path?.toLowerCase();
    for (const b of els.files.querySelectorAll('.file-item')) {
      const on = !!p && b.dataset.path.toLowerCase() === p;
      b.classList.toggle('active', on);
      if (on) { let d = b.parentElement; while (d && d !== els.files) { if (d.tagName === 'DETAILS') d.open = true; d = d.parentElement; } }
    }
  }

  function setFolder(info) {
    folder = info || null;
    document.body.classList.toggle('has-folder', !!folder);
    els.folderName.textContent = folder ? folder.name : 'No folder open';
    els.folderName.title = folder ? folder.root : '';
    $('folder-refresh').hidden = !folder;
    $('folder-close').hidden = !folder;
    renderFiles();
    if (folder && els.search.value.trim()) runSearch();
  }

  els.filesFilter.addEventListener('input', renderFiles);
  $('folder-refresh').onclick = async () => setFolder(await api.refreshFolder());
  $('folder-close').onclick = () => { api.closeFolder(); setFolder(null); };
  api.onFolderOpened((info) => { setFolder(info); show('files'); });
  api.onFolderChanged((info) => { if (folder && info.root === folder.root) setFolder(info); });

  // ---------------------------------------------------------------- find in folder
  let searchTimer = 0;
  let searchSeq = 0;
  async function runSearch() {
    if (replacing && preview) return;          // a replace preview is showing; typing clears it first
    const q = els.search.value.trim();
    const seq = ++searchSeq;
    els.results.replaceChildren();
    if (!q) { els.summary.textContent = ''; return; }
    if (!folder) {
      els.summary.innerHTML = 'Find in Folder searches every Markdown file in an open folder. <button class="link-btn" id="search-open-folder">Open a folder</button>';
      $('search-open-folder').onclick = () => api.openFolder();
      return;
    }
    els.summary.textContent = 'Searching…';
    const res = await api.searchFolder(q);
    if (seq !== searchSeq) return;
    els.summary.textContent = res.total
      ? `${res.total}${res.truncated ? '+' : ''} result${res.total === 1 ? '' : 's'} in ${res.results.length} file${res.results.length === 1 ? '' : 's'}`
      : 'No results.';
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const file of res.results) {
      const group = document.createElement('div');
      group.className = 'search-file';
      group.innerHTML = `<div class="search-file-head" title="${esc(file.path)}">${esc(file.name)}<span class="file-sub">${esc(file.rel.slice(0, -file.name.length - 1))}</span></div>`;
      for (const m of file.matches) {
        const b = document.createElement('button');
        b.className = 'search-hit';
        b.innerHTML = `<span class="hit-line">${m.line + 1}</span><span class="hit-text">${esc(m.text).replace(re, (x) => `<mark>${x}</mark>`)}</span>`;
        b.onclick = () => ctx.openAtLine(file.path, m.line, q);
        group.appendChild(b);
      }
      els.results.appendChild(group);
    }
  }
  els.search.addEventListener('input', () => { dropPreview(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  els.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); if (replacing) runPreview(); else runSearch(); } });

  // ---------------------------------------------------------------- replace in folder
  // Preview first (every match, with tick-boxes), then the main process asks, backs each file up, keeps
  // its old version in History and writes. Undo puts the whole batch back.
  const rep = {
    box: $('replace-box'), toggle: $('replace-toggle'), input: $('folder-replace'), regex: $('rep-regex'),
    matchCase: $('rep-case'), word: $('rep-word'), preview: $('rep-preview'), undo: $('rep-undo'),
  };
  let replacing = false;
  let preview = null;              // { results, total, truncated }
  let chosen = new Map();          // path -> Set of match indexes

  function setReplacing(on) {
    replacing = on;
    rep.box.hidden = !on;
    rep.toggle.textContent = on ? 'Hide replace' : 'Replace…';
    rep.toggle.setAttribute('aria-expanded', String(on));
    if (on) { (els.search.value.trim() ? rep.input : els.search).focus(); }
    else { dropPreview(); runSearch(); }
  }
  rep.toggle.onclick = () => setReplacing(!replacing);

  function dropPreview() {
    if (!preview) return;
    preview = null;
    chosen = new Map();
    if (replacing) els.summary.textContent = 'Press Preview changes to see every match before anything changes.';
  }
  for (const el of [rep.input, rep.regex, rep.matchCase, rep.word]) el.addEventListener('input', () => { if (preview) { dropPreview(); runSearch(); } });
  rep.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPreview(); } });
  rep.preview.onclick = () => runPreview();

  async function runPreview() {
    const find = els.search.value;
    if (!folder) { els.summary.textContent = 'Open a folder first: Replace changes the Markdown files in it.'; return; }
    if (!find.trim()) { els.search.focus(); return; }
    els.summary.textContent = 'Looking for matches…';
    const res = await api.replacePreview({ find, replacement: rep.input.value, opts: { regex: rep.regex.checked, matchCase: rep.matchCase.checked, wholeWord: rep.word.checked } });
    if (!res.ok) { els.summary.textContent = res.error; els.results.replaceChildren(); preview = null; return; }
    preview = res;
    const unsaved = new Set(ctx.unsavedPaths().map((p) => p.toLowerCase()));
    chosen = new Map(res.results.filter((f) => !unsaved.has(f.path.toLowerCase())).map((f) => [f.path, new Set(f.matches.map((m) => m.i))]));
    renderPreview(unsaved);
  }

  function chosenCount() { let n = 0; for (const set of chosen.values()) n += set.size; return n; }

  function renderPreview(unsaved) {
    els.results.replaceChildren();
    if (!preview.total) { els.summary.textContent = 'No matches.'; return; }
    els.summary.textContent = `${preview.total}${preview.truncated ? '+' : ''} match${preview.total === 1 ? '' : 'es'} in ${preview.results.length} file${preview.results.length === 1 ? '' : 's'} — untick any you want to keep.`;
    const applyBtn = document.createElement('button');
    applyBtn.className = 'big-btn sm replace-apply';
    const sync = () => {
      const n = chosenCount();
      applyBtn.textContent = n ? `Replace ${n}` : 'Nothing ticked';
      applyBtn.disabled = !n;
    };
    for (const file of preview.results) {
      const blocked = unsaved.has(file.path.toLowerCase());
      const group = document.createElement('div');
      group.className = 'search-file replace-file';
      const head = document.createElement('label');
      head.className = 'search-file-head';
      head.title = file.path;
      const all = document.createElement('input');
      all.type = 'checkbox';
      all.checked = !blocked;
      all.disabled = blocked;
      all.setAttribute('aria-label', `Replace in ${file.rel}`);
      head.append(all, document.createTextNode(file.rel.split(/[\\/]/).pop()));
      head.insertAdjacentHTML('beforeend', `<span class="file-sub">${esc(blocked ? 'unsaved edits — save first' : file.rel.split(/[\\/]/).slice(0, -1).join('/'))}</span>`);
      group.appendChild(head);
      const boxes = [];
      for (const m of file.matches) {
        const row = document.createElement('div');
        row.className = 'search-hit replace-hit';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !blocked;
        box.disabled = blocked;
        box.setAttribute('aria-label', `Line ${m.line + 1}: replace “${m.found}” with “${m.replacement}”`);
        box.onchange = () => {
          const set = chosen.get(file.path) || new Set();
          if (box.checked) set.add(m.i); else set.delete(m.i);
          chosen.set(file.path, set);
          all.checked = set.size === file.matches.length;
          all.indeterminate = set.size > 0 && set.size < file.matches.length;
          sync();
        };
        boxes.push(box);
        const text = document.createElement('button');
        text.className = 'hit-open';
        text.title = 'Show this line';
        text.innerHTML = `<span class="hit-line">${m.line + 1}</span><span class="hit-text">${esc(m.prefix)}<del>${esc(m.found)}</del><ins>${esc(m.replacement)}</ins>${esc(m.suffix)}</span>`;
        text.onclick = () => ctx.openAtLine(file.path, m.line, m.found);
        row.append(box, text);
        group.appendChild(row);
      }
      all.onchange = () => {
        chosen.set(file.path, new Set(all.checked ? file.matches.map((m) => m.i) : []));
        for (const b of boxes) b.checked = all.checked;
        all.indeterminate = false;
        sync();
      };
      els.results.appendChild(group);
    }
    applyBtn.onclick = applyPreview;
    const foot = document.createElement('div');
    foot.className = 'replace-foot';
    foot.appendChild(applyBtn);
    els.results.appendChild(foot);
    sync();
  }

  async function applyPreview() {
    const payload = {};
    for (const [p, set] of chosen) if (set.size) payload[p] = [...set];
    const res = await api.replaceApply({ chosen: payload });
    if (res.canceled) return;
    if (!res.ok) { els.summary.textContent = res.error || 'Nothing was replaced.'; return; }
    const skipped = res.skipped?.length ? ` ${res.skipped.length} file${res.skipped.length === 1 ? ' was' : 's were'} skipped (changed meanwhile or read-only).` : '';
    ctx.toast(`Replaced ${res.replaced} in ${res.files} file${res.files === 1 ? '' : 's'}.${skipped}`);
    preview = null;
    chosen = new Map();
    rep.undo.hidden = !res.files;
    els.summary.textContent = `Replaced ${res.replaced} in ${res.files} file${res.files === 1 ? '' : 's'}.${skipped}`;
    els.results.replaceChildren();
  }

  rep.undo.onclick = async () => {
    const res = await api.replaceUndo();
    if (res.canceled) return;
    if (!res.ok) { ctx.toast(res.error || 'Nothing to undo'); rep.undo.hidden = true; return; }
    rep.undo.hidden = true;
    ctx.toast(`Put back ${res.restored} file${res.restored === 1 ? '' : 's'}${res.skipped?.length ? ` (${res.skipped.length} changed since, left alone)` : ''}`);
    runSearch();
  };

  return {
    show,
    setFolder,
    markActive,
    folder: () => folder,
    allFiles: () => (folder ? flatFiles(folder.tree).map((f) => ({ path: f.path, name: f.name, rel: f.path.slice(folder.root.length + 1) })) : []),
    setBookmarks(list) { bookmarks = list || []; renderFiles(); },
    findInFolder() { ctx.showSidebar(); show('search'); },
    replaceInFolder() { ctx.showSidebar(); show('search'); if (!replacing) setReplacing(true); else rep.input.focus(); },
    panel: () => panel,
  };
}
