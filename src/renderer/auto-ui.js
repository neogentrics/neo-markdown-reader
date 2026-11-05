// Automations (3.7) in the page: your webhooks, the window that shows what will be sent, and what comes back.
// Requests are made by the main process (src/main/automations.js), to addresses you saved there.
import { diffWordsWithSpace } from 'diff';

const $ = (id) => document.getElementById(id);
const SENDS = { document: 'The open document', selection: 'The selected text', folder: 'Every document in the open folder' };
const size = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * @param {{ api: any, toast: (m: string) => void, activeTab: () => any, textOf: (t: any) => string, selectionOf: (t: any) => any,
 *   newDocument: (d: { name: string, content: string }) => Promise<void>, enterEditor: (t: any) => Promise<any>, folder: () => any }} ctx
 */
export function createAutoUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('auto-dlg');
  const pages = { list: $('auto-list-page'), edit: $('auto-edit-page'), send: $('auto-send-page'), change: $('auto-change-page') };
  let state = null;              // what auto:list returned
  let editing = null;            // the action being edited
  let job = null;                // { token, action, tab, selection }
  let answer = null;             // { text, tab, selection }

  const page = (name) => { for (const [k, el] of Object.entries(pages)) el.hidden = k !== name; };
  const say = (id, text) => { $(id).textContent = text; };

  function paintList() {
    const list = $('auto-actions');
    list.replaceChildren();
    for (const a of state.actions) {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'auto-row-text';
      text.setAttribute('translate', 'no');
      const name = document.createElement('b');
      name.textContent = a.name;
      const host = document.createElement('small');
      host.textContent = a.host;
      text.append(name, host);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'link-btn';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${a.name}`);
      edit.onclick = () => openEdit(a);
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'link-btn';
      run.textContent = 'Run';
      run.setAttribute('aria-label', `Run ${a.name}`);
      run.onclick = () => prepare(a.id);
      row.append(text, edit, run);
      list.appendChild(row);
    }
    $('auto-none').hidden = state.actions.length > 0;
    $('n8n-url').value = state.n8n.url;
    $('n8n-key').value = '';
    $('n8n-key').placeholder = state.n8n.hasKey ? 'A key is saved. Type a new one to replace it.' : 'Optional';
    $('auto-insecure').hidden = state.secure;
  }

  async function openManage() {
    state = await api.autoList();
    paintList();
    $('n8n-list').replaceChildren();
    say('n8n-msg', '');
    page('list');
    if (!dlg.open) dlg.showModal();
  }

  function openEdit(action = null, fill = {}) {
    editing = action;
    $('auto-edit-h').textContent = action ? 'Edit automation' : 'New automation';
    $('auto-name').value = action?.name ?? fill.name ?? '';
    $('auto-url').value = action?.url ?? fill.url ?? '';
    $('auto-send-what').value = action?.send ?? 'document';
    $('auto-result').value = action?.result ?? 'document';
    $('auto-secret').value = '';
    $('auto-secret').placeholder = action?.hasSecret ? 'One is saved. Type a new one to replace it.' : 'Optional, for example: Bearer abc123';
    $('auto-delete').hidden = !action;
    say('auto-edit-msg', '');
    page('edit');
    if (!dlg.open) dlg.showModal();
    $('auto-name').focus();
  }

  async function save() {
    const res = await api.autoSave({ id: editing?.id, name: $('auto-name').value, url: $('auto-url').value, send: $('auto-send-what').value, result: $('auto-result').value, secret: $('auto-secret').value });
    if (res.error) { say('auto-edit-msg', res.error); return; }
    state = res;
    paintList();
    page('list');
  }

  async function listN8n() {
    say('n8n-msg', 'Asking n8n…');
    $('n8n-list').replaceChildren();
    const res = await api.autoN8n({ url: $('n8n-url').value, key: $('n8n-key').value });
    if (res.error) { say('n8n-msg', res.error); return; }
    state.n8n = res.n8n;
    say('n8n-msg', res.workflows.length ? '' : 'No workflows with a POST webhook were found.');
    for (const w of res.workflows) {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'auto-row-text';
      text.setAttribute('translate', 'no');
      const name = document.createElement('b');
      name.textContent = w.name;
      const note = document.createElement('small');
      note.textContent = w.url;
      text.append(name, note);
      row.append(text);
      if (!w.active) {
        const off = document.createElement('small');
        off.textContent = 'Not active';
        row.append(off);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'link-btn';
      add.textContent = 'Add';
      add.setAttribute('aria-label', `Add ${w.name}`);
      add.onclick = () => openEdit(null, w);
      row.append(add);
      $('n8n-list').appendChild(row);
    }
  }

  // ---------------------------------------------------------------- sending
  async function prepare(id) {
    const tab = ctx.activeTab();
    const selection = tab ? ctx.selectionOf(tab) : null;
    const res = await api.autoPrepare({
      id, name: tab?.doc.name || '', path: tab?.doc.path || '', text: tab && !tab.doc.compare ? ctx.textOf(tab) : '', selection: selection?.text || '',
    });
    if (res.error) { toast(res.error); return; }
    job = { token: res.token, action: res.action, tab, selection };
    $('auto-send-h').textContent = res.action.name;
    say('auto-send-to', res.action.url);
    say('auto-send-summary', res.count > 1 ? `${SENDS[res.action.send]}: ${res.count} documents, ${size(res.bytes)}` : `${SENDS[res.action.send]}: ${size(res.bytes)}`);
    say('auto-send-sample', res.sample);
    $('auto-go').hidden = false;
    $('auto-send-stop').hidden = true;
    $('auto-send-cancel').hidden = false;
    say('auto-send-msg', res.plain ? 'This address isn’t encrypted, so anything sent could be read on the way. That’s usually fine inside your home network.' : '');
    page('send');
    if (!dlg.open) dlg.showModal();
    $('auto-go').focus();
  }

  function showChange(oldText, newText) {
    $('auto-diff').replaceChildren(...diffWordsWithSpace(oldText, newText).map((p) => {
      if (!p.added && !p.removed) return document.createTextNode(p.value);
      const el = document.createElement(p.added ? 'ins' : 'del');
      el.textContent = p.value;
      return el;
    }));
    page('change');
    $('auto-accept').focus();
  }

  async function go() {
    const now = job;
    if (!now) return;
    $('auto-go').hidden = true;
    $('auto-send-cancel').hidden = true;
    $('auto-send-stop').hidden = false;
    say('auto-send-msg', 'Sent. Waiting for the answer…');
    const res = await api.autoSend({ token: now.token });
    if (job !== now) return;
    job = null;
    if (res.error) {
      say('auto-send-msg', res.error);
      $('auto-send-stop').hidden = true;
      $('auto-send-cancel').hidden = false;
      return;
    }
    const { action } = now;
    if (action.result === 'none' || !res.text) {
      dlg.close();
      toast(action.result === 'none' ? `Sent to ${action.name}` : `${action.name} finished, with nothing to show`);
      return;
    }
    const editable = now.tab && !now.tab.doc.compare && !now.tab.doc.data && !now.tab.doc.needsPassword;
    const inEditor = now.selection?.from !== undefined;
    if (action.result === 'change' && action.send !== 'folder' && editable && (action.send === 'document' || inEditor)) {
      answer = { text: res.text, tab: now.tab, selection: action.send === 'selection' ? now.selection : null };
      showChange(answer.selection ? answer.selection.text : ctx.textOf(now.tab), res.text);
      return;
    }
    dlg.close();
    const base = (now.tab?.doc.name || 'Result').replace(/\.[^.]+$/, '');
    await ctx.newDocument({ name: `${base} - ${action.name}.md`, content: res.text });
  }

  async function accept() {
    const a = answer;
    answer = null;
    dlg.close();
    if (!a) return;
    const view = await ctx.enterEditor(a.tab);
    if (!view) { toast('The change couldn’t be made, because the document can’t be edited.'); return; }
    const from = a.selection ? a.selection.from : 0;
    const to = a.selection ? a.selection.to : view.state.doc.length;
    view.dispatch({ changes: { from, to, insert: a.text } });
    toast('Changed. Save the document to keep it.');
  }

  $('auto-new').onclick = () => openEdit();
  $('auto-close').onclick = () => dlg.close();
  $('auto-edit-save').onclick = save;
  $('auto-edit-cancel').onclick = () => page('list');
  $('auto-delete').onclick = async () => { state = await api.autoRemove(editing.id); paintList(); page('list'); };
  $('n8n-go').onclick = listN8n;
  $('auto-go').onclick = go;
  $('auto-send-cancel').onclick = () => { job = null; dlg.close(); };
  $('auto-send-stop').onclick = () => { if (job) { api.autoStop(job.token); } };
  $('auto-accept').onclick = accept;
  $('auto-reject').onclick = () => { answer = null; dlg.close(); };
  dlg.addEventListener('close', () => { if (dlg.open) return; if (job) api.autoStop(job.token); job = null; answer = null; });

  return { open: openManage, run: prepare };
}
