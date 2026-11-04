'use strict';
// Dictation (3.5): getting the speech model onto this computer, and talking to the process that listens.
// It works just like the natural voices (voices.js): nothing is downloaded until the reader agrees, every file
// is checked against its size and SHA-256, and the sound never leaves the computer.
const { VoiceStore } = require('./voices');

const MODEL = 'whisper-base';
const REVISION = '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c';
const BASE = `https://huggingface.co/onnx-community/whisper-base/resolve/${REVISION}`;
const IDLE_MS = 5 * 60 * 1000;

const FILES = [
  { path: 'onnx/encoder_model_int8.onnx', size: 23201297, sha256: 'ca6177401f86a2c6b4dc5f7fc02fbca680678906bd0c22f6d89f0b80f124253f' },
  { path: 'onnx/decoder_model_merged_int8.onnx', size: 53693315, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b' },
  { path: 'config.json', size: 2243, sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b' },
  { path: 'generation_config.json', size: 3832, sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0' },
  { path: 'vocab.json', size: 1036584, sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a' },
];

class DictationStore extends VoiceStore {
  constructor(options) {
    super({ files: FILES, base: BASE, model: MODEL, revision: REVISION, label: 'dictation model', ...options });
  }

  /** @param {{ samples: Float32Array, lang: string }} job → { text, ms } */
  async hear(job) {
    if (!this.installed()) throw new Error('Dictation isn’t downloaded');
    await this.start();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.postMessage({ type: 'hear', id, samples: job.samples, lang: job.lang });
    });
  }
}

module.exports = { DictationStore, FILES, REVISION };
