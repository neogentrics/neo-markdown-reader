// Password-locked documents in the page: the unlock screen shown in a locked tab, and the
// File → Protect with Password dialog. The encryption itself happens in the main process.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A rough guide to how hard a password would be to guess (0–4). */
export function passwordStrength(pw) {
  const s = String(pw || '');
  const len = [...s].length;
  if (len < 8) return { score: 0, label: 'Too short' };
  let kinds = 0;
  if (/[a-z]/.test(s)) kinds++;
  if (/[A-Z]/.test(s)) kinds++;
  if (/[0-9]/.test(s)) kinds++;
  if (/[^A-Za-z0-9]/.test(s)) kinds++;
  const unique = new Set(s).size;
  let score = 1;
  if (len >= 12 || (len >= 10 && kinds >= 3)) score = 2;
  if (len >= 14 && kinds >= 2 && unique >= 8) score = 3;
  if (len >= 18 && unique >= 10) score = 4;
  if (unique <= 3) score = 1;
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}

export function createLockUi(ctx) {
  const { api } = ctx;
  const dlg = $('lock-dlg');
  const pw = $('lock-pw');
  const pw2 = $('lock-pw2');
  const meter = $('lock-meter');
  const msg = $('lock-msg');
  const replace = $('lock-replace');
  const go = $('lock-go');
  let target = null;

  // ---------------------------------------------------------------- unlock screen
  function renderLockScreen(tab) {
    const el = tab.el;
    el.innerHTML = `
      <div class="lock-screen">
        <svg class="lock-art" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="16" r="1.4"/></svg>
        <h2>This document is locked</h2>
        <p class="lock-name">${esc(tab.doc.name)}</p>
        <form class="lock-form" autocomplete="off">
          <input type="password" class="lock-input" placeholder="Password" aria-label="Password" spellcheck="false">
          <button type="submit" class="big-btn sm">Unlock</button>
        </form>
        <p class="lock-error" role="alert" hidden></p>
        <p class="lock-hint">A forgotten password can’t be recovered — not even by Neo Markdown Reader.</p>
      </div>`;
    const form = el.querySelector('.lock-form');
    const input = el.querySelector('.lock-input');
    const err = el.querySelector('.lock-error');
    const btn = form.querySelector('button');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value) { input.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Unlocking…';
      err.hidden = true;
      const res = await api.unlock(tab.doc.path, input.value);
      btn.disabled = false;
      btn.textContent = 'Unlock';
      if (res?.doc) {
        input.value = '';
        await ctx.showUnlocked(tab, res.doc);
        return;
      }
      err.textContent = res?.error || 'Couldn’t unlock the document.';
      err.hidden = false;
      input.select();
    });
    if (tab.id === ctx.activeId()) setTimeout(() => input.focus(), 0);
  }

  // ---------------------------------------------------------------- protect dialog
  function update() {
    const s = passwordStrength(pw.value);
    meter.dataset.score = String(s.score);
    meter.querySelector('span').textContent = pw.value ? s.label : '';
    const mismatch = pw2.value && pw2.value !== pw.value;
    msg.textContent = mismatch ? 'The two passwords don’t match.' : '';
    go.disabled = s.score === 0 || pw.value !== pw2.value;
  }
  pw.addEventListener('input', update);
  pw2.addEventListener('input', update);
  $('lock-show').addEventListener('change', (e) => { pw.type = pw2.type = e.target.checked ? 'text' : 'password'; });
  $('lock-cancel').addEventListener('click', (e) => { e.preventDefault(); dlg.close(); });
  dlg.addEventListener('close', () => { pw.value = pw2.value = ''; target = null; });
  $('lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (go.disabled || !target) return;
    go.disabled = true;
    go.textContent = 'Locking…';
    const res = await api.protect({ path: target.doc.path, password: pw.value, replace: replace.checked });
    go.textContent = 'Lock';
    if (res?.canceled) { update(); return; }
    if (res?.error) { msg.textContent = res.error; update(); return; }
    const from = target;
    dlg.close();
    await ctx.openInTab(res.doc);
    if (res.trashed) ctx.closeTab(from.id, { force: true });
    ctx.toast(res.trashed ? 'Locked — the unlocked original was moved to the Recycle Bin' : `Locked copy saved as ${res.doc.name}`);
  });

  function protect(tab = ctx.activeTab()) {
    if (!tab) { ctx.toast('Open a document first'); return; }
    if (tab.doc.compare) { ctx.toast('Open the document itself to lock it'); return; }
    if (tab.doc.locked) { ctx.toast('This document is already locked'); return; }
    if (!tab.doc.path || tab.untitled) { ctx.toast('Save the document first (Ctrl+S)'); return; }
    if (ctx.hasUnsaved(tab)) { ctx.toast('Save your changes first (Ctrl+S)'); return; }
    target = tab;
    $('lock-doc').textContent = tab.doc.name;
    $('lock-target').textContent = tab.doc.name.replace(/\.[^.]+$/, '') + '.mdlock';
    replace.checked = false;
    $('lock-show').checked = false;
    pw.type = pw2.type = 'password';
    update();
    dlg.showModal();
    pw.focus();
  }

  async function lockNow(tab = ctx.activeTab()) {
    if (!tab?.doc.locked) { ctx.toast('This document isn’t locked'); return; }
    if (tab.doc.needsPassword) return;
    if (tab.editing) { ctx.toast('Finish editing first (click Done)'); return; }
    const res = await api.forgetLock(tab.doc.path);
    if (res?.doc) await ctx.showUnlocked(tab, res.doc);     // this tab, even if the window hasn't synced yet
    ctx.toast('Locked — enter the password to read it again');
  }

  async function saveUnlockedCopy(tab = ctx.activeTab()) {
    if (!tab?.doc.locked) { ctx.toast('This document isn’t locked'); return; }
    if (tab.doc.needsPassword) { ctx.toast('Unlock the document first'); return; }
    const res = await api.removeLock(tab.doc.path);
    if (res?.error) { ctx.toast(res.error); return; }
    if (res?.doc) { await ctx.openInTab(res.doc); ctx.toast(`Unlocked copy saved as ${res.doc.name}`); }
  }

  return { renderLockScreen, protect, lockNow, saveUnlockedCopy };
}
