'use strict';
// Everything that can change a file on disk lives here, in the main process. The page (which renders
// untrusted documents) can only *ask*; every write is checked against the permission you gave.
//
//  - Files open read-only. Editing a file needs permission, asked with a native dialog:
//      Just This Time (default)  -> remembered only while the file stays open in that window
//      Always for This File      -> saved in settings, revocable in File > Editing Permissions
//      Always for This Folder    -> same, for every file in the folder (and its subfolders)
//  - Files Windows marks read-only stay locked.
//  - Before the first save of a file in a session, the original is copied to the backups folder.
//  - Saving checks the file wasn't changed by another program since editing started.
//  - The file's original line endings and byte-order mark are preserved.
const fs = require('node:fs');
const path = require('node:path');
const { isMarkdownPath, isLockedPath, isOpenablePath, isWritable, isInside, encodeForSave, readMarkdown } = require('./files');

const MAX_BACKUPS = 200;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

class Editing {
  /**
   * @param {{ settings: any, dialog: any, backupDir: string, defaultDir?: string, platform?: string,
   *           sealLocked?: (path: string, content: string) => string | null }} deps
   *   sealLocked encrypts a locked document's text with the key it was unlocked with (null if it
   *   isn't unlocked), so a locked document is never written to disk in the clear.
   */
  constructor({ settings, dialog, backupDir, defaultDir = '', platform = process.platform, sealLocked = () => null }) {
    this.sealLocked = sealLocked;
    this.settings = settings;
    this.dialog = dialog;
    this.backupDir = backupDir;
    this.defaultDir = defaultDir;
    this.platform = platform;
    this.backedUp = new Set();          // files already backed up this app session
  }

  key(p) { return this.platform === 'win32' || this.platform === 'darwin' ? path.resolve(p).toLowerCase() : path.resolve(p); }

  /** Session ("Just this time") grants live on the window state: state.editGrants = Set of keys. */
  sessionGrants(state) {
    state.editGrants ??= new Set();
    return state.editGrants;
  }

  rememberedScope(p) {
    const g = this.settings.get().editGrants;
    if (g.files.some((f) => this.key(f) === this.key(p))) return 'file';
    if (g.folders.some((d) => isInside(d, p, this.platform))) return 'folder';
    return null;
  }

  isGranted(state, p) {
    return this.sessionGrants(state).has(this.key(p)) || !!this.rememberedScope(p);
  }

  /** Forget "Just this time" grants for files no longer open in this window. */
  pruneSession(state, openPaths) {
    const open = new Set(openPaths.map((p) => this.key(p)));
    for (const k of this.sessionGrants(state)) if (!open.has(k)) this.sessionGrants(state).delete(k);
  }

  /** Ask to edit a file. Resolves to { ok, scope?, reason? }. */
  async requestEdit(state, p) {
    if (!isOpenablePath(p) || !fs.existsSync(p)) return { ok: false, reason: 'missing' };
    const name = path.basename(p);
    if (!(await isWritable(p))) {
      await this.dialog.showMessageBox(state.win, {
        type: 'info', title: 'File is read-only', noLink: true, buttons: ['OK'],
        message: `“${name}” is read-only.`,
        detail: 'Windows (or the folder’s permissions) won’t let this file be changed, so it stays locked.\n\nTo edit it, save a copy with File → Save As…, or remove the read-only setting in the file’s Properties.',
      });
      return { ok: false, reason: 'readonly' };
    }
    if (this.isGranted(state, p)) return { ok: true, scope: this.rememberedScope(p) || 'session' };

    const { response } = await this.dialog.showMessageBox(state.win, {
      type: 'question',
      title: 'Allow editing?',
      message: `Allow Neo Markdown Reader to edit “${name}”?`,
      detail: `Changes will be saved to:\n${p}\n\nThe original is backed up before the first save, and nothing is written until you choose Save.`,
      buttons: ['Just This Time', 'Always for This File', 'Always for This Folder', 'Cancel'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    });
    if (response === 0) { this.sessionGrants(state).add(this.key(p)); return { ok: true, scope: 'session' }; }
    if (response === 1) { this.addGrant('files', path.resolve(p)); return { ok: true, scope: 'file' }; }
    if (response === 2) { this.addGrant('folders', path.dirname(path.resolve(p))); return { ok: true, scope: 'folder' }; }
    return { ok: false, reason: 'cancelled' };
  }

  addGrant(kind, value) {
    const g = this.settings.get().editGrants;
    if (!g[kind].some((x) => this.key(x) === this.key(value))) g[kind].push(value);
    this.settings.update({ editGrants: g });
  }

  listGrants() { return this.settings.get().editGrants; }

  revokeGrant(kind, value) {
    if (kind !== 'files' && kind !== 'folders') return this.listGrants();
    const g = this.settings.get().editGrants;
    g[kind] = g[kind].filter((x) => this.key(x) !== this.key(value));
    this.settings.update({ editGrants: g });
    return this.listGrants();
  }

  async backup(p) {
    const k = this.key(p);
    if (this.backedUp.has(k) || !fs.existsSync(p)) return null;
    await fs.promises.mkdir(this.backupDir, { recursive: true });
    const dest = path.join(this.backupDir, `${stamp()}-${path.basename(p)}`);
    await fs.promises.copyFile(p, dest);
    this.backedUp.add(k);
    // Keep the backups folder from growing forever.
    const files = (await fs.promises.readdir(this.backupDir)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
      fs.promises.unlink(path.join(this.backupDir, old)).catch(() => {});
    }
    return dest;
  }

  /**
   * Save over an existing file the user has allowed editing.
   * @returns {Promise<{ok:boolean, mtime?:number, reason?:string, backup?:string|null}>}
   */
  async save(state, { path: p, content, baseMtime, eol, bom }) {
    if (!isOpenablePath(p)) return { ok: false, reason: 'not-markdown' };
    if (!this.isGranted(state, p)) return { ok: false, reason: 'not-allowed' };
    let data = null;
    if (isLockedPath(p)) {
      data = this.sealLocked(p, String(content).replace(/\r\n/g, '\n'));
      if (data == null) return { ok: false, reason: 'locked' };
    }
    if (!(await isWritable(p))) return { ok: false, reason: 'readonly' };
    let current = null;
    try { current = await fs.promises.stat(p); } catch { /* deleted meanwhile: saving recreates it */ }
    if (current && Number.isFinite(baseMtime) && Math.abs(current.mtimeMs - baseMtime) > 1) {
      const { response } = await this.dialog.showMessageBox(state.win, {
        type: 'warning', title: 'File changed', noLink: true,
        message: `“${path.basename(p)}” was changed by another program after you started editing.`,
        detail: 'Saving now replaces those changes with yours. To keep both, choose Cancel, then File → Save As… to save your version under a new name.',
        buttons: ['Cancel', 'Replace With My Version'],
        defaultId: 0, cancelId: 0,
      });
      if (response !== 1) return { ok: false, reason: 'conflict' };
    }
    const backup = await this.backup(p);
    await fs.promises.writeFile(p, data ?? encodeForSave(content, { eol, bom }));
    const after = await fs.promises.stat(p);
    return { ok: true, mtime: after.mtimeMs, backup };
  }

  /** Save to a location the user picks. The chosen file counts as allowed ("just this time"). */
  async saveAs(state, { content, suggestedName, defaultDir, eol = process.platform === 'win32' ? '\r\n' : '\n', bom = false }) {
    let name = String(suggestedName || 'Untitled.md').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
    if (!isMarkdownPath(name)) name = name.replace(/\.[^.]*$/, '') + '.md';
    const res = await this.dialog.showSaveDialog(state.win, {
      title: 'Save As',
      defaultPath: path.join(defaultDir || this.defaultDir, name),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'cancelled' };
    let target = res.filePath;
    if (!isMarkdownPath(target)) target += '.md';
    if (fs.existsSync(target) && !(await isWritable(target))) return { ok: false, reason: 'readonly' };
    if (fs.existsSync(target)) await this.backup(target);
    await fs.promises.writeFile(target, encodeForSave(content, { eol, bom }));
    this.sessionGrants(state).add(this.key(target));
    return { ok: true, doc: await readMarkdown(target) };
  }

  /** Ask what to do with unsaved changes. Resolves to 'save' | 'discard' | 'cancel'. */
  async confirmUnsaved(state, { name, count = 1 }) {
    const { response } = await this.dialog.showMessageBox(state.win, {
      type: 'warning', title: 'Unsaved changes', noLink: true,
      message: count > 1 ? `You have unsaved changes in ${count} documents.` : `Save your changes to “${name}”?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: count > 1 ? ['Cancel', 'Close Without Saving'] : ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: count > 1 ? 0 : 2,
    });
    if (count > 1) return response === 1 ? 'discard' : 'cancel';
    return ['save', 'discard', 'cancel'][response] || 'cancel';
  }
}

module.exports = { Editing, stamp };
