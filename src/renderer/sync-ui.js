// Sync between your computers in the page (3.1): the Sync dialog, and showing another computer's
// highlights and notes as soon as they arrive. The syncing itself happens in the main process
// (src/main/sync.js); this only asks for it and shows where it stands.
const $ = (id) => document.getElementById(id);
const PLATFORMS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const PROVIDERS = { onedrive: 'OneDrive', 'onedrive-business': 'OneDrive for work', dropbox: 'Dropbox', icloud: 'iCloud Drive', 'google-drive': 'Google Drive' };

export function createSyncUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('sync-dlg');
  let status = null;

  /** "3 minutes ago", in the app's language. */
  function ago(ms) {
    const lang = ctx.settings().lang || 'en';
    const secs = Math.round((ms - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (Math.abs(secs) < 45) return rtf.format(0, 'second');
    for (const [unit, size] of [['minute', 60], ['hour', 3600], ['day', 86400]]) {
      const n = Math.round(secs / size);
      if (unit === 'day' || Math.abs(n) < (unit === 'minute' ? 60 : 24)) return rtf.format(n, unit);
    }
    return '';
  }

  function paint() {
    if (!status) return;
    const state = $('sync-state');
    if (status.error) { state.dataset.state = 'error'; state.textContent = status.error; }
    else if (!status.enabled) { state.dataset.state = 'off'; state.textContent = status.folder ? 'Sync is off on this computer' : 'Sync is off. Choose a folder to start.'; }
    else if (status.busy && !status.lastSync) { state.dataset.state = 'on'; state.textContent = 'Syncing…'; }
    else { state.dataset.state = 'on'; state.textContent = status.lastSync ? `On · last synced ${ago(status.lastSync)}` : 'On'; }

    $('sync-folder-path').textContent = status.syncDir || '—';
    $('sync-choose').textContent = status.folder ? 'Change Folder…' : 'Choose Folder…';
    $('sync-enabled').checked = status.enabled;
    $('sync-enabled').disabled = !status.folder;
    $('sync-now').disabled = !status.enabled;
    if (document.activeElement !== $('sync-name')) $('sync-name').value = status.name || '';

    // One click for each cloud folder found on this computer.
    const suggest = $('sync-suggest');
    suggest.replaceChildren();
    if (!status.folder) {
      for (const s of status.suggestions || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'big-btn sm';
        b.textContent = `Use ${PROVIDERS[s.id] || s.id}`;
        b.title = s.path;
        b.onclick = () => configure({ folder: s.path, enabled: true });
        suggest.appendChild(b);
      }
    }

    const devices = $('sync-devices');
    devices.replaceChildren();
    if (status.enabled) {
      const head = document.createElement('div');
      head.className = 'sync-folder-label';
      head.textContent = status.devices.length ? 'Other computers in step with this one' : 'No other computers yet: turn sync on in RT Markdown Reader on another computer, with the same folder.';
      devices.appendChild(head);
      for (const d of status.devices) {
        const row = document.createElement('div');
        row.className = 'sync-device';
        const name = document.createElement('span');
        name.translate = false;
        name.textContent = d.platform && PLATFORMS[d.platform] ? `${d.name} (${PLATFORMS[d.platform]})` : d.name;
        const when = document.createElement('span');
        when.className = 'sync-device-when';
        when.textContent = `Last seen ${ago(d.written)}`;
        row.append(name, when);
        devices.appendChild(row);
      }
    }
  }

  async function configure(patch) {
    $('sync-msg').textContent = '';
    status = await api.syncConfigure(patch);
    paint();
    if (status.error) $('sync-msg').textContent = status.error;
    else if (patch.enabled) toast('Sync is on');
  }

  async function open() {
    status = await api.syncStatus();
    $('sync-msg').textContent = '';
    paint();
    if (!dlg.open) dlg.showModal();
  }

  $('sync-choose').onclick = async () => {
    const folder = await api.syncChooseFolder();
    if (folder) configure({ folder, enabled: true });
  };
  $('sync-enabled').onchange = () => configure({ enabled: $('sync-enabled').checked });
  $('sync-name').onchange = () => { const name = $('sync-name').value.trim(); if (name) configure({ name }); };
  $('sync-now').onclick = async () => { $('sync-now').disabled = true; status = await api.syncNow(); paint(); };
  $('sync-close').onclick = () => dlg.close();
  $('sync-done').onclick = () => dlg.close();

  api.onSyncStatus((s) => { status = s; window.__syncStatus = s; if (dlg.open) paint(); });   // read by the end-to-end tests
  // Another computer's highlights and notes arrived: repaint the documents they belong to.
  api.onAnnotationsChanged((paths) => ctx.annotationsChanged(paths));
  // "Last synced 2 minutes ago" keeps counting while the dialog is open.
  setInterval(() => { if (dlg.open) paint(); }, 30000);

  return { open };
}
