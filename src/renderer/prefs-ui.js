// Preferences (3.4): every setting in one window, so the menus can stay short. Simple choices are made
// here; larger ones open their own window. Buttons run the same commands the menus used to, so anything
// moved here can still be found with Find a Command and keeps its shortcut.

const $ = (id) => document.getElementById(id);

export function createPrefsUi({ api, settings, toast, refreshVoices, openHelp }) {
  const dlg = $('prefs-dlg');
  const tabs = [...dlg.querySelectorAll('.prefs-nav button')];
  const panes = [...dlg.querySelectorAll('.prefs-pane')];
  let info = null;

  function show(pane) {
    const name = panes.some((p) => p.dataset.pane === pane) ? pane : 'general';
    for (const t of tabs) { const on = t.dataset.pane === name; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }
    for (const p of panes) p.hidden = p.dataset.pane !== name;
  }

  function paint() {
    const s = settings();
    $('pref-language').value = ['en', 'es', 'fr', 'de'].includes(s.language) ? s.language : 'system';
    $('pref-restore').checked = !!s.restoreSession;
    $('pref-menubar').checked = !!s.showMenuBar;
    $('pref-menubar-row').hidden = info.mac;
    $('pref-theme').value = s.theme;
    $('pref-font').value = s.font;
    $('pref-surface').value = s.surface;
    $('pref-colorsafe').checked = !!s.colorSafe;
    $('pref-width').value = s.pageWidth;
    $('pref-rate').value = String(s.readAloud?.rate ?? 1);
    $('pref-wiki').checked = s.wikiLinks === 'markdown';
    $('pref-run').checked = s.runCode !== 'off';
  }

  async function paintLink(given) {
    const link = given || await api.linkStatus();
    $('pref-link').checked = link.enabled;
    const rows = link.apps.map((a) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = a.name;
      const state = document.createElement('small');
      state.textContent = !a.linked ? 'Not linked' : a.running ? 'Linked' : 'Linked, not running';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-btn';
      button.textContent = a.linked ? 'Remove' : 'Link';
      button.setAttribute('aria-label', `${a.linked ? 'Remove' : 'Link'} ${a.name}`);
      button.onclick = async () => {
        if (a.linked) { await paintLink(await api.linkUnlink(a.id)); return; }
        toast(`Answer in ${a.name}`);
        const res = await api.linkPair(a.id);
        if (res?.error) toast(res.error);
        paintLink();
      };
      row.append(name, state, button);
      return row;
    });
    $('pref-link-list').replaceChildren(...rows);
    $('pref-link-status').textContent = !link.enabled ? ''
      : !link.safe ? 'This computer has no safe place to keep links, so they last until the app closes.'
        : rows.length ? '' : 'No other Recon Towers apps are running.';
  }

  async function paintStatus() {
    const ai = await api.aiStatus();
    $('pref-ai-status').textContent = ai.enabled ? `AI assist is on, using ${ai.name}.` : 'AI assist is off.';
    const claude = await api.connectorStatus();
    $('pref-claude-status').textContent = claude.enabled ? 'Connector on. Claude can reach your documents while this app is open.' : 'Connector off. Claude can’t reach your documents.';
  }

  async function open(pane = 'general') {
    info ??= await api.prefsInfo();
    if (!$('pref-language').options.length) {
      $('pref-language').append(new Option('System Default', 'system'), ...info.languages.map((l) => new Option(l.name, l.code)));
    }
    refreshVoices();
    paint();
    paintStatus();
    paintLink();
    show(pane);
    if (!dlg.open) dlg.showModal();
  }

  /** Run a menu command from a button. Its window opens on top of this one. */
  const run = async (id) => { if (!(await api.runCommand(id))) toast('That isn’t available right now'); };

  for (const t of tabs) t.onclick = () => show(t.dataset.pane);
  for (const b of dlg.querySelectorAll('[data-run]')) b.onclick = () => run(b.dataset.run);
  for (const [id, key] of [['pref-language', 'language'], ['pref-theme', 'theme'], ['pref-font', 'font'], ['pref-surface', 'surface'], ['pref-width', 'pageWidth']]) {
    $(id).addEventListener('change', () => api.setSettings({ [key]: $(id).value }));
  }
  $('pref-colorsafe').addEventListener('change', () => api.setSettings({ colorSafe: $('pref-colorsafe').checked }));
  $('pref-restore').addEventListener('change', () => api.setSettings({ restoreSession: $('pref-restore').checked }));
  $('pref-menubar').addEventListener('change', () => api.setSettings({ showMenuBar: $('pref-menubar').checked }));
  $('pref-link').addEventListener('change', async () => {
    const res = await api.linkSet($('pref-link').checked);
    if (res.error) toast(res.error);
    paintLink(res);
  });
  $('pref-wiki').addEventListener('change', () => run('wiki-style'));
  $('pref-run').addEventListener('change', () => run('allow-run'));
  $('pref-smaller').onclick = () => api.setSettings({ fontScale: settings().fontScale - 0.1 });
  $('pref-larger').onclick = () => api.setSettings({ fontScale: settings().fontScale + 0.1 });
  $('pref-reset').onclick = () => api.setSettings({ fontScale: 1 });
  $('prefs-help').onclick = () => { dlg.close(); openHelp(); };
  for (const id of ['prefs-close', 'prefs-done']) $(id).onclick = () => dlg.close();
  dlg.addEventListener('focusin', () => { if (info) paintStatus(); });

  return { open };
}
