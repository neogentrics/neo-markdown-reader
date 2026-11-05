// Tests for 3.6 smart search: passages, the tokenizer, the embedding step, the index, and the download list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { passages, plain, Unigram, E5, SmartIndex, quantize, normalize, MAX_PASSAGES } = require('../src/main/smart-core.js');
const { SmartStore, FILES, REVISION } = require('../src/main/smart-search.js');

const unit = (...v) => normalize(Float32Array.from(v));

test('Markdown becomes plain words', () => {
  assert.equal(plain('- [x] **Bold** and [a link](http://x.y) and [[Page|label]] `code`'), 'Bold and a link and label code');
  assert.equal(plain('| a | b |'), 'a b');
  assert.equal(plain('![a chart](c.png)'), 'a chart');
  assert.equal(plain('<b>hi</b> there'), 'hi there');
});

test('passages keep their heading and first line, and leave out code and front matter', () => {
  const list = passages('---\ntitle: X\n---\n\nIntro words.\n\n# Budget\n\nWe cut travel.\n\n```\nsecret code\n```\n\n## Hiring\n\nTwo new people.\n', 'notes');
  assert.deepEqual(list, [
    { line: 4, text: 'notes. Intro words.' },
    { line: 6, text: 'Budget. We cut travel.' },
    { line: 14, text: 'Hiring. Two new people.' },
  ]);
});

test('short paragraphs join up, and long ones are cut at sentences', () => {
  const short = passages('One.\n\nTwo.\n\nThree.\n');
  assert.deepEqual(short, [{ line: 0, text: 'One. Two. Three.' }]);
  const sentence = 'This sentence is about the same length as many others you might read. ';
  const long = passages(sentence.repeat(40));
  assert.ok(long.length >= 3, `${long.length} passages`);
  for (const p of long) assert.ok(p.text.length <= 1200, String(p.text.length));
  assert.ok(long.every((p) => /\.$/.test(p.text)), 'cut at the end of a sentence');
  const words = passages('word '.repeat(2000));
  assert.ok(words.every((p) => p.text.length <= 1200));
  const blob = passages('x'.repeat(5000));
  assert.ok(blob.length >= 4 && blob.every((p) => p.text.length <= 1200));
});

test('a short last line joins the passage before it', () => {
  const body = 'A sentence with enough words in it to make a passage of its own, and then some more. '.repeat(5);
  const list = passages(`# One\n\n${body}\n\nA short tail.\n\n# Two\n\nStands alone.\n`);
  assert.equal(list.length, 2);
  assert.match(list[0].text, /A short tail\.$/);
  assert.equal(list[1].text, 'Two. Stands alone.');
});

test('an empty document has no passages, and a very long one stops at the limit', () => {
  assert.deepEqual(passages(''), []);
  assert.deepEqual(passages('\n\n```\ncode\n```\n'), []);
  assert.deepEqual(passages('# Only a heading\n'), [{ line: 0, text: 'Only a heading' }]);
  const huge = Array.from({ length: 1000 }, (_, i) => `# H${i}\n\nSome text here.\n`).join('\n');
  assert.equal(passages(huge).length, MAX_PASSAGES);
});

const VOCAB = [['<s>', 0], ['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['▁', -5], ['▁hello', -2], ['▁he', -3], ['llo', -3], ['▁world', -2], ['w', -6], ['o', -6], ['r', -6], ['l', -6], ['d', -6], ['é', -6], ['<mask>', 0]];
const tok = new Unigram(VOCAB);

test('the tokenizer picks the best-scoring cut', () => {
  assert.deepEqual(tok.encode('hello world'), [0, 5, 8, 2]);
  assert.deepEqual(tok.encode('  hello\n\tworld  '), [0, 5, 8, 2], 'spaces are tidied');
  assert.deepEqual(tok.encode(''), [0, 2]);
  assert.deepEqual(tok.encode('world', 3), [0, 8, 2]);
});

test('text the vocabulary doesn’t know becomes one unknown mark', () => {
  assert.deepEqual(tok.encode('xyz'), [0, 4, 3, 2]);
  assert.deepEqual(tok.encode('😀'), [0, 4, 3, 2]);
  assert.deepEqual(tok.encode('wo😀rd'), [0, 4, 9, 10, 3, 11, 13, 2].filter((id, i) => i !== 1 || true).slice(0, 8));
});

test('long text is cut to the limit, keeping the end mark', () => {
  const ids = tok.encode('hello '.repeat(100), 16);
  assert.equal(ids.length, 16);
  assert.equal(ids[15], 2);
});

test('text is cleaned as the model expects', () => {
  assert.equal(Unigram.normalize('ﬁ Ｆull½'), 'fi Full1⁄2');
  assert.equal(Unigram.normalize('a​b\u0007c­d'), 'abcd');
});

test('the model’s output is averaged into one unit vector', async () => {
  const seen = [];
  const session = {
    inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
    outputNames: ['last_hidden_state'],
    run: async (feeds) => {
      seen.push(feeds);
      const n = feeds.input_ids.dims[1];
      return { last_hidden_state: { dims: [1, n, 2], data: Float32Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 0 : 3)) } };
    },
  };
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
  const e5 = new E5({ Tensor }, session, tok);
  const v = await e5.embed('hello', 'query');
  assert.deepEqual([...v], [1, 0]);
  assert.equal(seen[0].token_type_ids.type, 'int64');
  assert.deepEqual([...seen[0].attention_mask.data], seen[0].input_ids.data.length === 0 ? [] : Array(seen[0].input_ids.dims[1]).fill(1n));
  const noTypes = new E5({ Tensor }, { ...session, inputNames: ['input_ids', 'attention_mask'] }, tok);
  seen.length = 0;
  await noTypes.embed('hello', 'passage');
  assert.equal(seen[0].token_type_ids, undefined);
});

test('jobs run one at a time, and a failure doesn’t stop the next', async () => {
  let running = 0;
  let most = 0;
  let calls = 0;
  const session = {
    inputNames: [], outputNames: ['o'],
    run: async () => {
      running++; most = Math.max(most, running); calls++;
      await new Promise((r) => setTimeout(r, 2));
      running--;
      if (calls === 2) throw new Error('bad');
      return { o: { dims: [1, 1, 1], data: Float32Array.of(1) } };
    },
  };
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
  const e5 = new E5({ Tensor }, session, new Unigram(VOCAB));
  e5.tokenizer.encode = () => [0];
  const all = await Promise.allSettled([e5.embed('a', 'query'), e5.embed('b', 'query'), e5.embed('c', 'query')]);
  assert.deepEqual(all.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(most, 1);
});

test('squeezing a vector keeps it close', () => {
  const v = normalize(Float32Array.from({ length: 384 }, (_, i) => Math.sin(i * 12.9898) * 0.3));
  const { q, scale } = quantize(v);
  let dot = 0;
  for (let i = 0; i < v.length; i++) dot += q[i] * scale * v[i];
  assert.ok(dot > 0.999, String(dot));
  assert.deepEqual([...quantize(new Float32Array(3)).q], [0, 0, 0]);
});

function small() {
  const index = new SmartIndex(3, 'test');
  index.set('a.md', 1, 10, [{ line: 0, vector: unit(1, 0, 0) }, { line: 9, vector: unit(0, 1, 0) }]);
  index.set('b.md', 2, 20, [{ line: 4, vector: unit(0.9, 0.1, 0) }]);
  index.set('c.md', 3, 30, [{ line: 7, vector: unit(0, 0, 1) }]);
  index.set('empty.md', 4, 0, []);
  return index;
}

test('search finds each document’s best passage, closest first', () => {
  const found = small().search(unit(0, 1, 0));
  assert.deepEqual(found.slice(0, 2).map((r) => [r.path, r.line]), [['a.md', 9], ['b.md', 4]]);
  assert.equal(found.length, 3, 'a document with no passages isn’t listed');
  assert.equal(small().search(unit(0, 1, 0), 1).length, 1);
});

test('related documents leave out the one you’re reading', () => {
  const found = small().related('b.md');
  assert.deepEqual(found.map((r) => r.path), ['a.md', 'c.md']);
  assert.deepEqual(small().related('nothing.md'), []);
  assert.deepEqual(small().related('empty.md'), []);
  assert.equal(small().related('a.md', 1).length, 1);
});

/** A folder whose vectors all lean the same way, as the real model's do. */
function leaning(topics = 3, each = 12) {
  const dims = 8;
  const index = new SmartIndex(dims, 'test');
  const vector = (topic, wobble) => {
    const v = new Float32Array(dims).fill(1);
    v[topic] += 0.5;
    v[dims - 1] += wobble;
    return normalize(v);
  };
  for (let t = 0; t < topics; t++) {
    for (let i = 0; i < each; i++) index.set(`t${t}-${i}.md`, 1, 1, [{ line: i, vector: vector(t, (i % 3) * 0.02) }]);
  }
  return { index, vector };
}

test('with enough text, what every passage shares is taken away', () => {
  const { index, vector } = leaning();
  assert.ok(index.averages().passage && index.averages().document);
  const found = index.search(vector(1, 0.01), 36);
  assert.match(found[0].path, /^t1-/);
  const close = index.closeEnough(found);
  assert.ok(close.length >= 1 && close.length <= 12, `${close.length} results`);
  assert.ok(close.every((r) => r.path.startsWith('t1-')), close.map((r) => r.path).join());
});

test('related documents share a topic, and unrelated ones are left out', () => {
  const { index } = leaning();
  const near = index.relatedEnough(index.related('t0-0.md', 5));
  assert.ok(near.length > 0);
  assert.ok(near.every((r) => r.path.startsWith('t0-')), near.map((r) => r.path).join());
});

test('a small folder uses plain scores, and keeps only what’s near the best', () => {
  const index = small();
  assert.equal(index.averages().passage, null);
  assert.equal(index.averages().document, null);
  assert.deepEqual(index.closeEnough([{ score: 0.9 }, { score: 0.85 }, { score: 0.7 }]).map((r) => r.score), [0.9, 0.85]);
  assert.deepEqual(index.closeEnough([]), []);
  assert.deepEqual(index.relatedEnough([{ score: 0.95 }, { score: 0.8 }]).map((r) => r.score), [0.95]);
});

test('the averages follow changes to the folder', () => {
  const { index, vector } = leaning(2, 12);
  const before = index.averages();
  index.set('new.md', 1, 1, [{ line: 0, vector: vector(5, 0) }]);
  assert.notEqual(index.averages(), before);
  const again = index.averages();
  index.keep(['new.md']);
  assert.notEqual(index.averages(), again);
  assert.equal(index.averages().passage, null);
});

test('a document is read again only if it changed, and gone ones are forgotten', () => {
  const index = small();
  assert.equal(index.has('a.md', 1, 10), true);
  assert.equal(index.has('a.md', 2, 10), false);
  assert.equal(index.has('a.md', 1, 11), false);
  assert.equal(index.has('z.md', 1, 1), false);
  index.keep(['a.md']);
  assert.deepEqual([...index.files.keys()], ['a.md']);
});

test('an index comes back the same from disk', () => {
  const before = small();
  const after = SmartIndex.parse(before.serialize(), 3, 'test');
  assert.deepEqual(after.search(unit(0, 1, 0)).map((r) => [r.path, r.line]), before.search(unit(0, 1, 0)).map((r) => [r.path, r.line]));
  assert.equal(after.has('b.md', 2, 20), true);
});

test('a damaged index, or one from another model, starts over', () => {
  const good = small().serialize();
  assert.equal(SmartIndex.parse(good, 3, 'other').files.size, 0);
  assert.equal(SmartIndex.parse(good, 4, 'test').files.size, 0);
  assert.equal(SmartIndex.parse(good.subarray(0, good.length - 5), 3, 'test').files.size, 0);
  assert.equal(SmartIndex.parse(Buffer.from('nonsense'), 3, 'test').files.size, 0);
  assert.equal(SmartIndex.parse(Buffer.alloc(0), 3, 'test').files.size, 0);
});

test('the index holds no words from the documents', () => {
  const index = new SmartIndex(3, 'test');
  index.set('notes.md', 1, 1, [{ line: 0, vector: unit(1, 2, 3) }]);
  const raw = index.serialize().toString('latin1');
  assert.match(raw, /notes\.md/);
  assert.equal(Object.keys(index.files.get('notes.md')).includes('text'), false);
});

test('the download is pinned to one revision, with a checksum for every file', () => {
  assert.match(REVISION, /^[0-9a-f]{40}$/);
  for (const f of FILES) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(f.size > 0);
  }
  assert.deepEqual(FILES.map((f) => f.path), ['onnx/model_quantized.onnx', 'tokenizer.json']);
});

function store() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-smart-'));
  const child = new EventEmitter();
  child.sent = [];
  child.kill = () => {};
  child.postMessage = (m) => {
    child.sent.push(m);
    if (m.type === 'init') setImmediate(() => child.emit('message', { type: 'ready' }));
    else if (m.id) setImmediate(() => child.emit('message', { type: 'done', id: m.id, results: [{ path: 'a.md', line: 3 }] }));
  };
  const progress = [];
  const s = new SmartStore({ root, fetch: null, fork: () => child, worker: 'w', fake: true, onIndexing: (p) => progress.push(p) });
  return { s, child, progress };
}

test('nothing runs until the model is on this computer', async () => {
  const { s } = store();
  assert.equal(s.status().installed, false);
  await assert.rejects(s.search('/f', 'q'), /isn’t downloaded/);
});

test('questions reach the worker with their folder’s index file, one per folder', async () => {
  const { s, child } = store();
  await s.install();
  assert.deepEqual(await s.search('/f', 'cats'), [{ path: 'a.md', line: 3 }]);
  await s.related('/g', 'b.md');
  await s.index('/f', ['x.md']);
  const [search, related, index] = child.sent.filter((m) => m.id);
  assert.equal(search.query, 'cats');
  assert.equal(related.path, 'b.md');
  assert.deepEqual(index.files, ['x.md']);
  assert.equal(search.store, index.store);
  assert.notEqual(search.store, related.store);
  assert.ok(search.store.startsWith(s.dir), 'removing the download removes the indexes');
  s.stop();
});

test('reading progress is passed on, and a finished folder is no longer busy', async () => {
  const { s, child, progress } = store();
  await s.install();
  await s.search('/f', 'q');
  child.emit('message', { type: 'progress', root: '/f', done: 2, total: 5 });
  assert.deepEqual(s.indexing.get('/f'), { done: 2, total: 5 });
  child.emit('message', { type: 'progress', root: '/f', done: 5, total: 5 });
  assert.equal(s.indexing.has('/f'), false);
  assert.equal(progress.length, 2);
  s.stop();
});
