'use strict';
// Smart search (3.6): getting the model onto this computer, and talking to the process that reads for meaning.
// It works just like the natural voices (voices.js): nothing is downloaded until the reader agrees, every file
// is checked against its size and SHA-256, and no text ever leaves the computer. The index for each folder
// lives beside the model, so removing the download removes the indexes too.
const crypto = require('node:crypto');
const path = require('node:path');
const { VoiceStore } = require('./voices');

const MODEL = 'multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const BASE = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${REVISION}`;
const LICENSE_URL = 'https://huggingface.co/intfloat/multilingual-e5-small';
const IDLE_MS = 5 * 60 * 1000;

const FILES = [
  { path: 'onnx/model_quantized.onnx', size: 118308185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
  { path: 'tokenizer.json', size: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
];

class SmartStore extends VoiceStore {
  /** @param {object} options as VoiceStore, plus onIndexing({ root, done, total }) */
  constructor(options) {
    super({ files: FILES, base: BASE, model: MODEL, revision: REVISION, label: 'smart search model', ...options });
    this.onIndexing = options.onIndexing || (() => {});
    this.indexing = new Map();     // root -> { done, total }
  }

  status() { return { ...super.status(), licenseUrl: LICENSE_URL }; }

  storeFor(root) { return path.join(this.dir, 'indexes', `${crypto.createHash('sha256').update(root).digest('hex').slice(0, 32)}.idx`); }

  start() {
    const fresh = !this.ready;
    const ready = super.start();
    if (fresh) {
      this.child.on('message', (msg) => {
        if (msg.type !== 'progress') return;
        const busy = msg.done < msg.total;
        if (busy) this.indexing.set(msg.root, { done: msg.done, total: msg.total }); else this.indexing.delete(msg.root);
        this.onIndexing({ root: msg.root, done: msg.done, total: msg.total });
      });
    }
    return ready;
  }

  /** Stop after a few idle minutes, but never in the middle of reading a folder. */
  rest() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { if (this.indexing.size) this.rest(); else this.stop(); }, IDLE_MS);
    this.idle.unref?.();
  }

  async ask(job) {
    if (!this.installed()) throw new Error('Smart search isn’t downloaded');
    await this.start();
    this.rest();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.postMessage({ id, store: this.storeFor(job.root), ...job });
    });
  }

  /** Bring a folder's index up to date. A newer request for the same work takes over from this one. */
  index(root, files) { return this.ask({ type: 'index', root, files }); }

  async search(root, query, limit = 20) { return (await this.ask({ type: 'search', root, query, limit })).results; }

  async related(root, file, limit = 5) { return (await this.ask({ type: 'related', root, path: file, limit })).results; }
}

module.exports = { SmartStore, FILES, REVISION, MODEL, LICENSE_URL };
