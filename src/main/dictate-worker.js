'use strict';
// Dictation (3.5): the process that listens. Started by dictation.js with Electron's utilityProcess, so working
// out what was said never holds up the app's windows. Bundled into dist/dictate-worker.cjs, like voice-worker.js.
//
// Messages in:  { type: 'init', dir, fake }
//               { type: 'hear', id, samples, lang }
// Messages out: { type: 'ready' } | { type: 'failed', error }
//               { type: 'text', id, text, ms } | { type: 'error', id, error }
const fs = require('node:fs');
const path = require('node:path');

const port = process.parentPort;
let whisper = null;
let fake = false;
let queue = Promise.resolve();

async function init(msg) {
  fake = !!msg.fake;
  if (fake) return;
  const ort = require('onnxruntime-web');
  ort.env.wasm.wasmPaths = `${require('node:url').pathToFileURL(path.join(__dirname, 'voice')).href}/`;
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, require('node:os').availableParallelism?.() || 4));
  const { Whisper } = require('./whisper');
  whisper = await Whisper.load(ort, msg.dir, (f) => fs.promises.readFile(f));
}

async function hear(job) {
  const t = Date.now();
  try {
    const text = fake ? `I said ${Math.max(1, Math.round(job.samples.length / 16000))} seconds` : await whisper.transcribe(job.samples, job.lang);
    port.postMessage({ type: 'text', id: job.id, text, ms: Date.now() - t });
  } catch (err) {
    port.postMessage({ type: 'error', id: job.id, error: err?.message || String(err) });
  }
}

port.on('message', ({ data: msg }) => {
  if (msg.type === 'init') init(msg).then(() => port.postMessage({ type: 'ready' }), (err) => port.postMessage({ type: 'failed', error: err?.message || String(err) }));
  else if (msg.type === 'hear') queue = queue.then(() => hear(msg));
});
