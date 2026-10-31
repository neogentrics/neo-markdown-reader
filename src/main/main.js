'use strict';
const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeTheme, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { Settings } = require('./settings');
const { isMarkdownPath, fileFromArgv, readMarkdown } = require('./files');
const { Updater, RELEASES_URL } = require('./updater');
const { Editing } = require('./editing');

const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_HTML = path.join(ROOT, 'dist', 'index.html');
const SHOWCASE = path.join(ROOT, 'samples', 'showcase.md');
const THEME_BG = { light: '#e8ebf0', dark: '#0e1014', sepia: '#e6dccb' };

// Tests point the app at a throwaway profile folder.
if (process.env.NMR_USER_DATA) app.setPath('userData', process.env.NMR_USER_DATA);

let settings;
let updater;
let editing;
let quitting = false;
/** webContents.id -> { win, startup, tabs: [{ path, scroll }], active, watchers: Map(path -> unwatch) } */
const windows = new Map();
/** webContents.id -> last reported { bounds, tabs, active }. Survives a window closing while the app quits. */
const sessionById = new Map();
/** Files requested before the app was ready (macOS Finder). */
const pendingOpen = [];
let lastFocusedId = null;

// ---------------------------------------------------------------- single instance
// Double-clicking another .md file while the app runs adds a tab to the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    const file = fileFromArgv(argv, cwd);
    if (file) openFile(file); else focusAny();
  });
}

app.on('open-file', (e, file) => {          // macOS "Open With"
  e.preventDefault();
  if (app.isReady()) openFile(file); else pendingOpen.push(file);
});

// ---------------------------------------------------------------- helpers
function resolvedTheme() {
  const t = settings.get().theme;
  return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : t;
}

function rendererSettings() {
  return { ...settings.get(), resolvedTheme: resolvedTheme(), positions: undefined, session: undefined };
}

function visibleOnSomeDisplay(b) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100);
}

function defaultBounds() {
  const saved = settings.get().windowBounds;
  if (saved && visibleOnSomeDisplay(saved)) return saved;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1280, Math.round(width * 0.8)), height: Math.min(960, Math.round(height * 0.88)) };
}

function stateFor(event) { return windows.get(event.sender.id); }

function liveStates() { return [...windows.values()].filter((s) => !s.win.isDestroyed()); }

function targetState() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused.webContents.id)) return windows.get(focused.webContents.id);
  if (lastFocusedId && windows.has(lastFocusedId)) return windows.get(lastFocusedId);
  return liveStates()[0] || null;
}

function focusState(s) {
  if (s.win.isMinimized()) s.win.restore();
  s.win.show();
  s.win.focus();
}

function focusAny() {
  const s = targetState();
  if (s) focusState(s); else createWindow();
}

function applyMenuBarSetting(win) {
  if (isMac) return;
  const show = settings.get().showMenuBar;
  win.setAutoHideMenuBar(!show);
  win.setMenuBarVisibility(show);
}

// ---------------------------------------------------------------- windows
/**
 * @param {{ tabs?: {path:string, scroll?:number}[], active?: number, bounds?: object, at?: {x:number,y:number} }} opts
 */
function createWindow(opts = {}) {
  const base = opts.bounds && visibleOnSomeDisplay(opts.bounds) ? opts.bounds : defaultBounds();
  const cascade = opts.bounds ? 0 : liveStates().length * 28;
  const bounds = { width: base.width, height: base.height };
  if (opts.at) {
    bounds.x = Math.round(opts.at.x - 160);
    bounds.y = Math.round(opts.at.y - 20);
  } else if (base.x != null) {
    bounds.x = base.x + cascade;
    bounds.y = base.y + cascade;
  }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 560,
    minHeight: 420,
    show: false,
    title: 'Neo Markdown Reader',
    backgroundColor: THEME_BG[resolvedTheme()],
    icon: path.join(ROOT, 'dist', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,              // only the editor is editable, so only it gets underlined
      navigateOnDragDrop: false,
    },
  });
  applyMenuBarSetting(win);

  const id = win.webContents.id;
  const state = {
    win,
    startup: { tabs: opts.tabs || [], active: opts.active || 0 },
    tabs: [],
    active: 0,
    watchers: new Map(),
    known: new Map(),         // path -> mtimeMs of the version this window last received
  };
  windows.set(id, state);
  lastFocusedId = id;

  if (base.maximized && !opts.at) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => { lastFocusedId = id; });

  // Document content may never navigate the app window or open windows of its own.
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); handleUnmanagedLink(url); });
  win.webContents.setWindowOpenHandler(({ url }) => { handleUnmanagedLink(url); return { action: 'deny' }; });
  win.webContents.on('found-in-page', (_e, r) => win.webContents.send('find:result', { active: r.activeMatchOrdinal, total: r.matches }));
  win.webContents.on('context-menu', (_e, params) => showEditContextMenu(win, params));
  // The page refuses to unload while it has unsaved edits; confirm before discarding them.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Unsaved changes', noLink: true,
      message: 'This window has unsaved changes.',
      detail: 'Close it anyway and lose them? Choose Cancel to go back and save.',
      buttons: ['Cancel', 'Close Without Saving'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) e.preventDefault();      // preventDefault here means "ignore the page and close"
    else quitting = false;                      // closing (or quitting) was cancelled
  });

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    settings.update({ windowBounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
    snapshot(state);
    persistSession();
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', () => {
    // Closing one of several windows forgets it; closing the last window (or quitting) keeps it
    // so the next launch can restore it.
    const others = liveStates().filter((s) => s.win !== win);
    if (!quitting && others.length) state.forget = true;
  });
  win.on('closed', () => {
    for (const unwatch of state.watchers.values()) unwatch();
    windows.delete(id);
    if (state.forget) { sessionById.delete(id); persistSession(); }
  });

  win.loadFile(RENDERER_HTML);
  return state;
}

// ---------------------------------------------------------------- opening files
function sendDoc(state, channel, doc) {
  if (state.win.isDestroyed()) return;
  state.win.webContents.send(channel, doc);
  ensureWatch(state, doc.path, doc.mtime);
}

async function loadDoc(filePath, { remember = true } = {}) {
  const doc = await readMarkdown(filePath);
  if (remember) {
    settings.addRecent(doc.path);
    if (process.platform === 'win32' || isMac) app.addRecentDocument(doc.path);
    rebuildMenu();
  }
  return { ...doc, position: settings.get().positions[doc.path] || 0 };
}

/** Open a file from outside (Explorer double-click, CLI, menu, Finder): focus it if already open, else add a tab. */
async function openFile(filePath, { newWindow = false } = {}) {
  const abs = path.resolve(filePath);
  if (!newWindow) {
    for (const s of liveStates()) {
      const idx = s.tabs.findIndex((t) => t.path.toLowerCase() === abs.toLowerCase());
      if (idx >= 0) {
        focusState(s);
        s.win.webContents.send('tab:focus-path', abs);
        return;
      }
    }
  }
  const target = newWindow ? null : targetState();
  if (!target) { createWindow({ tabs: [{ path: abs }] }); return; }
  try {
    const doc = await loadDoc(abs);
    sendDoc(target, 'tab:open', doc);
    focusState(target);
  } catch (err) {
    target.win.webContents.send('doc:error', { message: errorMessage(err, abs) });
  }
}

function errorMessage(err, p) {
  return err?.code === 'ENOENT' ? `File not found:\n${p}` : String(err?.message || err);
}

// ---------------------------------------------------------------- watching (live reload)
/**
 * Watch a file for this window, starting the moment the window is handed the document. The mtime
 * of the version it received is the baseline, so a save that lands between reading the file and
 * starting the watcher is still noticed.
 */
function ensureWatch(state, p, knownMtime) {
  if (state.win.isDestroyed()) return;
  if (Number.isFinite(knownMtime)) state.known.set(p, knownMtime);
  if (state.watchers.has(p)) return;
  const check = async (mtimeMs) => {
    if (state.win.isDestroyed() || !state.watchers.has(p)) return;
    if (mtimeMs === state.known.get(p)) return;
    try {
      const doc = await readMarkdown(p);
      if (doc.mtime === state.known.get(p)) return;
      state.known.set(p, doc.mtime);
      state.win.webContents.send('doc:changed', doc);
    } catch { /* momentarily missing during an editor's save; the next poll catches up */ }
  };
  const listener = (curr) => {
    if (!curr || (curr.nlink === 0 && curr.size === 0)) return;
    check(curr.mtimeMs);
  };
  fs.watchFile(p, { interval: 500 }, listener);
  state.watchers.set(p, () => fs.unwatchFile(p, listener));
  fs.promises.stat(p).then((st) => check(st.mtimeMs), () => {});
}

/** Drop watchers for files no window tab shows any more; add any that are missing. */
function syncWatchers(state) {
  const wanted = new Set(state.tabs.map((t) => t.path));
  for (const [p, unwatch] of state.watchers) {
    if (!wanted.has(p)) { unwatch(); state.watchers.delete(p); state.known.delete(p); }
  }
  for (const p of wanted) ensureWatch(state, p, state.known.get(p));
}

// ---------------------------------------------------------------- session
/** Record a window's tabs and bounds for session restore. */
function snapshot(state) {
  const id = state.win.isDestroyed() ? null : state.win.webContents.id;
  if (id == null) return;
  if (!state.tabs.length) { sessionById.delete(id); return; }
  sessionById.set(id, {
    bounds: { ...state.win.getNormalBounds(), maximized: state.win.isMaximized() },
    tabs: state.tabs,
    active: state.active,
  });
}

function persistSession() {
  if (!settings) return;
  settings.update({ session: [...sessionById.values()].filter((w) => w.tabs.length) });
}

// ---------------------------------------------------------------- links
function isSafeExternal(url) {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); } catch { return false; }
}

function handleUnmanagedLink(url) {
  if (isSafeExternal(url)) shell.openExternal(url);
}

/**
 * A link clicked inside a document. Markdown files come back to the page (to open in the tab or a
 * new tab); web links open in the browser; any other local file is only revealed in its folder,
 * never executed.
 */
async function resolveLink(href, fromPath) {
  let url;
  try { url = new URL(href, fromPath ? pathToFileURL(fromPath).href : undefined); } catch { return { kind: 'none' }; }
  if (isSafeExternal(url.href)) { shell.openExternal(url.href); return { kind: 'external' }; }
  if (url.protocol !== 'file:') return { kind: 'none' };
  let target;
  try { target = fileURLToPath(url); } catch { return { kind: 'none' }; }
  if (isMarkdownPath(target)) {
    try {
      const doc = await loadDoc(target, { remember: false });
      return { kind: 'doc', doc: { ...doc, position: 0, hash: url.hash ? url.hash.slice(1) : '' } };
    } catch (err) { return { kind: 'error', message: errorMessage(err, target) }; }
  }
  if (fs.existsSync(target)) { shell.showItemInFolder(target); return { kind: 'revealed' }; }
  return { kind: 'error', message: `File not found:\n${target}` };
}

// ---------------------------------------------------------------- dialogs & export
async function showOpenDialog(win) {
  const recent = settings.get().recent[0];
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Markdown file',
    properties: ['openFile', 'multiSelections'],
    defaultPath: recent ? path.dirname(recent) : app.getPath('documents'),
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdx'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
}

async function openViaDialog(state) {
  const files = await showOpenDialog(state?.win);
  if (!state) { files.forEach((f) => openFile(f)); return files.length > 0; }
  for (const f of files) {
    try { sendDoc(state, 'tab:open', await loadDoc(f)); } catch (err) { state.win.webContents.send('doc:error', { message: errorMessage(err, f) }); }
  }
  return files.length > 0;
}

async function exportPdf(state) {
  const current = state.tabs[state.active]?.path;
  const base = current ? path.basename(current).replace(/\.[^.]+$/, '') : 'document';
  const res = await dialog.showSaveDialog(state.win, {
    title: 'Export as PDF',
    defaultPath: path.join(current ? path.dirname(current) : app.getPath('documents'), base + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return false;
  const pdf = await state.win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:Segoe UI,Arial,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
  await fs.promises.writeFile(res.filePath, pdf);
  shell.showItemInFolder(res.filePath);
  return true;
}

// ---------------------------------------------------------------- settings broadcast
function broadcastSettings() {
  for (const { win } of liveStates()) {
    win.setBackgroundColor(THEME_BG[resolvedTheme()]);
    applyMenuBarSetting(win);
    win.webContents.send('settings:changed', rendererSettings());
  }
  rebuildMenu();
}

function setSetting(patch) {
  settings.update(patch);
  broadcastSettings();
}

/** Send a command to the focused window's page (tab actions, find, etc.). */
function command(cmd, arg) {
  const s = targetState();
  if (s) s.win.webContents.send('menu:command', { cmd, arg });
}

// ---------------------------------------------------------------- updates
function onUpdateStatus(status) {
  for (const { win } of liveStates()) win.webContents.send('update:status', status);
  rebuildMenu();
}

async function checkForUpdatesInteractive() {
  const s = targetState();
  const res = await updater.check({ silent: false });
  const opts = { type: 'info', title: 'Check for Updates', buttons: ['OK'] };
  if (res.state === 'current') {
    dialog.showMessageBox(s?.win, { ...opts, message: 'You’re up to date', detail: `Neo Markdown Reader ${app.getVersion()} is the latest version.` });
  } else if (res.state === 'available') {
    const { response } = await dialog.showMessageBox(s?.win, { ...opts, message: `Version ${res.version} is available`, detail: 'This copy can’t update itself. Download the new version from the Releases page.', buttons: ['Open Download Page', 'Later'] });
    if (response === 0) shell.openExternal(res.url || RELEASES_URL);
  } else if (res.state === 'downloading' || res.state === 'ready') {
    dialog.showMessageBox(s?.win, { ...opts, message: `Version ${res.version} is ${res.state === 'ready' ? 'ready to install' : 'downloading'}`, detail: res.state === 'ready' ? 'Choose Help → Restart to Update, or it will install next time you quit.' : 'You’ll be asked to restart when it’s ready.' });
  } else {
    dialog.showMessageBox(s?.win, { ...opts, type: 'warning', message: 'Couldn’t check for updates', detail: (res.message || 'Check your internet connection and try again.') + `\n\nYou can always find new versions at:\n${RELEASES_URL}` });
  }
}

// ---------------------------------------------------------------- menu
function rebuildMenu() {
  if (!settings) return;
  const s = settings.get();
  const recentItems = s.recent.length
    ? [...s.recent.map((p) => ({ label: p.length > 80 ? '…' + p.slice(-78) : p, click: () => openFile(p) })),
      { type: 'separator' },
      { label: 'Clear Recent', click: () => { settings.update({ recent: [] }); app.clearRecentDocuments(); broadcastSettings(); } }]
    : [{ label: 'No recent files', enabled: false }];
  const radio = (label, key, value) => ({ label, type: 'radio', checked: s[key] === value, click: () => setSetting({ [key]: value }) });
  const cmd = (id, label, accelerator, extra = {}) => ({ id, label, accelerator, click: () => command(id), ...extra });
  const updateReady = updater?.status?.state === 'ready';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        cmd('new-doc', 'New Document', 'CmdOrCtrl+N'),
        {
          label: 'New from Template',
          submenu: [['meeting', 'Meeting Notes'], ['readme', 'Project README'], ['checklist', 'Checklist'], ['report', 'Report with Title Page']]
            .map(([key, label]) => ({ id: `template-${key}`, label, click: () => command('new-template', key) })),
        },
        { id: 'new-window', label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { type: 'separator' },
        { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openViaDialog(targetState()) },
        { label: 'Open Recent', submenu: recentItems },
        cmd('reopen-closed-tab', 'Reopen Closed Tab', 'CmdOrCtrl+Shift+T'),
        { type: 'separator' },
        cmd('save', 'Save', 'CmdOrCtrl+S'),
        cmd('save-as', 'Save As…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('reload', 'Reload File', 'F5'),
        cmd('reveal', 'Show in Folder'),
        cmd('copy-path', 'Copy File Path'),
        { type: 'separator' },
        { id: 'export-pdf', label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => { const st = targetState(); if (st) exportPdf(st); } },
        { id: 'print', label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => targetState()?.win.webContents.print({ printBackground: true }) },
        { type: 'separator' },
        cmd('close-tab', 'Close Tab', 'CmdOrCtrl+W'),
        { id: 'close-window', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => targetState()?.win.close() },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'Exit', role: 'quit' }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        cmd('toggle-edit', 'Edit Document', 'CmdOrCtrl+E'),
        { type: 'separator' },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        cmd('copy-rich', 'Copy as Formatted Text', 'CmdOrCtrl+Shift+C'),
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('find', 'Find…', 'CmdOrCtrl+F'),
        cmd('find-next', 'Find Next', 'F3'),
        cmd('find-prev', 'Find Previous', 'Shift+F3'),
        { type: 'separator' },
        cmd('grants', 'Editing Permissions…'),
        { id: 'open-backups', label: 'Open Backups Folder', click: () => openBackups() },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Theme', submenu: [radio('Follow System', 'theme', 'system'), radio('Light (Paper)', 'theme', 'light'), radio('Dark (Night)', 'theme', 'dark'), radio('Sepia', 'theme', 'sepia')] },
        { label: 'Typeface', submenu: [radio('Sans-serif (modern)', 'font', 'sans'), radio('Serif (book)', 'font', 'serif')] },
        { label: 'Page Width', submenu: [radio('Narrow', 'pageWidth', 'narrow'), radio('Normal', 'pageWidth', 'normal'), radio('Wide', 'pageWidth', 'wide'), radio('Full Window', 'pageWidth', 'full')] },
        { type: 'separator' },
        { id: 'toggle-outline', label: 'Outline Sidebar', type: 'checkbox', checked: s.showToc, accelerator: 'CmdOrCtrl+B', click: () => setSetting({ showToc: !settings.get().showToc }) },
        ...(isMac ? [] : [{ id: 'toggle-menubar', label: 'Always Show Menu Bar', type: 'checkbox', checked: s.showMenuBar, click: () => setSetting({ showMenuBar: !settings.get().showMenuBar }) }]),
        { type: 'separator' },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl+=', click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: () => setSetting({ fontScale: settings.get().fontScale - 0.1 }) },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: () => setSetting({ fontScale: 1 }) },
        { type: 'separator' },
        cmd('back', 'Back', isMac ? 'Cmd+[' : 'Alt+Left'),
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: '&Tabs',
      submenu: [
        cmd('next-tab', 'Next Tab', 'Ctrl+Tab'),
        cmd('prev-tab', 'Previous Tab', 'Ctrl+Shift+Tab'),
        cmd('next-tab', 'Next Tab', 'CmdOrCtrl+PageDown', { id: 'next-tab-alt', visible: false, acceleratorWorksWhenHidden: true }),
        cmd('prev-tab', 'Previous Tab', 'CmdOrCtrl+PageUp', { id: 'prev-tab-alt', visible: false, acceleratorWorksWhenHidden: true }),
        { type: 'separator' },
        cmd('duplicate-tab', 'Duplicate Tab'),
        cmd('move-tab-to-window', 'Move Tab to New Window'),
        { type: 'separator' },
        cmd('close-other-tabs', 'Close Other Tabs'),
        cmd('close-tabs-right', 'Close Tabs to the Right'),
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, visible: false, acceleratorWorksWhenHidden: true, click: () => command('select-tab', n - 1) })),
        { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', visible: false, acceleratorWorksWhenHidden: true, click: () => command('select-tab', -1) },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open Feature Showcase', click: () => openFile(SHOWCASE) },
        cmd('shortcuts', 'Keyboard Shortcuts', 'F1'),
        { type: 'separator' },
        updateReady
          ? { id: 'restart-to-update', label: `Restart to Update (${updater.status.version})`, click: () => updater.installNow() }
          : { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdatesInteractive() },
        { label: 'Releases Page', click: () => shell.openExternal(RELEASES_URL) },
        { type: 'separator' },
        {
          label: `About Neo Markdown Reader ${app.getVersion()}`,
          click: () => dialog.showMessageBox(targetState()?.win, { type: 'info', title: 'About', message: 'Neo Markdown Reader', detail: `Version ${app.getVersion()}\n© ${new Date().getFullYear()} Neo Gentrics. All rights reserved.` }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Right-click inside the page: spelling suggestions and clipboard actions in the editor, Copy elsewhere. */
function showEditContextMenu(win, params) {
  const items = [];
  if (params.isEditable && params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (!params.dictionarySuggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
    items.push({ label: 'Add to Dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) {
    items.push({ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
  } else if (params.selectionText) {
    items.push({ role: 'copy' }, { label: 'Copy as Formatted Text', click: () => win.webContents.send('menu:command', { cmd: 'copy-rich' }) });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function showTabContextMenu(state, { index, count, path: tabPath }) {
  const send = (cmd) => () => state.win.webContents.send('menu:command', { cmd, arg: index });
  Menu.buildFromTemplate([
    { label: 'Move to New Window', enabled: count > 1, click: send('move-tab-to-window') },
    { label: 'Duplicate', click: send('duplicate-tab') },
    { type: 'separator' },
    { label: 'Copy Path', click: () => clipboard.writeText(tabPath) },
    { label: 'Show in Folder', click: () => shell.showItemInFolder(tabPath) },
    { type: 'separator' },
    { label: 'Close', click: send('close-tab') },
    { label: 'Close Other Tabs', enabled: count > 1, click: send('close-other-tabs') },
    { label: 'Close Tabs to the Right', enabled: index < count - 1, click: send('close-tabs-right') },
  ]).popup({ window: state.win });
}

// ---------------------------------------------------------------- IPC
// Every handler validates its input: the page renders untrusted documents.
const isStr = (v, max = 8192) => typeof v === 'string' && v.length > 0 && v.length <= max;

function registerIpc() {
  ipcMain.handle('app:init', (e) => {
    const st = stateFor(e);
    const startup = st ? st.startup : { tabs: [], active: 0 };
    if (st) st.startup = { tabs: [], active: 0 };
    return {
      settings: rendererSettings(),
      platform: process.platform,
      version: app.getVersion(),
      startup: { ...startup, tabs: startup.tabs.map((t) => ({ path: t.path, scroll: t.scroll ?? settings.get().positions[t.path] ?? 0 })) },
      update: updater.status,
    };
  });

  ipcMain.handle('doc:read', async (e, p, opts = {}) => {
    if (!isStr(p, 4096) || !isMarkdownPath(p)) return { error: 'Not a Markdown file.' };
    try {
      const doc = await loadDoc(p, { remember: opts.remember !== false });
      const st = stateFor(e);
      if (st) ensureWatch(st, doc.path, doc.mtime);
      return { doc };
    } catch (err) { return { error: errorMessage(err, p) }; }
  });
  ipcMain.handle('doc:open-dialog', (e) => openViaDialog(stateFor(e)));
  ipcMain.handle('doc:showcase', async (e) => {
    const doc = await loadDoc(SHOWCASE, { remember: false });
    const st = stateFor(e);
    if (st) ensureWatch(st, doc.path, doc.mtime);
    return { doc };
  });
  ipcMain.handle('doc:resolve-link', async (e, href, fromPath) => {
    if (!isStr(href)) return { kind: 'none' };
    const res = await resolveLink(href, isStr(fromPath, 4096) ? fromPath : undefined);
    const st = stateFor(e);
    if (st && res.kind === 'doc') ensureWatch(st, res.doc.path, res.doc.mtime);
    return res;
  });

  ipcMain.handle('tabs:sync', (e, payload) => {
    const st = stateFor(e);
    if (!st || !payload || !Array.isArray(payload.tabs)) return;
    st.tabs = payload.tabs
      .filter((t) => isStr(t?.path, 4096) && isMarkdownPath(t.path))
      .slice(0, 100)
      .map((t) => ({ path: t.path, scroll: Number.isFinite(t.scroll) ? Math.min(1, Math.max(0, t.scroll)) : 0 }));
    st.active = Number.isInteger(payload.active) ? Math.max(0, Math.min(payload.active, st.tabs.length - 1)) : 0;
    const title = isStr(payload.title, 300) ? `${payload.title} — Neo Markdown Reader` : 'Neo Markdown Reader';
    if (st.win.getTitle() !== title) st.win.setTitle(title);
    if (isMac) st.win.setRepresentedFilename(st.tabs[st.active]?.path || '');
    syncWatchers(st);
    editing.pruneSession(st, st.tabs.map((t) => t.path));     // closing a tab ends "Just this time"
    if (st.tabs.length) settings.setPositions(Object.fromEntries(st.tabs.map((t) => [t.path, t.scroll])));
    snapshot(st);
    persistSession();
  });
  ipcMain.handle('tab:detach', (e, payload) => {
    const st = stateFor(e);
    if (!st || !isStr(payload?.path, 4096) || !isMarkdownPath(payload.path)) return false;
    const at = Number.isFinite(payload.screenX) && Number.isFinite(payload.screenY) ? { x: payload.screenX, y: payload.screenY } : null;
    createWindow({ tabs: [{ path: payload.path, scroll: Number(payload.scroll) || 0 }], at });
    return true;
  });
  ipcMain.handle('tab:context-menu', (e, info) => {
    const st = stateFor(e);
    if (st && info && Number.isInteger(info.index) && Number.isInteger(info.count) && isStr(info.path, 4096)) showTabContextMenu(st, info);
  });
  ipcMain.handle('window:close', (e) => stateFor(e)?.win.close());

  ipcMain.handle('shell:reveal', (_e, p) => { if (isStr(p, 4096) && isMarkdownPath(p)) shell.showItemInFolder(p); });
  ipcMain.handle('shell:open-external', (_e, url) => { if (isStr(url) && isSafeExternal(url)) shell.openExternal(url); });
  ipcMain.handle('clipboard:text', async (_e, text) => {
    if (typeof text === 'string' && text.length < 1e6) await clipboard.writeText(text);
  });
  ipcMain.handle('clipboard:rich', async (_e, { html, text } = {}) => {
    if (typeof html !== 'string' || typeof text !== 'string' || html.length > 2e7) return false;
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
    return true;
  });

  ipcMain.handle('doc:export-pdf', (e) => { const st = stateFor(e); return st ? exportPdf(st) : false; });
  ipcMain.handle('doc:print', (e) => { stateFor(e)?.win.webContents.print({ printBackground: true }); });
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return rendererSettings();
    const allowed = ['theme', 'font', 'fontScale', 'pageWidth', 'showToc', 'showMenuBar'];
    setSetting(Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))));
    return rendererSettings();
  });
  ipcMain.handle('recent:clear', () => { settings.update({ recent: [] }); app.clearRecentDocuments(); broadcastSettings(); });
  ipcMain.handle('find:start', (e, text, opts = {}) => {
    if (!isStr(text, 500)) return;
    e.sender.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase });
  });
  ipcMain.handle('find:stop', (e) => e.sender.stopFindInPage('keepSelection'));
  ipcMain.handle('update:install', () => updater.installNow());
  ipcMain.handle('update:open-page', () => shell.openExternal(updater.status.url || RELEASES_URL));

  // ---- editing: the page asks, the main process decides and does the writing
  ipcMain.handle('edit:request', async (e, p) => {
    const st = stateFor(e);
    if (!st || !isStr(p, 4096) || !isMarkdownPath(p)) return { ok: false, reason: 'invalid' };
    return editing.requestEdit(st, p);
  });
  ipcMain.handle('doc:save', async (e, payload = {}) => {
    const st = stateFor(e);
    if (!st || !isStr(payload.path, 4096) || typeof payload.content !== 'string' || payload.content.length > 5e7) return { ok: false, reason: 'invalid' };
    const res = await editing.save(st, {
      path: payload.path, content: payload.content, baseMtime: Number(payload.baseMtime),
      eol: payload.eol === '\r\n' ? '\r\n' : '\n', bom: payload.bom === true,
    });
    if (res.ok) st.known.set(payload.path, res.mtime);       // our own save is not an "outside change"
    return res;
  });
  ipcMain.handle('doc:save-as', async (e, payload = {}) => {
    const st = stateFor(e);
    if (!st || typeof payload.content !== 'string' || payload.content.length > 5e7) return { ok: false, reason: 'invalid' };
    const res = await editing.saveAs(st, {
      content: payload.content,
      suggestedName: isStr(payload.suggestedName, 260) ? payload.suggestedName : 'Untitled.md',
      defaultDir: isStr(payload.defaultDir, 4096) && fs.existsSync(payload.defaultDir) ? payload.defaultDir : undefined,
      eol: payload.eol === '\n' || payload.eol === '\r\n' ? payload.eol : undefined,
      bom: payload.bom === true,
    });
    if (res.ok) {
      settings.addRecent(res.doc.path);
      rebuildMenu();
      ensureWatch(st, res.doc.path, res.doc.mtime);
    }
    return res;
  });
  ipcMain.handle('dialog:unsaved', (e, info = {}) => {
    const st = stateFor(e);
    if (!st) return 'cancel';
    return editing.confirmUnsaved(st, { name: isStr(info.name, 300) ? info.name : 'Untitled', count: Number.isInteger(info.count) ? info.count : 1 });
  });
  ipcMain.handle('grants:list', () => editing.listGrants());
  ipcMain.handle('grants:revoke', (_e, kind, value) => (isStr(value, 4096) ? editing.revokeGrant(kind, value) : editing.listGrants()));
  ipcMain.handle('backups:open', () => openBackups());
}

function backupDir() { return path.join(app.getPath('userData'), 'backups'); }

async function openBackups() {
  await fs.promises.mkdir(backupDir(), { recursive: true });
  shell.openPath(backupDir());
}

// ---------------------------------------------------------------- startup
app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  updater = new Updater(onUpdateStatus);
  editing = new Editing({ settings, dialog, backupDir: backupDir(), defaultDir: app.getPath('documents') });
  // Documents never need camera, mic, notifications, etc.; only clipboard writes for "Copy".
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  nativeTheme.on('updated', () => { if (settings.get().theme === 'system') broadcastSettings(); });
  registerIpc();
  rebuildMenu();

  const files = [fileFromArgv(process.argv), ...pendingOpen].filter(Boolean);
  const saved = settings.get();
  if (files.length) {
    createWindow({ tabs: files.map((p) => ({ path: p })) });
  } else if (saved.restoreSession && saved.session.length) {
    for (const w of saved.session) createWindow({ tabs: w.tabs, active: w.active, bounds: w.bounds });
  } else {
    createWindow();
  }
  updater.start();

  app.on('activate', () => { if (!liveStates().length) createWindow(); });
});

app.on('before-quit', () => {
  quitting = true;
  persistSession();
  settings?.flush();
});
// Windows send their final tab state as they close, which can arrive after before-quit.
app.on('will-quit', () => {
  persistSession();
  settings?.flush();
});
app.on('window-all-closed', () => {
  if (isMac) return;
  quitting = true;
  settings?.flush();
  app.quit();
});
