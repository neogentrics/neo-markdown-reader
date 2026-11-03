'use strict';
// Natural voices (3.2): getting the voice model onto this computer, and talking to the process that speaks.
//
//  - Nothing is downloaded until the reader agrees (main.js asks, with the size and the license).
//  - The files come from one fixed revision of Supertone's published model, and each is checked against
//    the size and SHA-256 written below before it's used. A file that doesn't match is deleted, never used.
//    Files already downloaded and correct are kept, so a cancelled download carries on where it stopped.
//  - Speaking happens in a separate process (voice-worker.js) that starts the first time a natural voice
//    reads and stops after a few idle minutes, giving the memory back.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODEL = 'supertonic-3';
const REVISION = 'aafc6e32416a594460b32413efc49d7fe4ce6d46';
const BASE = `https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/${REVISION}`;
const LICENSE_URL = `https://huggingface.co/supertone-oss-archive/supertonic-3/blob/${REVISION}/LICENSE`;
const IDLE_MS = 5 * 60 * 1000;

/** Every file the voices need, with the size and SHA-256 they must have. */
const FILES = [
  { path: 'onnx/duration_predictor.onnx', size: 3700147, sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db' },
  { path: 'onnx/text_encoder.onnx', size: 36416150, sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff' },
  { path: 'onnx/vector_estimator.onnx', size: 256534781, sha256: '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c' },
  { path: 'onnx/vocoder.onnx', size: 101424195, sha256: '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba' },
  { path: 'onnx/tts.json', size: 8253, sha256: '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09' },
  { path: 'onnx/unicode_indexer.json', size: 277676, sha256: '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f' },
  { path: 'voice_styles/F1.json', size: 292046, sha256: 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2' },
  { path: 'voice_styles/F2.json', size: 292423, sha256: '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6' },
  { path: 'voice_styles/F3.json', size: 290794, sha256: '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab' },
  { path: 'voice_styles/F4.json', size: 291808, sha256: 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b' },
  { path: 'voice_styles/F5.json', size: 291479, sha256: '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d' },
  { path: 'voice_styles/M1.json', size: 291748, sha256: 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b' },
  { path: 'voice_styles/M2.json', size: 292055, sha256: 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50' },
  { path: 'voice_styles/M3.json', size: 290198, sha256: 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b' },
  { path: 'voice_styles/M4.json', size: 291522, sha256: 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303' },
  { path: 'voice_styles/M5.json', size: 291469, sha256: 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2' },
  { path: 'LICENSE', size: 15007, sha256: '0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f' },
];

/** The voices, in the order the menu lists them. */
const VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];

const totalSize = (files) => files.reduce((n, f) => n + f.size, 0);

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class VoiceStore {
  /**
   * @param {object} o
   * @param {string} o.root        folder for downloaded voices (in the app's data folder)
   * @param {Function} o.fetch     fetch() to download with (Electron's net.fetch: it uses the system proxy)
   * @param {Function} o.fork      (script) => utilityProcess child
   * @param {string} o.worker      path of the bundled worker script
   * @param {boolean} o.fake       tests: no download, no model; the worker plays a tone
   */
  constructor({ root, fetch: fetchImpl, fork, worker, fake = false, files = FILES, base = BASE }) {
    this.dir = path.join(root, MODEL);
    this.fetch = fetchImpl;
    this.fork = fork;
    this.worker = worker;
    this.fake = fake;
    this.files = files;
    this.base = base;
    this.download = null;          // { done, total, abort }
    this.error = '';
    this.child = null;
    this.ready = null;
    this.pending = new Map();      // id -> { resolve, reject }
    this.nextId = 1;
    this.idle = null;
  }

  marker() { return path.join(this.dir, 'installed.json'); }

  installed() {
    try {
      const m = JSON.parse(fs.readFileSync(this.marker(), 'utf8'));
      if (m.revision !== REVISION && !this.fake) return false;
      return this.files.every((f) => fs.statSync(path.join(this.dir, f.path)).size === f.size);
    } catch { return false; }
  }

  status() {
    const installed = this.installed();
    const total = totalSize(this.files);
    return {
      installed,
      downloading: !!this.download,
      done: this.download ? this.download.done : installed ? total : 0,
      total,
      error: this.error,
      voices: VOICES,
      licenseUrl: LICENSE_URL,
    };
  }

  // -------------------------------------------------------------- download
  /**
   * Download and check every file. `onProgress(status)` is called as bytes arrive.
   * Resolves to the status; a failure leaves no unchecked file behind and says why in status().error.
   */
  async install(onProgress = () => {}) {
    if (this.download) return this.status();
    const controller = new AbortController();
    this.download = { done: 0, total: totalSize(this.files), abort: () => controller.abort() };
    this.error = '';
    let last = 0;
    const tick = (force) => { const now = Date.now(); if (force || now - last > 200) { last = now; onProgress(this.status()); } };
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
      for (const f of this.files) {
        const target = path.join(this.dir, f.path);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (this.fake) {
          await fs.promises.writeFile(target, Buffer.alloc(f.size));
          this.download.done += f.size;
          tick(true);
          continue;
        }
        // Already here and correct (an earlier download that was stopped part-way).
        if (fs.existsSync(target) && fs.statSync(target).size === f.size && (await sha256File(target)) === f.sha256) {
          this.download.done += f.size;
          tick(true);
          continue;
        }
        await this.fetchFile(f, target, controller.signal, (n) => { this.download.done += n; tick(false); });
      }
      await fs.promises.writeFile(this.marker(), JSON.stringify({ model: MODEL, revision: REVISION, installed: Date.now() }));
    } catch (err) {
      this.error = controller.signal.aborted ? '' : `The natural voices couldn’t be downloaded: ${err.message}`;
    } finally {
      this.download = null;
    }
    tick(true);
    return this.status();
  }

  async fetchFile(f, target, signal, onBytes) {
    const part = `${target}.part`;
    const res = await this.fetch(`${this.base}/${f.path}`, { signal });
    if (!res.ok || !res.body) throw new Error(`${f.path}: the server answered ${res.status}`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let size = 0;
    try {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        size += buf.length;
        if (size > f.size) throw new Error(`${f.path} is larger than expected`);
        hash.update(buf);
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        onBytes(buf.length);
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (size !== f.size || hash.digest('hex') !== f.sha256) throw new Error(`${f.path} didn’t match its published checksum`);
      await fs.promises.rename(part, target);
    } catch (err) {
      out.destroy();
      await fs.promises.rm(part, { force: true });
      throw err;
    }
  }

  cancel() { this.download?.abort(); }

  async remove() {
    this.stop();
    await fs.promises.rm(this.dir, { recursive: true, force: true });
    return this.status();
  }

  // -------------------------------------------------------------- speaking
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = this.fork(this.worker);
      this.child = child;
      child.on('message', (msg) => {
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'failed') { reject(new Error(msg.error)); this.stop(); }
        else if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.type === 'audio') p.resolve({ sampleRate: msg.sampleRate, samples: msg.samples, ms: msg.ms });
          else p.reject(new Error(msg.error));
        }
      });
      child.on('exit', () => {
        for (const p of this.pending.values()) p.reject(new Error('The voice stopped unexpectedly'));
        this.pending.clear();
        this.child = null;
        this.ready = null;
        reject(new Error('The voice couldn’t start'));
      });
      child.postMessage({ type: 'init', dir: this.dir, fake: this.fake });
    });
    return this.ready;
  }

  /** Speak one sentence: { text, lang, voice, speed, steps } → { sampleRate, samples (Float32Array), ms }. */
  async speak(job) {
    if (!this.installed()) throw new Error('The natural voices aren’t downloaded');
    await this.start();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.postMessage({ type: 'speak', id, ...job });
    });
  }

  /** Drop every sentence that hasn't started yet (the reader skipped, paused or stopped). */
  cancelSpeech() { this.child?.postMessage({ type: 'cancel' }); }

  stop() {
    clearTimeout(this.idle);
    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
    this.ready = null;
  }
}

module.exports = { VoiceStore, FILES, VOICES, REVISION, LICENSE_URL, MODEL, totalSize };
