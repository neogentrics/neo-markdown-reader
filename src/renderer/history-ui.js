// The History panel: earlier versions of the active document, kept by the app every time it was saved
// (or changed by Replace in Folder, or restored). Compare any of them with the current text, or restore it.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const REASON = { save: 'Before saving', replace: 'Before Replace in Folder', restore: 'Before restoring' };

function dayLabel(t, now = new Date()) {
  const d = new Date(t);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? 'long' : undefined, year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric' });
}
const timeLabel = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const sizeLabel = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * @param {{ api: any, activeTab: () => any, openCompare: (left: {name:string, content:string}, right: {name:string, content:string}) => Promise<void>,
 *           textOf: (tab: any) => string, toast: (msg: string) => void }} ctx
 */
export function createHistoryUi(ctx) {
  const list = document.getElementById('hist-list');
  let seq = 0;

  const empty = (msg) => `<div class="side-empty">${msg}</div>`;

  async function render(tab = ctx.activeTab()) {
    const mine = ++seq;
    if (!tab || tab.doc.compare) { list.innerHTML = empty('Open a document to see its earlier versions.'); return; }
    if (!tab.doc.path) { list.innerHTML = empty('Save this document to start keeping its earlier versions.'); return; }
    const versions = await ctx.api.historyList(tab.doc.path);
    if (mine !== seq) return;
    if (!versions.length) {
      list.innerHTML = empty('No earlier versions yet. Each time you save, the version you replace is kept here.');
      return;
    }
    list.replaceChildren();
    let day = '';
    let group = null;
    for (const v of versions) {
      const label = dayLabel(v.time);
      if (label !== day) {
        day = label;
        group = document.createElement('div');
        group.className = 'hist-day';
        group.innerHTML = `<div class="group-head">${esc(label)}</div>`;
        list.appendChild(group);
      }
      const row = document.createElement('div');
      row.className = 'hist-item';
      row.innerHTML = `<div class="hist-when"><b>${esc(timeLabel(v.time))}</b><span>${esc(REASON[v.reason] || REASON.save)} · ${esc(sizeLabel(v.size))}</span></div>`;
      const actions = document.createElement('div');
      actions.className = 'hist-actions';
      const cmp = document.createElement('button');
      cmp.className = 'link-btn';
      cmp.textContent = 'Compare';
      cmp.title = 'Show what changed between this version and the current text';
      cmp.onclick = () => compare(tab, v);
      const back = document.createElement('button');
      back.className = 'link-btn';
      back.textContent = 'Restore';
      back.title = 'Put this version back (the current one is kept here first)';
      back.onclick = () => restore(tab, v);
      actions.append(cmp, back);
      row.appendChild(actions);
      group.appendChild(row);
    }
  }

  async function compare(tab, v) {
    const res = await ctx.api.historyRead(tab.doc.path, v.id);
    if (res.error) { ctx.toast(res.error); return; }
    const when = `${dayLabel(v.time)} ${timeLabel(v.time)}`;
    await ctx.openCompare({ name: `${tab.doc.name} (${when})`, content: res.content }, { name: `${tab.doc.name} (now)`, content: ctx.textOf(tab) });
  }

  async function restore(tab, v) {
    if (tab.editing && tab.dirty) { ctx.toast('Save or discard your edits first, then restore'); return; }
    const res = await ctx.api.historyRestore(tab.doc.path, v.id);
    if (res.ok) { ctx.toast('Restored — the version it replaced is in History too'); setTimeout(() => render(), 400); }
    else if (res.reason === 'readonly') ctx.toast('Not restored — the file is read-only');
    else if (res.reason !== 'cancelled') ctx.toast(res.message || 'Couldn’t restore that version');
  }

  return { render };
}
