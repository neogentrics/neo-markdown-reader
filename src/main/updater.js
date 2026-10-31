'use strict';
// Update checks against this project's GitHub Releases.
//  - Installed Windows app (NSIS) and Linux AppImage: electron-updater downloads the update in the
//    background and the user gets "Restart to update".
//  - Portable .exe and unsigned macOS builds can't self-update, so they are told a new version
//    exists and given the download page.
const { app, net } = require('electron');
const { compareVersions } = require('./version');

const OWNER = 'neogentrics';
const REPO = 'neo-markdown-reader';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function canSelfUpdate() {
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

class Updater {
  constructor(onStatus) {
    this.onStatus = onStatus;          // ({ state, version, url, message }) => void
    this.status = { state: 'idle' };
    this.autoUpdater = null;
  }

  start() {
    if (!app.isPackaged || process.env.NMR_DISABLE_UPDATES) return;
    if (canSelfUpdate()) {
      try {
        ({ autoUpdater: this.autoUpdater } = require('electron-updater'));
        this.autoUpdater.autoDownload = true;
        this.autoUpdater.autoInstallOnAppQuit = true;
        this.autoUpdater.on('update-available', (i) => this.emit({ state: 'downloading', version: i.version }));
        this.autoUpdater.on('update-downloaded', (i) => this.emit({ state: 'ready', version: i.version }));
        this.autoUpdater.on('error', (e) => { this.lastError = e; });
      } catch { this.autoUpdater = null; }
    }
    setTimeout(() => this.check({ silent: true }), 8000);
    setInterval(() => this.check({ silent: true }), CHECK_EVERY_MS).unref?.();
  }

  emit(status) {
    this.status = status;
    this.onStatus(status);
  }

  /** Returns a status object; with silent=false the caller shows "up to date" etc. */
  async check({ silent = false } = {}) {
    try {
      if (this.autoUpdater) {
        const res = await this.autoUpdater.checkForUpdates();
        const latest = res?.updateInfo?.version;
        if (latest && compareVersions(latest, app.getVersion()) > 0) return this.status.state === 'ready' ? this.status : { state: 'downloading', version: latest };
        return { state: 'current', version: app.getVersion() };
      }
      const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `NeoMarkdownReader/${app.getVersion()}` },
      });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const rel = await res.json();
      if (compareVersions(rel.tag_name, app.getVersion()) > 0) {
        const s = { state: 'available', version: String(rel.tag_name).replace(/^v/, ''), url: rel.html_url || RELEASES_URL };
        this.emit(s);
        return s;
      }
      return { state: 'current', version: app.getVersion() };
    } catch (err) {
      return silent ? { state: 'error' } : { state: 'error', message: String(err?.message || err) };
    }
  }

  installNow() {
    if (this.autoUpdater && this.status.state === 'ready') {
      setImmediate(() => this.autoUpdater.quitAndInstall(false, true));
      return true;
    }
    return false;
  }
}

module.exports = { Updater, RELEASES_URL, canSelfUpdate };
