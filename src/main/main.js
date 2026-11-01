'use strict';
const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeTheme, protocol, safeStorage, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { Settings } = require('./settings');
const { isMarkdownPath, isLockedPath, isOpenablePath, fileFromArgv, readMarkdown, readDocument } = require('./files');
const locked = require('./locked');
const { CodeSandbox, registerScheme, runnableLang, TIMEOUT: RUN_TIMEOUT } = require('./sandbox');
const ai = require('./ai');
const { Updater, RELEASES_URL } = require('./updater');
const { Editing } = require('./editing');
const { scanFolder, searchFolder } = require('./folders');
const { AnnotationStore } = require('./annotations');
const publish = require('./publish');

const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_HTML = path.join(ROOT, 'dist', 'index.html');
const SHOWCASE = path.join(ROOT, 'samples', 'showcase.md');
const THEME_BG = { light: '#e8ebf0', dark: '#0e1014', sepia: '#e6dccb', mist: '#dfe5ec', forest: '#0b120e', dusk: '#110e18', contrast: '#000000' };

registerScheme(protocol);                     // the code sandbox's private scheme (must precede app ready)
let sandbox = null;

// Tests point the app at a throwaway profile folder.
if (process.env.NMR_USER_DATA) app.setPath('userData', process.env.NMR_USER_DATA);

let settings;
let updater;
let editing;
let annotations;
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
  return { ...settings.get(), resolvedTheme: resolvedTheme(), paperAuto: publish.resolvePaper('auto', app.getLocaleCountryCode()), positions: undefined, session: undefined };
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
 * @param {{ tabs?: {path:string, scroll?:number}[], active?: number, bounds?: object, at?: {x:number,y:number}, folder?: string|null }} opts
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
    startup: { tabs: opts.tabs || [], active: opts.active || 0, folder: opts.folder || null },
    folder: null,             // { root, scan, unwatch } once a folder is open in this window
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
    state.folder?.unwatch?.();
    windows.delete(id);
    if (state.forget) { sessionById.delete(id); persistSession(); }
  });

  win.loadFile(RENDERER_HTML);
  return state;
}

// ---------------------------------------------------------------- locked documents
/**
 * Keys of locked documents unlocked in this app session, by path. They live only in memory: quitting
 * the app (or File → Lock Now) forgets them, and the next open asks for the password again.
 */
const lockKeys = new Map();
const lockFails = new Map();
const lockId = (p) => (process.platform === 'win32' || isMac ? path.resolve(p).toLowerCase() : path.resolve(p));
const keyFor = (p) => lockKeys.get(lockId(p))?.key || null;
const readAny = (p) => readDocument(p, keyFor);
function sealLocked(p, content) {
  const entry = lockKeys.get(lockId(p));
  if (!entry) return null;
  return locked.sealWithKey({ content, name: path.basename(p).replace(/\.mdlock$/i, '') }, entry.key, { salt: entry.salt, kdf: entry.kdf });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tell every window showing `p` that it changed (e.g. it was just locked again). */
async function refreshEverywhere(p) {
  let doc;
  try { doc = await readAny(p); } catch { return; }
  for (const st of liveStates()) {
    if (st.tabs.some((t) => lockId(t.path) === lockId(p))) {
      st.known.set(doc.path, doc.mtime);
      st.win.webContents.send('doc:changed', { ...doc, force: true });
    }
  }
}

// ---------------------------------------------------------------- AI assist key
// The Anthropic API key is encrypted by the operating system (Windows DPAPI, macOS Keychain, Linux
// secret service). Where no real secret store exists it is kept for this session only.
let aiKeyMemory = null;
const aiKeyFile = () => path.join(app.getPath('userData'), 'ai-key.bin');
function secureStorage() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text' || backend === 'unknown') return false;
  }
  return true;
}
function loadAiKey() {
  if (aiKeyMemory) return aiKeyMemory;
  try { if (secureStorage()) return safeStorage.decryptString(fs.readFileSync(aiKeyFile())); } catch { /* none saved */ }
  return null;
}
function saveAiKey(key) {
  if (secureStorage()) { fs.writeFileSync(aiKeyFile(), safeStorage.encryptString(key)); aiKeyMemory = null; return 'encrypted'; }
  aiKeyMemory = key;
  return 'session';
}
function clearAiKey() { aiKeyMemory = null; fs.rmSync(aiKeyFile(), { force: true }); }
const aiRuns = new Map();          // request id -> AbortController

// ---------------------------------------------------------------- opening files
function sendDoc(state, channel, doc) {
  if (state.win.isDestroyed()) return;
  state.win.webContents.send(channel, doc);
  ensureWatch(state, doc.path, doc.mtime);
}

async function loadDoc(filePath, { remember = true } = {}) {
  const doc = await readAny(filePath);
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
      const doc = await readAny(p);
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
  const folder = state.folder?.root || null;
  if (!state.tabs.length && !folder) { sessionById.delete(id); return; }
  sessionById.set(id, {
    bounds: { ...state.win.getNormalBounds(), maximized: state.win.isMaximized() },
    tabs: state.tabs,
    active: state.active,
    folder,
  });
}

function persistSession() {
  if (!settings) return;
  settings.update({ session: [...sessionById.values()].filter((w) => w.tabs.length || w.folder) });
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
  if (isOpenablePath(target)) {
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
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdx', 'mdlock'] },
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

const EXPORT_FORMATS = {
  pdf: { title: 'Export as PDF', name: 'PDF', ext: 'pdf' },
  docx: { title: 'Export as Word Document', name: 'Word Document', ext: 'docx' },
  html: { title: 'Export as Web Page', name: 'Web Page', ext: 'html' },
  txt: { title: 'Export as Plain Text', name: 'Plain Text', ext: 'txt' },
};

/** Ask where to save an export of the active tab's document. */
async function exportTarget(state, format) {
  const f = EXPORT_FORMATS[format];
  const current = state.tabs[state.active]?.path;
  const base = current ? path.basename(current).replace(/\.[^.]+$/, '') : 'document';
  const res = await dialog.showSaveDialog(state.win, {
    title: f.title,
    defaultPath: path.join(current ? path.dirname(current) : app.getPath('documents'), `${base}.${f.ext}`),
    filters: [{ name: f.name, extensions: [f.ext] }],
  });
  return res.canceled || !res.filePath ? null : res.filePath;
}

/** Exports are built in the main process; the page only hands over its rendered content. */
async function runExport(state, payload) {
  const format = payload?.format;
  if (!EXPORT_FORMATS[format] || !payload.meta || typeof payload.meta !== 'object') return { ok: false, error: 'Nothing to export' };
  const css = typeof payload.css === 'string' && payload.css.length < 2e6 ? payload.css : '';
  const theme = Object.hasOwn(THEME_BG, payload.theme) ? payload.theme : 'light';
  const font = payload.font === 'serif' ? 'serif' : 'sans';
  const meta = {
    name: typeof payload.meta.name === 'string' ? payload.meta.name.slice(0, 500) : '',
    title: typeof payload.meta.title === 'string' ? payload.meta.title.slice(0, 1000) : '',
    frontMatter: payload.meta.frontMatter && typeof payload.meta.frontMatter === 'object' ? payload.meta.frontMatter : null,
    toc: Array.isArray(payload.meta.toc) ? payload.meta.toc.slice(0, 2000).filter((h) => h && isStr(h.id, 500) && isStr(h.text, 1000) && Number.isInteger(h.level)) : [],
    baseUrl: typeof payload.meta.baseUrl === 'string' ? payload.meta.baseUrl : '',
  };
  if (format === 'pdf' && payload.options) setSetting({ exportOptions: payload.options });
  const saved = settings.get().exportOptions;
  const options = { ...saved, paper: publish.resolvePaper(saved.paper, app.getLocaleCountryCode()) };
  const filePath = await exportTarget(state, format);
  if (!filePath) return { ok: false, canceled: true };
  try {
    let data;
    let extra = {};
    if (format === 'pdf' || format === 'html') {
      if (!isStr(payload.content, 2e8)) return { ok: false, error: 'Nothing to export' };
    }
    if (format === 'pdf') {
      const out = await publish.renderPdf({ root: ROOT, payload: { content: payload.content, meta, css, theme: options.colors === 'theme' ? theme : 'light', font }, options });
      data = out.pdf;
      extra = { numbers: out.numbers };
    } else if (format === 'html') {
      const exportCss = await fs.promises.readFile(path.join(ROOT, 'dist', 'export.css'), 'utf8');
      data = await publish.buildStandaloneHtml({ content: payload.content, meta, css, theme: options.colors === 'theme' ? theme : 'light', font, exportCss, distDir: path.join(ROOT, 'dist') });
    } else if (format === 'docx') {
      if (!Array.isArray(payload.model)) return { ok: false, error: 'Nothing to export' };
      const brand = settings.get().brand;
      data = await publish.renderDocx({ root: ROOT, payload: { model: payload.model, meta, css }, options: { ...options, accent: brand.accent, bodyFont: brand.bodyFont, headingFont: brand.headingFont, codeFont: brand.codeFont } });
    } else {
      if (typeof payload.text !== 'string') return { ok: false, error: 'Nothing to export' };
      data = payload.text.replace(/\r?\n/g, process.platform === 'win32' ? '\r\n' : '\n');
    }
    await fs.promises.writeFile(filePath, data);
    if (!process.env.NMR_NO_REVEAL) shell.showItemInFolder(filePath);
    return { ok: true, path: filePath, ...extra };
  } catch (err) {
    return { ok: false, error: errorMessage(err, filePath) };
  }
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
        { id: 'open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => { const st = targetState(); if (st) openFolderDialog(st); } },
        {
          label: 'Open Recent Folder',
          submenu: s.recentFolders.length
            ? s.recentFolders.map((f) => ({ label: f.length > 80 ? '…' + f.slice(-78) : f, click: () => openRecentFolder(targetState(), f) }))
            : [{ label: 'No recent folders', enabled: false }],
        },
        cmd('close-folder', 'Close Folder'),
        cmd('reopen-closed-tab', 'Reopen Closed Tab', 'CmdOrCtrl+Shift+T'),
        { type: 'separator' },
        cmd('save', 'Save', 'CmdOrCtrl+S'),
        cmd('save-as', 'Save As…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('lock-protect', 'Protect with Password…'),
        cmd('lock-now', 'Lock Now'),
        cmd('lock-remove', 'Save an Unlocked Copy…'),
        { type: 'separator' },
        cmd('reload', 'Reload File', 'F5'),
        cmd('reveal', 'Show in Folder'),
        cmd('copy-path', 'Copy File Path'),
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            cmd('export-pdf', 'PDF…', 'CmdOrCtrl+Shift+E'),
            cmd('export-docx', 'Word Document (.docx)…'),
            cmd('export-html', 'Web Page (.html)…'),
            cmd('export-txt', 'Plain Text (.txt)…'),
          ],
        },
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
        cmd('find-in-folder', 'Find in Folder…', 'CmdOrCtrl+Shift+F'),
        { type: 'separator' },
        cmd('compare-saved', 'Compare with Saved Version'),
        cmd('compare-file', 'Compare with File…'),
        { type: 'separator' },
        cmd('highlight', 'Highlight Selection', 'CmdOrCtrl+Shift+H'),
        cmd('bookmark', 'Bookmark This File', 'CmdOrCtrl+D'),
        { type: 'separator' },
        cmd('grants', 'Editing Permissions…'),
        {
          label: 'AI Assist',
          submenu: [
            cmd('ai-summarize', 'Summarize Document'),
            cmd('ai-explain', 'Explain Selection'),
            cmd('ai-report', 'Turn Notes into a Report'),
            { type: 'separator' },
            cmd('ai-settings', 'AI Assist Settings…'),
          ],
        },
        { id: 'allow-run', label: 'Allow Running Code Blocks', type: 'checkbox', checked: s.runCode !== 'off', click: () => setSetting({ runCode: settings.get().runCode === 'off' ? 'ask' : 'off' }) },
        { id: 'open-backups', label: 'Open Backups Folder', click: () => openBackups() },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Theme', submenu: [radio('Follow System', 'theme', 'system'), { type: 'separator' }, radio('Paper (light)', 'theme', 'light'), radio('Sepia', 'theme', 'sepia'), radio('Mist', 'theme', 'mist'), { type: 'separator' }, radio('Night (dark)', 'theme', 'dark'), radio('Forest (dark)', 'theme', 'forest'), radio('Dusk (dark)', 'theme', 'dusk'), radio('High Contrast', 'theme', 'contrast')] },
        { label: 'Typeface', submenu: [radio('Sans-serif (modern)', 'font', 'sans'), radio('Serif (book)', 'font', 'serif')] },
        { label: 'Page Width', submenu: [radio('Narrow', 'pageWidth', 'narrow'), radio('Normal', 'pageWidth', 'normal'), radio('Wide', 'pageWidth', 'wide'), radio('Full Window', 'pageWidth', 'full')] },
        cmd('customize-theme', 'Customize Theme…'),
        { type: 'separator' },
        cmd('present', 'Present as Slides', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        cmd('quick-open', 'Go to File or Heading…', 'CmdOrCtrl+K'),
        { type: 'separator' },
        { id: 'toggle-outline', label: 'Sidebar', type: 'checkbox', checked: s.showToc, accelerator: 'CmdOrCtrl+B', click: () => setSetting({ showToc: !settings.get().showToc }) },
        cmd('panel-outline', 'Show Outline'),
        cmd('panel-files', 'Show Files'),
        cmd('panel-highlights', 'Show Highlights'),
        { type: 'separator' },
        cmd('split-toggle', 'Split View', 'CmdOrCtrl+\\'),
        cmd('split-link', 'Link Scrolling in Split View'),
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
        cmd('open-side', 'Open Tab to the Side'),
        cmd('compare-tabs', 'Compare Tab with…'),
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
    { label: 'Open to the Side', enabled: count > 1, click: send('open-side') },
    { label: 'Compare with…', enabled: count > 1, click: send('compare-tabs') },
    { type: 'separator' },
    { label: 'Copy Path', click: () => clipboard.writeText(tabPath) },
    { label: 'Show in Folder', click: () => shell.showItemInFolder(tabPath) },
    { type: 'separator' },
    { label: 'Close', click: send('close-tab') },
    { label: 'Close Other Tabs', enabled: count > 1, click: send('close-other-tabs') },
    { label: 'Close Tabs to the Right', enabled: index < count - 1, click: send('close-tabs-right') },
  ]).popup({ window: state.win });
}

// ---------------------------------------------------------------- folders (File > Open Folder…)
/** Open `root` as this window's folder: scan it, watch it for changes, remember it. */
async function setFolder(state, root) {
  state.folder?.unwatch?.();
  state.folder = null;
  if (!root) { snapshot(state); persistSession(); return null; }
  const stat = await fs.promises.stat(root).catch(() => null);
  if (!stat?.isDirectory()) return null;
  const scan = await scanFolder(root);
  const folder = { root, scan, unwatch: null };
  state.folder = folder;
  let timer = null;
  try {
    const watcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (state.folder !== folder || state.win.isDestroyed()) return;
        folder.scan = await scanFolder(root);
        state.win.webContents.send('folder:changed', folderInfo(folder.scan));
      }, 700);
    });
    watcher.on('error', () => {});
    folder.unwatch = () => { clearTimeout(timer); watcher.close(); };
  } catch { /* watching isn't available everywhere; the Refresh button still works */ }
  const recentFolders = [root, ...settings.get().recentFolders.filter((f) => f.toLowerCase() !== root.toLowerCase())];
  settings.update({ recentFolders });
  snapshot(state);
  persistSession();
  rebuildMenu();
  return folderInfo(scan);
}

const folderInfo = (scan) => ({ root: scan.root, name: scan.name, tree: scan.tree, count: scan.files.length, truncated: scan.truncated });

async function openFolderDialog(state) {
  const res = await dialog.showOpenDialog(state.win, {
    title: 'Open Folder', properties: ['openDirectory'],
    defaultPath: settings.get().recentFolders[0] || app.getPath('documents'),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const info = await setFolder(state, res.filePaths[0]);
  if (info) state.win.webContents.send('folder:opened', info);
  return info;
}

async function openRecentFolder(state, root) {
  if (!state) return;
  const info = await setFolder(state, root);
  if (info) state.win.webContents.send('folder:opened', info);
  else state.win.webContents.send('doc:error', { message: `Folder not found:\n${root}` });
}

// ---------------------------------------------------------------- IPC
// Every handler validates its input: the page renders untrusted documents.
const isStr = (v, max = 8192) => typeof v === 'string' && v.length > 0 && v.length <= max;

function registerIpc() {
  ipcMain.handle('app:init', async (e) => {
    const st = stateFor(e);
    const startup = st ? st.startup : { tabs: [], active: 0, folder: null };
    if (st) st.startup = { tabs: [], active: 0, folder: null };
    const folder = st && startup.folder ? await setFolder(st, startup.folder) : null;
    return {
      settings: rendererSettings(),
      platform: process.platform,
      version: app.getVersion(),
      startup: { ...startup, folder, tabs: startup.tabs.map((t) => ({ path: t.path, scroll: t.scroll ?? settings.get().positions[t.path] ?? 0 })) },
      update: updater.status,
    };
  });

  // ---- folders: only the folder the user opened in this window can be listed or searched
  ipcMain.handle('folder:open', (e) => { const st = stateFor(e); return st ? openFolderDialog(st) : null; });
  ipcMain.handle('folder:close', (e) => { const st = stateFor(e); if (st) setFolder(st, null); });
  ipcMain.handle('folder:refresh', async (e) => {
    const st = stateFor(e);
    if (!st?.folder) return null;
    st.folder.scan = await scanFolder(st.folder.root);
    return folderInfo(st.folder.scan);
  });
  ipcMain.handle('folder:search', async (e, query) => {
    const st = stateFor(e);
    if (!st?.folder || !isStr(query, 200)) return { results: [], total: 0, truncated: false };
    return searchFolder(st.folder.scan, query);
  });
  ipcMain.handle('doc:pick', async (e) => {
    const st = stateFor(e);
    const files = await showOpenDialog(st?.win);
    if (!files[0]) return null;
    try { return { doc: await loadDoc(files[0], { remember: false }) }; } catch (err) { return { error: errorMessage(err, files[0]) }; }
  });

  // ---- private highlights & bookmarks (stored by the app, never in the file)
  ipcMain.handle('annotations:get', (_e, p) => (isStr(p, 4096) && isMarkdownPath(p) ? annotations.get(p) : []));
  ipcMain.handle('annotations:set', (_e, p, list) => (isStr(p, 4096) && isMarkdownPath(p) && Array.isArray(list) ? annotations.set(p, list) : []));
  ipcMain.handle('bookmarks:toggle', (_e, p) => {
    if (!isStr(p, 4096) || !isOpenablePath(p)) return settings.get().bookmarks;
    const list = settings.get().bookmarks;
    const has = list.some((b) => b.toLowerCase() === p.toLowerCase());
    settings.update({ bookmarks: has ? list.filter((b) => b.toLowerCase() !== p.toLowerCase()) : [p, ...list] });
    broadcastSettings();
    return settings.get().bookmarks;
  });

  ipcMain.handle('doc:read', async (e, p, opts = {}) => {
    if (!isStr(p, 4096) || !isOpenablePath(p)) return { error: 'Not a Markdown file.' };
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
      .filter((t) => isStr(t?.path, 4096) && isOpenablePath(t.path))
      .slice(0, 100)
      .map((t) => ({ path: t.path, scroll: Number.isFinite(t.scroll) ? Math.min(1, Math.max(0, t.scroll)) : 0 }));
    st.active = Number.isInteger(payload.active) ? Math.max(0, Math.min(payload.active, st.tabs.length - 1)) : 0;
    const title = isStr(payload.title, 300) ? `${payload.title} — Neo Markdown Reader` : 'Neo Markdown Reader';
    if (st.win.getTitle() !== title) st.win.setTitle(title);
    if (isMac) st.win.setRepresentedFilename(st.tabs[st.active]?.path || '');
    syncWatchers(st);
    editing.pruneSession(st, st.tabs.map((t) => t.path));     // closing a tab ends "Just this time"
    if (st.runGrants) { const open = new Set(st.tabs.map((t) => lockId(t.path))); for (const k of st.runGrants) if (k !== 'untitled' && !open.has(k)) st.runGrants.delete(k); }
    if (st.tabs.length) settings.setPositions(Object.fromEntries(st.tabs.map((t) => [t.path, t.scroll])));
    snapshot(st);
    persistSession();
  });
  ipcMain.handle('tab:detach', (e, payload) => {
    const st = stateFor(e);
    if (!st || !isStr(payload?.path, 4096) || !isOpenablePath(payload.path)) return false;
    const at = Number.isFinite(payload.screenX) && Number.isFinite(payload.screenY) ? { x: payload.screenX, y: payload.screenY } : null;
    createWindow({ tabs: [{ path: payload.path, scroll: Number(payload.scroll) || 0 }], at });
    return true;
  });
  ipcMain.handle('tab:context-menu', (e, info) => {
    const st = stateFor(e);
    if (st && info && Number.isInteger(info.index) && Number.isInteger(info.count) && isStr(info.path, 4096)) showTabContextMenu(st, info);
  });
  ipcMain.handle('window:close', (e) => stateFor(e)?.win.close());

  ipcMain.handle('shell:reveal', (_e, p) => { if (isStr(p, 4096) && isOpenablePath(p)) shell.showItemInFolder(p); });
  ipcMain.handle('shell:open-external', (_e, url) => { if (isStr(url) && isSafeExternal(url)) shell.openExternal(url); });
  ipcMain.handle('clipboard:text', async (_e, text) => {
    if (typeof text === 'string' && text.length < 1e6) await clipboard.writeText(text);
  });
  ipcMain.handle('clipboard:rich', async (_e, { html, text } = {}) => {
    if (typeof html !== 'string' || typeof text !== 'string' || html.length > 2e7) return false;
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
    return true;
  });

  ipcMain.handle('export:run', (e, payload) => { const st = stateFor(e); return st ? runExport(st, payload) : { ok: false }; });
  ipcMain.handle('window:fullscreen', (e, on) => {
    const st = stateFor(e);
    if (!st) return false;
    if (on) { st.wasFullScreen = st.win.isFullScreen(); st.win.setFullScreen(true); } else if (!st.wasFullScreen) st.win.setFullScreen(false);
    return st.win.isFullScreen();
  });
  ipcMain.handle('brand:pick-stylesheet', async (e) => {
    const st = stateFor(e);
    const res = await dialog.showOpenDialog(st?.win, { title: 'Choose a brand stylesheet', properties: ['openFile'], filters: [{ name: 'Stylesheet', extensions: ['css'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    setSetting({ brand: { ...settings.get().brand, stylesheet: res.filePaths[0] } });
    return res.filePaths[0];
  });
  ipcMain.handle('brand:stylesheet', async () => {
    const file = settings.get().brand.stylesheet;
    if (!file) return { path: '', css: '' };
    try {
      const st = await fs.promises.stat(file);
      if (st.size > 1024 * 1024) return { path: file, css: '', error: 'That stylesheet is larger than 1 MB.' };
      return { path: file, css: await fs.promises.readFile(file, 'utf8') };
    } catch (err) { return { path: file, css: '', error: errorMessage(err, file) }; }
  });
  ipcMain.handle('doc:print', (e) => { stateFor(e)?.win.webContents.print({ printBackground: true }); });
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return rendererSettings();
    const allowed = ['theme', 'font', 'fontScale', 'pageWidth', 'showToc', 'showMenuBar', 'exportOptions', 'brand'];
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
    if (!st || !isStr(p, 4096) || !isOpenablePath(p)) return { ok: false, reason: 'invalid' };
    if (isLockedPath(p) && !keyFor(p)) return { ok: false, reason: 'locked' };
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

  // ---- AI assist: off by default, the reader's own key, only what they choose is sent
  ipcMain.handle('ai:status', () => ({ ...settings.get().ai, hasKey: !!loadAiKey(), secure: secureStorage(), models: ai.MODELS.map(({ id, label }) => ({ id, label })) }));
  ipcMain.handle('ai:configure', (_e, cfg = {}) => {
    let stored = null;
    if (cfg.clearKey === true) clearAiKey();
    if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) {
      const key = cfg.apiKey.trim();
      if (!ai.KEY_RE.test(key)) return { error: 'That doesn’t look like an Anthropic API key (they start with sk-ant-).' };
      stored = saveAiKey(key);
    }
    setSetting({ ai: { ...settings.get().ai, ...(typeof cfg.enabled === 'boolean' ? { enabled: cfg.enabled } : {}), ...(isStr(cfg.model, 100) ? { model: cfg.model } : {}) } });
    return { ok: true, stored, ...settings.get().ai, hasKey: !!loadAiKey(), secure: secureStorage() };
  });
  ipcMain.handle('ai:run', async (e, req = {}) => {
    const conf = settings.get().ai;
    const apiKey = loadAiKey();
    if (!conf.enabled || !apiKey) return { error: 'AI assist is off.', setup: true };
    if (isStr(req.path, 4096) && isLockedPath(req.path)) return { error: 'AI assist is off for locked documents, so their text never leaves this computer.' };
    if (!isStr(req.id, 100)) return { error: 'invalid' };
    let content;
    try {
      content = ai.buildPrompt(req.action, {
        text: typeof req.text === 'string' ? req.text : '',
        selection: typeof req.selection === 'string' ? req.selection : '',
        title: isStr(req.title, 500) ? req.title : '',
      });
    } catch (err) { return { error: err.message }; }
    const { Anthropic } = publish.exportTools(ROOT);
    const ctl = new AbortController();
    aiRuns.set(req.id, ctl);
    try {
      return await ai.runAi({
        Anthropic, apiKey, model: conf.model, content, signal: ctl.signal,
        baseURL: process.env.NMR_AI_BASE_URL || undefined,              // tests point this at a local fake
        onText: (text) => { if (!e.sender.isDestroyed()) e.sender.send('ai:delta', { id: req.id, text }); },
      });
    } catch (err) {
      return { error: ctl.signal.aborted ? 'Stopped.' : ai.friendlyError(err, Anthropic) };
    } finally { aiRuns.delete(req.id); }
  });
  ipcMain.handle('ai:cancel', (_e, id) => { aiRuns.get(id)?.abort(); });

  // ---- running code blocks: always asked, always sandboxed
  ipcMain.handle('code:run', async (e, req = {}) => {
    const st = stateFor(e);
    if (!st) return { error: 'No window' };
    if (settings.get().runCode === 'off') return { error: 'Running code is switched off. Turn it on under Edit → Allow Running Code Blocks.', off: true };
    const lang = runnableLang(req.lang);
    if (!lang) return { error: 'Only JavaScript and Python code can be run.' };
    if (typeof req.code !== 'string' || !req.code.trim() || req.code.length > 200_000) return { error: 'There’s no code to run.' };
    const docKey = isStr(req.path, 4096) ? lockId(req.path) : 'untitled';
    st.runGrants ??= new Set();
    if (!st.runGrants.has(docKey)) {
      const label = lang === 'python' ? 'Python' : 'JavaScript';
      const lines = req.code.split('\n');
      const preview = lines.slice(0, 18).join('\n').slice(0, 1400) + (lines.length > 18 || req.code.length > 1400 ? '\n…' : '');
      const { response, checkboxChecked } = await dialog.showMessageBox(st.win, {
        type: 'question', title: 'Run code?', noLink: true,
        message: `Run this ${label} code${isStr(req.name, 300) ? ` from “${req.name}”` : ''}?`,
        detail: `${preview}\n\nIt runs in a sealed sandbox: it can’t read or change your files, use the network or see your settings, and it’s stopped after ${RUN_TIMEOUT[lang] / 1000} seconds.`,
        buttons: ['Run', 'Cancel'], defaultId: 0, cancelId: 1,
        checkboxLabel: 'Don’t ask again for this document until I close it',
      });
      if (response !== 0) return { canceled: true };
      if (checkboxChecked) st.runGrants.add(docKey);
    }
    try {
      sandbox ??= new CodeSandbox({ dir: path.join(ROOT, 'dist', 'sandbox'), devTools: !app.isPackaged });
      return await sandbox.run({ lang, code: req.code });
    } catch (err) { return { error: String(err?.message || err) }; }
  });

  // ---- password-locked documents
  ipcMain.handle('lock:unlock', async (e, p, password) => {
    if (!isStr(p, 4096) || !isLockedPath(p) || typeof password !== 'string' || password.length > 1024) return { error: 'Enter the password.' };
    const id = lockId(p);
    const fails = lockFails.get(id) || 0;
    if (fails >= 3) await sleep(Math.min(8000, 1000 * 2 ** (fails - 3)));     // slow down guessing
    try {
      const res = await locked.unlock(await fs.promises.readFile(p, 'utf8'), password);
      lockKeys.set(id, { key: res.key, salt: res.salt, kdf: res.kdf });
      lockFails.delete(id);
      const doc = await loadDoc(p, { remember: false });
      const st = stateFor(e);
      if (st) ensureWatch(st, doc.path, doc.mtime);
      return { doc };
    } catch (err) {
      if (err.code === 'WRONG_PASSWORD') { lockFails.set(id, fails + 1); return { error: err.message, wrong: true }; }
      return { error: errorMessage(err, p) };
    }
  });
  ipcMain.handle('lock:protect', async (e, payload = {}) => {
    const st = stateFor(e);
    const p = payload.path;
    if (!st || !isStr(p, 4096) || !isMarkdownPath(p) || !st.tabs.some((t) => lockId(t.path) === lockId(p))) return { error: 'Save the document first.' };
    const password = payload.password;
    if (typeof password !== 'string' || [...password].length < locked.MIN_PASSWORD || password.length > 1024) return { error: `Use a password of at least ${locked.MIN_PASSWORD} characters.` };
    const target = p.replace(/\.[^.\\/]+$/, '') + '.mdlock';
    if (fs.existsSync(target)) {
      const { response } = await dialog.showMessageBox(st.win, {
        type: 'warning', title: 'Replace locked file?', noLink: true, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0,
        message: `“${path.basename(target)}” already exists.`, detail: 'Replacing it overwrites that locked document with this one.',
      });
      if (response !== 1) return { canceled: true };
    }
    try {
      const source = await readMarkdown(p);
      const res = await locked.lock({ content: source.content, name: source.name }, password);
      await fs.promises.writeFile(target, res.text);
      // Read it back before touching the original, so a failed write can never cost the document.
      const check = locked.unlockWithKey(await fs.promises.readFile(target, 'utf8'), res.key);
      if (check.content !== source.content) throw new Error('The locked copy could not be verified, so nothing else was changed.');
      lockKeys.set(lockId(target), { key: res.key, salt: res.salt, kdf: res.kdf });
      let trashed = false;
      if (payload.replace === true) { await shell.trashItem(p); trashed = true; }
      const doc = await loadDoc(target);
      ensureWatch(st, doc.path, doc.mtime);
      return { doc, trashed };
    } catch (err) { return { error: errorMessage(err, target) }; }
  });
  ipcMain.handle('lock:forget', async (_e, p) => {
    if (!isStr(p, 4096) || !isLockedPath(p)) return false;
    lockKeys.delete(lockId(p));
    await refreshEverywhere(p);               // other windows showing it
    try { return { doc: await readAny(p) }; } catch { return { doc: null }; }
  });
  ipcMain.handle('lock:remove', async (e, p) => {
    const st = stateFor(e);
    if (!st || !isStr(p, 4096) || !isLockedPath(p) || !keyFor(p)) return { error: 'Unlock the document first.' };
    try {
      const doc = await readAny(p);
      let suggested = path.basename(p).replace(/\.mdlock$/i, '');
      if (!isMarkdownPath(suggested)) suggested += '.md';
      const res = await dialog.showSaveDialog(st.win, {
        title: 'Save an Unlocked Copy', defaultPath: path.join(path.dirname(p), suggested),
        filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      let target = res.filePath;
      if (!isMarkdownPath(target)) target += '.md';
      if (fs.existsSync(target)) await editing.backup(target);
      await fs.promises.writeFile(target, doc.content);
      const out = await loadDoc(target);
      ensureWatch(st, out.path, out.mtime);
      return { doc: out };
    } catch (err) { return { error: errorMessage(err, p) }; }
  });
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
  editing = new Editing({ settings, dialog, backupDir: backupDir(), defaultDir: app.getPath('documents'), sealLocked });
  annotations = new AnnotationStore(app.getPath('userData'));
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
    for (const w of saved.session) createWindow({ tabs: w.tabs, active: w.active, bounds: w.bounds, folder: w.folder });
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
  annotations?.flush();
});
app.on('window-all-closed', () => {
  if (isMac) return;
  quitting = true;
  settings?.flush();
  app.quit();
});
