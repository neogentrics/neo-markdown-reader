// Connect Claude (3.4): turning the connector on, adding it to Claude Desktop or Claude Code, and showing
// a change Claude suggests. Nothing in a document changes until Accept; then the main process asks for
// edit permission like any other edit, and keeps a backup and a History copy.
import { diffWordsWithSpace } from 'diff';

const $ = (id) => document.getElementById(id);

export function createConnectorUi({ api, toast, isDirty }) {
  const dlg = $('claude-dlg');
  const msg = $('claude-msg');
  let status = null;

  function paint() {
    $('claude-on').checked = status.enabled;
    $('claude-add-desktop').disabled = !status.desktop.installed || status.portable;
    $('claude-add-code').disabled = !status.code.installed || status.portable;
    $('claude-add-desktop').textContent = status.desktop.added ? 'Add to Claude Desktop again' : 'Add to Claude Desktop';
    $('claude-not-found').hidden = status.desktop.installed || status.code.installed;
    $('claude-portable').hidden = !status.portable;
  }

  async function open() {
    status = await api.connectorStatus();
    msg.textContent = '';
    paint();
    if (!dlg.open) dlg.showModal();
  }

  $('claude-close').onclick = () => dlg.close();
  $('claude-done').onclick = () => dlg.close();
  $('claude-on').addEventListener('change', async () => {
    status = await api.connectorSet($('claude-on').checked);
    paint();
    msg.textContent = status.error || (status.enabled ? 'Connector on. Claude can reach your documents while this app is open.' : 'Connector off. Claude can’t reach your documents.');
  });
  for (const [id, target, done] of [
    ['claude-add-desktop', 'desktop', 'Added. Quit and reopen Claude Desktop to use it.'],
    ['claude-add-code', 'code', 'Added to Claude Code. Start a new Claude Code session to use it.'],
  ]) {
    $(id).addEventListener('click', async () => {
      msg.textContent = 'Adding…';
      const res = await api.connectorAdd(target);
      msg.textContent = res?.error || done;
      status = await api.connectorStatus();
      paint();
    });
  }

  // ---------------------------------------------------------------- a change suggested by Claude
  const sg = { dlg: $('claude-suggest-dlg'), diff: $('claude-suggest-diff'), status: $('claude-suggest-status'), accept: $('claude-suggest-accept') };
  const queue = [];
  let current = null;

  function showNext() {
    current = queue.shift() || null;
    if (!current) return;
    $('claude-suggest-file').textContent = current.path.split(/[\\/]/).pop();
    $('claude-suggest-note').textContent = current.note;
    $('claude-suggest-note').hidden = !current.note;
    sg.diff.replaceChildren(...diffWordsWithSpace(current.oldText, current.newText).map((p) => {
      if (!p.added && !p.removed) return document.createTextNode(p.value);
      const el = document.createElement(p.added ? 'ins' : 'del');
      el.textContent = p.value;
      return el;
    }));
    const unsaved = isDirty(current.path);
    sg.accept.disabled = unsaved;
    sg.status.textContent = unsaved ? 'Save this document first: it has changes that aren’t saved.' : '';
    if (!sg.dlg.open) sg.dlg.showModal();
  }

  async function answer(accept) {
    const s = current;
    if (!s) return;
    current = null;
    sg.dlg.close();
    const res = await api.claudeAnswer(s.id, accept);
    if (res?.error) toast(res.error);
    showNext();
  }

  sg.accept.onclick = () => answer(true);
  $('claude-suggest-reject').onclick = () => answer(false);
  sg.dlg.addEventListener('cancel', (e) => { e.preventDefault(); answer(false); });
  api.onClaudeSuggest((s) => { queue.push(s); if (!current) showNext(); });

  async function openClaudeCode() {
    const res = await api.openClaudeCode();
    if (res?.error) toast(res.error);
  }

  return { open, openClaudeCode };
}
