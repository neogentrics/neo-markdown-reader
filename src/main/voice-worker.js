'use strict';
// Natural voices (3.2): the process that speaks. Started by voices.js with Electron's utilityProcess, so
// a sentence being spoken never holds up the app's windows. Bundled with the WebAssembly build of ONNX
// Runtime into dist/voice-worker.cjs (scripts/build-renderer.mjs), next to dist/voice/*.wasm.
//
// Messages in:  { type: 'init', dir, fake }
//               { type: 'speak', id, text, lang, voice, speed, steps }
//               { type: 'cancel' }                       drop everything, and stop the sentence being made
// Messages out: { type: 'ready' } | { type: 'failed', error }
//               { type: 'audio', id, sampleRate, samples, ms } | { type: 'error', id, error }
const fs = require('node:fs');
const path = require('node:path');

const port = process.parentPort;
let tts = null;
let fake = false;
let dir = '';
const styles = new Map();
const queue = [];
let busy = false;
let running = null;

/** Test stand-in: a quiet tone as long as the sentence would take to read, made instantly. */
function tone(text, speed) {
  const rate = 44100;
  const n = Math.max(rate / 10, Math.round((rate * text.length * 0.06) / speed));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / rate);
  return { samples: out, sampleRate: rate };
}

async function init(msg) {
  fake = !!msg.fake;
  dir = msg.dir;
  if (fake) return;
  const ort = require('onnxruntime-web');
  // The .wasm and its worker script are copied next to this file at build time. A file:// URL, not a
  // path: ONNX Runtime imports the script, and on Windows "E:/…" reads as a URL with the scheme "e:".
  ort.env.wasm.wasmPaths = `${require('node:url').pathToFileURL(path.join(__dirname, 'voice')).href}/`;
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, require('node:os').availableParallelism?.() || 4));
  const { Supertonic } = require('./supertonic');
  tts = await Supertonic.load(ort, path.join(dir, 'onnx'), (f) => fs.promises.readFile(f));
  tts.ort = ort;
}

function style(voice) {
  if (!/^[FM][1-5]$/.test(voice)) throw new Error(`Unknown voice ${voice}`);
  if (!styles.has(voice)) {
    const { voiceStyle } = require('./supertonic');
    styles.set(voice, voiceStyle(tts.ort, JSON.parse(fs.readFileSync(path.join(dir, 'voice_styles', `${voice}.json`), 'utf8'))));
  }
  return styles.get(voice);
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    running = job;
    const t = Date.now();
    // Sentences can take seconds to make. Between steps, look for a message saying this one isn't wanted any more.
    const between = async () => {
      await new Promise(setImmediate);
      if (job.cancelled) throw new Error('cancelled');
    };
    try {
      if (fake) {
        const { samples, sampleRate } = tone(job.text, job.speed);
        port.postMessage({ type: 'audio', id: job.id, sampleRate, samples, ms: Date.now() - t });
      } else {
        const samples = await tts.speak(job.text, { lang: job.lang, style: style(job.voice), speed: job.speed, steps: job.steps, between });
        port.postMessage({ type: 'audio', id: job.id, sampleRate: tts.sampleRate, samples, ms: Date.now() - t });
      }
    } catch (err) {
      port.postMessage({ type: 'error', id: job.id, error: err?.message || String(err) });
    }
  }
  running = null;
  busy = false;
}

port.on('message', async (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') {
    try { await init(msg); port.postMessage({ type: 'ready' }); } catch (err) { port.postMessage({ type: 'failed', error: err?.message || String(err) }); }
  } else if (msg.type === 'speak') {
    queue.push(msg);
    pump();
  } else if (msg.type === 'cancel') {
    if (running) running.cancelled = true;
    for (const job of queue.splice(0)) port.postMessage({ type: 'error', id: job.id, error: 'cancelled' });
  }
});
