// Citations (3.6) in the page: where sources come from, and the window for choosing a library and a style
// and inserting a citation. Files and Zotero are read by the main process (src/main/bibliography.js);
// the formatting is in citations.js.
import { STYLES, styleKey, pickerLine, searchSources } from './citations.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 200;

/** The bibliography files a document names in its front matter. */
export function bibliographyOf(frontMatter) {
  const v = frontMatter?.bibliography;
  return (Array.isArray(v) ? v : v ? [v] : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

/** The text a citation adds to a document. */
export function citationText(key, page = '') {
  const p = String(page).trim();
  if (!p) return `[@${key}]`;
  return `[@${key}, ${/^\d/.test(p) ? `p. ${p}` : p}]`;
}

/**
 * @param {{ api: any, toast: (m: string) => void, activeTab: () => any, settings: () => any, rerenderAll: () => void, rerenderDoc: (path: string) => void }} ctx
 */
export function createCiteUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('cite-dlg');
  let library = { source: '', name: '', entries: [] };
  const files = new Map();        // "<document>|<bibliography>" -> { entries, stamp, checked, error }
  let shownStyle = null;
  let shownLibrary = null;

  function askFile(docPath, rel) {
    const key = `${docPath}|${rel}`;
    const known = files.get(key);
    if (known?.busy || (known && Date.now() - known.checked < 2000)) return;
    files.set(key, { ...known, busy: true, checked: Date.now() });
    api.citeFile({ docPath, rel }).then((res) => {
      const changed = res?.stamp !== known?.stamp || !!res?.error !== !!known?.error;
      files.set(key, { entries: res?.entries || [], stamp: res?.stamp, error: res?.error || '', checked: Date.now() });
      if (res?.error && !known?.error) toast(res.error);
      if (changed) ctx.rerenderDoc(docPath);
    });
  }

  /** Sources for one document: its own bibliography over your library. */
  function sourcesFor(doc, frontMatter) {
    const named = doc?.path ? bibliographyOf(frontMatter) : [];
    const sources = new Map(library.entries.map((e) => [e.id, e]));
    let loaded = false;
    for (const rel of named) {
      askFile(doc.path, rel);
      const file = files.get(`${doc.path}|${rel}`);
      if (file?.entries && !file.error) { loaded = true; for (const e of file.entries) sources.set(e.id, e); }
    }
    return { sources, named: named.length > 0, loaded };
  }

  /** For render(): what this document can cite, once its front matter is known. */
  const forDoc = (doc) => (frontMatter) => {
    const { sources, named, loaded } = sourcesFor(doc, frontMatter);
    if (!sources.size && !loaded) return null;
    return { sources, style: styleKey(frontMatter?.['citation-style'] ?? frontMatter?.csl, ctx.settings().citeStyle), strict: named && loaded };
  };

  async function loadLibrary() {
    library = await api.citeLibrary() || library;
    if (library.error) toast(library.error);
    paintSource();
  }

  /** Called with each change of settings: a new style or library redraws what's on screen. */
  async function settingsChanged(s) {
    const first = shownStyle === null;
    const style = s.citeStyle;
    const lib = s.citeLibrary;
    const newLibrary = lib !== shownLibrary;
    const newStyle = style !== shownStyle;
    shownStyle = style;
    shownLibrary = lib;
    if (newLibrary) await loadLibrary();
    if (!first && (newStyle || newLibrary)) ctx.rerenderAll();
    else if (first && library.entries.length) ctx.rerenderAll();
  }

  // ---------------------------------------------------------------- the window
  function allSources() {
    const tab = ctx.activeTab();
    const own = tab?.result?.frontMatter && tab.doc.path ? sourcesFor(tab.doc, tab.result.frontMatter).sources : null;
    return [...(own || new Map(library.entries.map((e) => [e.id, e]))).values()];
  }

  function paintSource() {
    const n = library.entries.length;
    const where = library.source === 'zotero' ? 'Zotero' : library.name;
    $('cite-source').textContent = where ? `${where} · ${n}` : 'No library chosen yet';
    $('cite-refresh').hidden = library.source !== 'zotero';
    $('cite-remove').hidden = !library.source;
  }

  function paintList() {
    const list = $('cite-list');
    list.replaceChildren();
    const all = allSources().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const found = searchSources(all, $('cite-search').value);
    for (const e of found.slice(0, MAX_ROWS)) {
      const line = pickerLine(e);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cite-row';
      row.setAttribute('translate', 'no');
      const head = document.createElement('b');
      head.textContent = [line.who, line.year].filter(Boolean).join(', ') || e.id;
      const title = document.createElement('span');
      title.textContent = line.title;
      row.append(head, title);
      row.onclick = () => use(e);
      list.appendChild(row);
    }
    $('cite-none').hidden = found.length > 0;
    $('cite-none').textContent = all.length ? 'No sources match.' : 'Choose a BibTeX or CSL JSON file, or use your Zotero library, and your sources will appear here.';
  }

  const editing = () => !!ctx.activeTab()?.editor?.view;

  function paintStyle() {
    const tab = ctx.activeTab();
    const box = $('cite-style');
    box.value = styleKey(ctx.settings().citeStyle);
    const fixed = tab?.result?.frontMatter?.['citation-style'] ?? tab?.result?.frontMatter?.csl;
    $('cite-style-note').hidden = !fixed;
    $('cite-hint').textContent = editing() ? '' : 'Choosing a source copies its citation. While editing, it goes in at the cursor.';
  }

  async function use(entry) {
    const text = citationText(entry.id, $('cite-page').value);
    const view = ctx.activeTab()?.editor?.view;
    dlg.close();
    if (!view) {
      await api.copyText(text);
      toast(`Copied ${text}`);
      return;
    }
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    view.focus();
  }

  async function open() {
    if (dlg.open) return;
    await loadLibrary();
    $('cite-search').value = '';
    $('cite-page').value = '';
    paintStyle();
    paintList();
    $('cite-msg').textContent = bibliographyOf(ctx.activeTab()?.result?.frontMatter).length ? 'This document’s own bibliography is listed here too.' : '';
    dlg.showModal();
    $('cite-search').focus();
  }

  async function after(res) {
    if (res?.error) { $('cite-msg').textContent = res.error; return; }
    $('cite-msg').textContent = '';
    if (res) { library = res; paintSource(); paintList(); ctx.rerenderAll(); }
  }

  const box = $('cite-style');
  box.replaceChildren(...Object.entries(STYLES).map(([key, s]) => { const o = document.createElement('option'); o.value = key; o.textContent = s.name; return o; }));
  box.onchange = () => api.setSettings({ citeStyle: box.value });
  $('cite-search').addEventListener('input', paintList);
  $('cite-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('cite-list').firstElementChild?.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('cite-list').firstElementChild?.focus(); }
  });
  $('cite-list').addEventListener('keydown', (e) => {
    const row = e.target.closest('.cite-row');
    if (!row) return;
    const next = e.key === 'ArrowDown' ? row.nextElementSibling : e.key === 'ArrowUp' ? (row.previousElementSibling || $('cite-search')) : null;
    if (next) { e.preventDefault(); next.focus(); }
  });
  $('cite-choose').onclick = async () => after(await api.citeChoose());
  $('cite-zotero').onclick = async () => {
    $('cite-msg').textContent = 'Reading your Zotero library…';
    after(await api.citeZotero());
  };
  $('cite-refresh').onclick = $('cite-zotero').onclick;
  $('cite-remove').onclick = async () => after(await api.citeClear());
  $('cite-close').onclick = () => dlg.close();

  return {
    forDoc, open, settingsChanged,
    /** For the editor's list after [@ : every source this document can use. */
    targets: () => allSources().map((e) => ({ key: e.id, ...pickerLine(e) })),
  };
}
