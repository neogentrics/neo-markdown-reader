'use strict';
const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeTheme, net, protocol, safeStorage, screen, session, shell, utilityProcess } = require('electron');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { Settings, FONTS, FONT_NAMES, cleanAccelerator } = require('./settings');
const { PronunciationStore } = require('./pronounce');
const { DictationStore } = require('./dictation');
const { SmartStore } = require('./smart-search');
const { isMarkdownPath, isLockedPath, isOpenablePath, isViewablePath, isDataPath, fileFromArgv, readMarkdown, readDocument, isWritable, encodeForSave } = require('./files');
const { HistoryStore } = require('./history');
const { runJob: runReplaceJob } = require('./folder-replace');
const { saveImage, safeName, freeName } = require('./images');
const { FolderIndex } = require('./folder-index');
const { detectEol } = require('./files');
const locked = require('./locked');
const { CodeSandbox, registerScheme, runnableLang, TIMEOUT: RUN_TIMEOUT } = require('./sandbox');
const ai = require('./ai');
const providers = require('./ai-providers');
const connector = require('./connector');
const appLink = require('./app-link');
const linkPictures = require('./link-pictures');
const storyTracker = require('./story-tracker');
const claudeCode = require('./claude-code');
const ABOUT_WEBSITE = 'https://recontowers.com/projects/neo-markdown-reader/';
const i18n = require('./i18n');
const addons = require('./addons');
const { Updater, RELEASES_URL } = require('./updater');
const { Editing } = require('./editing');
const { scanFolder, searchFolder } = require('./folders');
const { AnnotationStore } = require('./annotations');
const flashcards = require('./flashcards');
const bibliography = require('./bibliography');
const automations = require('./automations');
const notion = require('./notion');
const servers = require('./servers');
const webdav = require('./webdav');
const wikis = require('./wikis');
const blogs = require('./blogs');
const discord = require('./discord');
const sent = require('./sent');
const { Inbound, newKey: newInboundKey, networkAddresses } = require('./inbound');
const { SyncEngine } = require('./sync');
const { VoiceStore, VOICES, LICENSE_URL } = require('./voices');
const { LANGS: VOICE_LANGS } = require('./voice-text');
const publish = require('./publish');

const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_HTML = path.join(ROOT, 'dist', 'index.html');
const SHOWCASE = path.join(ROOT, 'samples', 'showcase.md');
const THEME_BG = { light: '#e8ebf0', dark: '#0e1014', sepia: '#e6dccb', mist: '#dfe5ec', forest: '#0b120e', dusk: '#110e18', contrast: '#000000', blue: '#1f6fa8', red: '#a8201a', yellow: '#ffb627' };

registerScheme(protocol);                     // the code sandbox's private scheme (must precede app ready)
let sandbox = null;
let addonSandbox = null;
/** Installed add-ons (3.0), see addons.js. */
let addonStore = null;

// Tests point the app at a throwaway profile folder. The app was called Neo Markdown Reader until 3.4.1:
// anyone who used it then keeps their settings, keys, highlights and voices right where they are.
const FORMER_DATA = path.join(app.getPath('appData'), 'Neo Markdown Reader');
if (process.env.NMR_USER_DATA) app.setPath('userData', process.env.NMR_USER_DATA);
else if (fs.existsSync(FORMER_DATA)) app.setPath('userData', FORMER_DATA);
// Read aloud uses the computer's own voices; on Linux Chromium reaches them through speech-dispatcher.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-speech-dispatcher');

let settings;
let updater;
let editing;
let annotations;
let cardStore;
let history;
/** Sync between your computers (3.1), see sync.js. */
let sync;
/** Dictation (3.5), see dictation.js. */
let dictation = null;
/** Smart search (3.6), see smart-search.js. */
let smart = null;
/** Natural voices (3.2), see voices.js. */
let voices;
/** Every menu command, for running by name from Quick Open (">") and for changing shortcuts. */
let commandRegistry = new Map();
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

// ---------------------------------------------------------------- the app in your language (3.0)
let t = i18n.createTranslator('en');
function currentLanguage() { return i18n.pickLanguage(settings?.get().language, app.getLocale()); }
function refreshLanguage() { if (t.lang !== currentLanguage()) t = i18n.createTranslator(currentLanguage()); return t; }
/** Native dialogs in the app's language (their English text is translated as they're shown). */
const trFilters = (o) => (o && Array.isArray(o.filters) ? { ...o, filters: o.filters.map((f) => ({ ...f, name: t(f.name) })) } : o);
const trFile = (o) => trFilters(o && { ...o, ...(o.title ? { title: t(o.title) } : {}), ...(o.buttonLabel ? { buttonLabel: t(o.buttonLabel) } : {}) });
const dlg = {
  showMessageBox: (win, o) => (o === undefined ? dialog.showMessageBox(i18n.translateBox(win, t)) : dialog.showMessageBox(win, i18n.translateBox(o, t))),
  showMessageBoxSync: (win, o) => dialog.showMessageBoxSync(win, i18n.translateBox(o, t)),
  showOpenDialog: (win, o) => dialog.showOpenDialog(win, trFile(o)),
  showSaveDialog: (win, o) => dialog.showSaveDialog(win, trFile(o)),
};

// ---------------------------------------------------------------- helpers
/** An add-on theme chosen in View › Theme ("addon:<id>:<theme>"), if it's installed and on. */
function addonTheme() {
  const m = /^addon:([a-z0-9-]+):([a-z0-9-]+)$/.exec(settings.get().theme || '');
  if (!m || !addonOn(m[1])) return null;
  const th = addonStore?.get(m[1])?.manifest.themes.find((x) => x.id === m[2]);
  return th ? { key: `${m[1]}:${m[2]}`, theme: th } : null;
}
const addonOn = (id) => !!addonStore?.get(id) && !addonStore.get(id).error && !settings.get().addonsOff.includes(id);

function resolvedTheme() {
  const t = settings.get().theme;
  if (t.startsWith('addon:')) return addonTheme()?.theme.tone === 'dark' ? 'dark' : 'light';   // an add-on's colours go over this
  return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : t;
}

function rendererSettings() {
  const at = addonTheme();
  return { ...settings.get(), lang: currentLanguage(), addons: addonInfo(), addonTheme: at ? at.key : '', addonThemeCss: at ? addons.themeCss(at.key, at.theme) : '', resolvedTheme: resolvedTheme(), paperAuto: publish.resolvePaper('auto', app.getLocaleCountryCode()), positions: undefined, session: undefined };
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
    title: 'RT Markdown Reader',
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
    const choice = dlg.showMessageBoxSync(win, {
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

// ---------------------------------------------------------------- AI assist keys
// API keys, one per service, are encrypted by the operating system (Windows DPAPI, macOS Keychain,
// Linux secret service). Where no real secret store exists they are kept for this session only.
// Before 3.3 there was one key, for Claude, in ai-key.bin: it's read from there until keys are saved again.
let aiKeysMemory = null;
const aiKeysFile = () => path.join(app.getPath('userData'), 'ai-keys.bin');
const legacyAiKeyFile = () => path.join(app.getPath('userData'), 'ai-key.bin');
function secureStorage() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === 'basic_text' || backend === 'unknown') return false;
  }
  return true;
}
function loadAiKeys() {
  if (aiKeysMemory) return { ...aiKeysMemory };
  if (!secureStorage()) return {};
  let keys = {};
  try {
    const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(aiKeysFile())));
    if (saved && typeof saved === 'object') keys = saved;
  } catch { /* none saved */ }
  if (!keys.anthropic) {
    try { keys.anthropic = safeStorage.decryptString(fs.readFileSync(legacyAiKeyFile())); } catch { delete keys.anthropic; }
  }
  return Object.fromEntries(Object.entries(keys).filter(([id, k]) => providers.PROVIDER_IDS.includes(id) && typeof k === 'string' && k));
}
function saveAiKeys(keys) {
  if (secureStorage()) {
    fs.writeFileSync(aiKeysFile(), safeStorage.encryptString(JSON.stringify(keys)));
    fs.rmSync(legacyAiKeyFile(), { force: true });
    aiKeysMemory = null;
    return 'encrypted';
  }
  aiKeysMemory = { ...keys };
  return 'session';
}
const aiPrices = new Map();        // "provider|model" -> $ per million input tokens, from the service's model list
const AI_CONFIRM_TOKENS = 50_000;  // larger requests to a paid service are confirmed first, with their size
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
  if (isViewablePath(target)) {
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
  const res = await dlg.showOpenDialog(win, {
    title: 'Open',
    properties: ['openFile', 'multiSelections'],
    defaultPath: recent ? path.dirname(recent) : app.getPath('documents'),
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdx', 'mdlock'] },
      { name: 'Everything the reader opens', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdx', 'mdlock', 'txt', 'csv', 'tsv', 'tab', 'json', 'yaml', 'yml', 'ipynb'] },
      { name: 'Data (CSV, TSV, JSON, YAML)', extensions: ['csv', 'tsv', 'tab', 'json', 'yaml', 'yml'] },
      { name: 'Jupyter Notebook', extensions: ['ipynb'] },
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
  epub: { title: 'Export as E-book', name: 'EPUB E-book', ext: 'epub' },
  slides: { title: 'Export Slides as PDF', name: 'PDF', ext: 'pdf', suffix: ' (slides)' },
  pptx: { title: 'Export Slides as PowerPoint', name: 'PowerPoint Presentation', ext: 'pptx' },
};

/** Ask where to save an export of the active tab's document. */
async function exportTarget(state, format) {
  const f = EXPORT_FORMATS[format];
  const current = state.tabs[state.active]?.path;
  const base = current ? path.basename(current).replace(/\.[^.]+$/, '') : 'document';
  const res = await dlg.showSaveDialog(state.win, {
    title: f.title,
    defaultPath: path.join(current ? path.dirname(current) : app.getPath('documents'), `${base}${f.suffix || ''}.${f.ext}`),
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
  const font = FONTS.includes(payload.font) ? payload.font : 'sans';
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
    } else if (format === 'epub') {
      if (!Array.isArray(payload.chapters) || !payload.chapters.length || payload.chapters.length > 2000) return { ok: false, error: 'Nothing to export' };
      data = await publish.renderEpub({ root: ROOT, payload: {
        chapters: payload.chapters.filter((c) => c && typeof c.html === 'string').map((c) => ({ title: String(c.title || '').slice(0, 500), html: c.html })),
        toc: Array.isArray(payload.toc) ? payload.toc.slice(0, 5000) : [],
        graphics: Array.isArray(payload.graphics) ? payload.graphics.slice(0, 500).filter((g) => g && typeof g.html === 'string') : [],
        meta, css, lang: isStr(payload.lang, 35) ? payload.lang : 'en',
      } });
    } else if (format === 'slides') {
      if (!Array.isArray(payload.slides) || !payload.slides.length || payload.slides.length > 1000) return { ok: false, error: 'Nothing to export' };
      data = await publish.renderSlidesPdf({ root: ROOT, payload: { slides: payload.slides.filter((sl) => sl && typeof sl.html === 'string'), meta, css, theme, font } });
    } else if (format === 'pptx') {
      if (!Array.isArray(payload.slides) || !payload.slides.length || payload.slides.length > 1000 || !payload.slides.every(Array.isArray)) return { ok: false, error: 'Nothing to export' };
      const brand = settings.get().brand;
      data = await publish.renderPptx({ root: ROOT, payload: { slides: payload.slides, meta, css }, options: { accent: brand.accent, bodyFont: brand.bodyFont || FONT_NAMES[font], headingFont: brand.headingFont, codeFont: brand.codeFont } });
    } else if (format === 'docx') {
      if (!Array.isArray(payload.model)) return { ok: false, error: 'Nothing to export' };
      const brand = settings.get().brand;
      data = await publish.renderDocx({ root: ROOT, payload: { model: payload.model, meta, css }, options: { ...options, accent: brand.accent, bodyFont: brand.bodyFont || FONT_NAMES[font], headingFont: brand.headingFont, codeFont: brand.codeFont } });
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
    dlg.showMessageBox(s?.win, { ...opts, message: 'You’re up to date', detail: `RT Markdown Reader ${app.getVersion()} is the latest version.` });
  } else if (res.state === 'available') {
    const { response } = await dlg.showMessageBox(s?.win, { ...opts, message: `Version ${res.version} is available`, detail: 'This copy can’t update itself. Download the new version from the Releases page.', buttons: ['Open Download Page', 'Later'] });
    if (response === 0) shell.openExternal(res.url || RELEASES_URL);
  } else if (res.state === 'downloading' || res.state === 'ready') {
    dlg.showMessageBox(s?.win, { ...opts, message: `Version ${res.version} is ${res.state === 'ready' ? 'ready to install' : 'downloading'}`, detail: res.state === 'ready' ? 'Choose Help → Restart to Update, or it will install next time you quit.' : 'You’ll be asked to restart when it’s ready.' });
  } else {
    dlg.showMessageBox(s?.win, { ...opts, type: 'warning', message: 'Couldn’t check for updates', detail: (res.message || 'Check your internet connection and try again.') + `\n\nYou can always find new versions at:\n${RELEASES_URL}` });
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
  // Moved out of the menus to keep them short, usually to Preferences: still found by Find a Command,
  // and its shortcut still works.
  const moved = (item) => ({ ...item, visible: false, acceleratorWorksWhenHidden: true, moved: true });
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
        { id: 'daily-note', label: 'Today’s Note', accelerator: 'CmdOrCtrl+Shift+D', click: () => { const st = targetState(); if (st) openDailyNote(st); } },
        { type: 'separator' },
        cmd('save', 'Save', 'CmdOrCtrl+S'),
        cmd('save-as', 'Save As…', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        {
          label: 'This Document',
          submenu: [
            cmd('rename-doc', 'Rename…', 'F2'),
            cmd('reload', 'Reload File', 'F5'),
            cmd('reveal', 'Show in Folder'),
            cmd('copy-path', 'Copy File Path'),
            cmd('send-linked', 'Send to Linked App…'),
            cmd('send-story', 'Send to StoryTracker'),
            {
              label: 'Send This Document',
              submenu: [
                cmd('send-blog', 'As a Draft on My Blog…'),
                cmd('send-discord', 'To Discord…'),
                { type: 'separator' },
                cmd('sent-list', 'Where This Was Sent'),
              ],
            },
            cmd('open-claude-code', 'Open Folder in Claude Code'),
            { type: 'separator' },
            cmd('lock-protect', 'Protect with Password…'),
            cmd('lock-now', 'Lock Now'),
            cmd('lock-remove', 'Save an Unlocked Copy…'),
            { type: 'separator' },
            { id: 'import-docx', label: 'Import Word Document…', click: () => { const st = targetState(); if (st) importDocx(st); } },
          ],
        },
        {
          label: 'Export',
          submenu: [
            cmd('export-pdf', 'PDF…', 'CmdOrCtrl+Shift+E'),
            cmd('export-docx', 'Word Document (.docx)…'),
            cmd('export-html', 'Web Page (.html)…'),
            cmd('export-txt', 'Plain Text (.txt)…'),
            { type: 'separator' },
            cmd('export-epub', 'E-book (.epub)…'),
            cmd('export-slides', 'Slides as PDF…'),
            cmd('export-pptx', 'Slides as PowerPoint (.pptx)…'),
            cmd('export-audio', 'Audio (MP3 or Audiobook)…'),
            ...addonExportItems(),
          ],
        },
        {
          label: 'Automations',
          submenu: [
            ...settings.get().automations.map((a) => ({ id: `auto-${a.id}`, label: a.name, click: () => command('run-automation', a.id) })),
            ...(settings.get().automations.length ? [{ type: 'separator' }] : []),
            cmd('automations', 'Manage Automations…'),
          ],
        },
        {
          label: 'Notion',
          submenu: [
            cmd('notion-bring', 'Bring In a Notion Page…'),
            cmd('notion-send', 'Send to Notion…'),
            cmd('notion-compare', 'Compare with Notion'),
            cmd('notion-open', 'Open in Notion'),
            { type: 'separator' },
            cmd('notion-setup', 'Notion Connection…'),
          ],
        },
        {
          label: 'Home Server',
          submenu: [
            cmd('server-open', 'Open a Folder on My Server…'),
            cmd('server-publish', 'Publish This Document to My Wiki…'),
            cmd('server-publish-folder', 'Publish This Folder to My Wiki…'),
            { type: 'separator' },
            cmd('server-list', 'My Servers…'),
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
        moved(cmd('find-next', 'Find Next', 'F3')),
        moved(cmd('find-prev', 'Find Previous', 'Shift+F3')),
        cmd('find-in-folder', 'Find in Folder…', 'CmdOrCtrl+Shift+F'),
        cmd('replace-in-folder', 'Replace in Folder…', 'CmdOrCtrl+Shift+R'),
        cmd('check-links', 'Check Links in Folder…'),
        { type: 'separator' },
        cmd('highlight', 'Highlight Selection', 'CmdOrCtrl+Shift+H'),
        cmd('bookmark', 'Bookmark This File', 'CmdOrCtrl+D'),
        cmd('edit-table', 'Edit Table…'),
        cmd('citations', 'Insert Citation…'),
        cmd('dictate', 'Dictation', 'CmdOrCtrl+Alt+D'),
        moved(cmd('dictate-remove', 'Remove Dictation Download…')),
        moved(cmd('smart-remove', 'Remove Smart Search Download…')),
        {
          label: 'Compare and History',
          submenu: [
            cmd('compare-saved', 'Compare with Saved Version'),
            cmd('compare-file', 'Compare with File…'),
            cmd('panel-history', 'Version History', 'CmdOrCtrl+Shift+Y'),
          ],
        },
        moved({ id: 'wiki-style', label: 'Insert Standard Markdown Links', type: 'checkbox', checked: s.wikiLinks === 'markdown', click: () => setSetting({ wikiLinks: settings.get().wikiLinks === 'markdown' ? 'wiki' : 'markdown' }) }),
        moved(cmd('grants', 'Editing Permissions…')),
        {
          label: 'AI Assist',
          submenu: [
            cmd('ai-summarize', 'Summarize Document'),
            cmd('ai-explain', 'Explain Selection'),
            cmd('ai-report', 'Turn Notes into a Report'),
            cmd('ai-cards', 'Draft Flashcards…'),
            cmd('ai-folder', 'Ask About This Folder…'),
            { type: 'separator' },
            cmd('ai-proofread', 'Proofread Selection'),
            cmd('ai-rewrite', 'Rewrite Selection'),
            cmd('ai-shorten', 'Shorten Selection'),
            cmd('ai-translate', 'Translate Selection…'),
            { type: 'separator' },
            cmd('ai-settings', 'AI Assist Settings…'),
            moved(cmd('connect-claude', 'Connect Claude…')),
          ],
        },
        moved({ id: 'allow-run', label: 'Allow Running Code Blocks', type: 'checkbox', checked: s.runCode !== 'off', click: () => setSetting({ runCode: settings.get().runCode === 'off' ? 'ask' : 'off' }) }),
        moved({ id: 'open-backups', label: 'Open Backups Folder', click: () => openBackups() }),
        { type: 'separator' },
        cmd('preferences', 'Preferences…', 'CmdOrCtrl+,'),
        moved(cmd('sync', 'Sync Between Computers…')),
      ],
    },
    {
      label: '&View',
      submenu: [
        cmd('read-aloud', 'Read Aloud', 'CmdOrCtrl+Shift+U'),
        cmd('present', 'Present as Slides', 'CmdOrCtrl+Shift+P'),
        cmd('study', 'Study Flashcards…'),
        cmd('focus-mode', 'Focus Mode', 'F8'),
        cmd('split-toggle', 'Split View', 'CmdOrCtrl+\\'),
        { type: 'separator' },
        { id: 'toggle-outline', label: 'Sidebar', type: 'checkbox', checked: s.showToc, accelerator: 'CmdOrCtrl+B', click: () => setSetting({ showToc: !settings.get().showToc }) },
        {
          label: 'Panels',
          submenu: [
            cmd('panel-outline', 'Show Outline'),
            cmd('panel-files', 'Show Files'),
            cmd('panel-highlights', 'Show Highlights'),
            cmd('panel-tasks', 'Show Tasks', 'CmdOrCtrl+Shift+L'),
            cmd('link-map', 'Link Map', 'CmdOrCtrl+Shift+M'),
          ],
        },
        { label: 'Sections', submenu: [cmd('fold-all', 'Fold All Sections', 'CmdOrCtrl+Shift+['), cmd('unfold-all', 'Unfold All Sections', 'CmdOrCtrl+Shift+]')] },
        cmd('quick-open', 'Go to File or Heading…', 'CmdOrCtrl+K'),
        { type: 'separator' },
        {
          label: 'Text Size',
          submenu: [
            { id: 'text-larger', label: 'Larger Text', accelerator: 'CmdOrCtrl+=', click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
            { id: 'text-larger-alt', label: 'Larger Text', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
            { id: 'text-smaller', label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: () => setSetting({ fontScale: settings.get().fontScale - 0.1 }) },
            { id: 'text-reset', label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: () => setSetting({ fontScale: 1 }) },
          ],
        },
        moved({ label: 'Theme', submenu: [radio('Follow System', 'theme', 'system'), { type: 'separator' }, radio('Paper (light)', 'theme', 'light'), radio('Sepia', 'theme', 'sepia'), radio('Mist', 'theme', 'mist'), radio('Blue', 'theme', 'blue'), radio('Red', 'theme', 'red'), radio('Yellow', 'theme', 'yellow'), { type: 'separator' }, radio('Night (dark)', 'theme', 'dark'), radio('Forest (dark)', 'theme', 'forest'), radio('Dusk (dark)', 'theme', 'dusk'), radio('High Contrast', 'theme', 'contrast'),
          ...addonThemeItems(s)] }),
        moved({ id: 'color-safe', label: 'Colour-Safe Colours', type: 'checkbox', checked: s.colorSafe, click: () => setSetting({ colorSafe: !settings.get().colorSafe }) }),
        moved({ label: 'Look', submenu: [radio('Solid', 'surface', 'solid'), radio('Glass', 'surface', 'glass')] }),
        moved({ label: 'Typeface', submenu: [radio('Sans-serif (modern)', 'font', 'sans'), radio('Serif (book)', 'font', 'serif'), { type: 'separator' }, radio('Times New Roman', 'font', 'times'), radio('Georgia', 'font', 'georgia'), radio('Century Schoolbook', 'font', 'century'), radio('Garamond', 'font', 'garamond'), radio('Palatino Linotype', 'font', 'palatino'), radio('Cambria', 'font', 'cambria'), radio('Arial', 'font', 'arial'), radio('Calibri', 'font', 'calibri'), radio('Verdana', 'font', 'verdana'), radio('Tahoma', 'font', 'tahoma'), radio('Century Gothic', 'font', 'gothic'), radio('Trebuchet MS', 'font', 'trebuchet'), radio('Courier New', 'font', 'courier')] }),
        moved({ label: 'Page Width', submenu: [radio('Narrow', 'pageWidth', 'narrow'), radio('Normal', 'pageWidth', 'normal'), radio('Wide', 'pageWidth', 'wide'), radio('Full Window', 'pageWidth', 'full')] }),
        moved(cmd('customize-theme', 'Customize Theme…')),
        moved(cmd('pronunciation', 'Pronunciation List…')),
        moved(cmd('addons', 'Add-ons…')),
        moved({ label: 'Language', submenu: [
          { id: 'language-system', label: 'System Default', type: 'radio', checked: !i18n.CODES.has(s.language), click: () => setSetting({ language: 'system' }) },
          { type: 'separator' },
          ...i18n.LANGUAGES.map((l) => ({ id: `language-${l.code}`, label: l.name, type: 'radio', checked: s.language === l.code, click: () => setSetting({ language: l.code }) })),
        ] }),
        moved(cmd('panel-history', 'Show Version History', undefined, { id: 'panel-history-view' })),
        moved(cmd('split-link', 'Link Scrolling in Split View')),
        moved(cmd('back', 'Back', isMac ? 'Cmd+[' : 'Alt+Left')),
        ...(isMac ? [] : [moved({ id: 'toggle-menubar', label: 'Always Show Menu Bar', type: 'checkbox', checked: s.showMenuBar, click: () => setSetting({ showMenuBar: !settings.get().showMenuBar }) })]),
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
        cmd('reopen-closed-tab', 'Reopen Closed Tab', 'CmdOrCtrl+Shift+T'),
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
        cmd('help-center', 'Help Center', 'F1'),
        cmd('tutorial', 'Tutorial'),
        cmd('shortcuts', 'Keyboard Shortcuts'),
        cmd('command-palette', 'Find a Command…', 'CmdOrCtrl+Shift+K'),
        moved(cmd('ai-guide', 'Connecting an AI Service')),
        moved({ id: 'showcase', label: 'Open Feature Showcase', click: () => openFile(SHOWCASE) }),
        moved(cmd('customize-shortcuts', 'Customize Keyboard Shortcuts…')),
        { type: 'separator' },
        updateReady
          ? { id: 'restart-to-update', label: `Restart to Update (${updater.status.version})`, click: () => updater.installNow() }
          : { id: 'check-updates', label: 'Check for Updates…', click: () => checkForUpdatesInteractive() },
        moved({ id: 'releases-page', label: 'Releases Page', click: () => shell.openExternal(RELEASES_URL) }),
        { type: 'separator' },
        {
          id: 'about',
          label: `About RT Markdown Reader ${app.getVersion()}`,
          // The page shows the full About window; with no window open, a short version in a message box.
          click: () => (targetState() ? command('about') : dlg.showMessageBox({
            type: 'info', title: 'About', message: 'RT Markdown Reader',
            detail: `Version ${app.getVersion()}\nA beautiful, distraction-free Markdown reader.\n${ABOUT_WEBSITE}\n© ${new Date().getFullYear()} Recon Towers. All rights reserved.`,
          })),
        },
      ],
    },
  ];
  applyShortcuts(template, s.shortcuts);
  commandRegistry = collectCommands(template);
  refreshLanguage();
  i18n.translateMenu(template, t);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- your own shortcuts & commands by name
/** Menu items with these ids can't be given other shortcuts (they're duplicates or lists). */
const FIXED_IDS = /(-alt|^template-)/;

/** Replace default shortcuts with the ones you chose (by menu item id). Records each default. */
function applyShortcuts(items, chosen) {
  for (const item of items) {
    if (item.submenu && Array.isArray(item.submenu)) applyShortcuts(item.submenu, chosen);
    if (!item.id) continue;
    item.defaultAccelerator = item.accelerator || '';
    if (!FIXED_IDS.test(item.id) && Object.hasOwn(chosen, item.id)) item.accelerator = chosen[item.id] || undefined;
  }
}

/** Every clickable menu command, keyed by its id (or its place in the menus). */
function collectCommands(items, trail = [], out = new Map()) {
  for (const item of items) {
    if (item.type === 'separator' || item.role || (item.visible === false && !item.moved)) continue;
    const label = String(item.label || '').replace(/&/g, '');
    if (Array.isArray(item.submenu)) {
      if (/^Open Recent/.test(label)) continue;
      collectCommands(item.submenu, [...trail, label], out);
      continue;
    }
    if (typeof item.click !== 'function') continue;
    const key = item.id || [...trail, label].join('/').toLowerCase().replace(/[^a-z0-9/]+/g, '-');
    if (out.has(key)) continue;
    out.set(key, {
      key, label, path: trail.join(' › '), accelerator: item.accelerator || '', defaultAccelerator: item.defaultAccelerator ?? item.accelerator ?? '',
      enabled: item.enabled !== false, customizable: !!item.id && !FIXED_IDS.test(item.id), click: item.click,
    });
  }
  return out;
}

/** Shortcuts written different ways ("Ctrl+K" and "CmdOrCtrl+K" on Windows) compare equal. */
function sameShortcut(a, b) {
  const norm = (acc) => {
    if (!acc) return '';
    const parts = acc.split('+');
    let key = parts.pop();
    if (key === '') { parts.pop(); key = '+'; }
    const alias = { CommandOrControl: 'CmdOrCtrl', Control: 'Ctrl', Command: 'Cmd', Option: 'Alt', Return: 'Enter', Esc: 'Escape', Plus: '+' };
    const mods = parts.map((m) => alias[m] || m).map((m) => (m === (isMac ? 'Cmd' : 'Ctrl') ? 'CmdOrCtrl' : m));
    return [...new Set(mods)].sort().join('+') + '+' + (alias[key] || key).toUpperCase();
  };
  return !!a && !!b && norm(a) === norm(b);
}

function commandList() {
  return [...commandRegistry.values()].map(({ click, ...rest }) => ({ ...rest, label: t(rest.label), path: rest.path.split(' › ').map((p) => t(p)).join(' › ') }));
}

/** Set (or with accelerator null, reset) one command's shortcut. */
function setShortcut(id, accelerator, { takeOver = false } = {}) {
  const entry = commandRegistry.get(id);
  if (!entry?.customizable) return { error: 'That command’s shortcut can’t be changed.' };
  const chosen = { ...settings.get().shortcuts };
  if (accelerator === null) delete chosen[id];
  else if (accelerator === '') chosen[id] = '';
  else {
    const acc = cleanAccelerator(accelerator);
    if (!acc) return { error: 'That key combination can’t be used. Use Ctrl, Alt or Shift with a letter, number or key, or a function key (F1–F24).' };
    const clash = [...commandRegistry.values()].find((c) => c.key !== id && sameShortcut(c.accelerator, acc));
    if (clash && !takeOver) return { conflict: { key: clash.key, label: clash.label, path: clash.path, customizable: clash.customizable } };
    if (clash) {
      if (!clash.customizable) return { error: `${acc} is used by ${clash.label}, which can’t be changed.` };
      chosen[clash.key] = '';
    }
    chosen[id] = acc === entry.defaultAccelerator ? undefined : acc;
    if (chosen[id] === undefined) delete chosen[id];
  }
  settings.update({ shortcuts: chosen });
  rebuildMenu();
  return { ok: true, commands: commandList() };
}

// ---------------------------------------------------------------- importing Word documents
async function importDocx(state, given = null) {
  let src = given;
  if (!src) {
    const res = await dlg.showOpenDialog(state.win, {
      title: 'Import Word Document', properties: ['openFile'],
      defaultPath: settings.get().recent[0] ? path.dirname(settings.get().recent[0]) : app.getPath('documents'),
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    src = res.filePaths[0];
  }
  try {
    const st = await fs.promises.stat(src);
    if (!st.isFile() || !/\.docx$/i.test(src)) return { error: 'That isn’t a Word document (.docx).' };
    if (st.size > 100 * 1024 * 1024) return { error: 'That Word document is too large to import (over 100 MB).' };
  } catch (err) { return { error: errorMessage(err, src) }; }
  const base = path.basename(src).replace(/\.docx$/i, '');
  const out = await dlg.showSaveDialog(state.win, {
    title: 'Save the Markdown version as', defaultPath: path.join(path.dirname(src), `${base}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (out.canceled || !out.filePath) return { canceled: true };
  let target = out.filePath;
  if (!isMarkdownPath(target)) target += '.md';
  try {
    const { docxToMarkdown } = publish.exportTools(ROOT);
    const prefix = safeName(base, 'x').replace(/\.x$/, '');
    const conv = await docxToMarkdown(await fs.promises.readFile(src), { imagePrefix: prefix });
    let md = conv.markdown;
    if (conv.images.length) {
      const dir = path.join(path.dirname(target), 'images');
      await fs.promises.mkdir(dir, { recursive: true });
      for (const img of conv.images) {
        const name = freeName(dir, img.name);
        await fs.promises.writeFile(path.join(dir, name), img.data, { flag: 'wx' });
        if (name !== img.name) md = md.split(`(images/${img.name})`).join(`(images/${name})`);
      }
    }
    if (fs.existsSync(target)) { await editing.backup(target); await editing.keepVersion(target, 'save'); }
    await fs.promises.writeFile(target, encodeForSave(`${md}\n`, { eol: process.platform === 'win32' ? '\r\n' : '\n' }));
    const doc = await loadDoc(target);
    sendDoc(state, 'tab:open', doc);
    return { ok: true, images: conv.images.length, warnings: conv.warnings.length };
  } catch (err) {
    return { error: `Couldn’t import that document: ${err?.message || err}` };
  }
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
  // Writing help on the editor's selection (only offered when AI assist is on).
  if (params.isEditable && params.selectionText?.trim() && settings.get().ai?.enabled) {
    const send = (cmd) => () => win.webContents.send('menu:command', { cmd });
    items.push({ label: 'AI Assist', submenu: [
      { label: 'Proofread', click: send('ai-proofread') }, { label: 'Rewrite', click: send('ai-rewrite') },
      { label: 'Shorten', click: send('ai-shorten') }, { label: 'Translate…', click: send('ai-translate') },
    ] }, { type: 'separator' });
  }
  if (params.isEditable) {
    items.push({ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
  } else if (params.selectionText) {
    items.push({ role: 'copy' }, { label: 'Copy as Formatted Text', click: () => win.webContents.send('menu:command', { cmd: 'copy-rich' }) });
  }
  if (items.length) Menu.buildFromTemplate(i18n.translateMenu(items, t)).popup({ window: win });
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
        smartRefresh(state);
        folder.sync?.();
      }, 700);
    });
    watcher.on('error', () => {});
    folder.unwatch = () => { clearTimeout(timer); watcher.close(); };
  } catch { /* watching isn't available everywhere; the Refresh button still works */ }
  followServerFolder(state, folder);
  const recentFolders = [root, ...settings.get().recentFolders.filter((f) => f.toLowerCase() !== root.toLowerCase())];
  settings.update({ recentFolders });
  snapshot(state);
  persistSession();
  rebuildMenu();
  return folderInfo(scan);
}

const folderInfo = (scan) => ({ root: scan.root, name: scan.name, tree: scan.tree, count: scan.files.length, truncated: scan.truncated });

async function openFolderDialog(state) {
  const res = await dlg.showOpenDialog(state.win, {
    title: 'Open Folder', properties: ['openDirectory'],
    defaultPath: settings.get().recentFolders[0] || app.getPath('documents'),
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const info = await setFolder(state, res.filePaths[0]);
  if (info) state.win.webContents.send('folder:opened', info);
  smartRefresh(state);
  return info;
}

async function openRecentFolder(state, root) {
  if (!state) return;
  const info = await setFolder(state, root);
  if (info) { state.win.webContents.send('folder:opened', info); smartRefresh(state); }
  else state.win.webContents.send('doc:error', { message: `Folder not found:\n${root}` });
}

// ---------------------------------------------------------------- the Claude connector (3.4)
let connectorServer = null;
const claudeSuggestions = new Map();                 // id -> { path, oldText, newText, done }
const CLAUDE_WAIT_MS = 45_000;                       // Claude's side gives up on a call that takes much longer

const connectorEntry = () => connector.serverEntry({ exe: process.execPath, bridge: path.join(ROOT, 'src', 'main', 'connector-bridge.js'), dir: app.getPath('userData') });
const desktopConfigs = () => connector.desktopConfigPaths({ home: app.getPath('home') });

function connectorStatus() {
  const files = desktopConfigs();
  return {
    enabled: settings.get().claudeConnector,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    desktop: { installed: files.length > 0, added: connector.inDesktop(files) },
    code: { installed: !!claudeCode.findClaude() },
  };
}

function connectorPlaces() {
  const states = liveStates();
  return {
    open: [...new Set(states.flatMap((s) => s.tabs.map((t) => t.path)))],
    folders: states.filter((s) => s.folder).map((s) => ({ root: s.folder.root, name: s.folder.scan.name, files: s.folder.scan.files, scan: s.folder.scan })),
  };
}

/** Show a change from Claude in the app. Answers when the person does, or says it's still waiting. */
async function suggestFromClaude({ path: p, oldText, newText, note }) {
  await openFile(p);
  const st = liveStates().find((s) => s.tabs.some((t) => t.path.toLowerCase() === p.toLowerCase())) || targetState();
  if (!st) throw new connector.ToolError('RT Markdown Reader has no window open.');
  focusState(st);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ outcome: 'waiting', message: 'The person hasn’t answered yet. The suggestion stays open in the app.' }), CLAUDE_WAIT_MS);
    claudeSuggestions.set(id, { path: p, oldText, newText, done: (r) => { clearTimeout(timer); resolve(r); } });
    st.win.webContents.send('claude:suggest', { id, path: p, oldText, newText, note });
  });
}

async function applyConnector() {
  const on = settings.get().claudeConnector;
  if (!on) { await connectorServer?.stop(); connectorServer = null; return; }
  if (connectorServer) return;
  const handle = connector.createTools({
    places: connectorPlaces,
    read: async (p) => (await fs.promises.readFile(p, 'utf8')).replace(/^\ufeff/, ''),
    search: (f, query) => searchFolder(f.scan, query),
    notes: (p) => annotations.get(p),
    suggest: suggestFromClaude,
  });
  const server = new connector.ConnectorServer({ dir: app.getPath('userData'), handle });
  await server.start();
  connectorServer = server;
}

// ---------------------------------------------------------------- App Link (3.6)
// Other Recon Towers apps on this computer. The rules are in docs/app-link.md.
let linkServer = null;
let linksMemory = null;
const linksFile = () => path.join(app.getPath('userData'), 'links.bin');

function loadLinks() {
  if (linksMemory) return { ...linksMemory };
  if (!secureStorage()) return {};
  try {
    const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(linksFile())));
    return saved && typeof saved === 'object' ? saved : {};
  } catch { return {}; }
}
function saveLinks(links) {
  if (secureStorage()) fs.writeFileSync(linksFile(), safeStorage.encryptString(JSON.stringify(links)));
  else linksMemory = { ...links };             // kept until the app closes, never in a plain file
}

/** Ask the person, in this app, whether another app may link with it. */
async function askToLink({ name }) {
  const st = targetState();
  if (st) focusState(st);
  const box = {
    type: 'question',
    message: `Link ${name} with RT Markdown Reader?`,
    detail: `${name} will be able to open documents here. It can’t read or change anything on its own.\n\nOnly say yes if you’ve just asked it to link.`,
    buttons: ['Link', 'Don’t Link'], defaultId: 1, cancelId: 1, noLink: true,
  };
  const { response } = await (st ? dlg.showMessageBox(st.win, box) : dlg.showMessageBox(box));
  return response === 0;
}

/** A document from a linked app. Text opens unsaved, with its pictures; a path opens like any Markdown file, with the pictures beside it. */
async function openFromLink({ from, name, text, path: file, attachments }) {
  if (file) {
    const full = path.resolve(file);
    if (isLockedPath(full)) throw new appLink.LinkError('not_allowed', 'Password-locked documents can’t be opened this way.');
    if (!isMarkdownPath(full)) throw new appLink.LinkError('not_allowed', 'RT Markdown Reader opens Markdown files this way.');
    if (!fs.existsSync(full)) throw new appLink.LinkError('not_found', 'That document isn’t there.');
    await openFile(full);
    return;
  }
  const st = targetState();
  if (!st) throw new appLink.LinkError('failed', 'RT Markdown Reader has no window open.');
  focusState(st);
  const pictures = await linkPictures.readAttachments(attachments);
  st.win.webContents.send('link:document', { from, name, content: linkPictures.showEveryPicture(text, pictures), pictures });
}

const storyHandover = new storyTracker.Handover();

/** Send to StoryTracker: through the link if there is one and it's running, and the same way as Open With if not. */
async function sendToStory(doc) {
  const attachments = await linkPictures.attachmentsFor(doc.text, doc.path);
  if (linkServer && Object.hasOwn(loadLinks(), storyTracker.ID)) {
    try {
      return await linkServer.send(storyTracker.ID, { name: doc.name, text: doc.text, attachments });
    } catch (err) {
      if (!['not_running', 'not_linked'].includes(err.code)) return { error: linkMessage(err) };
    }
  }
  try {
    return { ...(await storyHandover.send({ name: doc.name, text: doc.text })), picturesLeft: attachments.length };
  } catch (err) { return { error: err.message }; }
}

// ---------------------------------------------------------------- your home server (3.9)
const SERVER_SYNC_MS = 60 * 1000;
const publishJobs = new Map();
const serverById = (id) => settings.get().servers.find((s) => s.id === id) || null;
const serverSecret = (id) => loadSecrets().servers?.[id] || '';
const serverRoot = () => path.join(app.getPath('userData'), 'server-folders');
const wikiFile = () => path.join(app.getPath('userData'), 'wiki-pages.json');
let wikiCache = null;

function wikiRecords() {
  if (!wikiCache) {
    try { wikiCache = JSON.parse(fs.readFileSync(wikiFile(), 'utf8')); } catch { wikiCache = {}; }
  }
  return wikiCache;
}

function saveWikiRecords(id, known) {
  wikiRecords()[id] = known;
  try { fs.writeFileSync(wikiFile(), JSON.stringify(wikiCache)); } catch { /* the pages are made; it only means they'd be made again */ }
}

/** Keep a folder on a server and this computer's copy in step, for as long as the folder is open here. */
function followServerFolder(state, folder) {
  const link = settings.get().serverFolders.find((f) => path.resolve(f.root).toLowerCase() === path.resolve(folder.root).toLowerCase());
  const server = link && serverById(link.server);
  if (!server) return;
  const stateFile = `${path.dirname(folder.root)}.json`;
  let told = false;
  let running = null;
  folder.sync = () => {
    running ??= (async () => {
      let known = {};
      try { known = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); } catch { /* the first time */ }
      try {
        const client = servers.davClient({ fetch: net.fetch, server, secret: serverSecret(server.id) });
        const res = await webdav.syncFolder({ client, remote: link.remote, root: folder.root, known });
        await fs.promises.writeFile(stateFile, JSON.stringify(res.known));
        told = false;
        if (res.report.conflicts.length && !state.win.isDestroyed()) state.win.webContents.send('srv:synced', { conflicts: res.report.conflicts });
        return res.report;
      } catch (err) {
        if (!told && !state.win.isDestroyed()) state.win.webContents.send('srv:synced', { error: err.message });
        told = true;
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const timer = setInterval(() => folder.sync(), SERVER_SYNC_MS);
  const stopWatching = folder.unwatch;
  folder.unwatch = () => { clearInterval(timer); stopWatching?.(); };
  folder.sync();
}

/** Where this computer keeps its copy of a folder on a server. */
function serverCopyPath(server, remote) {
  const id = crypto.createHash('sha256').update(`${server.id}|${remote}`).digest('hex').slice(0, 16);
  const name = (remote.split('/').pop() || server.name).replace(/[\\/:*?"<>|]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'Server folder';
  return path.join(serverRoot(), id, name);
}

/** The documents to publish, as the publisher wants them. Locked ones are never included. */
async function publishDocs(st, req) {
  if (req.scope === 'folder') {
    if (!st.folder) throw new wikis.WikiError('Open a folder first.', 'no_folder');
    const docs = [];
    for (const file of st.folder.scan.files) {
      if (isLockedPath(file) || !isMarkdownPath(file)) continue;
      const text = await fs.promises.readFile(file, 'utf8').catch(() => null);
      if (text !== null) docs.push({ key: file, rel: path.relative(st.folder.root, file).replace(/\\/g, '/'), name: path.basename(file), text, dir: path.dirname(file) });
    }
    if (!docs.length) throw new wikis.WikiError('There are no documents in this folder.', 'empty');
    return docs;
  }
  if (!isStr(req.path, 4096) || !path.isAbsolute(req.path)) throw new wikis.WikiError('Save the document first, so its pictures can be found.', 'unsaved');
  if (isLockedPath(req.path)) throw new wikis.WikiError('Password-locked documents are never sent.', 'locked');
  const text = typeof req.text === 'string' ? req.text : '';
  if (!text.trim()) throw new wikis.WikiError('Open a document first.', 'empty');
  return [{ key: req.path, rel: path.basename(req.path), name: path.basename(req.path), text, dir: path.dirname(req.path) }];
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

/** Give an answer the page can show, whatever went wrong. */
const serverAnswer = (fn) => async (e, req = {}) => {
  try {
    return await fn(e, req && typeof req === 'object' ? req : {});
  } catch (err) {
    return { error: err instanceof webdav.DavError || err instanceof wikis.WikiError ? err.message : 'That didn’t work.', code: err.code };
  }
};

// ---------------------------------------------------------------- sending to blogs and Discord (3.10)
let sentCache = null;
const sentLog = () => { sentCache ??= sent.createSent({ file: path.join(app.getPath('userData'), 'sent.json') }); return sentCache; };

/** One document that's about to leave this computer. Locked documents never do. */
async function sendable(e, req) {
  const st = stateFor(e);
  if (!st) throw new wikis.WikiError('Open a document first.', 'empty');
  return (await publishDocs(st, { ...req, scope: 'doc' }))[0];
}

function sendTarget(id, kind) {
  const server = serverById(id);
  if (!server || !servers.KINDS[server.kind][kind]) throw new wikis.WikiError('That isn’t in your list any more.', 'gone');
  return { server, secret: serverSecret(server.id) };
}

// ---------------------------------------------------------------- Notion (3.8)
const notionJobs = new Map();     // what's been fetched or is about to be sent, so the page only has to name it
const notionSeenFile = () => path.join(app.getPath('userData'), 'notion-seen.json');
let notionSeenCache = null;

function notionSeen() {
  if (!notionSeenCache) {
    try { notionSeenCache = JSON.parse(fs.readFileSync(notionSeenFile(), 'utf8')); } catch { notionSeenCache = {}; }
  }
  return notionSeenCache;
}

function markNotionSeen(id, edited) {
  if (!id || !edited) return;
  notionSeen()[id] = edited;
  try { fs.writeFileSync(notionSeenFile(), JSON.stringify(notionSeenCache)); } catch { /* it only means one extra look at the page */ }
}

function notionClient(token = loadSecrets().notion) {
  if (!token) throw new notion.NotionError('Connect to Notion first.', 'no_key');
  return notion.createClient({ fetch: net.fetch, token, base: process.env.NMR_NOTION_URL || notion.API });
}

/** The page's address, for opening and for the link in a document. */
const notionUrl = (id, url) => url || `https://www.notion.so/${String(id).replace(/-/g, '')}`;

/** Give an answer the page can show, whatever went wrong. */
const notionAnswer = (fn) => async (e, req = {}) => {
  try {
    return await fn(e, req && typeof req === 'object' ? req : {});
  } catch (err) {
    return { error: err instanceof notion.NotionError ? err.message : 'That didn’t work.', code: err.code };
  }
};

function notionPictures(md, docPath) {
  const dir = path.join(path.dirname(docPath), 'images');
  return notion.keepPictures(md, {
    fetch: net.fetch,
    save: (picture) => saveImage(docPath, picture),
    have(id) {
      try {
        const file = fs.readdirSync(dir).find((f) => f.startsWith(`notion-${id}`));
        return file ? `images/${file}` : null;
      } catch { return null; }
    },
  });
}

/** What's on a document's linked page now, written as that document would be. */
async function notionLatest(text, docPath) {
  const id = notion.linkOf(text);
  if (!id) throw new notion.NotionError('This document isn’t linked to a Notion page.', 'no_link');
  const client = notionClient();
  const [meta, page] = await Promise.all([client.meta(id), client.content(id)]);
  const latest = notion.asDocument(meta.title, notion.toMarkdown(page.markdown));
  const kept = docPath ? await notionPictures(latest, docPath) : { md: latest };
  return { id, meta, content: notion.splitFront(text).front + kept.md };
}

// ---------------------------------------------------------------- automations (3.7)
const automationFile = () => path.join(app.getPath('userData'), 'automation-keys.bin');
let automationMemory = null;      // on a computer with no safe place for keys, they last until the app closes

function loadSecrets() {
  if (automationMemory) return automationMemory;
  try { automationMemory = JSON.parse(safeStorage.decryptString(fs.readFileSync(automationFile()))); } catch { automationMemory = {}; }
  return automationMemory;
}

function saveSecrets(patch) {
  automationMemory = { ...loadSecrets(), ...patch };
  if (secureStorage()) { try { fs.writeFileSync(automationFile(), safeStorage.encryptString(JSON.stringify(automationMemory))); } catch { /* kept until the app closes */ } }
}

let inbound = null;

/** Add text to the end of a document: asks for permission like any edit, and keeps a backup and a History copy. */
async function appendFromWorkflow({ path: file, text }) {
  const full = path.resolve(file);
  if (isLockedPath(full)) throw Object.assign(new Error('Password-locked documents can’t be changed this way.'), { status: 403 });
  if (!isMarkdownPath(full)) throw Object.assign(new Error('Only Markdown documents can be changed this way.'), { status: 403 });
  if (!fs.existsSync(full)) throw Object.assign(new Error('That document isn’t there.'), { status: 404 });
  const st = targetState();
  if (!st) throw Object.assign(new Error('RT Markdown Reader has no window open.'), { status: 503 });
  if (!editing.isGranted(st, full)) {
    const grant = await editing.requestEdit(st, full);
    if (!grant.ok) throw Object.assign(new Error('The change wasn’t allowed.'), { status: 403 });
  }
  const now = await fs.promises.readFile(full, 'utf8');
  await rewriteFile(full, `${now.replace(/\s*$/, '')}\n\n${text.trim()}\n`, 'workflow');
}

async function applyInbound() {
  await inbound?.stop();
  inbound = null;
  if (!settings.get().inbound) return;
  if (!loadSecrets().inbound) saveSecrets({ inbound: newInboundKey() });
  const server = new Inbound({
    key: () => loadSecrets().inbound || '',
    port: Number(process.env.NMR_INBOUND_PORT) || undefined,
    network: settings.get().inboundNetwork,
    actions: {
      create: async ({ name, content }) => {
        const st = targetState();
        if (!st) throw Object.assign(new Error('RT Markdown Reader has no window open.'), { status: 503 });
        focusState(st);
        st.win.webContents.send('inbound:document', { name: appLink.documentName(name), content });
      },
      open: ({ path: file }) => openFromLink({ path: file }).catch((err) => { throw Object.assign(err, { status: err.code === 'not_found' ? 404 : 403 }); }),
      append: appendFromWorkflow,
    },
  });
  await server.start();
  inbound = server;
}

function inboundStatus() {
  const s = settings.get();
  return {
    enabled: s.inbound, network: s.inboundNetwork, safe: secureStorage(), port: inbound?.port || 0,
    key: s.inbound ? loadSecrets().inbound || '' : '', addresses: s.inboundNetwork ? networkAddresses() : [],
  };
}

async function applyLink() {
  if (!settings.get().appLink) { await linkServer?.stop(); linkServer = null; return; }
  if (linkServer) return;
  const server = new appLink.AppLink({
    folder: appLink.sharedFolder({ home: app.getPath('home') }),
    dataDir: app.getPath('userData'),
    version: app.getVersion(),
    load: loadLinks, save: saveLinks, ask: askToLink, open: openFromLink,
  });
  await server.start();
  linkServer = server;
}

async function linkStatus() {
  return { enabled: settings.get().appLink, safe: secureStorage(), apps: linkServer ? await linkServer.list() : [] };
}

const linkMessage = (err) => (err instanceof appLink.LinkError ? err.message : 'That didn’t work.');

// ---------------------------------------------------------------- connected notes (2.3)
/** The open folder's link / tag / task index, brought up to date. */
/** Keep a window's folder read for meaning, when smart search is on. Runs in the background. */
function smartRefresh(st) {
  if (!st?.folder || !settings.get().smartSearch || !smart?.status().installed) return;
  clearTimeout(st.smartTimer);
  st.smartTimer = setTimeout(() => {
    if (!st.folder) return;
    const files = st.folder.scan.files.filter((f) => !isLockedPath(f));
    smart.index(st.folder.root, files).catch(() => {});
  }, 1500);
  st.smartTimer.unref?.();
}

async function folderIndex(st) {
  if (!st?.folder) return null;
  st.index ??= new FolderIndex();
  return st.index.update(st.folder.scan);
}

/** Write new text over a Markdown file, keeping its line endings and BOM, after a backup and a History copy. */
async function rewriteFile(p, text, reason = 'save') {
  const raw = await fs.promises.readFile(p);
  const str = raw.toString('utf8');
  await editing.backup(p);
  await history.add(p, raw, reason);
  await fs.promises.writeFile(p, encodeForSave(text, { eol: detectEol(str), bom: str.startsWith('\ufeff') }));
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** File › Today’s Note: open (or create) Daily/YYYY-MM-DD.md in the open folder. */
async function openDailyNote(st) {
  if (!st.folder) { st.win.webContents.send('doc:error', { message: 'Open a folder first: daily notes go in its “Daily” folder.' }); return; }
  const day = isoDay();
  const dir = path.join(st.folder.root, 'Daily');
  const file = path.join(dir, `${day}.md`);
  try {
    if (!fs.existsSync(file)) {
      const long = new Date().toLocaleDateString(app.getLocale() || undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      await fs.promises.mkdir(dir, { recursive: true });
      const body = `---\ntitle: ${long}\ndate: ${day}\ntags: [daily]\n---\n# ${long}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n`;
      await fs.promises.writeFile(file, encodeForSave(body, { eol: process.platform === 'win32' ? '\r\n' : '\n' }), { flag: 'wx' });
      st.folder.scan = await scanFolder(st.folder.root);
      st.win.webContents.send('folder:changed', folderInfo(st.folder.scan));
      smartRefresh(st);
    }
    sendDoc(st, 'tab:open', await loadDoc(file));
  } catch (err) { st.win.webContents.send('doc:error', { message: errorMessage(err, file) }); }
}

// ---------------------------------------------------------------- add-ons (3.0)
/** What the page needs to know about installed add-ons. */
function addonInfo() {
  if (!addonStore) return [];
  return addonStore.list().map(({ manifest: m, error }) => ({
    id: m.id, name: m.name, version: m.version, author: m.author || '', description: m.description || '', error: error || '',
    enabled: !error && !settings.get().addonsOff.includes(m.id), capabilities: error ? [] : addons.capabilities(m),
    themes: m.themes.map((th) => ({ key: `${m.id}:${th.id}`, name: th.name, tone: th.tone })),
    blocks: m.codeBlocks.map((b) => b.language),
    exports: m.exports.map((e) => ({ id: e.id, name: e.name, extension: e.extension })),
  }));
}

function addonThemeItems(s) {
  const items = [];
  for (const { manifest: m } of addonStore?.list() || []) {
    if (!addonOn(m.id)) continue;
    for (const th of m.themes) items.push({ label: `${th.name} (${m.name})`, type: 'radio', checked: s.theme === `addon:${m.id}:${th.id}`, click: () => setSetting({ theme: `addon:${m.id}:${th.id}` }) });
  }
  return items.length ? [{ type: 'separator' }, ...items] : [];
}

function addonExportItems() {
  const items = [];
  for (const { manifest: m } of addonStore?.list() || []) {
    if (!addonOn(m.id)) continue;
    for (const e of m.exports) {
      items.push({ label: `${e.name} (.${e.extension})…`, click: () => targetState()?.win.webContents.send('menu:command', { cmd: 'addon-export', arg: { id: m.id, exportId: e.id } }) });
    }
  }
  return items.length ? [{ type: 'separator' }, ...items] : [];
}

/** Run one of an add-on's scripts in the sealed sandbox. Resolves to its result, or throws a plain error. */
async function runAddon(id, rel, input, timeoutMs) {
  const source = await addonStore.script(id, rel);
  addonSandbox ??= new CodeSandbox({ dir: path.join(ROOT, 'dist', 'sandbox'), devTools: false });
  const res = await addonSandbox.run({ lang: 'javascript', code: addons.sandboxProgram(source, input), timeoutMs });
  if (res.timedOut) throw new Error('The add-on took too long and was stopped.');
  if (res.error) throw new Error(`The add-on failed: ${String(res.error).slice(0, 300)}`);
  try { return JSON.parse(res.result ?? 'null'); } catch { throw new Error('The add-on gave an answer the app can’t use.'); }
}

/** Read an add-on package the reader chose: a .nmraddon / .zip, or an addon.json in a folder. */
async function readAddonPackage(file) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return { error: 'That file is too large to be an add-on.' };
  if (path.basename(file).toLowerCase() === 'addon.json') {
    const base = path.dirname(file);
    const files = { 'addon.json': await fs.promises.readFile(file) };
    let m;
    try { m = JSON.parse(String(files['addon.json'])); } catch { return { error: 'Its addon.json isn’t valid JSON.' }; }
    for (const s of [...(Array.isArray(m.codeBlocks) ? m.codeBlocks : []), ...(Array.isArray(m.exports) ? m.exports : [])]) {
      const rel = addons.scriptPath(s?.script);
      if (!rel || files[rel]) continue;
      try { files[rel] = await fs.promises.readFile(path.join(base, ...rel.split('/'))); } catch { /* reported as missing */ }
    }
    return addons.checkPackage(files);
  }
  let entries;
  try { entries = publish.exportTools(ROOT).unzipAddon(await fs.promises.readFile(file)); } catch (err) { return { error: err.message || 'That isn’t an add-on package.' }; }
  const pkg = addons.packageFiles(entries);
  return pkg.error ? pkg : addons.checkPackage(pkg.files);
}

async function installAddon(st) {
  const res = await dlg.showOpenDialog(st.win, { title: 'Install Add-on', properties: ['openFile'], filters: [{ name: 'Add-on', extensions: ['nmraddon', 'zip', 'json'] }] });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  const pkg = await readAddonPackage(res.filePaths[0]);
  if (pkg.error) return { error: `That add-on can’t be installed: ${t(pkg.error)}` };
  const m = pkg.manifest;
  const old = addonStore.get(m.id);
  const caps = addons.capabilities(m).map((c) => `• ${t(c)}`).join('\n');
  const { response } = await dlg.showMessageBox(st.win, {
    type: 'question', title: 'Install add-on?', noLink: true, buttons: [old ? 'Update' : 'Install', 'Cancel'], defaultId: 1, cancelId: 1,
    message: old && old.manifest.version ? `Update “${m.name}” from ${old.manifest.version} to ${m.version}?` : `Install “${m.name}” ${m.version}?`,
    detail: `${m.author ? `By ${m.author}. ` : ''}It will:\n${caps}\n\nAdd-on code runs in a sealed sandbox: it can’t use the internet, read your files or change your documents. Only install add-ons from people you trust.`,
  });
  if (response !== 0) return { canceled: true };
  try { await addonStore.install(pkg); } catch (err) { return { error: errorMessage(err, m.id) }; }
  if (settings.get().addonsOff.includes(m.id)) settings.update({ addonsOff: settings.get().addonsOff.filter((x) => x !== m.id) });
  broadcastSettings();
  return { ok: true, id: m.id };
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
    await st.folder.sync?.();
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
    if (!isStr(p, 4096) || !isViewablePath(p)) return settings.get().bookmarks;
    const list = settings.get().bookmarks;
    const has = list.some((b) => b.toLowerCase() === p.toLowerCase());
    settings.update({ bookmarks: has ? list.filter((b) => b.toLowerCase() !== p.toLowerCase()) : [p, ...list] });
    broadcastSettings();
    return settings.get().bookmarks;
  });

  ipcMain.handle('doc:read', async (e, p, opts = {}) => {
    if (!isStr(p, 4096) || !isViewablePath(p)) return { error: 'Not a file the reader can open.' };
    try {
      const doc = await loadDoc(p, { remember: opts.remember !== false });
      const st = stateFor(e);
      if (st) ensureWatch(st, doc.path, doc.mtime);
      return { doc };
    } catch (err) { return { error: errorMessage(err, p) }; }
  });
  // A hover preview of a linked document: the start of its text (or of one section), nothing remembered or watched.
  ipcMain.handle('doc:peek', async (_e, p) => {
    if (!isStr(p, 4096) || !isViewablePath(p)) return { error: 'invalid' };
    if (isLockedPath(p)) return { name: path.basename(p), locked: true };
    try {
      const doc = await readDocument(p, () => null);
      return { name: doc.name, path: doc.path, baseUrl: doc.baseUrl, content: doc.content.slice(0, 60000), data: doc.data || '' };
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
      .filter((t) => isStr(t?.path, 4096) && isViewablePath(t.path))
      .slice(0, 100)
      .map((t) => ({ path: t.path, scroll: Number.isFinite(t.scroll) ? Math.min(1, Math.max(0, t.scroll)) : 0 }));
    st.active = Number.isInteger(payload.active) ? Math.max(0, Math.min(payload.active, st.tabs.length - 1)) : 0;
    const title = isStr(payload.title, 300) ? `${payload.title} — RT Markdown Reader` : 'RT Markdown Reader';
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
    if (!st || !isStr(payload?.path, 4096) || !isViewablePath(payload.path)) return false;
    const at = Number.isFinite(payload.screenX) && Number.isFinite(payload.screenY) ? { x: payload.screenX, y: payload.screenY } : null;
    createWindow({ tabs: [{ path: payload.path, scroll: Number(payload.scroll) || 0 }], at });
    return true;
  });
  ipcMain.handle('tab:context-menu', (e, info) => {
    const st = stateFor(e);
    if (st && info && Number.isInteger(info.index) && Number.isInteger(info.count) && isStr(info.path, 4096)) showTabContextMenu(st, info);
  });
  ipcMain.handle('window:close', (e) => stateFor(e)?.win.close());

  ipcMain.handle('shell:reveal', (_e, p) => { if (isStr(p, 4096) && isViewablePath(p)) shell.showItemInFolder(p); });
  ipcMain.handle('app:about', () => ({
    version: app.getVersion(), year: new Date().getFullYear(), portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    os: `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${require('node:os').release()} (${process.arch})`,
  }));
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
    const res = await dlg.showOpenDialog(st?.win, { title: 'Choose a brand stylesheet', properties: ['openFile'], filters: [{ name: 'Stylesheet', extensions: ['css'] }] });
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
    const allowed = ['citeStyle', 'theme', 'surface', 'colorSafe', 'font', 'fontScale', 'pageWidth', 'showToc', 'showMenuBar', 'restoreSession', 'exportOptions', 'brand', 'readAloud', 'speakBar', 'audioOutput', 'audioInput', 'language'];
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

  // ---- AI assist: off by default, the reader's own key (or a model on this computer), only what they choose is sent
  const aiStatus = () => {
    const conf = settings.get().ai;
    const keys = loadAiKeys();
    const problem = providers.setupProblem(conf, keys);
    return {
      ...conf, secure: secureStorage(), ready: !problem, problem, name: providers.PROVIDERS[conf.provider].name,
      providers: providers.PROVIDER_IDS.map((id) => {
        const p = providers.PROVIDERS[id];
        return { id, label: p.label, name: p.name, keyName: p.keyName, keyHint: p.keyHint, keyUrl: p.keyUrl, keyOptional: !!p.keyOptional, noKey: !!p.noKey, hasKey: !!keys[id] };
      }),
      claudeModels: ai.MODELS.map(({ id, label }) => ({ id, label })),
    };
  };
  const BAD_LOCAL_URL = 'Enter the server’s address, such as http://localhost:11434/v1. Plain http works only for this computer or your own network; use https for anything else.';
  ipcMain.handle('ai:status', () => aiStatus());
  ipcMain.handle('ai:configure', (_e, cfg = {}) => {
    const conf = { ...settings.get().ai };
    const provider = providers.PROVIDER_IDS.includes(cfg.provider) ? cfg.provider : conf.provider;
    const keys = loadAiKeys();
    let keysChanged = false;
    if (cfg.clearKey === true) { delete keys[provider]; keysChanged = true; }
    if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) {
      const key = cfg.apiKey.trim();
      const problem = providers.keyProblem(provider, key);
      if (problem) return { error: problem };
      keys[provider] = key;
      keysChanged = true;
    }
    if (provider === 'local' && typeof cfg.localUrl === 'string') {
      const url = providers.cleanLocalUrl(cfg.localUrl);
      if (!url) return { error: BAD_LOCAL_URL };
      conf.localUrl = url;
    }
    for (const [field, into] of [['model', 'models'], ['quickModel', 'quick']]) {
      if (typeof cfg[field] !== 'string') continue;
      const m = cfg[field].trim();
      if (m && !providers.MODEL_ID_RE.test(m)) return { error: 'That model name has characters a model name can’t have.' };
      conf[into] = { ...conf[into] };
      if (m) conf[into][provider] = m;
      else delete conf[into][provider];
    }
    if (typeof cfg.enabled === 'boolean') conf.enabled = cfg.enabled;
    conf.provider = provider;
    const stored = keysChanged ? saveAiKeys(keys) : null;
    setSetting({ ai: conf });
    return { ok: true, stored, ...aiStatus() };
  });
  // The models a service offers, read from the service itself (a key typed but not saved yet may be used).
  ipcMain.handle('ai:list-models', async (_e, req = {}) => {
    const conf = settings.get().ai;
    const provider = providers.PROVIDER_IDS.includes(req.provider) ? req.provider : conf.provider;
    const p = providers.PROVIDERS[provider];
    let apiKey = loadAiKeys()[provider] || '';
    if (typeof req.apiKey === 'string' && req.apiKey.trim()) {
      const problem = providers.keyProblem(provider, req.apiKey.trim());
      if (problem) return { error: problem };
      apiKey = req.apiKey.trim();
    }
    if (!apiKey && !p.keyOptional) return { error: `Add your ${p.keyName} to see ${p.name}’s models.` };
    let baseURL;
    if (provider === 'local') {
      baseURL = providers.cleanLocalUrl(typeof req.localUrl === 'string' ? req.localUrl : conf.localUrl);
      if (!baseURL) return { error: BAD_LOCAL_URL };
    } else baseURL = providers.baseUrlFor({ provider }, process.env.NMR_AI_BASE_URL);
    try {
      const models = await providers.listModels({ fetch: net.fetch, provider, baseURL, apiKey, signal: AbortSignal.timeout(20_000) });
      for (const m of models) if (typeof m.price === 'number') aiPrices.set(`${provider}|${m.id}`, m.price);
      return { models };
    } catch (err) {
      return { error: err?.name === 'TimeoutError' ? `${provider === 'local' ? 'Your local server' : p.name} didn’t answer in time.` : err.message };
    }
  });

  /** Send one request to the chosen service, streaming the answer to the page as it arrives. */
  async function aiRequest(e, id, task, content) {
    const conf = settings.get().ai;
    const keys = loadAiKeys();
    const problem = providers.setupProblem(conf, keys);
    if (problem) return { error: problem, setup: true };
    const model = providers.modelFor(conf, task);
    const name = providers.PROVIDERS[conf.provider].name;
    const tokens = providers.estimateTokens(content.length);
    if (tokens >= AI_CONFIRM_TOKENS && conf.provider !== 'local' && conf.provider !== 'claudecode') {
      const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
        type: 'question', buttons: ['Send', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
        message: `Send this to ${name}?`,
        detail: providers.sizeNote(conf.provider, tokens, aiPrices.get(`${conf.provider}|${model}`)),
      });
      if (response !== 0) return { error: 'Not sent.' };
    }
    const ctl = new AbortController();
    aiRuns.set(id, ctl);
    const onText = (text) => { if (!e.sender.isDestroyed()) e.sender.send('ai:delta', { id, text }); };
    const override = process.env.NMR_AI_BASE_URL || undefined;          // tests point this at a local stand-in
    let Anthropic;
    try {
      if (conf.provider === 'anthropic') {
        ({ Anthropic } = publish.exportTools(ROOT));
        return { ...(await ai.runAi({ Anthropic, apiKey: keys.anthropic, model, content, signal: ctl.signal, baseURL: override, onText })), name };
      }
      if (conf.provider === 'claudecode') return { ...(await claudeCode.runClaudeCode({ spawn, bin: claudeCode.findClaude(), model, content, signal: ctl.signal, onText })), name };
      return { ...(await providers.runChat({ fetch: net.fetch, provider: conf.provider, baseURL: providers.baseUrlFor(conf, override), apiKey: keys[conf.provider] || '', model, content, signal: ctl.signal, onText })), name };
    } catch (err) {
      return { error: ctl.signal.aborted ? 'Stopped.' : Anthropic ? ai.friendlyError(err, Anthropic) : err.message };
    } finally { aiRuns.delete(id); }
  }

  ipcMain.handle('ai:run', async (e, req = {}) => {
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
    return aiRequest(e, req.id, req.action, content);
  });
  ipcMain.handle('ai:cancel', (_e, id) => { aiRuns.get(id)?.abort(); });

  // ---- automations: your webhooks. The page names one by its id, so it can only ever reach an address you saved.
  const autoJobs = new Map();         // token -> { action, payload, controller }
  const autoState = () => {
    const secrets = loadSecrets().actions || {};
    return {
      actions: settings.get().automations.map((a) => ({ ...a, host: automations.hostOf(a.url), hasSecret: !!secrets[a.id] })),
      n8n: { url: settings.get().n8nUrl, hasKey: !!loadSecrets().n8n }, secure: secureStorage(),
    };
  };
  ipcMain.handle('auto:list', () => autoState());
  ipcMain.handle('auto:save', (_e, a = {}) => {
    const clean = automations.cleanAction(a);
    if (!clean) return { error: isStr(String(a.name || '').trim(), 60) ? 'Enter the whole web address, starting with http:// or https://, with no password in it.' : 'Give it a name.' };
    const list = settings.get().automations;
    setSetting({ automations: list.some((x) => x.id === clean.id) ? list.map((x) => (x.id === clean.id ? clean : x)) : [...list, clean] });
    if (typeof a.secret === 'string' && a.secret.trim()) saveSecrets({ actions: { ...loadSecrets().actions, [clean.id]: a.secret.trim().slice(0, 2000) } });
    return autoState();
  });
  ipcMain.handle('auto:remove', (_e, id) => {
    setSetting({ automations: settings.get().automations.filter((x) => x.id !== id) });
    const { [id]: gone, ...rest } = loadSecrets().actions || {};
    saveSecrets({ actions: rest });
    return autoState();
  });
  ipcMain.handle('auto:n8n', async (_e, req = {}) => {
    const base = automations.n8nBase(req.url);
    if (!base) return { error: 'Enter your n8n address, starting with http:// or https://.' };
    const key = (typeof req.key === 'string' && req.key.trim()) || loadSecrets().n8n;
    if (!key) return { error: 'Add your n8n API key to list workflows by name. Or use New Automation with a webhook’s address.' };
    try {
      const workflows = await automations.listWorkflows({ fetch: net.fetch, base, key });
      setSetting({ n8nUrl: base });
      saveSecrets({ n8n: key });
      return { workflows, n8n: { url: base, hasKey: true } };
    } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('auto:prepare', async (e, req = {}) => {
    const st = stateFor(e);
    const action = settings.get().automations.find((a) => a.id === req.id);
    if (!st || !action) return { error: 'That automation isn’t there any more.' };
    const payload = { app: 'RT Markdown Reader', version: app.getVersion(), action: action.name };
    if (action.send === 'folder') {
      const idx = await folderIndex(st);
      if (!idx) return { error: 'Open a folder first.' };
      const documents = [];
      let bytes = 0;
      for (const f of idx.files) {
        const lines = idx.cache.get(f.path)?.lines;
        if (!lines) continue;
        const text = lines.join('\n');
        bytes += Buffer.byteLength(text);
        if (documents.length >= automations.MAX_FOLDER_FILES || bytes > automations.MAX_FOLDER_BYTES) return { error: 'That folder is too large to send at once (over 500 documents or 20 MB).' };
        documents.push({ name: path.basename(f.path), path: f.rel.replace(/\\/g, '/'), text });
      }
      if (!documents.length) return { error: 'There are no documents in this folder.' };
      payload.folder = path.basename(st.folder.root);
      payload.documents = documents;
    } else {
      if (isStr(req.path, 4096) && isLockedPath(req.path)) return { error: 'Password-locked documents are never sent.' };
      const text = typeof req.text === 'string' ? req.text : '';
      const selection = typeof req.selection === 'string' ? req.selection : '';
      if (action.send === 'selection' && !selection.trim()) return { error: 'Select some text first.' };
      if (action.send === 'document' && !text.trim()) return { error: 'Open a document first.' };
      payload.name = isStr(req.name, 500) ? req.name : '';
      if (action.send === 'selection') payload.selection = selection; else payload.text = text;
    }
    const token = crypto.randomUUID();
    autoJobs.set(token, { action, payload });
    return { token, action, plain: !/^https:/i.test(action.url), ...automations.describeSend(payload) };
  });
  // ---- your servers: the page names one by its id, and its password stays here.
  const serverList = () => {
    const secrets = loadSecrets().servers || {};
    const s = settings.get();
    const others = [];
    if (s.n8nUrl) others.push({ key: 'n8n', name: 'n8n', host: hostOf(s.n8nUrl), command: 'automations' });
    if (s.ai?.localUrl && s.ai.provider === 'local') others.push({ key: 'ai', name: 'Local AI model', host: hostOf(s.ai.localUrl), command: 'preferences', arg: 'ai' });
    return {
      servers: s.servers.map((x) => ({ ...x, host: hostOf(x.url), kindName: servers.KINDS[x.kind].name, hasSecret: !!secrets[x.id] })),
      kinds: servers.KINDS, others, secure: secureStorage(),
    };
  };
  ipcMain.handle('srv:list', () => serverList());
  ipcMain.handle('srv:save', serverAnswer(async (_e, req) => {
    const clean = servers.cleanServer(req);
    if (!clean) throw new webdav.DavError('Check the address. It needs to start with http:// or https://.', 'bad_url');
    const typed = typeof req.secret === 'string' ? req.secret.trim() : '';
    const info = servers.KINDS[clean.kind];
    const secret = (info.channel && typed ? discord.cleanWebhook(typed, process.env.NMR_DISCORD_URL) : typed) || (!typed && typeof req.id === 'string' ? serverSecret(req.id) : '');
    if (info.channel && !secret) throw new webdav.DavError('Paste the whole webhook address, from the channel’s settings, under Integrations.', 'no_key');
    if (!secret) throw new webdav.DavError(info.user ? 'Type your password.' : 'Paste your key.', 'no_key');
    await servers.testServer({ fetch: net.fetch, server: clean, secret });
    saveSecrets({ servers: { ...loadSecrets().servers, [clean.id]: secret } });
    const list = settings.get().servers;
    setSetting({ servers: list.some((x) => x.id === clean.id) ? list.map((x) => (x.id === clean.id ? clean : x)) : [...list, clean] });
    return { ok: true };
  }));
  ipcMain.handle('srv:remove', (_e, id) => {
    const { [id]: gone, ...rest } = loadSecrets().servers || {};
    saveSecrets({ servers: rest });
    const s = settings.get();
    setSetting({ servers: s.servers.filter((x) => x.id !== id), serverFolders: s.serverFolders.filter((f) => f.server !== id) });
    return {};
  });
  ipcMain.handle('srv:test', serverAnswer(async (_e, req) => {
    if (req.other === 'n8n' || req.other === 'ai') {
      const s = settings.get();
      const url = req.other === 'n8n' ? `${s.n8nUrl}/healthz` : `${s.ai?.localUrl}/models`;
      const res = await net.fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!res?.ok) throw new webdav.DavError('The server can’t be reached. Check the address and that you’re on its network.', 'offline');
      return { ok: true };
    }
    const server = serverById(req.id);
    if (!server) throw new webdav.DavError('That server isn’t there any more.', 'gone');
    await servers.testServer({ fetch: net.fetch, server, secret: serverSecret(server.id) });
    return { ok: true };
  }));
  ipcMain.handle('srv:folders', serverAnswer(async (_e, req) => {
    const server = serverById(req.id);
    if (!server) throw new webdav.DavError('That server isn’t there any more.', 'gone');
    const client = servers.davClient({ fetch: net.fetch, server, secret: serverSecret(server.id) });
    return { folders: await client.folders(typeof req.rel === 'string' ? req.rel : '') };
  }));
  ipcMain.handle('srv:open-folder', serverAnswer(async (e, req) => {
    const st = stateFor(e);
    const server = serverById(req.id);
    if (!st || !server) throw new webdav.DavError('That server isn’t there any more.', 'gone');
    const remote = (typeof req.rel === 'string' ? req.rel : '').replace(/^\/+|\/+$/g, '');
    const root = serverCopyPath(server, remote);
    await fs.promises.mkdir(root, { recursive: true });
    const list = settings.get().serverFolders;
    if (!list.some((f) => f.root === root)) setSetting({ serverFolders: [...list, { server: server.id, remote, root }] });
    const client = servers.davClient({ fetch: net.fetch, server, secret: serverSecret(server.id) });
    const stateFile = `${path.dirname(root)}.json`;
    let known = {};
    try { known = JSON.parse(await fs.promises.readFile(stateFile, 'utf8')); } catch { /* the first time */ }
    const res = await webdav.syncFolder({ client, remote, root, known });
    await fs.promises.writeFile(stateFile, JSON.stringify(res.known));
    const info = await setFolder(st, root);
    if (info) st.win.webContents.send('folder:opened', info);
    smartRefresh(st);
    return { count: info?.count || 0 };
  }));
  ipcMain.handle('srv:publish-prepare', serverAnswer(async (e, req) => {
    const st = stateFor(e);
    const server = serverById(req.id);
    if (!st || !server || !servers.KINDS[server.kind].wiki) throw new wikis.WikiError('That server isn’t there any more.', 'gone');
    const docs = await publishDocs(st, req);
    const wiki = servers.wikiClient({ fetch: net.fetch, server, secret: serverSecret(server.id) });
    const places = await wiki.places();
    const known = wikiRecords()[server.id] || {};
    const token = crypto.randomUUID();
    publishJobs.set(token, { server, docs });
    const fresh = docs.filter((d) => !known[d.key]).length;
    const pictures = new Set(docs.flatMap((d) => wikis.localPictures(d.text).map((p) => wikis.pictureFile(d.dir, p)))).size;
    const suggested = req.scope === 'folder' ? path.basename(st.folder.root) : wikis.pageFrom(docs[0].text, docs[0].name).title;
    return { token, places, placeWord: wiki.placeWord, freePlace: !!wiki.freePlace, fresh, again: docs.length - fresh, pictures, suggested, lastPlace: known['place|last']?.id || '' };
  }));
  ipcMain.handle('srv:publish', serverAnswer(async (_e, req) => {
    const job = publishJobs.get(req.token);
    if (!job) throw new wikis.WikiError('That isn’t waiting any more.', 'gone');
    const { server, docs } = job;
    const wiki = servers.wikiClient({ fetch: net.fetch, server, secret: serverSecret(server.id) });
    const known = wikiRecords()[server.id] || {};
    let place = typeof req.place === 'string' ? req.place : '';
    if (!place) {
      const name = typeof req.newPlace === 'string' ? req.newPlace.trim().slice(0, 200) : '';
      if (!name) throw new wikis.WikiError('Give it a name first.', 'no_name');
      place = (await wiki.makePlace(name)).id;
    }
    const readFile = (file) => fs.promises.readFile(file).catch(() => null);
    let res;
    try {
      res = await wikis.publish({ wiki, place, docs, known, readFile });
    } catch (err) {
      if (err.known) saveWikiRecords(server.id, err.known);
      throw err;
    }
    res.known['place|last'] = { id: place };
    saveWikiRecords(server.id, res.known);
    publishJobs.delete(req.token);
    const { made, updated, same, missing, failed, pages } = res.report;
    for (const p of pages) sentLog().add(p.key, { kind: server.kind, where: server.name, what: 'page', url: p.url });
    return { made, updated, same, missing, failed, url: pages.length === 1 || docs.length === 1 ? res.known[docs[0].key]?.url : pages[0]?.url };
  }));

  // ---- Blogs and Discord: nothing goes until you've seen what's going and where, and pressed the button.
  ipcMain.handle('send:prepare', serverAnswer(async (e, req) => {
    const doc = await sendable(e, req);
    const post = blogs.postFrom(doc.text, doc.name);
    const list = serverList().servers;
    return { ...post, opening: discord.openingOf(post.body), sites: list.filter((x) => servers.KINDS[x.kind].blog), channels: list.filter((x) => servers.KINDS[x.kind].channel) };
  }));
  ipcMain.handle('send:status', serverAnswer(async (_e, req) => {
    const { server, secret } = sendTarget(req.id, 'blog');
    const record = isStr(req.path, 4096) ? sentLog().post(req.path, server.id) : null;
    if (!record) return { state: 'new' };
    const state = await servers.blogClient({ fetch: net.fetch, server, secret }).status(record.id);
    return { state: state || 'gone', url: record.url };
  }));
  ipcMain.handle('send:draft', serverAnswer(async (e, req) => {
    const doc = await sendable(e, req);
    const { server, secret } = sendTarget(req.id, 'blog');
    const title = typeof req.title === 'string' ? req.title.trim().slice(0, 300) : '';
    if (!title) throw new wikis.WikiError('Give it a title first.', 'no_title');
    const tags = Array.isArray(req.tags) ? req.tags.filter((t) => isStr(t, 100)).slice(0, 20) : [];
    const res = await blogs.sendDraft({
      blog: servers.blogClient({ fetch: net.fetch, server, secret }),
      post: { title, html: typeof req.html === 'string' ? req.html : '', excerpt: typeof req.excerpt === 'string' ? req.excerpt : '', tags, featured: isStr(req.featured, 2000) ? req.featured : '' },
      record: sentLog().post(doc.key, server.id),
      dir: doc.dir,
      readFile: (file) => fs.promises.readFile(file).catch(() => null),
    });
    sentLog().setPost(doc.key, server.id, res.record);
    sentLog().add(doc.key, { kind: server.kind, where: server.name, what: res.action === 'updated' ? 'update' : 'draft', url: res.url });
    return { url: res.url, action: res.action, published: res.published, ...res.report };
  }));
  const discordMessages = (doc, req) => {
    const post = blogs.postFrom(doc.text, doc.name);
    const summary = req.summary === true;
    const messages = discord.messagesFrom(summary ? String(req.words || '') : post.body, post.title);
    if (messages.length > discord.MAX_MESSAGES) throw new wikis.WikiError(`That would take ${messages.length} messages, which is too many for one channel. Send a summary instead.`, 'too_long');
    return { messages, summary };
  };
  ipcMain.handle('send:plan', serverAnswer(async (e, req) => {
    const { messages } = discordMessages(await sendable(e, req), req);
    return { messages: messages.length, pictures: messages.reduce((n, m) => n + m.pictures.length, 0) };
  }));
  ipcMain.handle('send:discord', serverAnswer(async (e, req) => {
    const doc = await sendable(e, req);
    const { server, secret } = sendTarget(req.id, 'channel');
    const { messages, summary } = discordMessages(doc, req);
    const remember = (url) => sentLog().add(doc.key, { kind: 'discord', where: server.name, what: summary ? 'summary' : 'post', url });
    try {
      const res = await discord.post({ channel: servers.channelClient({ fetch: net.fetch, secret }), messages, dir: doc.dir, readFile: (file) => fs.promises.readFile(file).catch(() => null) });
      remember(res.url);
      return { url: res.url, ...res.report };
    } catch (err) {
      if (err.partial) remember(err.partial.url);
      throw err;
    }
  }));
  ipcMain.handle('sent:list', (_e, p) => (isStr(p, 4096) ? sentLog().list(p) : []));
  ipcMain.handle('sent:forget', (_e, p) => { if (isStr(p, 4096)) sentLog().forget(p); return {}; });

  // ---- Notion: your key stays here, and what's sent is what you were shown.
  ipcMain.handle('notion:state', () => ({ hasKey: !!loadSecrets().notion, secure: secureStorage() }));
  ipcMain.handle('notion:connect', notionAnswer(async (_e, req) => {
    const key = typeof req.key === 'string' ? req.key.trim() : '';
    if (!key) throw new notion.NotionError('Paste your key first.', 'no_key');
    if (key.length > 500 || /\s/.test(key)) throw new notion.NotionError('That doesn’t look like a Notion key.', 'key');
    const me = await notionClient(key).me();
    saveSecrets({ notion: key });
    return me;
  }));
  ipcMain.handle('notion:forget', () => { saveSecrets({ notion: '' }); notionJobs.clear(); return {}; });
  ipcMain.handle('notion:search', notionAnswer(async (_e, req) => ({
    items: await notionClient().search(isStr(req.query, 500) ? req.query : '', { pagesOnly: !!req.pagesOnly }),
  })));

  ipcMain.handle('notion:fetch', notionAnswer(async (_e, req) => {
    const pasted = typeof req.link === 'string';
    const id = notion.pageIdOf(pasted ? req.link : req.id);
    if (!id) throw new notion.NotionError('That isn’t a link to a Notion page.', 'bad_link');
    const client = notionClient();
    const database = async (isSource) => {
      const data = await client.rows(id, { isSource });
      const job = { kind: 'database', id, title: data.title, content: notion.asDocument(data.title, notion.tableOf(data)) };
      const token = crypto.randomUUID();
      notionJobs.set(token, job);
      return { token, kind: 'database', title: data.title, rows: data.rows.length, more: data.more };
    };
    if (req.kind === 'database') return database(true);
    let meta;
    let page;
    try {
      [meta, page] = await Promise.all([client.meta(id), client.content(id)]);
    } catch (err) {
      if (!pasted) throw err;
      try { return await database(false); } catch { throw err; }   // a link may be to a database
    }
    if (meta.trashed) throw new notion.NotionError('That page is in Notion’s trash.', 'trashed');
    const content = notion.asDocument(meta.title, notion.toMarkdown(page.markdown));
    const token = crypto.randomUUID();
    notionJobs.set(token, { kind: 'page', id, title: meta.title, url: notionUrl(id, meta.url), edited: meta.edited, content });
    return { token, kind: 'page', title: meta.title, pictures: notion.picturesIn(content).length, truncated: page.truncated, unknown: page.unknown };
  }));

  ipcMain.handle('notion:keep', notionAnswer(async (e, req) => {
    const st = stateFor(e);
    const job = notionJobs.get(req.token);
    if (!st || !job) throw new notion.NotionError('That page isn’t waiting any more.', 'gone');
    const linked = job.kind === 'page' && !!req.linked;
    const name = `${job.title.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) || 'Notion page'}.md`;
    const finish = () => {
      notionJobs.delete(req.token);
      if (linked) markNotionSeen(job.id, job.edited);
    };
    if (req.how === 'open') {
      finish();
      return { open: { name, content: linked ? notion.withLink(job.content, job.url) : job.content } };
    }
    const { canceled, filePath } = await dlg.showSaveDialog(st.win, {
      title: 'Save as Markdown', defaultPath: path.join(st.folder?.root || app.getPath('documents'), name), filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const { md, missed } = await notionPictures(job.content, filePath);
    await fs.promises.writeFile(filePath, encodeForSave(`${linked ? notion.withLink(md, job.url) : md}\n`, { eol: process.platform === 'win32' ? '\r\n' : '\n' }));
    editing.sessionGrants(st).add(editing.key(filePath));
    finish();
    await openFile(filePath);
    return { saved: true, missed };
  }));

  ipcMain.handle('notion:prepare', notionAnswer(async (_e, req) => {
    if (isStr(req.path, 4096) && isLockedPath(req.path)) throw new notion.NotionError('Password-locked documents are never sent.', 'locked');
    const text = typeof req.text === 'string' ? req.text : '';
    if (!text.trim()) throw new notion.NotionError('Open a document first.', 'empty');
    const id = notion.linkOf(text);
    if (!id) return { unlinked: true };
    const client = notionClient();
    const [meta, page] = await Promise.all([client.meta(id), client.content(id)]);
    const { title, rest } = notion.splitTitle(notion.splitFront(text).body);
    const notes = { pictures: 0, footnotes: 0 };
    const plan = notion.planEdits(page.markdown, rest, notes);
    const rename = title && title !== meta.title ? title : '';
    if (!plan.changed && !rename) {
      markNotionSeen(id, meta.edited);
      return { same: true, hosted: notes.hosted || 0 };
    }
    if (plan.blocked) throw new notion.NotionError('This change can’t be made around the pictures and files stored on this page. Make it in Notion instead.', 'blocked');
    const token = crypto.randomUUID();
    notionJobs.set(token, { kind: 'update', id, plan, rename });
    const known = notionSeen()[id];
    return { token, title: meta.title, rename, before: plan.before, after: plan.after, moved: !!known && meta.edited > known, truncated: page.truncated, notes };
  }));

  ipcMain.handle('notion:prepare-new', notionAnswer(async (_e, req) => {
    if (isStr(req.path, 4096) && isLockedPath(req.path)) throw new notion.NotionError('Password-locked documents are never sent.', 'locked');
    const parent = notion.pageIdOf(req.parent);
    const text = typeof req.text === 'string' ? req.text : '';
    if (!parent || !text.trim()) throw new notion.NotionError('Open a document first.', 'empty');
    const { title, rest } = notion.splitTitle(notion.splitFront(text).body);
    const notes = { pictures: 0, footnotes: 0 };
    const name = title || (isStr(req.name, 500) ? req.name : '').replace(/\.[^.]+$/, '') || 'Untitled';
    const token = crypto.randomUUID();
    notionJobs.set(token, { kind: 'create', parent, title: name, markdown: notion.fromMarkdown(rest, notes), text });
    return { token, title: name, parentTitle: isStr(req.parentTitle, 2000) ? req.parentTitle : '', after: rest, notes };
  }));

  ipcMain.handle('notion:send', notionAnswer(async (_e, req) => {
    const job = notionJobs.get(req.token);
    if (!job || (job.kind !== 'update' && job.kind !== 'create')) throw new notion.NotionError('That isn’t waiting to be sent any more.', 'gone');
    const client = notionClient();
    if (job.kind === 'create') {
      const made = await client.create(job);
      notionJobs.delete(req.token);
      markNotionSeen(made.id, made.edited);
      if (isStr(req.path, 4096)) sentLog().add(req.path, { kind: 'notion', where: 'Notion', what: 'page', url: notionUrl(made.id, made.url) });
      return { text: notion.withLink(job.text, notionUrl(made.id, made.url)) };
    }
    const missed = job.plan.changed ? await client.edit(job.id, job.plan) : 0;
    if (job.rename) await client.rename(job.id, job.rename);
    notionJobs.delete(req.token);
    markNotionSeen(job.id, (await client.meta(job.id)).edited);
    if (isStr(req.path, 4096)) sentLog().add(req.path, { kind: 'notion', where: 'Notion', what: 'update', url: notionUrl(job.id) });
    return { missed };
  }));

  // Has a linked page moved on? Only a real difference counts, and being offline isn't one.
  ipcMain.handle('notion:check', async (_e, req = {}) => {
    try {
      const text = typeof req?.text === 'string' ? req.text : '';
      const id = notion.linkOf(text);
      if (!id || !loadSecrets().notion) return {};
      const client = notionClient();
      const meta = await client.meta(id);
      const known = notionSeen()[id];
      if (known && meta.edited <= known) return {};
      const page = await client.content(id);
      if (!notion.planEdits(page.markdown, notion.splitTitle(notion.splitFront(text).body).rest).changed) {
        markNotionSeen(id, meta.edited);
        return {};
      }
      return { changed: true, title: meta.title, edited: meta.edited };
    } catch { return {}; }
  });
  ipcMain.handle('notion:pull', notionAnswer(async (_e, req) => {
    const text = typeof req.text === 'string' ? req.text : '';
    const { meta, content } = await notionLatest(text, isStr(req.path, 4096) && path.isAbsolute(req.path) ? req.path : '');
    return { content, title: meta.title, edited: meta.edited };
  }));
  ipcMain.handle('notion:seen', (_e, req = {}) => {
    markNotionSeen(notion.linkOf(req?.text), isStr(req?.edited, 60) ? req.edited : '');
    return {};
  });
  ipcMain.handle('notion:open', notionAnswer(async (_e, req) => {
    const id = notion.linkOf(typeof req.text === 'string' ? req.text : '');
    if (!id) throw new notion.NotionError('This document isn’t linked to a Notion page.', 'no_link');
    await shell.openExternal(notionUrl(id));
    return {};
  }));

  ipcMain.handle('auto:send', async (_e, req = {}) => {
    const job = autoJobs.get(req.token);
    if (!job) return { error: 'That was already sent, or was stopped.' };
    job.controller = new AbortController();
    try {
      const text = await automations.callWebhook({ fetch: net.fetch, url: job.action.url, payload: job.payload, secret: loadSecrets().actions?.[job.action.id] || '', signal: job.controller.signal });
      return { text };
    } catch (err) { return { error: err.message }; } finally { autoJobs.delete(req.token); }
  });
  ipcMain.handle('auto:stop', (_e, token) => {
    const job = autoJobs.get(token);
    if (job?.controller) job.controller.abort(); else autoJobs.delete(token);
  });
  ipcMain.handle('inbound:status', () => inboundStatus());
  ipcMain.handle('inbound:set', async (_e, patch = {}) => {
    const next = {};
    if (typeof patch.enabled === 'boolean') next.inbound = patch.enabled;
    if (typeof patch.network === 'boolean') next.inboundNetwork = patch.network;
    settings.update(next);
    try { await applyInbound(); } catch { settings.update({ inbound: false }); await applyInbound().catch(() => {}); return { ...inboundStatus(), error: 'That address couldn’t be opened. Another program may be using it.' }; }
    return inboundStatus();
  });
  ipcMain.handle('inbound:new-key', () => { saveSecrets({ inbound: newInboundKey() }); return inboundStatus(); });

  // ---- citations: sources from a file or from Zotero on this computer
  const bibCache = new Map();          // path -> { mtime, size, parsed }
  const zoteroFile = () => path.join(app.getPath('userData'), 'citations-zotero.json');
  async function readBib(p) {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > 20 * 1024 * 1024) throw new Error('That file of sources is too large (over 20 MB).');
    const hit = bibCache.get(p);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
    const entry = { mtime: st.mtimeMs, size: st.size, parsed: bibliography.parseFile(p, await fs.promises.readFile(p, 'utf8')) };
    bibCache.set(p, entry);
    return entry;
  }
  async function libraryNow() {
    const from = settings.get().citeLibrary;
    if (!from) return { source: '', name: '', entries: [] };
    if (from === 'zotero') {
      try { return { source: 'zotero', name: 'Zotero', entries: JSON.parse(await fs.promises.readFile(zoteroFile(), 'utf8')).entries || [] }; } catch { return { source: 'zotero', name: 'Zotero', entries: [] }; }
    }
    try {
      const hit = await readBib(from);
      return { source: 'file', name: path.basename(from), entries: hit.parsed.entries };
    } catch { return { source: 'file', name: path.basename(from), entries: [], error: `Your library “${path.basename(from)}” couldn’t be read.` }; }
  }
  // A document names its own file relative to itself. Never a full path or a network share: opening a
  // document someone sent you must not reach out to a server, or read anything but a list of sources.
  ipcMain.handle('cite:file', async (_e, req = {}) => {
    const { docPath, rel } = req;
    if (!isStr(docPath, 4096) || !isStr(rel, 1024) || !bibliography.isBibPath(rel) || path.isAbsolute(rel) || /^[\\/]|^[a-z][a-z0-9+.-]*:/i.test(rel)) return { error: `The bibliography “${String(rel).slice(0, 80)}” must be a .bib or .json file named relative to this document.` };
    const file = path.resolve(path.dirname(docPath), rel);
    try {
      const hit = await readBib(file);
      return { entries: hit.parsed.entries, stamp: `${hit.mtime}-${hit.size}`, skipped: hit.parsed.skipped };
    } catch (err) {
      return { error: err.code === 'ENOENT' ? `The bibliography “${rel}” wasn’t found next to this document.` : `The bibliography “${rel}” couldn’t be read. ${err.code ? '' : err.message}`.trim() };
    }
  });
  ipcMain.handle('cite:library', () => libraryNow());
  ipcMain.handle('cite:choose', async (e) => {
    const res = await dlg.showOpenDialog(stateFor(e)?.win, { title: 'Choose your sources', properties: ['openFile'], filters: [{ name: 'BibTeX or CSL JSON', extensions: ['bib', 'bibtex', 'json'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    try { await readBib(res.filePaths[0]); } catch (err) { return { error: err.message }; }
    setSetting({ citeLibrary: res.filePaths[0] });
    return libraryNow();
  });
  ipcMain.handle('cite:zotero', async () => {
    try {
      const { entries } = await bibliography.fetchZotero(net.fetch, process.env.NMR_ZOTERO_URL || bibliography.ZOTERO_URL);
      await fs.promises.writeFile(zoteroFile(), JSON.stringify({ entries, updated: Date.now() }));
    } catch (err) { return { error: err.message }; }
    if (settings.get().citeLibrary !== 'zotero') setSetting({ citeLibrary: 'zotero' });
    return libraryNow();
  });
  ipcMain.handle('cite:clear', () => { setSetting({ citeLibrary: '' }); return libraryNow(); });

  // ---- flashcards: found in the text, with only each card's progress kept by the app
  ipcMain.handle('cards:deck', async (e, req = {}) => {
    const today = flashcards.isoDay();
    if (req.folder) {
      const idx = await folderIndex(stateFor(e));
      if (!idx) return { error: 'Open a folder first.' };
      const cards = [];
      for (const f of idx.cards()) cards.push(...flashcards.deck(f.cards, cardStore.get(f.path), today, { path: f.path, rel: f.rel, baseUrl: pathToFileURL(path.dirname(f.path) + path.sep).href }));
      return { cards: cards.slice(0, 10000), keep: true };
    }
    const text = typeof req.text === 'string' ? req.text : '';
    const keep = isStr(req.path, 4096) && isMarkdownPath(req.path);        // not locked or unsaved documents
    const where = keep ? { path: req.path } : {};
    return { cards: flashcards.deck(flashcards.parseCards(text), keep ? cardStore.get(req.path) : {}, today, where), keep };
  });
  ipcMain.handle('cards:grade', (_e, req = {}) => {
    const { path: p, id, grade } = req;
    if (!isStr(p, 4096) || !isMarkdownPath(p) || !/^[0-9a-f]{16}$/.test(String(id)) || ![1, 2, 3, 4].includes(grade)) return { error: 'invalid' };
    const state = cardStore.grade(p, id, grade);
    return { state, next: flashcards.intervals(state) };
  });
  ipcMain.handle('cards:draft', async (e, req = {}) => {
    if (isStr(req.path, 4096) && isLockedPath(req.path)) return { error: 'AI assist is off for locked documents, so their text never leaves this computer.' };
    if (!isStr(req.id, 100)) return { error: 'invalid' };
    let content;
    try {
      content = ai.buildPrompt('cards', {
        text: typeof req.text === 'string' ? req.text : '',
        title: isStr(req.title, 500) ? req.title : '',
        count: [5, 10, 20].includes(req.count) ? req.count : 10,
      });
    } catch (err) { return { error: err.message }; }
    const res = await aiRequest(e, req.id, 'cards', content);
    return res.error ? res : { ...res, cards: flashcards.parseDraft(res.text).map(({ q, a }) => ({ q, a })) };
  });

  // Writing help: a suggested change to the editor's selection, which the page shows for accepting or rejecting.
  ipcMain.handle('ai:edit', async (e, req = {}) => {
    if (isStr(req.path, 4096) && isLockedPath(req.path)) return { error: 'AI assist is off for locked documents, so their text never leaves this computer.' };
    if (!isStr(req.id, 100)) return { error: 'invalid' };
    const str = (v) => (typeof v === 'string' ? v : '');
    let content;
    try { content = ai.buildEditPrompt(req.action, { text: str(req.text), before: str(req.before), after: str(req.after), language: str(req.language) }); } catch (err) { return { error: err.message }; }
    const res = await aiRequest(e, req.id, req.action, content);
    return res.error ? res : { ...res, text: ai.cleanEditResult(str(req.text), res.text) };
  });

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
      const { response, checkboxChecked } = await dlg.showMessageBox(st.win, {
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
      const { response } = await dlg.showMessageBox(st.win, {
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
      const res = await dlg.showSaveDialog(st.win, {
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
  // ---- pictures pasted or dropped into the editor: saved next to a document you're allowed to edit
  ipcMain.handle('image:save', async (e, req = {}) => {
    const st = stateFor(e);
    const p = req.path;
    if (!st || !isStr(p, 4096) || !isOpenablePath(p)) return { ok: false, reason: 'invalid' };
    if (isLockedPath(p)) return { ok: false, reason: 'locked' };
    if (!editing.isGranted(st, p)) return { ok: false, reason: 'not-allowed' };
    if (!(req.data instanceof Uint8Array) && !(req.data instanceof ArrayBuffer)) return { ok: false, reason: 'invalid' };
    try {
      return await saveImage(p, { name: isStr(req.name, 260) ? req.name : '', data: Buffer.from(req.data) });
    } catch (err) { return { ok: false, reason: 'error', message: errorMessage(err, p) }; }
  });

  // ---- Word documents → Markdown
  ipcMain.handle('docx:import', (e, given) => {
    const st = stateFor(e);
    if (!st) return { error: 'No window' };
    return importDocx(st, isStr(given, 4096) && /\.docx$/i.test(given) ? given : null);
  });

  // ---- version history: only for documents open in this window
  const openHere = (st, p) => !!st && isStr(p, 4096) && isOpenablePath(p) && st.tabs.some((t) => lockId(t.path) === lockId(p));
  ipcMain.handle('history:list', async (e, p) => {
    const st = stateFor(e);
    if (!openHere(st, p)) return [];
    return history.list(p);
  });
  ipcMain.handle('history:read', async (e, p, id) => {
    const st = stateFor(e);
    if (!openHere(st, p) || !isStr(id, 40)) return { error: 'invalid' };
    try {
      const bytes = await history.read(p, id);
      if (isLockedPath(p)) {
        const key = keyFor(p);
        if (!key) return { error: 'Unlock the document to see its earlier versions.' };
        return { content: locked.unlockWithKey(bytes.toString('utf8'), key).content.replace(/\r\n/g, '\n') };
      }
      return { content: bytes.toString('utf8').replace(/^\ufeff/, '').replace(/\r\n/g, '\n') };
    } catch (err) { return { error: String(err?.message || err) }; }
  });
  ipcMain.handle('history:restore', async (e, p, id) => {
    const st = stateFor(e);
    if (!openHere(st, p) || !isStr(id, 40)) return { ok: false, reason: 'invalid' };
    let bytes;
    try { bytes = await history.read(p, id); } catch (err) { return { ok: false, reason: 'missing', message: String(err?.message || err) }; }
    const versions = await history.list(p);
    const when = new Date(versions.find((v) => v.id === id)?.time || Date.now()).toLocaleString();
    if (editing.isGranted(st, p)) {
      const { response } = await dlg.showMessageBox(st.win, {
        type: 'question', title: 'Restore this version?', noLink: true, buttons: ['Restore', 'Cancel'], defaultId: 0, cancelId: 1,
        message: `Restore “${path.basename(p)}” to the version from ${when}?`,
        detail: 'The current version is kept in Version History first, so you can come back to it.',
      });
      if (response !== 0) return { ok: false, reason: 'cancelled' };
    } else {
      const grant = await editing.requestEdit(st, p);
      if (!grant.ok) return { ok: false, reason: grant.reason };
    }
    if (!(await isWritable(p))) return { ok: false, reason: 'readonly' };
    await editing.backup(p);
    await editing.keepVersion(p, 'restore');
    await fs.promises.writeFile(p, bytes);
    return { ok: true };
  });

  // ---- find & replace across the open folder: preview first, ask, back up, keep History, undo
  const cleanReplaceOpts = (o = {}) => ({ regex: o.regex === true, matchCase: o.matchCase === true, wholeWord: o.wholeWord === true });
  ipcMain.handle('replace:preview', async (e, req = {}) => {
    const st = stateFor(e);
    if (!st?.folder) return { ok: false, error: 'Open a folder first.' };
    if (typeof req.find !== 'string' || req.find.length > 1000 || typeof req.replacement !== 'string' || req.replacement.length > 10000) return { ok: false, error: 'invalid' };
    const opts = cleanReplaceOpts(req.opts);
    const files = st.folder.scan.files.filter((f) => !isLockedPath(f)).map((f) => ({ path: f, rel: path.relative(st.folder.root, f) }));
    const res = await runReplaceJob({ mode: 'preview', files, find: req.find, replacement: req.replacement, opts });
    st.replacePlan = res.ok ? { find: req.find, replacement: req.replacement, opts, root: st.folder.root, files: new Map(res.results.map((r) => [r.path, r.mtime])) } : null;
    return res;
  });
  ipcMain.handle('replace:apply', async (e, req = {}) => {
    const st = stateFor(e);
    const plan = st?.replacePlan;
    if (!plan) return { ok: false, error: 'Preview the changes first.' };
    const chosen = {};
    let count = 0;
    for (const [p, list] of Object.entries(req.chosen && typeof req.chosen === 'object' ? req.chosen : {})) {
      if (!plan.files.has(p) || !Array.isArray(list)) continue;
      const ids = [...new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < 100000))];
      if (ids.length) { chosen[p] = ids; count += ids.length; }
    }
    const fileCount = Object.keys(chosen).length;
    if (!count) return { ok: false, error: 'Nothing is ticked.' };
    const { response } = await dlg.showMessageBox(st.win, {
      type: 'question', title: 'Replace in folder?', noLink: true, buttons: ['Replace', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Replace ${count} match${count === 1 ? '' : 'es'} in ${fileCount} file${fileCount === 1 ? '' : 's'}?`,
      detail: `In “${path.basename(plan.root)}”. Each file is backed up and its current version kept in Version History first, and Undo Replace puts them all back.`,
    });
    if (response !== 0) return { ok: false, canceled: true };
    const res = await runReplaceJob({ mode: 'apply', chosen, find: plan.find, replacement: plan.replacement, opts: plan.opts });
    if (!res.ok) return res;
    const batch = [];
    const skipped = [];
    let replaced = 0;
    for (const f of res.files) {
      if (f.error) { skipped.push({ path: f.path, reason: f.error }); continue; }
      if (Math.abs(f.mtime - plan.files.get(f.path)) > 1) { skipped.push({ path: f.path, reason: 'changed' }); continue; }
      if (!(await isWritable(f.path))) { skipped.push({ path: f.path, reason: 'readonly' }); continue; }
      try {
        const before = await fs.promises.readFile(f.path);
        await editing.backup(f.path);
        await history.add(f.path, before, 'replace');
        await fs.promises.writeFile(f.path, encodeForSave(f.content, { eol: f.eol, bom: f.bom }));
        batch.push({ path: f.path, before, after: (await fs.promises.stat(f.path)).mtimeMs });
        replaced += f.count;
      } catch { skipped.push({ path: f.path, reason: 'error' }); }
    }
    st.replacePlan = null;
    st.replaceUndo = batch.length ? { batch, root: plan.root } : null;
    return { ok: true, replaced, files: batch.length, skipped };
  });
  ipcMain.handle('replace:undo', async (e) => {
    const st = stateFor(e);
    const undo = st?.replaceUndo;
    if (!undo) return { ok: false, error: 'There’s nothing to undo.' };
    const { response } = await dlg.showMessageBox(st.win, {
      type: 'question', title: 'Undo replace?', noLink: true, buttons: ['Undo Replace', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Put back the ${undo.batch.length} file${undo.batch.length === 1 ? '' : 's'} changed by the last Replace?`,
      detail: 'Files changed again since then are left alone (their earlier versions are still in Version History).',
    });
    if (response !== 0) return { ok: false, canceled: true };
    let restored = 0;
    const skipped = [];
    for (const item of undo.batch) {
      try {
        const now = await fs.promises.stat(item.path);
        if (Math.abs(now.mtimeMs - item.after) > 1) { skipped.push({ path: item.path, reason: 'changed' }); continue; }
        await history.add(item.path, await fs.promises.readFile(item.path), 'restore');
        await fs.promises.writeFile(item.path, item.before);
        restored++;
      } catch { skipped.push({ path: item.path, reason: 'error' }); }
    }
    st.replaceUndo = null;
    return { ok: true, restored, skipped };
  });

  // ---- connected notes: backlinks, link map, tags, tasks, link checker (open folder only)
  ipcMain.handle('notes:backlinks', async (e, p) => {
    const idx = await folderIndex(stateFor(e));
    return idx && isStr(p, 4096) ? idx.backlinks(p) : [];
  });
  ipcMain.handle('notes:graph', async (e) => { const idx = await folderIndex(stateFor(e)); return idx ? idx.graph() : null; });
  ipcMain.handle('notes:tags', async (e) => { const idx = await folderIndex(stateFor(e)); return idx ? idx.tags() : []; });
  ipcMain.handle('notes:tasks', async (e, today) => {
    const idx = await folderIndex(stateFor(e));
    return idx ? idx.tasks(/^\d{4}-\d{2}-\d{2}$/.test(today) ? today : isoDay()) : [];
  });
  ipcMain.handle('notes:check', async (e) => { const idx = await folderIndex(stateFor(e)); return idx ? idx.check() : null; });

  // Ticking a task off changes its file: only with edit permission, only if that line is unchanged.
  ipcMain.handle('tasks:toggle', async (e, req = {}) => {
    const st = stateFor(e);
    const p = req.path;
    if (!st?.folder || !isStr(p, 4096) || !isMarkdownPath(p) || !st.folder.scan.files.includes(p) || !Number.isInteger(req.line) || typeof req.text !== 'string') return { ok: false, reason: 'invalid' };
    if (!editing.isGranted(st, p)) {
      const grant = await editing.requestEdit(st, p);
      if (!grant.ok) return { ok: false, reason: grant.reason };
    }
    if (!(await isWritable(p))) return { ok: false, reason: 'readonly' };
    const raw = (await fs.promises.readFile(p, 'utf8')).replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\](\s+)(.*)$/.exec(lines[req.line] ?? '');
    if (!m || m[4].trim() !== req.text.trim()) return { ok: false, reason: 'changed' };
    lines[req.line] = `${m[1]}[${req.done ? 'x' : ' '}]${m[3]}${m[4]}`;
    await rewriteFile(p, lines.join('\n'));
    return { ok: true };
  });

  // A [[link]] to a document that doesn't exist yet: create it (after asking) next to the linking one.
  ipcMain.handle('doc:create-linked', async (e, fromPath, name) => {
    const st = stateFor(e);
    if (!st || !isStr(fromPath, 4096) || !isOpenablePath(fromPath) || !isStr(name, 200)) return { error: 'invalid' };
    const clean = String(name).trim().replace(/[\\:*?"<>|]/g, '-').replace(/^[./]+/, '');
    if (!clean || clean.split('/').some((seg) => !seg || seg === '..')) return { error: 'That isn’t a name a document can have.' };
    const base = clean.includes('/') && st.folder ? st.folder.root : path.dirname(fromPath);     // "projects/plan" is from the folder's top
    const target = path.join(base, ...clean.split('/')) + (isMarkdownPath(clean) ? '' : '.md');
    if (fs.existsSync(target)) return { doc: await loadDoc(target) };
    const { response } = await dlg.showMessageBox(st.win, {
      type: 'question', title: 'Create document?', noLink: true, buttons: ['Create', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Create “${path.basename(target)}”?`, detail: `There’s no document called “${name}” yet. It will be created in:\n${path.dirname(target)}`,
    });
    if (response !== 0) return { canceled: true };
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, encodeForSave(`# ${path.basename(target).replace(/\.[^.]+$/, '')}\n\n`, { eol: process.platform === 'win32' ? '\r\n' : '\n' }), { flag: 'wx' });
      editing.sessionGrants(st).add(editing.key(target));
      return { doc: await loadDoc(target) };
    } catch (err) { return { error: errorMessage(err, target) }; }
  });

  // Rename a document, then offer to update the links to it in the open folder.
  ipcMain.handle('doc:rename', async (e, p, newName) => {
    const st = stateFor(e);
    if (!st || !isStr(p, 4096) || !isMarkdownPath(p) || !isStr(newName, 255)) return { error: 'invalid' };
    let name = newName.trim();
    if (!name || /[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) return { error: 'A name can’t contain \\ / : * ? " < > |' };
    if (!isMarkdownPath(name)) name += path.extname(p) || '.md';
    const target = path.join(path.dirname(p), name);
    if (target === p) return { error: 'That’s already its name.' };
    if (fs.existsSync(target) && target.toLowerCase() !== p.toLowerCase()) return { error: `“${name}” already exists in that folder.` };
    if (!editing.isGranted(st, p)) {
      const grant = await editing.requestEdit(st, p);
      if (!grant.ok) return { error: grant.reason === 'readonly' ? 'This file is read-only.' : null, canceled: true };
    }
    const idx = await folderIndex(st);
    const updates = idx && st.folder.scan.files.includes(p) ? idx.retarget(p, target) : [];
    const files = idx?.files;                        // as they were before the rename: the folder watcher refreshes the index while the question below is open
    try { await fs.promises.rename(p, target); } catch (err) { return { error: errorMessage(err, p) }; }
    cardStore.move(p, target);
    sentLog().move(p, target);
    editing.sessionGrants(st).add(editing.key(target));
    let updated = 0;
    let missed = 0;
    if (updates.length) {
      const links = updates.reduce((n, u) => n + u.count, 0);
      const { response } = await dlg.showMessageBox(st.win, {
        type: 'question', title: 'Update links?', noLink: true, buttons: ['Update Links', 'Leave Them'], defaultId: 0, cancelId: 1,
        message: `Update ${links} link${links === 1 ? '' : 's'} to “${path.basename(p)}” in ${updates.length} other document${updates.length === 1 ? '' : 's'}?`,
        detail: 'Each document is backed up and its current version kept in Version History first.',
      });
      if (response === 0) {
        for (const u of updates) {
          try {
            const raw = (await fs.promises.readFile(u.path, 'utf8')).replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
            const res = require('./notes-core').retargetLinks(raw, u.path, p, target, files);
            if (!res.count) continue;
            if (await isWritable(u.path)) { await rewriteFile(u.path, res.text); updated += res.count; } else missed++;
          } catch { missed++; /* left as it was */ }
        }
      }
    }
    if (st.folder) { st.folder.scan = await scanFolder(st.folder.root); st.win.webContents.send('folder:changed', folderInfo(st.folder.scan)); }
    return { doc: await loadDoc(target), updated, missed };
  });

  // ---- Claude: the connector, and Claude Code in a terminal (3.4)
  ipcMain.handle('connector:status', () => connectorStatus());
  ipcMain.handle('connector:set', async (_e, on) => {
    settings.update({ claudeConnector: on === true });
    try { await applyConnector(); } catch { settings.update({ claudeConnector: false }); return { ...connectorStatus(), error: 'The connector couldn’t start.' }; }
    return connectorStatus();
  });
  ipcMain.handle('connector:add', async (_e, target) => {
    if (process.env.PORTABLE_EXECUTABLE_DIR) return { error: 'The portable version moves each time it runs, so Claude can’t start it. Use the installed app for this.' };
    if (target === 'code') return claudeCode.addConnector({ spawn, bin: claudeCode.findClaude(), name: connector.SERVER_NAME, entry: connectorEntry() });
    try { connector.addToDesktop(desktopConfigs(), connectorEntry()); return {}; } catch (err) {
      return { error: err instanceof connector.ToolError ? err.message : 'Claude Desktop’s settings couldn’t be changed.' };
    }
  });
  ipcMain.handle('claude:answer', async (e, id, accept) => {
    const s = claudeSuggestions.get(id);
    if (!s) return {};
    claudeSuggestions.delete(id);
    if (accept !== true) { s.done({ outcome: 'rejected' }); return {}; }
    const st = stateFor(e);
    try {
      if (!editing.isGranted(st, s.path)) {
        const grant = await editing.requestEdit(st, s.path);
        if (!grant.ok) { s.done({ outcome: 'rejected' }); return {}; }
      }
      await rewriteFile(s.path, connector.applyEdit(await fs.promises.readFile(s.path, 'utf8'), s.oldText, s.newText));
      s.done({ outcome: 'accepted' });
      return {};
    } catch (err) {
      const message = err instanceof connector.ToolError ? err.message : errorMessage(err, s.path);
      s.done({ outcome: 'failed', message });
      return { error: message };
    }
  });
  // ---- App Link (3.6)
  ipcMain.handle('link:status', () => linkStatus());
  ipcMain.handle('link:set', async (_e, on) => {
    settings.update({ appLink: on === true });
    try { await applyLink(); } catch { settings.update({ appLink: false }); return { ...(await linkStatus()), error: 'App Link couldn’t start.' }; }
    return linkStatus();
  });
  ipcMain.handle('link:pair', async (_e, id) => {
    if (!linkServer || !appLink.validId(id)) return { error: 'Turn on App Link first.' };
    try { return await linkServer.pairWith(id); } catch (err) { return { error: linkMessage(err) }; }
  });
  ipcMain.handle('link:unlink', async (_e, id) => {
    if (linkServer && appLink.validId(id)) await linkServer.unlink(id);
    return linkStatus();
  });
  ipcMain.handle('link:send', async (e, doc) => {
    if (typeof doc?.text !== 'string' || doc.locked || (doc.path && isLockedPath(doc.path))) return { error: 'Password-locked documents can’t be sent.' };
    if (doc.to === storyTracker.ID) return sendToStory(doc);
    if (!linkServer) return { error: 'Turn on App Link in Preferences first.' };
    const ready = (await linkServer.list()).filter((a) => a.linked && a.running);
    if (!ready.length) return { error: 'No linked app is running.' };
    let choice = ready[0];
    if (ready.length > 1) {
      const buttons = [...ready.map((a) => a.name), 'Cancel'];
      const { response } = await dlg.showMessageBox(stateFor(e).win, { type: 'question', message: 'Send this document to which app?', buttons, cancelId: ready.length, noLink: true });
      choice = ready[response];
      if (!choice) return {};
    }
    try {
      return await linkServer.send(choice.id, { name: doc.name, text: doc.text, attachments: await linkPictures.attachmentsFor(doc.text, doc.path) });
    } catch (err) { return { error: linkMessage(err) }; }
  });
  ipcMain.handle('claude:open-terminal', (e) => {
    const st = stateFor(e);
    const doc = st?.tabs[st.active]?.path;
    const dir = st?.folder?.root || (doc && path.dirname(doc));
    if (!dir) return { error: 'Open a document or a folder first.' };
    const bin = claudeCode.findClaude();
    if (!bin) return { error: claudeCode.NOT_INSTALLED };
    claudeCode.openTerminal({ spawn, bin, dir });
    return {};
  });

  // ---- Preferences and the Help Center (3.4)
  ipcMain.handle('prefs:info', () => ({ languages: i18n.LANGUAGES, mac: isMac }));
  ipcMain.handle('help:articles', async () => {
    const dir = path.join(ROOT, 'help');
    const names = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    return Promise.all(names.map(async (f) => {
      const text = await fs.promises.readFile(path.join(dir, f), 'utf8');
      return { slug: f.replace(/^\d+-|\.md$/g, ''), title: text.match(/^# (.+)$/m)?.[1] || f, text };
    }));
  });

  // ---- the tutorial (3.4)
  let tutorialOffered = !!process.env.NMR_NO_TOUR;   // once per run, not once per window
  const pronunciation = new PronunciationStore(path.join(app.getPath('userData'), 'pronunciation.json'));
  ipcMain.handle('say:get', (_e, doc) => pronunciation.lists(typeof doc === 'string' ? doc : null));
  ipcMain.handle('say:rules', (_e, doc) => pronunciation.rules(typeof doc === 'string' ? doc : null));
  ipcMain.handle('say:set', (_e, change) => pronunciation.set(typeof change?.folder === 'string' ? change.folder : null, change?.list));

  ipcMain.handle('tutorial:get', () => {
    const { tutorial, tutorialStep } = settings.get();
    const offer = !tutorialOffered;
    tutorialOffered = true;
    return { state: tutorial, step: tutorialStep, offer };
  });
  ipcMain.handle('tutorial:set', (_e, patch = {}) => { settings.update({ tutorial: patch.state, tutorialStep: patch.step }); });
  ipcMain.handle('tutorial:practice', async (_e, fresh) => {
    const dir = path.join(app.getPath('userData'), 'tutorial');
    const file = path.join(dir, 'Practice.md');
    await fs.promises.mkdir(dir, { recursive: true });
    if (fresh || !fs.existsSync(file)) await fs.promises.copyFile(path.join(ROOT, 'samples', 'practice.md'), file);
    await openFile(file);
    return file;
  });

  // ---- AI: ask a question about documents from the open folder
  ipcMain.handle('ai:ask-folder', async (e, req = {}) => {
    const st = stateFor(e);
    const problem = providers.setupProblem(settings.get().ai, loadAiKeys());
    if (problem) return { error: problem, setup: true };
    if (!st?.folder) return { error: 'Open a folder first.' };
    if (!isStr(req.id, 100) || !Array.isArray(req.paths) || req.paths.length > 500) return { error: 'invalid' };
    const allowed = new Set(st.folder.scan.files.filter((f) => !isLockedPath(f)));
    const docs = [];
    for (const p of req.paths) {
      if (!allowed.has(p)) continue;                 // never locked documents, never files outside the folder
      try { docs.push({ rel: path.relative(st.folder.root, p).replace(/\\/g, '/'), text: (await fs.promises.readFile(p, 'utf8')).replace(/^﻿/, '') }); } catch { /* skipped */ }
    }
    let content;
    try { content = ai.buildFolderPrompt(typeof req.question === 'string' ? req.question : '', docs); } catch (err) { return { error: err.message }; }
    return aiRequest(e, req.id, 'folder', content);
  });

  // ---- add-ons
  // ---- sync between your computers (3.1): the main process reads and writes the sync folder
  ipcMain.handle('sync:status', () => sync.status());
  ipcMain.handle('sync:choose-folder', async (e) => {
    const st = stateFor(e);
    const opts = { title: 'Choose a folder you already sync', properties: ['openDirectory', 'createDirectory'] };
    const res = await (st ? dlg.showOpenDialog(st.win, opts) : dialog.showOpenDialog(opts));
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  ipcMain.handle('sync:configure', (_e, o = {}) => {
    const patch = {};
    if (isStr(o.folder, 4096) && path.isAbsolute(o.folder)) patch.folder = o.folder;
    if (typeof o.enabled === 'boolean') patch.enabled = o.enabled;
    if (isStr(o.name, 80)) patch.name = o.name;
    return sync.configure(patch);
  });
  ipcMain.handle('sync:now', () => sync.sync());

  // ---- natural voices (3.2): downloaded only after the reader agrees; spoken in a separate process
  // Export as audio (3.5): the file grows under a temporary name, and takes its real name when it's finished.
  const audioJobs = new Map();
  let nextAudio = 1;
  const dropAudio = async (job) => {
    await job.file.close().catch(() => {});
    await fs.promises.rm(job.part, { force: true }).catch(() => {});
  };
  ipcMain.handle('audio:begin', async (e, { format, name } = {}) => {
    const st = stateFor(e);
    const kinds = { mp3: { name: 'MP3 audio', extensions: ['mp3'] }, m4b: { name: 'Audiobook', extensions: ['m4b'] } };
    if (!st || !kinds[format]) return null;
    const res = await dlg.showSaveDialog(st.win, { title: 'Export as Audio', defaultPath: path.basename(String(name || `Audio.${format}`)), filters: [kinds[format]] });
    if (res.canceled || !res.filePath) return null;
    const part = `${res.filePath}.part`;
    const id = nextAudio++;
    audioJobs.set(id, { path: res.filePath, part, file: await fs.promises.open(part, 'w+') });
    return { id };
  });
  ipcMain.handle('audio:write', async (_e, id, bytes) => {
    const job = audioJobs.get(id);
    if (job && bytes instanceof Uint8Array) await job.file.appendFile(bytes);
  });
  ipcMain.handle('audio:finish', async (_e, id, { tail, patches = [] } = {}) => {
    const job = audioJobs.get(id);
    if (!job) return { ok: false };
    audioJobs.delete(id);
    try {
      if (tail?.length) await job.file.appendFile(tail);
      for (const p of patches) await job.file.write(p.bytes, 0, p.bytes.length, p.at);
      await job.file.close();
      await fs.promises.rename(job.part, job.path);
      return { ok: true, name: path.basename(job.path) };
    } catch {
      await dropAudio(job);
      return { ok: false };
    }
  });
  ipcMain.handle('audio:abort', async (_e, id) => {
    const job = audioJobs.get(id);
    if (!job) return;
    audioJobs.delete(id);
    await dropAudio(job);
  });
  app.on('will-quit', () => { for (const job of audioJobs.values()) { job.file.close().catch(() => {}); fs.rmSync(job.part, { force: true }); } });

  ipcMain.handle('dictate:status', () => dictation.status());
  ipcMain.handle('dictate:install', async (e) => {
    if (dictation.status().installed) return dictation.status();
    const { response } = await dlg.showMessageBox(stateFor(e)?.win, {
      type: 'question', title: 'Dictation', noLink: true, buttons: ['Download', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Download dictation?',
      detail: `About ${Math.round(dictation.status().total / 1e6 / 10) * 10} MB, downloaded once. After that it works offline: what you say never leaves your computer.\n\nDictation uses the Whisper model by OpenAI, under the MIT license.`,
    });
    if (response !== 0) return { ...dictation.status(), canceled: true };
    return dictation.install((status) => { for (const { win } of liveStates()) win.webContents.send('dictate:progress', status); });
  });
  ipcMain.handle('dictate:remove', async (e) => {
    if (!dictation.status().installed) return dictation.status();
    const { response } = await dlg.showMessageBox(stateFor(e)?.win, {
      type: 'question', title: 'Dictation', noLink: true, buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Remove the dictation download?',
      detail: 'This frees the space it uses. You can download it again at any time.',
    });
    return response === 0 ? dictation.remove() : dictation.status();
  });
  ipcMain.handle('dictate:hear', async (_e, job = {}) => {
    if (!(job.samples instanceof Float32Array) || job.samples.length > 16000 * 30) return { error: 'That was too long' };
    try { return await dictation.hear({ samples: job.samples, lang: /^[a-z]{2}$/.test(job.lang) ? job.lang : '' }); } catch (err) { return { error: err.message }; }
  });

  // ---- smart search: finding documents by what they mean, entirely on this computer
  const smartStatus = (st) => ({ ...smart.status(), enabled: settings.get().smartSearch, indexing: st?.folder ? smart.indexing.get(st.folder.root) || null : null });
  ipcMain.handle('smart:status', (e) => smartStatus(stateFor(e)));
  ipcMain.handle('smart:enable', async (e, on) => {
    const st = stateFor(e);
    if (!on) { setSetting({ smartSearch: false }); return smartStatus(st); }
    if (!smart.status().installed) {
      const { response } = await dlg.showMessageBox(st?.win, {
        type: 'question', title: 'Smart search', noLink: true, buttons: ['Download', 'Cancel'], defaultId: 0, cancelId: 1,
        message: 'Download smart search?',
        detail: `About ${Math.round(smart.status().total / 1e6 / 5) * 5} MB, downloaded once. After that it works offline: your documents are read on this computer and never leave it.\n\nIt uses the multilingual-e5-small model (MIT license), from Hugging Face. Locked documents are never read.`,
      });
      if (response !== 0) return { ...smartStatus(st), canceled: true };
      const res = await smart.install((status) => { for (const { win } of liveStates()) win.webContents.send('smart:download', status); });
      if (!res.installed) return smartStatus(st);
    }
    setSetting({ smartSearch: true });
    for (const s of liveStates()) smartRefresh(s);
    return smartStatus(st);
  });
  ipcMain.handle('smart:search', async (e, query) => {
    const st = stateFor(e);
    if (!st?.folder || !isStr(query, 500) || !settings.get().smartSearch) return { results: [] };
    try {
      const found = await smart.search(st.folder.root, query);
      const idx = await folderIndex(st);
      const results = found.map((r) => {
        const rel = path.relative(st.folder.root, r.path);
        return { path: r.path, rel, name: path.basename(r.path), line: r.line, text: idx?.passageText(r.path, r.line) || '' };
      });
      return { results, indexing: smart.indexing.get(st.folder.root) || null };
    } catch { return { results: [], error: 'Smart search stopped. Try again.' }; }
  });
  ipcMain.handle('smart:related', async (e, p) => {
    const st = stateFor(e);
    if (!st?.folder || !isStr(p, 4096) || !settings.get().smartSearch || !smart.status().installed) return [];
    try {
      const found = await smart.related(st.folder.root, p);
      return found.map((r) => ({ path: r.path, rel: path.relative(st.folder.root, r.path), name: path.basename(r.path) }));
    } catch { return []; }
  });
  ipcMain.handle('smart:remove', async (e) => {
    if (!smart.status().installed) return smart.status();
    const { response } = await dlg.showMessageBox(stateFor(e)?.win, {
      type: 'question', title: 'Smart search', noLink: true, buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Remove the smart search download?',
      detail: 'This frees the space it uses, and removes what it learned about your folders. Your documents aren’t touched. You can download it again at any time.',
    });
    if (response !== 0) return smart.status();
    setSetting({ smartSearch: false });
    return smart.remove();
  });

  ipcMain.handle('voice:status', () => voices.status());
  ipcMain.handle('voice:install', async (e) => {
    const st = stateFor(e);
    if (voices.status().installed) return voices.status();
    const mb = Math.round(voices.status().total / 1e6 / 10) * 10;
    for (;;) {
      const { response } = await dlg.showMessageBox(st?.win, {
        type: 'question', title: 'Natural voices', noLink: true, buttons: ['Download', 'Read the License', 'Cancel'], defaultId: 0, cancelId: 2,
        message: 'Download the natural voices?',
        detail: `About ${mb} MB, downloaded once. After that they work offline: nothing you read is ever sent anywhere.\n\nThe voices are Supertonic 3 by Supertone, under the OpenRAIL-M license, which forbids using them to impersonate people, to deceive, or to harm anyone.`,
      });
      if (response === 1) { shell.openExternal(LICENSE_URL); continue; }
      if (response !== 0) return { ...voices.status(), canceled: true };
      break;
    }
    return voices.install((status) => { for (const { win } of liveStates()) win.webContents.send('voice:progress', status); });
  });
  ipcMain.handle('voice:cancel-download', () => { voices.cancel(); return voices.status(); });
  ipcMain.handle('voice:remove', async (e) => {
    const st = stateFor(e);
    const { response } = await dlg.showMessageBox(st?.win, {
      type: 'question', title: 'Natural voices', noLink: true, buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Remove the natural voices?',
      detail: 'This frees the space they use. Your computer’s own voices stay, and you can download the natural ones again at any time.',
    });
    return response === 0 ? voices.remove() : voices.status();
  });
  ipcMain.handle('voice:speak', async (_e, job = {}) => {
    if (!isStr(job.text, 20000) || !VOICES.includes(job.voice) || !VOICE_LANGS.includes(job.lang)) return { error: 'invalid' };
    const speed = Math.min(2, Math.max(0.5, Number(job.speed) || 1.05));
    const steps = Math.min(12, Math.max(2, Math.round(Number(job.steps) || 8)));
    try { return await voices.speak({ text: job.text, lang: job.lang, voice: job.voice, speed, steps }); } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('voice:cancel', () => voices.cancelSpeech());
  ipcMain.handle('addons:list', () => addonInfo());
  ipcMain.handle('addons:install', async (e) => { const st = stateFor(e); return st ? installAddon(st) : { error: 'invalid' }; });
  ipcMain.handle('addons:set-enabled', (_e, id, on) => {
    if (!isStr(id, 40) || !addonStore?.get(id)) return addonInfo();
    const off = settings.get().addonsOff.filter((x) => x !== id);
    settings.update({ addonsOff: on ? off : [...off, id] });
    broadcastSettings();
    return addonInfo();
  });
  ipcMain.handle('addons:remove', async (e, id) => {
    const st = stateFor(e);
    const item = isStr(id, 40) && addonStore?.get(id);
    if (!st || !item) return { error: 'invalid' };
    const { response } = await dlg.showMessageBox(st.win, {
      type: 'question', title: 'Remove add-on?', noLink: true, buttons: ['Remove', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Remove “${item.manifest.name}”?`, detail: 'Its themes, code-block types and export formats will no longer be available. Your documents aren’t changed.',
    });
    if (response !== 0) return { canceled: true };
    await addonStore.remove(id);
    settings.update({ addonsOff: settings.get().addonsOff.filter((x) => x !== id), ...(settings.get().theme.startsWith(`addon:${id}:`) ? { theme: 'system' } : {}) });
    broadcastSettings();
    return { ok: true };
  });
  // Draw a code block with an add-on: its script gets the block's text and returns HTML or SVG (sanitized by the page).
  ipcMain.handle('addons:render', async (_e, req = {}) => {
    const item = isStr(req.id, 40) && addonOn(req.id) ? addonStore.get(req.id) : null;
    const block = item?.manifest.codeBlocks.find((b) => b.language === req.language);
    if (!block || typeof req.code !== 'string' || req.code.length > 100_000) return { error: 'invalid' };
    try {
      const out = await runAddon(req.id, block.script, { code: req.code, language: block.language }, 5000);
      if (typeof out !== 'string') return { error: 'The add-on gave an answer the app can’t use.' };
      return out.length > 2_000_000 ? { error: 'The add-on’s drawing is too large.' } : { html: out };
    } catch (err) { return { error: err.message }; }
  });
  // Export with an add-on: its script gets the document and returns the new file's text (or base64 bytes).
  ipcMain.handle('addons:export', async (e, req = {}) => {
    const st = stateFor(e);
    const item = st && isStr(req.id, 40) && addonOn(req.id) ? addonStore.get(req.id) : null;
    const ex = item?.manifest.exports.find((x) => x.id === req.exportId);
    const d = req.doc || {};
    if (!ex || typeof d.markdown !== 'string' || d.markdown.length > 20_000_000) return { error: 'invalid' };
    const doc = {
      title: isStr(d.title, 1000) ? d.title : '', name: isStr(d.name, 500) ? d.name : '', markdown: d.markdown,
      html: typeof d.html === 'string' && d.html.length < 40_000_000 ? d.html : '',
      headings: Array.isArray(d.headings) ? d.headings.slice(0, 5000).filter((h) => h && isStr(h.text, 1000) && Number.isInteger(h.level)).map((h) => ({ level: h.level, text: h.text, id: isStr(h.id, 500) ? h.id : '' })) : [],
    };
    let out;
    try { out = await runAddon(req.id, ex.script, doc, 20_000); } catch (err) { return { error: err.message }; }
    let data;
    if (typeof out === 'string') data = Buffer.from(out, 'utf8');
    else if (out && typeof out.base64 === 'string') data = Buffer.from(out.base64, 'base64');
    else return { error: 'The add-on gave an answer the app can’t use.' };
    if (data.length > 50 * 1024 * 1024) return { error: 'The exported file would be too large.' };
    const current = st.tabs[st.active]?.path;
    const base = current ? path.basename(current).replace(/\.[^.]+$/, '') : 'document';
    const res = await dlg.showSaveDialog(st.win, {
      title: `Export as ${ex.name}`, defaultPath: path.join(current ? path.dirname(current) : app.getPath('documents'), `${base}.${ex.extension}`),
      filters: [{ name: ex.name, extensions: [ex.extension] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    let target = res.filePath;
    if (path.extname(target).toLowerCase() !== `.${ex.extension}`) target += `.${ex.extension}`;
    try { await fs.promises.writeFile(target, data); } catch (err) { return { error: errorMessage(err, target) }; }
    if (!process.env.NMR_NO_REVEAL) shell.showItemInFolder(target);
    return { ok: true, path: target };
  });

  // ---- commands by name (Quick Open ">") and your own shortcuts
  ipcMain.handle('commands:list', () => commandList());
  ipcMain.handle('commands:run', (_e, key) => {
    const entry = isStr(key, 200) ? commandRegistry.get(key) : null;
    if (!entry || !entry.enabled) return false;
    entry.click();
    return true;
  });
  ipcMain.handle('shortcuts:set', (_e, id, accelerator, opts = {}) => {
    if (!isStr(id, 48) || !(accelerator === null || typeof accelerator === 'string')) return { error: 'invalid' };
    return setShortcut(id, accelerator, { takeOver: opts?.takeOver === true });
  });
  // While you press keys for a new shortcut, the menus mustn't act on them.
  ipcMain.handle('shortcuts:recording', (e, on) => { e.sender.setIgnoreMenuShortcuts(on === true); });
  ipcMain.handle('shortcuts:reset-all', async (e) => {
    const st = stateFor(e);
    const { response } = await dlg.showMessageBox(st?.win, {
      type: 'question', title: 'Reset shortcuts?', noLink: true, buttons: ['Reset All', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Put every keyboard shortcut back to how it came?',
    });
    if (response !== 0) return null;
    settings.update({ shortcuts: {} });
    rebuildMenu();
    return commandList();
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
  history = new HistoryStore(path.join(app.getPath('userData'), 'history'));
  editing = new Editing({ settings, dialog: dlg, backupDir: backupDir(), defaultDir: app.getPath('documents'), sealLocked, history });
  annotations = new AnnotationStore(app.getPath('userData'));
  cardStore = new flashcards.CardStore(app.getPath('userData'));
  addonStore = new addons.AddonStore(path.join(app.getPath('userData'), 'addons')).load();
  sync = new SyncEngine({
    dir: app.getPath('userData'),
    settings,
    annotations,
    cards: cardStore,
    // Another computer's changes have just been applied here: show them in every open window.
    onApplied: ({ settings: changed, annotationPaths }) => {
      if (changed) broadcastSettings();
      if (annotationPaths.length) for (const { win } of liveStates()) win.webContents.send('annotations:changed', annotationPaths);
    },
    onStatus: (status) => { for (const { win } of liveStates()) win.webContents.send('sync:status', status); },
  });
  settings.onChange = () => sync.soon();
  annotations.onChange = () => sync.soon();
  cardStore.onChange = () => sync.soon();
  sync.start();
  applyConnector().catch(() => {});
  applyLink().catch(() => {});
  storyHandover.sweep();
  applyInbound().catch(() => {});
  voices = new VoiceStore({
    root: path.join(app.getPath('userData'), 'voices'),
    fetch: (url, opts) => net.fetch(url, opts),
    fork: (script) => utilityProcess.fork(script, [], { serviceName: 'RT Markdown Reader voices', stdio: 'ignore' }),
    worker: path.join(ROOT, 'dist', 'voice-worker.cjs'),
    fake: !!process.env.NMR_FAKE_TTS,             // tests: no download, and a tone instead of a voice
  });
  dictation = new DictationStore({
    root: path.join(app.getPath('userData'), 'dictation'),
    fetch: (url, opts) => net.fetch(url, opts),
    fork: (script) => utilityProcess.fork(script, [], { serviceName: 'RT Markdown Reader dictation', stdio: 'ignore' }),
    worker: path.join(ROOT, 'dist', 'dictate-worker.cjs'),
    fake: !!process.env.NMR_FAKE_TTS,             // tests: no download, and made-up words
  });
  smart = new SmartStore({
    root: path.join(app.getPath('userData'), 'smart-search'),
    fetch: (url, opts) => net.fetch(url, opts),
    fork: (script) => utilityProcess.fork(script, [], { serviceName: 'RT Markdown Reader smart search', stdio: 'ignore' }),
    worker: path.join(ROOT, 'dist', 'smart-worker.cjs'),
    fake: !!process.env.NMR_FAKE_TTS,             // tests: no download, and words hashed instead of a model
    onIndexing(progress) { for (const { win } of liveStates()) win.webContents.send('smart:progress', progress); },
  });
  // Documents never need camera, notifications, etc.: only clipboard writes for "Copy", and the app's own
  // windows may use the microphone for dictation, which only starts when you ask for it.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm === 'clipboard-sanitized-write'
    || (perm === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio' && liveStates().some(({ win }) => win.webContents === wc))));
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

let syncFlushed = false;
app.on('before-quit', (e) => {
  quitting = true;
  persistSession();
  settings?.flush();
  // One last sync, so the other computers see what was done here just before quitting. Bounded:
  // a slow or missing cloud folder never holds the app open for more than a few seconds.
  if (sync?.status().enabled && !syncFlushed) {
    e.preventDefault();
    syncFlushed = true;
    annotations?.flush();
    cardStore?.flush();
    Promise.race([sync.flush(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  }
});
// Windows send their final tab state as they close, which can arrive after before-quit.
app.on('will-quit', () => {
  connectorServer?.stop();
  linkServer?.stop();
  storyHandover.clear();
  persistSession();
  settings?.flush();
  annotations?.flush();
  cardStore?.flush();
  voices?.stop();
});
app.on('window-all-closed', () => {
  if (isMac) return;
  quitting = true;
  settings?.flush();
  app.quit();
});
