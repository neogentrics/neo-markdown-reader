// Edit mode: a Markdown editor beside the live preview, for one tab at a time.
// Permission, saving, backups and conflict checks all happen in the main process (src/main/editing.js);
// this module only asks for them and keeps the editor, preview and tab state in step.
import { TEMPLATES } from './templates.js';

/**
 * @param {object} ctx  hooks into the tab system in app.js
 * @param {any} ctx.api
 * @param {() => any} ctx.activeTab
 * @param {(doc:any, opts?:any) => Promise<any>} ctx.openInTab
 * @param {(tab:any, doc:any, opts?:{preview?:boolean}) => Promise<void>} ctx.renderInto
 * @param {(tab:any) => void} ctx.updateTabButton
 * @param {() => void} ctx.showActiveDoc
 * @param {(msg:string) => void} ctx.toast
 * @param {() => void} ctx.syncSoon
 * @param {() => string} ctx.platform
 * @param {HTMLElement} ctx.desk
 */
export function createEditMode(ctx) {
  const { api } = ctx;
  const $ = (id) => document.getElementById(id);
  const els = {
    pane: $('editor-pane'), editors: $('editors'), fmt: $('fmt-bar'), status: $('edit-status'),
    edit: $('btn-edit'), editLabel: document.querySelector('#btn-edit .edit-label'), save: $('btn-save'),
    banner: $('disk-banner'), grants: $('grants'), grantsBody: $('grants-body'),
  };
  let untitledCount = 0;

  // ---------------------------------------------------------------- loading the editor bundle
  let kitLoading = null;
  function loadKit() {
    kitLoading ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'editor.js';
      s.onload = () => resolve(window.__editorKit);
      s.onerror = () => { kitLoading = null; reject(new Error('The editor failed to load')); };
      document.head.appendChild(s);
    });
    return kitLoading;
  }

  // ---------------------------------------------------------------- live preview
  function schedulePreview(tab) {
    clearTimeout(tab.previewTimer);
    tab.previewTimer = setTimeout(async () => {
      await ctx.renderInto(tab, { ...tab.doc, content: tab.editor.getText() }, { preview: true });
      if (tab === ctx.activeTab()) { ctx.showActiveDoc(); syncPreviewTo(tab, tab.topLine || 0); }
    }, 220);
  }

  /** Scroll the preview so the block the editor shows at its top is at the top of the preview. */
  function syncPreviewTo(tab, line) {
    tab.topLine = line;
    if (tab !== ctx.activeTab()) return;
    let best = null;
    for (const el of tab.el.querySelectorAll('[data-line]')) {
      if (Number(el.dataset.line) <= line) best = el; else break;
    }
    if (!best) { ctx.desk.scrollTop = 0; return; }
    const top = best.getBoundingClientRect().top - ctx.desk.getBoundingClientRect().top + ctx.desk.scrollTop - 16;
    ctx.desk.scrollTop = Math.max(0, top);
  }

  // ---------------------------------------------------------------- entering / leaving edit mode
  async function enter(tab) {
    if (!tab || tab.editing) { tab?.editor?.focus(); return; }
    if (tab.doc.compare) { ctx.toast('A comparison can’t be edited — open the document itself to edit it'); return; }
    if (tab.doc.needsPassword) { ctx.toast('Unlock the document first'); return; }
    ctx.beforeEdit?.();                      // e.g. close split view to make room for the editor
    if (!tab.untitled) {
      const res = await api.requestEdit(tab.doc.path);
      if (!res.ok) {
        if (res.reason === 'cancelled') ctx.toast('Still read-only — nothing was changed');
        if (res.reason === 'readonly') { tab.doc.writable = false; refresh(); }
        return;
      }
      if (res.scope === 'file' || res.scope === 'folder') ctx.toast(`Editing allowed — remembered for this ${res.scope}`);
    }
    let kit;
    try { kit = await loadKit(); } catch (err) { ctx.toast(err.message); return; }
    tab.host = document.createElement('div');
    tab.host.className = 'editor-host';
    els.editors.appendChild(tab.host);
    tab.savedText = tab.doc.content;
    tab.baseMtime = tab.doc.mtime;
    tab.editing = true;
    tab.dirty = false;
    tab.editor = kit.create(tab.host, {
      doc: tab.doc.content,
      onChange: (text) => {
        const dirty = text !== tab.savedText;
        if (dirty !== tab.dirty) { tab.dirty = dirty; ctx.updateTabButton(tab); }
        refresh();
        schedulePreview(tab);
      },
      onTopLine: (line) => syncPreviewTo(tab, line),
    });
    show(tab);
    tab.editor.focus();
  }

  /** Leave edit mode ("Done"). Asks about unsaved changes first. Resolves to false if cancelled. */
  async function exit(tab, { force = false } = {}) {
    if (!tab?.editing) return true;
    if (tab.dirty && !force) {
      const choice = await api.confirmUnsaved({ name: tab.doc.name });
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await save(tab))) return false;
    }
    clearTimeout(tab.previewTimer);
    tab.editor.destroy();
    tab.host.remove();
    tab.editor = null;
    tab.host = null;
    tab.editing = false;
    tab.dirty = false;
    ctx.updateTabButton(tab);
    if (force) return true;                    // the tab is closing anyway
    await ctx.renderInto(tab, tab.doc);        // show the saved version (drops edits that were discarded)
    if (tab === ctx.activeTab()) { ctx.showActiveDoc(); show(tab); }
    return true;
  }

  async function toggle(tab = ctx.activeTab()) {
    if (!tab) return;
    if (tab.editing) await exit(tab); else await enter(tab);
  }

  // ---------------------------------------------------------------- saving
  async function save(tab = ctx.activeTab()) {
    if (!tab) return false;
    if (tab.untitled || !tab.doc.path) return saveAs(tab);
    if (!tab.editing) { ctx.toast('Nothing to save — click Edit to make changes'); return true; }
    const content = tab.editor.getText();
    const payload = { path: tab.doc.path, content, baseMtime: tab.baseMtime, eol: tab.doc.eol, bom: tab.doc.bom };
    let res = await api.save(payload);
    if (!res.ok && res.reason === 'not-allowed') {
      // e.g. the tab moved to another window: ask again, then retry once.
      const again = await api.requestEdit(tab.doc.path);
      if (again.ok) res = await api.save(payload);
    }
    if (!res.ok) {
      const why = { conflict: 'Not saved — the file was changed by another program', readonly: 'Not saved — the file is read-only', 'not-allowed': 'Not saved — editing wasn’t allowed' };
      ctx.toast(why[res.reason] || 'Couldn’t save the file');
      return false;
    }
    tab.savedText = content;
    tab.baseMtime = res.mtime;
    tab.doc = { ...tab.doc, content, mtime: res.mtime };
    tab.dirty = tab.editor.getText() !== tab.savedText;
    els.banner.hidden = true;
    ctx.updateTabButton(tab);
    refresh();
    ctx.toast(res.backup ? 'Saved — the original was backed up first' : 'Saved');
    return true;
  }

  async function saveAs(tab = ctx.activeTab()) {
    if (!tab) return false;
    const content = tab.editing ? tab.editor.getText() : tab.doc.content;
    let name = tab.doc.name;
    if (!/\.(md|markdown)$/i.test(name)) name = name.replace(/\.[^.]*$/, '') + '.md';     // .txt → .md
    const res = await api.saveAs({ content, suggestedName: name, defaultDir: tab.doc.dir || undefined, eol: tab.doc.eol, bom: tab.doc.bom });
    if (!res.ok) { if (res.reason !== 'cancelled') ctx.toast('Couldn’t save the file'); return false; }
    const { doc } = res;
    tab.untitled = false;
    tab.doc = { ...doc, content };
    tab.savedText = content;
    tab.baseMtime = doc.mtime;
    tab.dirty = tab.editing ? tab.editor.getText() !== content : false;
    tab.history = [];
    await ctx.renderInto(tab, tab.editing ? { ...tab.doc, content: tab.editor.getText() } : tab.doc, { preview: tab.editing });
    ctx.updateTabButton(tab);
    if (tab === ctx.activeTab()) ctx.showActiveDoc();
    refresh();
    ctx.syncSoon();
    ctx.toast(`Saved as ${doc.name}`);
    return true;
  }

  // ---------------------------------------------------------------- new documents
  async function newDocument(templateKey = 'blank') {
    const t = TEMPLATES[templateKey] || TEMPLATES.blank;
    untitledCount += 1;
    const name = templateKey === 'blank' ? `Untitled-${untitledCount}.md` : `${t.name}.md`;
    const doc = {
      path: null, name, dir: '', baseUrl: '', content: t.content(), mtime: NaN,
      eol: ctx.platform() === 'win32' ? '\r\n' : '\n', bom: false, writable: true, position: 0,
    };
    const tab = await ctx.openInTab(doc, { duplicate: true, scroll: 0 });
    tab.untitled = true;
    ctx.updateTabButton(tab);
    await enter(tab);
    // A template starts "unsaved" so closing it asks first; a blank document doesn't until you type.
    if (templateKey !== 'blank') { tab.savedText = ''; tab.dirty = true; ctx.updateTabButton(tab); refresh(); }
  }

  // ---------------------------------------------------------------- outside changes while editing
  /** The file changed on disk. Returns true if edit mode handled it (so the reader must not re-render). */
  function onDiskChange(tab, doc) {
    if (!tab.editing) return false;
    if (!tab.dirty) {
      // Nothing to lose: take the new version quietly.
      tab.doc = { ...tab.doc, ...doc };
      tab.savedText = doc.content;
      tab.baseMtime = doc.mtime;
      tab.editor.setText(doc.content);
      tab.dirty = false;
      ctx.updateTabButton(tab);
      refresh();
      return true;
    }
    tab.pendingDisk = doc;
    if (tab === ctx.activeTab()) els.banner.hidden = false;
    return true;
  }
  $('disk-load').onclick = () => {
    const tab = ctx.activeTab();
    const doc = tab?.pendingDisk;
    if (!doc) return;
    tab.pendingDisk = null;
    els.banner.hidden = true;
    tab.doc = { ...tab.doc, ...doc };
    tab.savedText = doc.content;
    tab.baseMtime = doc.mtime;
    tab.editor.setText(doc.content);
    tab.dirty = false;
    ctx.updateTabButton(tab);
    refresh();
  };
  $('disk-keep').onclick = () => {
    // Keep editing; saving later will warn that it replaces the other program's changes.
    const tab = ctx.activeTab();
    if (tab) tab.pendingDisk = null;
    els.banner.hidden = true;
  };

  // ---------------------------------------------------------------- chrome
  /** Show the right editor (or none) for the active tab and update the toolbar. */
  function show(tab = ctx.activeTab()) {
    for (const host of els.editors.children) host.hidden = host !== tab?.host;
    const editing = !!tab?.editing;
    document.body.classList.toggle('editing', editing);
    els.pane.hidden = !editing;
    els.banner.hidden = !(editing && tab.pendingDisk);
    refresh();
  }

  function refresh() {
    const tab = ctx.activeTab();
    els.edit.hidden = !tab || !!tab.doc.compare;           // comparisons are read-only views
    els.save.hidden = !tab?.editing;
    if (!tab) return;
    const locked = !tab.untitled && tab.doc.writable === false && !tab.editing;
    els.edit.classList.toggle('editing', !!tab.editing);
    els.edit.classList.toggle('locked', locked);
    els.editLabel.textContent = tab.editing ? 'Done' : locked ? 'Read-only' : 'Edit';
    els.edit.title = tab.editing ? 'Finish editing (Ctrl+E)' : locked ? 'This file is read-only. Use File → Save As… to edit a copy.' : 'Edit this document (Ctrl+E)';
    els.save.disabled = !!tab.editing && !tab.dirty && !tab.untitled;
    if (tab.editing) {
      els.status.textContent = tab.untitled ? 'Not saved yet' : tab.dirty ? 'Unsaved changes' : 'All changes saved';
      els.status.classList.toggle('dirty', !!tab.dirty || !!tab.untitled);
    }
  }

  els.edit.onclick = () => toggle();
  els.save.onclick = () => save();
  els.fmt.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });   // keep editor focus
  els.fmt.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmd]');
    const tab = ctx.activeTab();
    if (b && tab?.editing) tab.editor.run(b.dataset.cmd);
  });

  // ---------------------------------------------------------------- editing permissions dialog
  async function showGrants() {
    const g = await api.listGrants();
    const section = (title, kind, list) => {
      const wrap = document.createElement('div');
      wrap.className = 'grants-group';
      wrap.innerHTML = `<h4>${title}</h4>`;
      if (!list.length) { wrap.insertAdjacentHTML('beforeend', '<div class="grants-empty">None</div>'); return wrap; }
      const ul = document.createElement('ul');
      for (const value of list) {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = value;
        const btn = document.createElement('button');
        btn.className = 'link-btn';
        btn.textContent = 'Remove';
        btn.onclick = async () => { await api.revokeGrant(kind, value); showGrants(); };
        li.append(span, btn);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      return wrap;
    };
    els.grantsBody.replaceChildren(section('Always allowed files', 'files', g.files), section('Always allowed folders', 'folders', g.folders));
    if (!els.grants.open) els.grants.showModal();
  }
  $('grants-close').onclick = () => els.grants.close();
  $('grants-backups').onclick = () => api.openBackups();

  return {
    enter, exit, toggle, save, saveAs, newDocument, onDiskChange, show, refresh, showGrants,
    /** Does this tab hold work that would be lost if it closed now? */
    hasUnsaved: (t) => !!t.editing && (t.dirty || (t.untitled && !!t.editor?.getText().trim())),
  };
}
