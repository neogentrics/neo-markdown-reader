'use strict';
// The only bridge between the (sandboxed, untrusted-content) page and the OS.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('reader', {
  // documents
  init: invoke('app:init'),
  readDoc: invoke('doc:read'),
  openDialog: invoke('doc:open-dialog'),
  showcase: invoke('doc:showcase'),
  resolveLink: invoke('doc:resolve-link'),
  // tabs & windows
  syncTabs: invoke('tabs:sync'),
  detachTab: invoke('tab:detach'),
  tabContextMenu: invoke('tab:context-menu'),
  closeWindow: invoke('window:close'),
  // shell & clipboard
  reveal: invoke('shell:reveal'),
  openExternal: invoke('shell:open-external'),
  appAbout: invoke('app:about'),
  prefsInfo: invoke('prefs:info'),
  helpArticles: invoke('help:articles'),
  connectorStatus: invoke('connector:status'),
  connectorSet: invoke('connector:set'),
  connectorAdd: invoke('connector:add'),
  claudeAnswer: invoke('claude:answer'),
  openClaudeCode: invoke('claude:open-terminal'),
  onClaudeSuggest: on('claude:suggest'),
  tutorialGet: invoke('tutorial:get'),
  tutorialSet: invoke('tutorial:set'),
  tutorialPractice: invoke('tutorial:practice'),
  copyText: invoke('clipboard:text'),
  copyRich: invoke('clipboard:rich'),
  // output
  exportDoc: invoke('export:run'),
  print: invoke('doc:print'),
  setFullScreen: invoke('window:fullscreen'),
  pickStylesheet: invoke('brand:pick-stylesheet'),
  runCode: invoke('code:run'),
  // AI assist (requests are made by the main process with the reader's own key)
  aiStatus: invoke('ai:status'),
  aiConfigure: invoke('ai:configure'),
  aiListModels: invoke('ai:list-models'),
  aiRun: invoke('ai:run'),
  aiCancel: invoke('ai:cancel'),
  onAiDelta: on('ai:delta'),
  // password-locked documents (encryption happens in the main process)
  unlock: invoke('lock:unlock'),
  protect: invoke('lock:protect'),
  forgetLock: invoke('lock:forget'),
  removeLock: invoke('lock:remove'),
  readStylesheet: invoke('brand:stylesheet'),
  // settings
  setSettings: invoke('settings:set'),
  clearRecent: invoke('recent:clear'),
  // find
  find: invoke('find:start'),
  stopFind: invoke('find:stop'),
  // editing (every write is checked and performed by the main process)
  requestEdit: invoke('edit:request'),
  save: invoke('doc:save'),
  saveAs: invoke('doc:save-as'),
  confirmUnsaved: invoke('dialog:unsaved'),
  listGrants: invoke('grants:list'),
  revokeGrant: invoke('grants:revoke'),
  openBackups: invoke('backups:open'),
  saveImage: invoke('image:save'),
  importDocx: invoke('docx:import'),
  // version history (kept by the app, never in your folder)
  historyList: invoke('history:list'),
  historyRead: invoke('history:read'),
  historyRestore: invoke('history:restore'),
  // find & replace across the open folder (preview, then ask, then change)
  replacePreview: invoke('replace:preview'),
  replaceApply: invoke('replace:apply'),
  replaceUndo: invoke('replace:undo'),
  // commands by name & your own shortcuts
  listCommands: invoke('commands:list'),
  runCommand: invoke('commands:run'),
  setShortcut: invoke('shortcuts:set'),
  resetShortcuts: invoke('shortcuts:reset-all'),
  recordShortcuts: invoke('shortcuts:recording'),
  // connected notes (open folder only)
  backlinks: invoke('notes:backlinks'),
  linkGraph: invoke('notes:graph'),
  tags: invoke('notes:tags'),
  tasks: invoke('notes:tasks'),
  checkLinks: invoke('notes:check'),
  toggleTask: invoke('tasks:toggle'),
  createLinked: invoke('doc:create-linked'),
  renameDoc: invoke('doc:rename'),
  askFolder: invoke('ai:ask-folder'),
  peekDoc: invoke('doc:peek'),
  aiEdit: invoke('ai:edit'),
  // sync between your computers (3.1)
  syncStatus: invoke('sync:status'),
  syncChooseFolder: invoke('sync:choose-folder'),
  syncConfigure: invoke('sync:configure'),
  syncNow: invoke('sync:now'),
  onSyncStatus: on('sync:status'),
  onAnnotationsChanged: on('annotations:changed'),
  // natural voices (3.2)
  voiceStatus: invoke('voice:status'),
  sayGet: invoke('say:get'),
  sayRules: invoke('say:rules'),
  saySet: invoke('say:set'),
  voiceInstall: invoke('voice:install'),
  voiceCancelDownload: invoke('voice:cancel-download'),
  voiceRemove: invoke('voice:remove'),
  voiceSpeak: invoke('voice:speak'),
  voiceCancel: invoke('voice:cancel'),
  onVoiceProgress: on('voice:progress'),
  // add-ons (3.0)
  addonsList: invoke('addons:list'),
  addonsInstall: invoke('addons:install'),
  addonsSetEnabled: invoke('addons:set-enabled'),
  addonsRemove: invoke('addons:remove'),
  addonRender: invoke('addons:render'),
  addonExport: invoke('addons:export'),
  // folders, compare, highlights & bookmarks
  openFolder: invoke('folder:open'),
  closeFolder: invoke('folder:close'),
  refreshFolder: invoke('folder:refresh'),
  searchFolder: invoke('folder:search'),
  pickDoc: invoke('doc:pick'),
  getAnnotations: invoke('annotations:get'),
  setAnnotations: invoke('annotations:set'),
  toggleBookmark: invoke('bookmarks:toggle'),
  onFolderOpened: on('folder:opened'),
  onFolderChanged: on('folder:changed'),
  // updates
  installUpdate: invoke('update:install'),
  openUpdatePage: invoke('update:open-page'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  // events from the main process
  onOpenTab: on('tab:open'),
  onFocusPath: on('tab:focus-path'),
  onDocumentChanged: on('doc:changed'),
  onError: on('doc:error'),
  onSettings: on('settings:changed'),
  onCommand: on('menu:command'),
  onFindResult: on('find:result'),
  onUpdate: on('update:status'),
});
