'use strict';
// Smart search (3.6): the process that reads for meaning. Started by smart-search.js with Electron's
// utilityProcess, so indexing a folder never holds up the app's windows. Bundled into dist/smart-worker.cjs,
// like voice-worker.js. Everything stays on this computer.
//
// Messages in:  { type: 'init', dir, fake }
//               { type: 'index', id, root, store, files: string[] }    bring the index for a folder up to date
//               { type: 'search', id, root, store, query, limit }
//               { type: 'related', id, root, store, path, limit }
// Messages out: { type: 'ready' } | { type: 'failed', error }
//               { type: 'progress', root, done, total }
//               { type: 'done', id, ... } | { type: 'error', id, error }
const fs = require('node:fs');
const path = require('node:path');
const { passages, E5, SmartIndex, normalize, DIMS } = require('./smart-core');

const port = process.parentPort;
const MAX_BYTES = 2 * 1024 * 1024;
const SAVE_EVERY = 30 * 1000;
const FAKE_DIMS = 1024;

let model = null;
let modelDir = '';
let fake = false;
let current = null;            // { root, store, index, dirty }
let indexing = null;           // the job in progress: a newer one for the same folder takes over

/** Test stand-in: words hashed into a vector, with a few words sharing a meaning. */
const FAKE_SAME = { automobile: 'car', sedan: 'car', vehicle: 'car', feline: 'cat', kitten: 'cat' };
function fakeEmbed(text) {
  const v = new Float32Array(FAKE_DIMS);
  for (const raw of String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const word = FAKE_SAME[raw] || raw;
    let h = 7;
    for (const c of word) h = (h * 31 + c.codePointAt(0)) >>> 0;
    v[h % FAKE_DIMS] += 1;
  }
  return normalize(v);
}

const embed = async (text, kind) => (fake ? fakeEmbed(text) : (await loadModel()).embed(text, kind));
const dims = () => (fake ? FAKE_DIMS : DIMS);

/** The model loads the first time text needs reading: showing related documents doesn't need it. */
function loadModel() {
  model ??= (async () => {
    const ort = require('onnxruntime-web');
    ort.env.wasm.wasmPaths = `${require('node:url').pathToFileURL(path.join(__dirname, 'voice')).href}/`;
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, require('node:os').availableParallelism?.() || 4));
    return E5.load(ort, modelDir, (f) => fs.promises.readFile(f));
  })();
  return model;
}

async function save() {
  if (!current?.dirty) return;
  const { store, index } = current;
  current.dirty = false;
  await fs.promises.mkdir(path.dirname(store), { recursive: true });
  const part = `${store}.part`;
  await fs.promises.writeFile(part, index.serialize());
  await fs.promises.rename(part, store);
}

async function open(root, store) {
  if (current?.root === root) return current;
  await save();
  let index;
  try { index = SmartIndex.parse(await fs.promises.readFile(store), dims()); } catch { index = new SmartIndex(dims()); }
  current = { root, store, index, dirty: false };
  return current;
}

async function runIndex(job) {
  const me = { stop: false };
  if (indexing) indexing.stop = true;
  indexing = me;
  const here = await open(job.root, job.store);
  const before = here.index.files.size;
  here.index.keep(job.files);
  if (here.index.files.size !== before) here.dirty = true;
  let saved = Date.now();
  let done = 0;
  const total = job.files.length;
  port.postMessage({ type: 'progress', root: job.root, done, total });
  for (const file of job.files) {
    if (me.stop) return { stopped: true };
    done++;
    let st;
    try { st = await fs.promises.stat(file); } catch { continue; }
    if (st.size > MAX_BYTES || here.index.has(file, st.mtimeMs, st.size)) continue;
    let text;
    try { text = await fs.promises.readFile(file, 'utf8'); } catch { continue; }
    const items = [];
    for (const p of passages(text, path.basename(file).replace(/\.[^.]+$/, ''))) {
      if (me.stop) return { stopped: true };
      items.push({ line: p.line, vector: await embed(p.text, 'passage') });
    }
    here.index.set(file, st.mtimeMs, st.size, items);
    here.dirty = true;
    if (done % 5 === 0 || done === total) port.postMessage({ type: 'progress', root: job.root, done, total });
    if (Date.now() - saved > SAVE_EVERY) { await save(); saved = Date.now(); }
  }
  await save();
  if (indexing === me) indexing = null;
  port.postMessage({ type: 'progress', root: job.root, done: total, total });
  return { files: total };
}

async function runSearch(job) {
  const here = await open(job.root, job.store);
  const vector = await embed(job.query, 'query');
  const found = here.index.search(vector, job.limit);
  return { results: fake ? found : here.index.closeEnough(found) };
}

async function runRelated(job) {
  const here = await open(job.root, job.store);
  const found = here.index.related(job.path, job.limit);
  return { results: fake ? found : here.index.relatedEnough(found) };
}

const JOBS = { index: runIndex, search: runSearch, related: runRelated };

port.on('message', ({ data: msg }) => {
  if (msg.type === 'init') {
    fake = !!msg.fake;
    modelDir = msg.dir;
    port.postMessage({ type: 'ready' });
    return;
  }
  const run = JOBS[msg.type];
  if (!run) return;
  run(msg).then(
    (res) => port.postMessage({ type: 'done', id: msg.id, ...res }),
    (err) => port.postMessage({ type: 'error', id: msg.id, error: err?.message || String(err) }),
  );
});
