// Add-ons in the page (3.0): the Add-ons dialog, drawing code blocks with add-ons, add-on themes, and
// exporting with an add-on. The add-ons' code runs in the main process's sealed sandbox; what comes back
// is sanitized here like any document (see render.sanitizeAddon).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MAX_BLOCKS = 40;

export function createAddonsUi(ctx) {
  const { api, toast, render } = ctx;
  let info = [];
  const cache = new Map();             // id|language|code -> { html } | { error }

  // ---------------------------------------------------------------- settings: list, theme
  function apply(s) {
    info = s.addons || [];
    const root = document.documentElement;
    if (s.addonTheme) root.dataset.addonTheme = s.addonTheme; else delete root.dataset.addonTheme;
    let style = $('addon-theme-css');
    if (!style) { style = document.createElement('style'); style.id = 'addon-theme-css'; document.head.appendChild(style); }
    style.textContent = s.addonThemeCss || '';
    if ($('addons-dlg').open) paint();
  }
  /** The add-on that draws `language` code blocks, if one is on. */
  const drawer = (language) => info.find((a) => a.enabled && a.blocks.includes(language));

  // ---------------------------------------------------------------- code blocks
  async function drawBlocks(root) {
    const pres = [...root.querySelectorAll('pre.code-block[data-lang]')].filter((p) => drawer(p.dataset.lang)).slice(0, MAX_BLOCKS);
    for (const pre of pres) {
      const language = pre.dataset.lang;
      const addon = drawer(language);
      const code = pre.querySelector('code')?.textContent ?? '';
      const key = `${addon.id}|${language}|${code}`;
      let res = cache.get(key);
      if (!res) {
        res = await api.addonRender({ id: addon.id, language, code });
        if (cache.size > 300) cache.clear();
        cache.set(key, res);
      }
      if (!pre.isConnected) continue;
      const fig = document.createElement('figure');
      fig.className = 'addon-block';
      fig.dataset.addon = addon.id;
      fig.dataset.lang = language;
      if (pre.dataset.line) fig.dataset.line = pre.dataset.line;
      if (res.html != null) fig.innerHTML = render.sanitizeAddon(res.html);
      else {
        fig.classList.add('addon-error');
        fig.innerHTML = `<div class="chart-error"><b>${esc(addon.name)} couldn’t draw this block:</b> ${esc(res.error || 'unknown problem')}</div>`;
        fig.appendChild(pre.cloneNode(true));
      }
      pre.replaceWith(fig);
    }
  }

  // ---------------------------------------------------------------- export
  async function exportWith({ id, exportId }) {
    const tab = ctx.activeTab();
    if (!tab || tab.doc.compare) { toast('Open a document first'); return; }
    if (tab.doc.needsPassword) { toast('Unlock the document first'); return; }
    const addon = info.find((a) => a.id === id && a.enabled);
    const ex = addon?.exports.find((e) => e.id === exportId);
    if (!ex) return;
    toast(`Exporting ${ex.name}…`);
    const res = await api.addonExport({
      id, exportId,
      doc: {
        title: tab.result?.title || tab.doc.name, name: tab.doc.name, markdown: ctx.textOf(tab), html: ctx.cleanHtml(tab),
        headings: (tab.result?.toc || []).map((h) => ({ level: h.level, text: h.text, id: h.id })),
      },
    });
    window.__lastExport = res;              // read by the end-to-end tests
    if (res?.ok) toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
    else if (res?.error) toast(res.error);
    else toast('Export cancelled');
  }

  // ---------------------------------------------------------------- the Add-ons dialog
  const dlg = $('addons-dlg');
  const list = $('addons-list');
  function paint() {
    list.replaceChildren();
    if (!info.length) {
      list.innerHTML = '<div class="side-empty">No add-ons yet. Install one from a <code>.nmraddon</code> file someone gave you.</div>';
      return;
    }
    for (const a of info) {
      const row = document.createElement('div');
      row.className = `addon-row${a.enabled ? '' : ' off'}${a.error ? ' broken' : ''}`;
      const head = document.createElement('div');
      head.className = 'addon-head';
      head.innerHTML = `<div class="addon-name"><b translate="no">${esc(a.name)}</b> <span class="addon-ver" translate="no">${esc(a.version)}</span>${a.author ? ` <span class="addon-by">· <span translate="no">${esc(a.author)}</span></span>` : ''}</div>`;
      const actions = document.createElement('div');
      actions.className = 'addon-actions';
      if (!a.error) {
        const sw = document.createElement('label');
        sw.className = 'check sm';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = a.enabled;
        box.setAttribute('aria-label', `Turn on ${a.name}`);
        box.onchange = async () => { info = await api.addonsSetEnabled(a.id, box.checked); cache.clear(); ctx.rerenderAll(); paint(); };
        sw.append(box, document.createTextNode(' On'));
        actions.appendChild(sw);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'link-btn';
      rm.textContent = 'Remove';
      rm.onclick = async () => { const res = await api.addonsRemove(a.id); if (res?.ok) { toast('Add-on removed'); cache.clear(); ctx.rerenderAll(); } };
      actions.appendChild(rm);
      head.appendChild(actions);
      row.appendChild(head);
      if (a.description) row.insertAdjacentHTML('beforeend', `<p class="addon-desc" translate="no">${esc(a.description)}</p>`);
      if (a.error) row.insertAdjacentHTML('beforeend', `<p class="lock-msg">This add-on is damaged and can’t be used: ${esc(a.error)}</p>`);
      else row.insertAdjacentHTML('beforeend', `<ul class="addon-caps">${a.capabilities.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
      list.appendChild(row);
    }
  }
  async function open() {
    info = await api.addonsList();
    paint();
    if (!dlg.open) dlg.showModal();
  }
  $('addons-install').onclick = async () => {
    const res = await api.addonsInstall();
    if (res?.error) toast(res.error);
    else if (res?.ok) { info = await api.addonsList(); paint(); cache.clear(); ctx.rerenderAll(); toast('Add-on installed'); }
  };
  $('addons-close').onclick = () => dlg.close();
  $('addons-done').onclick = () => dlg.close();

  return { apply, drawBlocks, exportWith, open, list: () => info };
}
