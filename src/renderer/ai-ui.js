// AI assist in the page: the settings dialog and the panel that shows Claude's answer as it streams.
// Requests are made by the main process (src/main/ai.js) with the reader's own API key.

import { diffWordsWithSpace } from 'diff';

const $ = (id) => document.getElementById(id);
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EDIT_TITLES = { proofread: 'Proofread', rewrite: 'Rewrite', shorten: 'Shorten', translate: 'Translate' };
const TITLES = { summarize: 'Summary', explain: 'Explanation', report: 'Report draft' };

export function createAiUi(ctx) {
  const { api, render, toast } = ctx;
  const dlg = $('ai-dlg');
  const panel = $('ai-panel');
  const body = $('ai-body');
  let current = null;            // { id, action, text, tab }
  let paint = 0;

  // ---------------------------------------------------------------- settings
  async function openSettings(reason = '') {
    const st = await api.aiStatus();
    $('ai-enabled').checked = !!st.enabled;
    $('ai-key').value = '';
    $('ai-key').placeholder = st.hasKey ? 'A key is saved — type a new one to replace it' : 'sk-ant-…';
    $('ai-key-remove').hidden = !st.hasKey;
    $('ai-insecure').hidden = !!st.secure;
    const sel = $('ai-model');
    sel.innerHTML = '';
    for (const m of st.models) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.appendChild(o); }
    sel.value = st.model;
    $('ai-msg').textContent = reason;
    if (!dlg.open) dlg.showModal();
  }
  $('ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api.aiConfigure({ enabled: $('ai-enabled').checked, apiKey: $('ai-key').value, model: $('ai-model').value });
    if (res?.error) { $('ai-msg').textContent = res.error; return; }
    if (res.enabled && !res.hasKey) { $('ai-msg').textContent = 'Enter your API key to turn AI assist on.'; return; }
    dlg.close();
    toast(res.enabled ? (res.stored === 'session' ? 'AI assist is on — the key is kept until you quit' : 'AI assist is on') : 'AI assist is off');
  });
  $('ai-cancel').addEventListener('click', () => dlg.close());
  $('ai-key-remove').addEventListener('click', async () => {
    await api.aiConfigure({ clearKey: true, enabled: false });
    toast('API key removed — AI assist is off');
    dlg.close();
  });
  $('ai-get-key').addEventListener('click', (e) => { e.preventDefault(); api.openExternal('https://console.anthropic.com/settings/keys'); });

  // ---------------------------------------------------------------- running
  api.onAiDelta(({ id, text }) => {
    // Once the finished answer is in, a piece that arrives late must not be added to it again.
    if (!current || current.id !== id || current.done) return;
    current.text += text;
    if (!paint) paint = requestAnimationFrame(() => { paint = 0; show(); });
  });

  function show() {
    if (!current) return;
    body.innerHTML = current.text ? render(citeLinks(current.text)).html : '<p class="ai-wait">Thinking…</p>';
    for (const a of body.querySelectorAll('a[href^="#cite="]')) a.classList.add('cite');
  }

  async function run(action) {
    const tab = ctx.activeTab();
    if (!tab || tab.doc.compare) { toast('Open a document first'); return; }
    if (tab.doc.locked) { toast('AI assist is off for locked documents, so their text never leaves this computer'); return; }
    const st = await api.aiStatus();
    if (!st.enabled || !st.hasKey) { openSettings('Turn on AI assist and add your Anthropic API key to use this.'); return; }
    const selection = action === 'explain' ? ctx.selectionIn(tab) : '';
    if (action === 'explain' && !selection) { toast('Select some text on the page first'); return; }
    if (current) api.aiCancel(current.id);
    const id = Math.random().toString(36).slice(2);
    current = { id, action, text: '', tab };
    $('ai-title').textContent = `${TITLES[action]} — ${tab.doc.name}`;
    $('ai-status').textContent = `Sent to Claude: ${action === 'explain' ? 'the selected passage and the document' : 'this document'}`;
    $('ai-stop').hidden = false;
    $('ai-copy').disabled = $('ai-open').disabled = true;
    $('ai-open').hidden = action !== 'report';
    show();
    if (!panel.open) panel.showModal();
    const res = await api.aiRun({ id, action, text: ctx.textOf(tab), selection, title: tab.result?.title || tab.doc.name, path: tab.doc.path || '' });
    if (!current || current.id !== id) return;
    current.done = true;
    $('ai-stop').hidden = true;
    if (res?.error) {
      $('ai-status').textContent = res.error;
      if (res.setup) { panel.close(); openSettings(res.error); }
      if (!current.text) body.innerHTML = '';
      return;
    }
    current.text = res.text || current.text;
    show();
    $('ai-copy').disabled = $('ai-open').disabled = !current.text;
    $('ai-status').textContent = res.note || 'Written by Claude — check anything important against the document.';
  }

  // ---------------------------------------------------------------- ask about this folder (2.3)
  // The reader ticks which documents go; the answer cites [path:line], which become links that open
  // that document at that line.
  const ask = { dlg: $('ask-dlg'), q: $('ask-question'), filter: $('ask-filter'), files: $('ask-files'), size: $('ask-size') };
  let askFiles = [];
  let askChosen = new Set();
  const LIMIT = 400_000;

  function renderAskFiles() {
    const q = ask.filter.value.trim().toLowerCase();
    ask.files.replaceChildren();
    for (const f of askFiles) {
      if (q && !f.rel.toLowerCase().includes(q)) continue;
      const row = document.createElement('label');
      row.className = 'ask-file';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = askChosen.has(f.path);
      box.onchange = () => { if (box.checked) askChosen.add(f.path); else askChosen.delete(f.path); syncAsk(); };
      const name = document.createElement('span');
      name.textContent = f.rel;
      row.append(box, name);
      ask.files.appendChild(row);
    }
    if (!ask.files.children.length) ask.files.innerHTML = '<div class="side-empty">No documents match.</div>';
    syncAsk();
  }
  function syncAsk() {
    const n = askChosen.size;
    ask.size.textContent = n ? `${n} document${n === 1 ? '' : 's'} will be sent to Claude.` : 'Tick at least one document.';
    $('ask-go').disabled = !n;
  }
  async function askFolder() {
    const folder = ctx.folder();
    if (!folder) { toast('Open a folder first — Claude answers from the documents in it'); return; }
    const st = await api.aiStatus();
    if (!st.enabled || !st.hasKey) { openSettings('Turn on AI assist and add your Anthropic API key to use this.'); return; }
    askFiles = ctx.folderFiles().filter((f) => !/\.mdlock$/i.test(f.path));
    if (!askFiles.length) { toast('No documents in this folder'); return; }
    // Start with the current document and the ones it links with, or everything in a small folder.
    const tab = ctx.activeTab();
    askChosen = new Set(askFiles.length <= 40 ? askFiles.map((f) => f.path) : []);
    if (tab?.doc.path && askFiles.some((f) => f.path === tab.doc.path)) askChosen.add(tab.doc.path);
    ask.filter.value = '';
    renderAskFiles();
    if (!ask.dlg.open) ask.dlg.showModal();
    ask.q.focus();
  }
  ask.filter.addEventListener('input', renderAskFiles);
  $('ask-all').onclick = () => { const q = ask.filter.value.trim().toLowerCase(); for (const f of askFiles) if (!q || f.rel.toLowerCase().includes(q)) askChosen.add(f.path); renderAskFiles(); };
  $('ask-none').onclick = () => { const q = ask.filter.value.trim().toLowerCase(); for (const f of askFiles) if (!q || f.rel.toLowerCase().includes(q)) askChosen.delete(f.path); renderAskFiles(); };
  $('ask-cancel').onclick = () => ask.dlg.close();
  ask.q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask.dlg.querySelector('form').requestSubmit(); } });
  $('ask-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = ask.q.value.trim();
    if (!question) { ask.size.textContent = 'Type a question first.'; ask.q.focus(); return; }
    if (!askChosen.size) return;
    ask.dlg.close();
    if (current) api.aiCancel(current.id);
    const id = Math.random().toString(36).slice(2);
    const root = ctx.folder().root;
    current = { id, action: 'folder', text: '', tab: ctx.activeTab(), root, files: askFiles };
    $('ai-title').textContent = question.length > 70 ? `${question.slice(0, 68)}…` : question;
    $('ai-status').textContent = `Sent to Claude: ${askChosen.size} document${askChosen.size === 1 ? '' : 's'} from ${ctx.folder().name}`;
    $('ai-stop').hidden = false;
    $('ai-copy').disabled = true;
    $('ai-open').hidden = true;
    show();
    if (!panel.open) panel.showModal();
    const res = await api.askFolder({ id, question, paths: [...askChosen] });
    if (!current || current.id !== id) return;
    current.done = true;
    $('ai-stop').hidden = true;
    if (res?.error) {
      $('ai-status').textContent = res.error;
      if (res.setup) { panel.close(); openSettings(res.error); }
      if (!current.text) body.innerHTML = '';
      return;
    }
    current.text = res.text || current.text;
    show();
    $('ai-copy').disabled = !current.text;
    $('ai-status').textContent = res.note || 'Written by Claude from the ticked documents — click a citation to check it.';
  });

  /** [notes/plan.md:12] → a link that opens that line (only for documents that were sent). */
  function citeLinks(md) {
    if (current?.action !== 'folder') return md;
    const known = new Map(current.files.map((f) => [f.rel.replace(/\\/g, '/').toLowerCase(), f]));
    return md.replace(/\[([^\]\n]+?\.(?:md|markdown|mdown|mkdn?|mdwn|mdx|txt)):(\d+)(?:-\d+)?\](?!\()/gi, (all, rel, line) => {
      const f = known.get(rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase());
      return f ? `[${rel.split('/').pop()}:${line}](#cite=${encodeURIComponent(f.rel)}:${line})` : all;
    });
  }

  // ---------------------------------------------------------------- writing help in the editor (2.4)
  // The suggestion is shown as a change (old words struck through, new ones marked) to accept or reject;
  // nothing in the document changes until Accept.
  const ed = { dlg: $('ai-edit-dlg'), diff: $('ai-edit-diff'), status: $('ai-edit-status'), accept: $('ai-edit-accept'), lang: $('ai-edit-lang'), language: $('ai-edit-language') };
  let edit = null;                 // { id, action, tab, from, to, original, text, done, language }
  let editPaint = 0;
  try { ed.language.value = localStorage.getItem('nmr-translate-to') || ''; } catch { /* first time */ }

  function paintEdit() {
    editPaint = 0;
    if (!edit) return;
    if (!edit.text) { ed.diff.innerHTML = `<p class="ai-wait">${edit.started ? 'Thinking…' : ''}</p>`; return; }
    const parts = diffWordsWithSpace(edit.original, edit.done ? edit.text : edit.text.replace(/\S*$/, ''));
    // Changes that are only spacing or line breaks aren't marked: a removed line break would show as a stray mark.
    ed.diff.innerHTML = parts.map((p) => {
      const blank = !p.value.trim();
      if (p.added) return blank ? escHtml(p.value) : `<ins>${escHtml(p.value)}</ins>`;
      if (p.removed) return blank || !edit.done ? '' : `<del>${escHtml(p.value)}</del>`;
      return escHtml(p.value);
    }).join('');
  }

  async function runEdit() {
    const id = Math.random().toString(36).slice(2);
    Object.assign(edit, { id, text: '', done: false, started: true });
    ed.accept.disabled = true;
    ed.status.textContent = `Sent to Claude: the selected text${edit.action === 'translate' ? '' : ' and a little of the text around it'}`;
    paintEdit();
    const res = await api.aiEdit({ id, action: edit.action, text: edit.original, before: edit.before, after: edit.after, language: edit.language, path: edit.tab.doc.path || '' });
    if (!edit || edit.id !== id) return;
    edit.done = true;
    if (res?.error) {
      ed.status.textContent = res.error;
      if (res.setup) { ed.dlg.close(); openSettings(res.error); }
      edit.text = '';
      ed.diff.innerHTML = '';
      return;
    }
    edit.text = res.text || '';
    paintEdit();
    const same = edit.text.trim() === edit.original.trim();
    ed.accept.disabled = !edit.text.trim() || same;
    ed.status.textContent = res.note || (same ? 'No changes suggested.' : 'Suggested by Claude — check it before accepting.');
    if (!ed.accept.disabled) ed.accept.focus();
  }

  async function editSelection(action) {
    const sel = ctx.editorSelection();
    if (!sel) { toast('Click Edit and select some text first'); return; }
    if (!sel.text.trim()) { toast('Select some text in the editor first'); return; }
    if (sel.tab.doc.locked) { toast('AI assist is off for locked documents, so their text never leaves this computer'); return; }
    const st = await api.aiStatus();
    if (!st.enabled || !st.hasKey) { openSettings('Turn on AI assist and add your Anthropic API key to use this.'); return; }
    if (edit) api.aiCancel(edit.id);
    edit = { id: '', action, tab: sel.tab, from: sel.from, to: sel.to, original: sel.text, before: sel.before, after: sel.after, text: '', done: false, language: '' };
    $('ai-edit-h').textContent = `${EDIT_TITLES[action]} — suggested change`;
    ed.diff.innerHTML = '';
    ed.status.textContent = '';
    ed.accept.disabled = true;
    ed.lang.hidden = action !== 'translate';
    $('ai-edit-again').hidden = false;
    if (!ed.dlg.open) ed.dlg.showModal();
    if (action === 'translate') { ed.diff.innerHTML = `<p class="hint-text">${escHtml(sel.text.length > 400 ? `${sel.text.slice(0, 400)}…` : sel.text)}</p>`; ed.language.focus(); ed.language.select(); return; }
    runEdit();
  }

  ed.lang.addEventListener('submit', (e) => {
    e.preventDefault();
    const lang = ed.language.value.trim();
    if (!lang) { ed.language.focus(); return; }
    try { localStorage.setItem('nmr-translate-to', lang); } catch { /* not kept */ }
    edit.language = lang;
    ed.lang.hidden = true;
    runEdit();
  });
  api.onAiDelta(({ id, text }) => {
    if (!edit || edit.id !== id || edit.done) return;
    edit.text += text;
    if (!editPaint) editPaint = requestAnimationFrame(paintEdit);
  });
  ed.accept.onclick = () => {
    if (!edit?.done || !edit.text) return;
    const view = edit.tab.editing && edit.tab.editor?.view;
    if (!view || view.state.sliceDoc(edit.from, edit.to) !== edit.original) {
      toast('That text changed in the meantime — nothing was replaced');
      ed.dlg.close();
      return;
    }
    edit.tab.editor.replaceRange(edit.from, edit.to, edit.text);
    view.dispatch({ selection: { anchor: edit.from, head: edit.from + edit.text.length } });
    ed.dlg.close();
    toast('Change accepted — Ctrl+Z undoes it');
  };
  $('ai-edit-again').onclick = () => { if (edit && (edit.action !== 'translate' || edit.language)) runEdit(); };
  $('ai-edit-reject').onclick = () => ed.dlg.close();
  $('ai-edit-close').onclick = () => ed.dlg.close();
  ed.dlg.addEventListener('close', () => {
    if (ed.dlg.open) return;
    if (edit && !edit.done) api.aiCancel(edit.id);
    const tab = edit?.tab;
    edit = null;
    if (tab?.editing) tab.editor?.focus();
  });

  $('ai-stop').addEventListener('click', () => { if (current) api.aiCancel(current.id); });
  $('ai-close').addEventListener('click', () => panel.close());
  // The dialog's close event arrives a moment after it closes; if a new request already reopened
  // the panel by then, that request must be left alone.
  panel.addEventListener('close', () => {
    if (panel.open) return;
    if (current) api.aiCancel(current.id);
    current = null;
    body.innerHTML = '';
  });
  $('ai-copy').addEventListener('click', async () => { if (current?.text) { await api.copyText(current.text); toast('Copied as Markdown'); } });
  $('ai-open').addEventListener('click', async () => {
    if (!current?.text) return;
    const text = current.text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1');
    const name = `${current.tab.doc.name.replace(/\.[^.]+$/, '')} — report.md`;
    panel.close();
    await ctx.newDocument({ name, content: text });
  });
  // Links in the answer open in the browser, never inside the panel.
  body.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    const cite = /^#cite=(.+):(\d+)$/.exec(href);
    if (cite && current?.root) {
      let rel = cite[1];
      try { rel = decodeURIComponent(rel); } catch { /* keep */ }
      const f = current.files.find((x) => x.rel === rel);
      if (f) { panel.close(); ctx.openAtLine(f.path, Math.max(0, Number(cite[2]) - 1)); }
      return;
    }
    if (/^https?:/i.test(href)) api.openExternal(a.href);
  });

  return { run, openSettings, askFolder, editSelection };
}
