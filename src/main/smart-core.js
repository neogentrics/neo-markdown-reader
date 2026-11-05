'use strict';
// Smart search (3.6): the parts that need no model. Splitting a document into passages, the tokenizer
// the model expects, the embedding step around ONNX Runtime, and the index that holds one vector for each
// passage. Passage text is never stored: a vector and a line number are enough to find it again.
//
// The model is multilingual-e5-small (MIT), downloaded once on request (see smart-search.js).

const DIMS = 384;
const MAX_TOKENS = 256;
const MAX_PASSAGES = 400;        // in one document
const TARGET = 900;              // characters in a passage
const MIN_MERGE = 300;

// ======================================================================== passages
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/** A line of Markdown as plain words. */
function plain(line) {
  return String(line)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/[|*_`~#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Long text in pieces of about TARGET characters, cut at the end of a sentence where there is one. */
function pieces(text) {
  if (text.length <= TARGET * 1.3) return [text];
  const out = [];
  let rest = text;
  while (rest.length > TARGET * 1.3) {
    const window = rest.slice(0, TARGET);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('。'));
    const at = cut > TARGET / 3 ? cut + 1 : (window.lastIndexOf(' ') > TARGET / 3 ? window.lastIndexOf(' ') : TARGET);
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * A document as passages of a few sentences, each with the heading it sits under.
 * @returns {{ line: number, text: string }[]}  line counts from 0
 */
function passages(markdown, title = '') {
  const lines = String(markdown ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let heading = title;
  let fence = '';
  let buffer = '';
  let start = -1;
  let lastHeading = null;
  const flush = () => {
    const text = buffer.trim();
    const last = out[out.length - 1];
    if (text && text.length < MIN_MERGE / 2 && last && lastHeading === heading && last.text.length + text.length <= TARGET * 1.3) {
      last.text += ` ${text}`;           // on its own, a short tail matches everything a little
    } else if (text) {
      for (const piece of pieces(text)) out.push({ line: start, text: heading ? `${heading}. ${piece}` : piece });
      lastHeading = heading;
    }
    buffer = '';
    start = -1;
  };
  for (; i < lines.length && out.length < MAX_PASSAGES; i++) {
    const line = lines[i];
    const open = FENCE.exec(line);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = '';
      continue;
    }
    if (fence) continue;
    const head = HEADING.exec(line);
    if (head) {
      flush();
      heading = plain(head[1]) || heading;
      start = i;
      buffer = '';
      continue;
    }
    if (!line.trim()) {
      if (buffer.length >= MIN_MERGE) flush();
      continue;
    }
    const words = plain(line);
    if (!words) continue;
    if (start < 0) start = i;
    buffer += `${buffer ? ' ' : ''}${words}`;
    if (buffer.length >= TARGET * 2) flush();
  }
  flush();
  if (!out.length && heading && heading !== title) out.push({ line: 0, text: heading });
  return out.slice(0, MAX_PASSAGES);
}

// ======================================================================== the tokenizer
// Control characters and the invisible marks between words.
const ZERO_WIDTH = new RegExp('[\\u0000-\\u0008\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u200b-\\u200f\\u2028-\\u202f\\ufeff]', 'g');

/** A SentencePiece Unigram tokenizer, read from the tokenizer.json published with the model. */
class Unigram {
  constructor(vocab, { unk = 3, bos = 0, eos = 2 } = {}) {
    this.pieces = new Map();
    this.maxLen = 1;
    let min = 0;
    vocab.forEach(([piece, score], id) => {
      if (id === bos || id === eos || id === unk || piece === '<pad>' || piece === '<mask>') return;
      this.pieces.set(piece, [id, score]);
      const n = piece.length;
      if (n > this.maxLen) this.maxLen = n;
      if (score < min) min = score;
    });
    this.unkScore = min - 10;
    this.unk = unk;
    this.bos = bos;
    this.eos = eos;
  }

  static fromJson(json) {
    const m = json.model;
    return new Unigram(m.vocab, { unk: m.unk_id });
  }

  /** The same clean-up SentencePiece's nmt_nfkc does, in the ways that matter here. */
  static normalize(text) {
    return String(text).normalize('NFKC')
      .replace(ZERO_WIDTH, '')
      .replace(/\s+/g, ' ').trim();
  }

  /** The best-scoring way to cut one word (Viterbi). */
  segment(word) {
    const n = word.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1).fill(-1);
    const ids = new Int32Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      const stop = Math.min(n, i + this.maxLen);
      let single = false;
      for (let j = i + 1; j <= stop; j++) {
        const hit = this.pieces.get(word.slice(i, j));
        if (!hit) continue;
        if (j === i + 1) single = true;
        const score = best[i] + hit[1];
        if (score > best[j]) { best[j] = score; from[j] = i; ids[j] = hit[0]; }
      }
      if (!single) {
        // A character the model has never seen: cut around whole code points.
        const step = word.codePointAt(i) > 0xffff ? 2 : 1;
        const score = best[i] + this.unkScore;
        if (score > best[i + step]) { best[i + step] = score; from[i + step] = i; ids[i + step] = this.unk; }
      }
    }
    const out = [];
    for (let at = n; at > 0; at = from[at]) {
      if (from[at] < 0) return [this.unk];
      out.push(ids[at]);
    }
    out.reverse();
    return out.filter((id, i) => id !== this.unk || out[i - 1] !== this.unk);
  }

  /** Token ids for a piece of text, with the start and end marks, cut to `max`. */
  encode(text, max = MAX_TOKENS) {
    const clean = Unigram.normalize(text);
    const ids = [this.bos];
    if (clean) {
      for (const word of clean.split(' ')) {
        for (const id of this.segment(`▁${word}`)) ids.push(id);
        if (ids.length >= max - 1) break;
      }
    }
    ids.length = Math.min(ids.length, max - 1);
    ids.push(this.eos);
    return ids;
  }
}

// ======================================================================== vectors
function normalize(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const k = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= k;
  return v;
}

/** The model around ONNX Runtime: text in, one unit vector out. */
class E5 {
  constructor(ort, session, tokenizer) {
    this.ort = ort;
    this.session = session;
    this.tokenizer = tokenizer;
    this.queue = Promise.resolve();
  }

  static async load(ort, dir, read) {
    const session = await ort.InferenceSession.create(await read(`${dir}/onnx/model_quantized.onnx`), { graphOptimizationLevel: 'all' });
    const tokenizer = Unigram.fromJson(JSON.parse(new TextDecoder().decode(await read(`${dir}/tokenizer.json`))));
    return new E5(ort, session, tokenizer);
  }

  async run(text) {
    const { ort } = this;
    const ids = this.tokenizer.encode(text);
    const n = ids.length;
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]),
    };
    if (this.session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n), [1, n]);
    const res = await this.session.run(feeds);
    const hidden = res[this.session.outputNames[0]];
    const data = hidden.data;
    const dims = hidden.dims[2];
    const out = new Float32Array(dims);
    for (let t = 0; t < n; t++) for (let d = 0; d < dims; d++) out[d] += data[t * dims + d];
    return normalize(out);
  }

  /** @param {'query'|'passage'} kind  the model was trained with these two labels */
  embed(text, kind) {
    const job = this.queue.then(() => this.run(`${kind}: ${text}`));
    this.queue = job.catch(() => {});
    return job;
  }
}

// ======================================================================== the index
function quantize(v) {
  let max = 0;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > max) max = a; }
  const scale = max / 127 || 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale);
  return { q, scale };
}

// Every vector from this model shares a large common direction, so raw scores bunch together and short,
// vague passages look close to everything. Taking the folder's average direction away spreads them out. That
// needs enough text to have a meaningful average; a smaller folder uses the raw scores.
const MIN_PASSAGES = 24;
const MIN_DOCUMENTS = 8;
const dotOf = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const minus = (a, c) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - c[i]; return normalize(o); };

class SmartIndex {
  constructor(dims = DIMS, model = 'multilingual-e5-small') {
    this.dims = dims;
    this.model = model;
    this.files = new Map();       // path -> { mtime, size, lines: Int32Array, scales: Float32Array, vecs: Int8Array, mean? }
  }

  has(path, mtime, size) {
    const f = this.files.get(path);
    return !!f && f.mtime === mtime && f.size === size;
  }

  /** @param {{ line: number, vector: Float32Array }[]} items */
  set(path, mtime, size, items) {
    const n = items.length;
    const f = { mtime, size, lines: new Int32Array(n), scales: new Float32Array(n), vecs: new Int8Array(n * this.dims) };
    items.forEach((it, i) => {
      const { q, scale } = quantize(it.vector);
      f.lines[i] = it.line;
      f.scales[i] = scale;
      f.vecs.set(q, i * this.dims);
    });
    this.files.set(path, f);
    this.average = undefined;
  }

  /** Forget documents that are no longer in the folder. */
  keep(paths) {
    const wanted = new Set(paths);
    for (const p of this.files.keys()) if (!wanted.has(p)) { this.files.delete(p); this.average = undefined; }
  }

  /** The folder's average passage and average document, or null where there's too little to go on. */
  averages() {
    if (this.average !== undefined) return this.average;
    const { dims } = this;
    const passage = new Float32Array(dims);
    const document = new Float32Array(dims);
    let n = 0;
    let docs = 0;
    for (const [path, f] of this.files) {
      for (let i = 0; i < f.lines.length; i++) {
        for (let d = 0; d < dims; d++) passage[d] += f.vecs[i * dims + d] * f.scales[i];
        n++;
      }
      const m = this.mean(path);
      if (m) { for (let d = 0; d < dims; d++) document[d] += m[d]; docs++; }
    }
    for (let d = 0; d < dims; d++) { passage[d] /= n || 1; document[d] /= docs || 1; }
    this.average = { passage: n >= MIN_PASSAGES ? passage : null, document: docs >= MIN_DOCUMENTS ? document : null };
    return this.average;
  }

  /** The documents closest to a query, each with its best passage. */
  search(query, limit = 20) {
    const { dims } = this;
    const c = this.averages().passage;
    const q = c ? minus(query, c) : query;
    const qc = c ? dotOf(q, c) : 0;
    const cc = c ? dotOf(c, c) : 0;
    const out = [];
    for (const [path, f] of this.files) {
      let best = -Infinity;
      let line = 0;
      for (let i = 0; i < f.lines.length; i++) {
        let dot = 0;
        let vc = 0;
        const at = i * dims;
        for (let d = 0; d < dims; d++) {
          const v = f.vecs[at + d];
          dot += v * q[d];
          if (c) vc += v * c[d];
        }
        dot *= f.scales[i];
        // The cosine between (query − average) and (passage − average), for a passage of length 1.
        const score = c ? (dot - qc) / Math.sqrt(Math.max(1e-6, 1 - 2 * vc * f.scales[i] + cc)) : dot;
        if (score > best) { best = score; line = f.lines[i]; }
      }
      if (best > -Infinity) out.push({ path, line, score: best });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** The results worth showing: those not far behind the best one. */
  closeEnough(found) {
    const best = found[0]?.score ?? 0;
    if (this.averages().passage) return found.filter((r) => r.score >= Math.max(0.12, best * 0.65));
    return found.filter((r) => r.score >= best - 0.07);
  }

  mean(path) {
    const f = this.files.get(path);
    if (!f?.lines.length) return null;
    if (f.mean) return f.mean;
    const { dims } = this;
    const m = new Float32Array(dims);
    for (let i = 0; i < f.lines.length; i++) for (let d = 0; d < dims; d++) m[d] += f.vecs[i * dims + d] * f.scales[i];
    f.mean = normalize(m);
    return f.mean;
  }

  /** The other documents most like this one. */
  related(path, limit = 5) {
    const raw = this.mean(path);
    if (!raw) return [];
    const c = this.averages().document;
    const me = c ? minus(raw, c) : raw;
    const out = [];
    for (const other of this.files.keys()) {
      if (other === path) continue;
      const m = this.mean(other);
      if (!m) continue;
      out.push({ path: other, score: dotOf(me, c ? minus(m, c) : m) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Related documents worth showing. Most documents have some in common; these have a lot. */
  relatedEnough(found) {
    const from = this.averages().document ? 0.2 : 0.9;
    return found.filter((r) => r.score >= from);
  }

  serialize() {
    const files = [...this.files].map(([path, f]) => ({ path, mtime: f.mtime, size: f.size, n: f.lines.length }));
    const head = Buffer.from(JSON.stringify({ version: 1, model: this.model, dims: this.dims, files }), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(head.length);
    const parts = [len, head];
    for (const f of this.files.values()) {
      parts.push(Buffer.from(f.lines.buffer, f.lines.byteOffset, f.lines.byteLength), Buffer.from(f.scales.buffer, f.scales.byteOffset, f.scales.byteLength), Buffer.from(f.vecs.buffer, f.vecs.byteOffset, f.vecs.byteLength));
    }
    return Buffer.concat(parts);
  }

  /** An index read back, or an empty one if the file is damaged or from another model. */
  static parse(buf, dims = DIMS, model = 'multilingual-e5-small') {
    const index = new SmartIndex(dims, model);
    try {
      const len = buf.readUInt32LE(0);
      const head = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      if (head.version !== 1 || head.dims !== dims || head.model !== model) return index;
      let at = 4 + len;
      const take = (bytes) => {
        if (at + bytes > buf.length) throw new Error('short');
        const copy = new Uint8Array(bytes);
        copy.set(buf.subarray(at, at + bytes));
        at += bytes;
        return copy.buffer;
      };
      for (const f of head.files) {
        index.files.set(f.path, {
          mtime: f.mtime, size: f.size,
          lines: new Int32Array(take(f.n * 4)), scales: new Float32Array(take(f.n * 4)), vecs: new Int8Array(take(f.n * dims)),
        });
      }
    } catch { return new SmartIndex(dims, model); }
    return index;
  }
}

module.exports = { passages, plain, Unigram, E5, SmartIndex, quantize, normalize, DIMS, MAX_PASSAGES };
