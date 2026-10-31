'use strict';
// The only bridge between the (sandboxed, untrusted-content) page and the OS.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('reader', {
  init: () => ipcRenderer.invoke('app:init'),
  openDialog: () => ipcRenderer.invoke('doc:open-dialog'),
  openPath: (p) => ipcRenderer.invoke('doc:open-path', p),
  openLink: (href) => ipcRenderer.invoke('doc:open-link', href),
  openShowcase: () => ipcRenderer.invoke('doc:open-showcase'),
  goBack: () => ipcRenderer.invoke('doc:back'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  revealCurrent: () => ipcRenderer.invoke('shell:reveal-current'),
  exportPdf: () => ipcRenderer.invoke('doc:export-pdf'),
  print: () => ipcRenderer.invoke('doc:print'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  find: (text, opts) => ipcRenderer.invoke('find:start', text, opts),
  stopFind: () => ipcRenderer.invoke('find:stop'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  onDocument: listeners('doc:loaded'),
  onDocumentChanged: listeners('doc:changed'),
  onError: listeners('doc:error'),
  onSettings: listeners('settings:changed'),
  onCommand: listeners('menu:command'),
  onFindResult: listeners('find:result'),
});
