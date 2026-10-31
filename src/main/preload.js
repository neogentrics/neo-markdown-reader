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
  copyText: invoke('clipboard:text'),
  copyRich: invoke('clipboard:rich'),
  // output
  exportPdf: invoke('doc:export-pdf'),
  print: invoke('doc:print'),
  // settings
  setSettings: invoke('settings:set'),
  clearRecent: invoke('recent:clear'),
  // find
  find: invoke('find:start'),
  stopFind: invoke('find:stop'),
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
