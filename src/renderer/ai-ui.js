// AI assist in the page: the settings dialog and the panel that shows Claude's answer as it streams.
// Requests are made by the main process (src/main/ai.js) with the reader's own API key.

const $ = (id) => document.getElementById(id);
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
    if (!current || current.id !== id) return;
    current.text += text;
    if (!paint) paint = requestAnimationFrame(() => { paint = 0; show(); });
  });

  function show() {
    if (!current) return;
    body.innerHTML = current.text ? render(current.text).html : '<p class="ai-wait">Thinking…</p>';
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
    if (/^https?:/i.test(a.getAttribute('href'))) api.openExternal(a.href);
  });

  return { run, openSettings };
}
