'use strict';
// Send to StoryTracker with no link (3.11): the same way as Open With. docs/app-link.md says why that's safe without a key.
// A person just chose it, RT Story Tracker files nothing by itself, and it reads the file the moment it's handed over.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID = 'storytracker';
const NAME = 'RT Story Tracker';
const SENT_FOLDER = /^rtmr-send-[0-9a-f]{16}$/;
const HANDOVER_MS = 120_000;        // long enough for it to start on a slow computer and read the file
const NOT_FOUND = 'RT Story Tracker isn’t on this computer, or it’s somewhere this app can’t find. If it’s running, link the two in Preferences.';
const NOT_STARTED = 'RT Story Tracker wouldn’t start.';

/** Where its installers put it. There's no other way to ask for an app by name on Windows or Linux. */
function storyPlaces({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.NMR_STORY_APP) return [env.NMR_STORY_APP];
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programs = [path.join(local, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
    return programs.flatMap((dir) => ['rt-story-tracker', 'RT Story Tracker'].map((name) => path.join(dir, name, 'RT Story Tracker.exe')));
  }
  if (platform === 'darwin') return ['/Applications/RT Story Tracker.app', path.join(home, 'Applications', 'RT Story Tracker.app')];
  return ['/opt/RT Story Tracker/rt-story-tracker', '/usr/bin/rt-story-tracker'];
}

/** Start it with a file, or tell the copy that's already running to take it. Nothing goes through a shell. */
function startWith(app, file, { platform = process.platform, start = spawn } = {}) {
  const [command, args] = platform === 'darwin' && app.endsWith('.app') ? ['open', ['-a', app, file]] : [app, [file]];
  return new Promise((resolve, reject) => {
    const child = start(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** A file name that works on every system, always `.md`, because that's what the other app is told to expect. */
function handoverName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,8}$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, '').trim().slice(0, 80).replace(/[. ]+$/, '');
  const safe = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? `${base} document` : base;
  return `${safe || 'Sent document'}.md`;
}

class Handover {
  constructor({ tempDir = os.tmpdir(), places = storyPlaces, start = startWith, after = HANDOVER_MS } = {}) {
    Object.assign(this, { tempDir, places, start, after });
    this.folders = new Map();         // folder -> its timer
  }

  remove(folder) {
    clearTimeout(this.folders.get(folder));
    this.folders.delete(folder);
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 2 });
  }

  /** Write a plain copy, hand it over, and remove it once RT Story Tracker has had time to read it. */
  async send({ name, text }) {
    const app = this.places().find((place) => fs.existsSync(place));
    if (!app) throw new Error(NOT_FOUND);
    const folder = path.join(this.tempDir, `rtmr-send-${crypto.randomBytes(8).toString('hex')}`);
    this.folders.set(folder, null);
    try {
      fs.mkdirSync(folder, { mode: 0o700 });
      const file = path.join(folder, handoverName(name));
      fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
      await this.start(app, file);
    } catch {
      this.remove(folder);
      throw new Error(NOT_STARTED);
    }
    const timer = setTimeout(() => this.remove(folder), this.after);
    timer.unref?.();
    this.folders.set(folder, timer);
    return { name: NAME };
  }

  /** The app is closing: nothing it wrote stays behind. */
  clear() {
    for (const folder of [...this.folders.keys()]) this.remove(folder);
  }

  /** Copies left by a crash. Only this app's own folders, and only ones too old to still be on their way. */
  sweep(now = Date.now()) {
    let names = [];
    try { names = fs.readdirSync(this.tempDir); } catch { return; }
    for (const name of names.filter((n) => SENT_FOLDER.test(n))) {
      const folder = path.join(this.tempDir, name);
      try {
        if (now - fs.statSync(folder).mtimeMs >= this.after) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 2 });
      } catch { /* it went by itself */ }
    }
  }
}

module.exports = { ID, NAME, Handover, storyPlaces, startWith, handoverName };
