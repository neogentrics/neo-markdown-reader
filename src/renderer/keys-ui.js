// Customize keyboard shortcuts: every menu command with its shortcut; click Change and press new keys.
// The main process checks the combination, warns about clashes and rebuilds the menus.
import { prettyShortcut } from './palette.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CODE_KEYS = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/', Backquote: '`', Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

/** The Electron accelerator for a key press ("CmdOrCtrl+Shift+K"), or null for a lone modifier key. */
export function acceleratorFor(e, platform = 'win32') {
  const code = e.code || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = code.slice(6);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else key = CODE_KEYS[code] || null;
  if (!key) return null;
  const mac = platform === 'darwin';
  const mods = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl');
  if (mac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

export function createKeysUi(ctx) {
  const $ = (id) => document.getElementById(id);
  const dlg = $('keys-dlg');
  const listEl = $('keys-list');
  const filter = $('keys-filter');
  const msg = $('keys-msg');
  let commands = [];
  let recording = null;          // command key being changed

  const pretty = (acc) => prettyShortcut(acc, ctx.platform());

  function render() {
    const q = filter.value.trim().toLowerCase();
    listEl.replaceChildren();
    const shown = commands.filter((c) => c.customizable && (!q || `${c.path} ${c.label} ${pretty(c.accelerator)}`.toLowerCase().includes(q)));
    for (const c of shown) {
      const row = document.createElement('div');
      row.className = `keys-row${recording === c.key ? ' recording' : ''}`;
      const changed = c.accelerator !== c.defaultAccelerator;
      row.innerHTML = `<div class="keys-name"><b>${esc(c.label)}</b><span>${esc(c.path)}</span></div>
        <div class="keys-acc">${recording === c.key ? '<span class="keys-press">Press keys… (Esc to cancel)</span>' : c.accelerator ? `<kbd>${esc(pretty(c.accelerator))}</kbd>` : '<span class="keys-none">None</span>'}</div>`;
      const actions = document.createElement('div');
      actions.className = 'keys-actions';
      const mk = (label, fn, title) => { const b = document.createElement('button'); b.className = 'link-btn'; b.textContent = label; if (title) b.title = title; b.onclick = fn; actions.appendChild(b); };
      mk('Change', () => startRecording(c.key), `Give “${c.label}” a new shortcut`);
      if (c.accelerator) mk('Remove', () => set(c.key, ''), 'No shortcut for this command');
      if (changed) mk('Reset', () => set(c.key, null), `Back to ${c.defaultAccelerator ? pretty(c.defaultAccelerator) : 'none'}`);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
    if (!shown.length) listEl.innerHTML = '<div class="side-empty">No commands match.</div>';
  }

  function startRecording(key) {
    recording = key;
    msg.textContent = '';
    ctx.api.recordShortcuts?.(true);           // menu shortcuts pause while you press new keys
    render();
    const row = listEl.querySelector('.recording');
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector('button')?.focus();
  }

  function stopRecording() {
    recording = null;
    ctx.api.recordShortcuts?.(false);
  }

  async function set(key, accelerator, takeOver = false) {
    const res = await ctx.api.setShortcut(key, accelerator, { takeOver });
    if (res.conflict) {
      const c = res.conflict;
      msg.innerHTML = `${esc(pretty(accelerator))} is already used by <b>${esc(c.label)}</b>${c.path ? ` (${esc(c.path)})` : ''}. `;
      if (c.customizable) {
        const b = document.createElement('button');
        b.className = 'link-btn';
        b.textContent = 'Use it here instead';
        b.onclick = () => set(key, accelerator, true);
        msg.appendChild(b);
      }
      render();
      return;
    }
    if (res.error) { msg.textContent = res.error; render(); return; }
    msg.textContent = '';
    commands = res.commands;
    render();
  }

  // Listen on the whole window: redrawing the list moves focus off the button that was clicked.
  window.addEventListener('keydown', (e) => {
    if (!recording || !dlg.open) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); render(); return; }
    const acc = acceleratorFor(e, ctx.platform());
    if (!acc) return;                          // just a modifier so far
    const key = recording;
    stopRecording();
    set(key, acc);
  }, true);
  filter.addEventListener('input', render);
  $('keys-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { if (recording) stopRecording(); });
  $('keys-reset-all').onclick = async () => {
    const list = await ctx.api.resetShortcuts();
    if (!list) return;
    commands = list;
    msg.textContent = '';
    render();
  };

  async function open() {
    commands = await ctx.api.listCommands();
    filter.value = '';
    msg.textContent = '';
    render();
    if (!dlg.open) dlg.showModal();
    filter.focus();
  }

  return { open };
}
