// Sidebar panels: Outline (built in app.js) · Files (open folder + bookmarks) · Search (find in folder)
// · Highlights (rendered by highlights.js).
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
    for (const b of els.tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.panel === name);
    for (const p of document.querySelectorAll('.side-panel')) p.hidden = p.dataset.panel !== name;
    if (name === 'search') { els.search.focus(); els.search.select(); }
    if (name === 'highlights') ctx.renderHighlights();
  }
  els.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-panel]'); if (b) show(b.dataset.panel); });

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
    for (const f of node.files) det.appendChild(fileButton(f.path, f.name));
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
  els.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  els.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });

  return {
    show,
    setFolder,
    markActive,
    folder: () => folder,
    allFiles: () => (folder ? flatFiles(folder.tree).map((f) => ({ path: f.path, name: f.name, rel: f.path.slice(folder.root.length + 1) })) : []),
    setBookmarks(list) { bookmarks = list || []; renderFiles(); },
    findInFolder() { ctx.showSidebar(); show('search'); },
    panel: () => panel,
  };
}
