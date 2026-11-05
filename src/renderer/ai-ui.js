// AI assist in the page: the settings dialog and the panel that shows the answer as it streams.
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
  // One service at a time: Claude, ChatGPT, Gemini, Mistral, OpenRouter, or a model on this computer.
  // Each has its own saved key; model names come from the service's own list (3.3).
  let status = null;                       // the last ai:status
  const lists = new Map();                 // provider -> [{ id, label, price? }]
  let listing = 0;
  const providerOf = (id) => status.providers.find((x) => x.id === id);

  function fillModels(provider) {
    const list = provider === 'anthropic' ? status.claudeModels : lists.get(provider) || [];
    $('ai-model-list').replaceChildren(...list.map((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.label = typeof m.price === 'number' ? `${m.label} · $${m.price < 0.1 ? m.price.toFixed(3) : m.price.toFixed(2)} per million tokens read` : m.label;
      return o;
    }));
  }
  async function refreshModels(quiet = false) {
    const provider = $('ai-provider').value;
    if (provider === 'anthropic') { fillModels(provider); $('ai-models-msg').textContent = ''; return; }
    const p = providerOf(provider);
    if (!p.keyOptional && !p.hasKey && !$('ai-key').value.trim()) {
      if (!quiet) $('ai-models-msg').textContent = `Add your ${p.keyName} to see ${p.name}’s models.`;
      return;
    }
    const n = ++listing;
    $('ai-models-msg').textContent = 'Getting the list of models…';
    const res = await api.aiListModels({ provider, apiKey: $('ai-key').value, localUrl: $('ai-local-url').value });
    if (n !== listing || $('ai-provider').value !== provider) return;
    if (res?.error) { $('ai-models-msg').textContent = res.error; return; }
    lists.set(provider, res.models);
    fillModels(provider);
    $('ai-models-msg').textContent = res.models.length
      ? `${res.models.length} model${res.models.length === 1 ? '' : 's'} available — pick one from the list, or type its name.`
      : (provider === 'local' ? 'The server has no models yet. In Ollama, download one with: ollama pull llama3.2' : 'No models were listed. Type the model’s name.');
    if (!$('ai-model').value && res.models.length === 1) $('ai-model').value = res.models[0].id;
  }
  function showProvider(provider) {
    const p = providerOf(provider);
    $('ai-local').hidden = provider !== 'local';
    $('ai-key-field').hidden = !!p.noKey;
    $('ai-local-url').value = status.localUrl;
    $('ai-key-label').textContent = p.keyName;
    $('ai-key').value = '';
    $('ai-key').placeholder = p.hasKey ? 'A key is saved — type a new one to replace it' : p.keyHint || (p.keyOptional ? 'Not needed for Ollama or LM Studio' : '');
    $('ai-get-key').hidden = !p.keyUrl;
    $('ai-key-note').hidden = !p.keyUrl;
    $('ai-key-remove').hidden = !p.hasKey;
    $('ai-key-sep').hidden = !(p.hasKey && p.keyUrl);
    $('ai-key-hints').hidden = !p.keyUrl && !p.hasKey;
    $('ai-model').value = status.models[provider] || '';
    $('ai-model').placeholder = provider === 'anthropic' ? '' : 'Pick from the list, or type a model’s name';
    $('ai-quick').value = status.quick[provider] || '';
    $('ai-models-msg').textContent = '';
    fillModels(provider);
    if (provider !== 'anthropic' && !lists.has(provider) && (p.hasKey || p.keyOptional)) refreshModels(true);
  }

  async function openSettings(reason = '') {
    status = await api.aiStatus();
    $('ai-enabled').checked = !!status.enabled;
    $('ai-insecure').hidden = !!status.secure;
    const sel = $('ai-provider');
    sel.replaceChildren(...status.providers.map((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; return o; }));
    sel.value = status.provider;
    showProvider(status.provider);
    $('ai-msg').textContent = reason;
    if (!dlg.open) dlg.showModal();
  }
  $('ai-provider').addEventListener('change', () => { showProvider($('ai-provider').value); $('ai-msg').textContent = ''; });
  $('ai-models-refresh').addEventListener('click', () => refreshModels());
  $('ai-local-url').addEventListener('change', () => { lists.delete('local'); refreshModels(true); });
  $('ai-key').addEventListener('change', () => { if ($('ai-key').value.trim() && !lists.has($('ai-provider').value)) refreshModels(true); });
  $('ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = $('ai-provider').value;
    const model = $('ai-model').value.trim();
    if (provider === 'anthropic' && !status.claudeModels.some((m) => m.id === model)) { $('ai-msg').textContent = 'Choose one of the Claude models in the list.'; return; }
    const res = await api.aiConfigure({
      enabled: $('ai-enabled').checked, provider, apiKey: $('ai-key').value, model, quickModel: $('ai-quick').value,
      ...(provider === 'local' ? { localUrl: $('ai-local-url').value } : {}),
    });
    if (res?.error) { $('ai-msg').textContent = res.error; return; }
    status = res;
    if (res.enabled && !res.ready) { $('ai-msg').textContent = res.problem; showProvider(provider); return; }
    dlg.close();
    toast(res.enabled ? (res.stored === 'session' ? `AI assist is on with ${res.name} — the key is kept until you quit` : `AI assist is on with ${res.name}`) : 'AI assist is off');
  });
  $('ai-cancel').addEventListener('click', () => dlg.close());
  $('ai-key-remove').addEventListener('click', async () => {
    const provider = $('ai-provider').value;
    status = await api.aiConfigure({ provider, clearKey: true, ...(provider === status.provider ? { enabled: false } : {}) });
    toast(`${providerOf(provider).keyName} removed`);
    showProvider(provider);
  });
  $('ai-get-key').addEventListener('click', (e) => { e.preventDefault(); const p = providerOf($('ai-provider').value); if (p?.keyUrl) api.openExternal(p.keyUrl); });

  /** The service in use, or null after showing settings with what's missing. */
  async function ready(why) {
    const st = await api.aiStatus();
    if (st.ready) return st;
    openSettings(st.enabled ? st.problem : why);
    return null;
  }
  const SETUP = 'Turn on AI assist and choose a service to use this.';

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
    const st = await ready(SETUP);
    if (!st) return;
    const selection = action === 'explain' ? ctx.selectionIn(tab) : '';
    if (action === 'explain' && !selection) { toast('Select some text on the page first'); return; }
    if (current) api.aiCancel(current.id);
    const id = Math.random().toString(36).slice(2);
    current = { id, action, text: '', tab, name: st.name };
    $('ai-title').textContent = `${TITLES[action]} — ${tab.doc.name}`;
    $('ai-status').textContent = `Sent to ${st.name}: ${action === 'explain' ? 'the selected passage and the document' : 'this document'}`;
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
    $('ai-status').textContent = res.note || `Written by ${current.name} — check anything important against the document.`;
  }

  // ---------------------------------------------------------------- ask about this folder (2.3)
  // The reader ticks which documents go; the answer cites [path:line], which become links that open
  // that document at that line.
  const ask = { dlg: $('ask-dlg'), q: $('ask-question'), filter: $('ask-filter'), files: $('ask-files'), size: $('ask-size') };
  let askFiles = [];
  let askChosen = new Set();
  let askName = '';
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
    ask.size.textContent = n ? `${n} document${n === 1 ? '' : 's'} will be sent to ${askName}.` : 'Tick at least one document.';
    $('ask-go').disabled = !n;
  }
  async function askFolder() {
    const folder = ctx.folder();
    if (!folder) { toast('Open a folder first — the AI answers from the documents in it'); return; }
    const st = await ready(SETUP);
    if (!st) return;
    askName = st.name;
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
    current = { id, action: 'folder', text: '', tab: ctx.activeTab(), root, files: askFiles, name: askName };
    $('ai-title').textContent = question.length > 70 ? `${question.slice(0, 68)}…` : question;
    $('ai-status').textContent = `Sent to ${askName}: ${askChosen.size} document${askChosen.size === 1 ? '' : 's'} from ${ctx.folder().name}`;
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
    $('ai-status').textContent = res.note || `Written by ${current.name} from the ticked documents — click a citation to check it.`;
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
    ed.status.textContent = `Sent to ${edit.name}: the selected text${edit.action === 'translate' ? '' : ' and a little of the text around it'}`;
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
    ed.status.textContent = res.note || (same ? 'No changes suggested.' : `Suggested by ${edit.name} — check it before accepting.`);
    if (!ed.accept.disabled) ed.accept.focus();
  }

  async function editSelection(action) {
    const sel = ctx.editorSelection();
    if (!sel) { toast('Click Edit and select some text first'); return; }
    if (!sel.text.trim()) { toast('Select some text in the editor first'); return; }
    if (sel.tab.doc.locked) { toast('AI assist is off for locked documents, so their text never leaves this computer'); return; }
    const st = await ready(SETUP);
    if (!st) return;
    if (edit) api.aiCancel(edit.id);
    edit = { id: '', name: st.name, action, tab: sel.tab, from: sel.from, to: sel.to, original: sel.text, before: sel.before, after: sel.after, text: '', done: false, language: '' };
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

  return { run, openSettings, askFolder, editSelection, ready: () => ready(SETUP) };
}
