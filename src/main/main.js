'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { Settings } = require('./settings');
const { isMarkdownPath, fileFromArgv, readMarkdown } = require('./files');

const isMac = process.platform === 'darwin';
const RENDERER_HTML = path.join(__dirname, '..', '..', 'dist', 'index.html');
const SHOWCASE = path.join(__dirname, '..', '..', 'samples', 'showcase.md');
const THEME_BG = { light: '#e8ebf0', dark: '#0e1014', sepia: '#e6dccb' };

let settings;
const windows = new Map();   // webContents.id -> { win, filePath, history, unwatch }
const pendingOpen = [];      // files requested before the app was ready (macOS open-file)

// ---------- single instance: a second launch (double-clicking another .md) opens in this process
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    const file = fileFromArgv(argv, cwd);
    if (file) openFile(file);
    else focusAny();
  });
}

app.on('open-file', (e, file) => {          // macOS Finder "Open With"
  e.preventDefault();
  if (app.isReady()) openFile(file); else pendingOpen.push(file);
});

function focusAny() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return createWindow(null);
  if (win.isMinimized()) win.restore();
  win.focus();
}

function resolvedTheme() {
  const t = settings.get().theme;
  return t === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : t;
}

function initialBounds() {
  const saved = settings.get().windowBounds;
  if (saved) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 20 && saved.y < a.y + a.height - 100);
    if (visible) return saved;
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1280, Math.round(width * 0.8)), height: Math.min(960, Math.round(height * 0.88)) };
}

function createWindow(filePath) {
  const bounds = initialBounds();
  const cascade = BrowserWindow.getAllWindows().length * 28;
  const win = new BrowserWindow({
    ...bounds,
    x: bounds.x != null ? bounds.x + cascade : undefined,
    y: bounds.y != null ? bounds.y + cascade : undefined,
    minWidth: 520,
    minHeight: 420,
    show: false,
    title: 'Neo Markdown Reader',
    backgroundColor: THEME_BG[resolvedTheme()],
    autoHideMenuBar: !isMac,
    icon: path.join(__dirname, '..', '..', 'dist', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });
  const id = win.webContents.id;
  const state = { win, filePath: filePath || null, history: [], unwatch: null };
  windows.set(id, state);

  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Never let document content navigate the app window or spawn new ones.
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); handleLinkUrl(state, url); });
  win.webContents.setWindowOpenHandler(({ url }) => { handleLinkUrl(state, url); return { action: 'deny' }; });
  win.webContents.on('found-in-page', (_e, result) => win.webContents.send('find:result', {
    active: result.activeMatchOrdinal, total: result.matches,
  }));

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    settings.update({ windowBounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => { state.unwatch?.(); windows.delete(id); });

  win.loadFile(RENDERER_HTML);
  return win;
}

function stateFor(event) {
  return windows.get(event.sender.id);
}

// Opening a file from outside (double-click, CLI, Finder): reuse a window already showing it,
// reuse an empty welcome window, otherwise open a fresh window.
function openFile(filePath) {
  const abs = path.resolve(filePath);
  for (const s of windows.values()) {
    if (s.filePath && s.filePath.toLowerCase() === abs.toLowerCase()) {
      if (s.win.isMinimized()) s.win.restore();
      s.win.focus();
      return;
    }
  }
  const empty = [...windows.values()].find((s) => !s.filePath && !s.win.isDestroyed());
  if (empty) {
    loadIntoWindow(empty, abs);
    empty.win.focus();
  } else {
    createWindow(abs);
  }
}

async function loadIntoWindow(state, filePath, { pushHistory = false } = {}) {
  const { win } = state;
  try {
    const doc = await readMarkdown(filePath);
    if (pushHistory && state.filePath && state.filePath !== doc.path) state.history.push(state.filePath);
    state.filePath = doc.path;
    watch(state);
    const s = settings.addRecent(doc.path);
    if (process.platform === 'win32' || isMac) app.addRecentDocument(doc.path);
    rebuildMenu();
    win.setTitle(`${doc.name} — Neo Markdown Reader`);
    if (isMac) win.setRepresentedFilename(doc.path);
    win.webContents.send('doc:loaded', { ...doc, canGoBack: state.history.length > 0, recent: s.recent });
    return true;
  } catch (err) {
    win.webContents.send('doc:error', { message: err.code === 'ENOENT' ? `File not found:\n${filePath}` : String(err.message || err) });
    return false;
  }
}

// Live reload: re-render whenever the file changes on disk (e.g. while editing in VS Code).
function watch(state) {
  state.unwatch?.();
  const file = state.filePath;
  let last = 0;
  const listener = async (curr) => {
    if (!curr || curr.mtimeMs === last || state.filePath !== file || state.win.isDestroyed()) return;
    last = curr.mtimeMs;
    if (curr.nlink === 0 && curr.size === 0) return;          // momentarily deleted during save
    try {
      const doc = await readMarkdown(file);
      state.win.webContents.send('doc:changed', doc);
    } catch { /* file vanished mid-save; next tick will catch up */ }
  };
  fs.watchFile(file, { interval: 600 }, listener);
  state.unwatch = () => fs.unwatchFile(file, listener);
}

function isSafeExternal(url) {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); } catch { return false; }
}

// Links clicked inside a document.
function handleLinkUrl(state, url) {
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  if (isSafeExternal(url)) { shell.openExternal(parsed.href); return; }
  if (parsed.protocol === 'file:') {
    let target;
    try { target = fileURLToPath(parsed); } catch { return; }
    if (isMarkdownPath(target)) loadIntoWindow(state, target, { pushHistory: true });
    else if (fs.existsSync(target)) shell.showItemInFolder(target);   // never execute linked files
  }
}

async function showOpenDialog(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Markdown file',
    properties: ['openFile', 'multiSelections'],
    defaultPath: settings.get().recent[0] ? path.dirname(settings.get().recent[0]) : app.getPath('documents'),
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdx'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
}

async function openViaDialog(state) {
  const files = await showOpenDialog(state?.win);
  if (!files.length) return false;
  const [first, ...rest] = files;
  if (state) await loadIntoWindow(state, first); else openFile(first);
  rest.forEach(openFile);
  return true;
}

function broadcastSettings() {
  const s = settings.get();
  for (const { win } of windows.values()) {
    if (!win.isDestroyed()) {
      win.setBackgroundColor(THEME_BG[resolvedTheme()]);
      win.webContents.send('settings:changed', { ...s, resolvedTheme: resolvedTheme() });
    }
  }
  rebuildMenu();
}

function setSetting(patch) {
  settings.update(patch);
  broadcastSettings();
}

function focusedState() {
  const win = BrowserWindow.getFocusedWindow();
  return win ? windows.get(win.webContents.id) : null;
}

function send(cmd, arg) {
  const s = focusedState();
  if (s) s.win.webContents.send('menu:command', { cmd, arg });
}

async function exportPdf(state) {
  const { win, filePath } = state;
  const base = filePath ? path.basename(filePath).replace(/\.[^.]+$/, '') : 'document';
  const res = await dialog.showSaveDialog(win, {
    title: 'Export as PDF',
    defaultPath: path.join(filePath ? path.dirname(filePath) : app.getPath('documents'), base + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return false;
  const pdf = await win.webContents.printToPDF({
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

function rebuildMenu() {
  const s = settings.get();
  const recentItems = s.recent.length
    ? [...s.recent.map((p) => ({ label: p.length > 80 ? '…' + p.slice(-78) : p, click: () => openFile(p) })),
      { type: 'separator' }, { label: 'Clear Recent', click: () => { settings.update({ recent: [] }); app.clearRecentDocuments(); broadcastSettings(); } }]
    : [{ label: 'No recent files', enabled: false }];
  const radio = (label, key, value, accelerator) => ({ label, type: 'radio', checked: s[key] === value, accelerator, click: () => setSetting({ [key]: value }) });

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openViaDialog(focusedState()) },
        { label: 'Open Recent', submenu: recentItems },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow(null) },
        { type: 'separator' },
        { label: 'Reload File', accelerator: 'F5', click: () => { const st = focusedState(); if (st?.filePath) loadIntoWindow(st, st.filePath); } },
        { label: 'Show in Folder', click: () => { const st = focusedState(); if (st?.filePath) shell.showItemInFolder(st.filePath); } },
        { type: 'separator' },
        { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => { const st = focusedState(); if (st) exportPdf(st); } },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => focusedState()?.win.webContents.print({ printBackground: true }) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Close Window', accelerator: 'Ctrl+W', role: 'close' },
        ...(isMac ? [] : [{ label: 'Exit', role: 'quit' }]),
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'copy' }, { role: 'selectAll' }, { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Theme', submenu: [radio('Follow System', 'theme', 'system'), radio('Light (Paper)', 'theme', 'light'), radio('Dark (Night)', 'theme', 'dark'), radio('Sepia', 'theme', 'sepia')] },
        { label: 'Typeface', submenu: [radio('Sans-serif (modern)', 'font', 'sans'), radio('Serif (book)', 'font', 'serif')] },
        { label: 'Page Width', submenu: [radio('Narrow', 'pageWidth', 'narrow'), radio('Normal', 'pageWidth', 'normal'), radio('Wide', 'pageWidth', 'wide'), radio('Full Window', 'pageWidth', 'full')] },
        { type: 'separator' },
        { label: 'Outline Sidebar', type: 'checkbox', checked: s.showToc, accelerator: 'CmdOrCtrl+B', click: () => setSetting({ showToc: !settings.get().showToc }) },
        { type: 'separator' },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl+=', click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
        { label: 'Larger Text', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => setSetting({ fontScale: settings.get().fontScale + 0.1 }) },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: () => setSetting({ fontScale: settings.get().fontScale - 0.1 }) },
        { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', click: () => setSetting({ fontScale: 1 }) },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Alt+Left', click: () => goBack(focusedState()) },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open Feature Showcase', click: () => openFile(SHOWCASE) },
        { label: 'Keyboard Shortcuts', click: () => send('shortcuts') },
        { type: 'separator' },
        { label: `About Neo Markdown Reader ${app.getVersion()}`, click: () => dialog.showMessageBox({ type: 'info', title: 'About', message: 'Neo Markdown Reader', detail: `Version ${app.getVersion()}\n© ${new Date().getFullYear()} Neo Gentrics. All rights reserved.` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function goBack(state) {
  if (!state || !state.history.length) return false;
  const prev = state.history.pop();
  return loadIntoWindow(state, prev);
}

// ---------- IPC (every handler validates its input; the page is treated as untrusted)
function registerIpc() {
  ipcMain.handle('app:init', (e) => {
    const st = stateFor(e);
    if (st?.filePath) setImmediate(() => loadIntoWindow(st, st.filePath));
    return { settings: { ...settings.get(), resolvedTheme: resolvedTheme() }, platform: process.platform, version: app.getVersion() };
  });
  ipcMain.handle('doc:open-dialog', (e) => openViaDialog(stateFor(e)));
  ipcMain.handle('doc:open-path', (e, p) => {
    const st = stateFor(e);
    if (!st || typeof p !== 'string' || !isMarkdownPath(p)) return false;
    return loadIntoWindow(st, p, { pushHistory: true });
  });
  ipcMain.handle('doc:open-link', (e, href) => {
    const st = stateFor(e);
    if (!st || typeof href !== 'string' || href.length > 8192) return false;
    let url;
    try { url = new URL(href, st.filePath ? require('node:url').pathToFileURL(st.filePath).href : undefined); } catch { return false; }
    handleLinkUrl(st, url.href);
    return true;
  });
  ipcMain.handle('doc:back', (e) => goBack(stateFor(e)));
  ipcMain.handle('doc:open-showcase', (e) => { const st = stateFor(e); return st ? loadIntoWindow(st, SHOWCASE, { pushHistory: true }) : false; });
  ipcMain.handle('shell:open-external', (_e, url) => { if (typeof url === 'string' && isSafeExternal(url)) shell.openExternal(url); });
  ipcMain.handle('shell:reveal-current', (e) => { const st = stateFor(e); if (st?.filePath) shell.showItemInFolder(st.filePath); });
  ipcMain.handle('doc:export-pdf', (e) => { const st = stateFor(e); return st ? exportPdf(st) : false; });
  ipcMain.handle('doc:print', (e) => { stateFor(e)?.win.webContents.print({ printBackground: true }); });
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.get();
    const allowed = ['theme', 'font', 'fontScale', 'pageWidth', 'showToc'];
    setSetting(Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))));
    return settings.get();
  });
  ipcMain.handle('recent:clear', () => { settings.update({ recent: [] }); app.clearRecentDocuments(); broadcastSettings(); });
  ipcMain.handle('find:start', (e, text, opts = {}) => {
    if (typeof text !== 'string' || !text) return;
    e.sender.findInPage(text.slice(0, 500), { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase });
  });
  ipcMain.handle('find:stop', (e) => e.sender.stopFindInPage('keepSelection'));
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  // Documents never need camera, mic, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
  nativeTheme.on('updated', () => { if (settings.get().theme === 'system') broadcastSettings(); });
  registerIpc();
  rebuildMenu();

  const files = [fileFromArgv(process.argv), ...pendingOpen].filter(Boolean);
  if (files.length) files.forEach(openFile); else createWindow(null);

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(null); });
});

app.on('before-quit', () => settings?.flush());
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
