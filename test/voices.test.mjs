// Tests for 3.2 "Natural voices": preparing text for the model, guessing a document's language, and
// downloading the voices (checked against their published size and SHA-256 before anything is used).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const text = require('../src/main/voice-text.js');
const { VoiceStore, FILES, REVISION } = require('../src/main/voices.js');
const { gaussian } = require('../src/main/supertonic.js');

test('voices: text is normalised, symbols are spoken or dropped, and it is tagged with its language', () => {
  assert.equal(text.prepare('Use the “Run” button — then wait', 'en'), '<en>Use the "Run" button - then wait.</en>');
  assert.equal(text.prepare('Mail me @ home 😀 !', 'en'), '<en>Mail me at home!</en>');
  // Accents are split from their letters (NFKD), the way the model was trained: "é" is "e" + "◌́".
  assert.equal(text.prepare('¿Qué tal?', 'es'), '<es>¿Qué tal?</es>'.normalize('NFKD'));
  assert.equal(text.modelLang('de-AT'), 'de');
  assert.equal(text.modelLang('zh'), null, 'a language the model doesn’t speak');
  assert.equal(text.modelLang(''), null);
});

test('voices: long text is split at sentences, and a very long sentence at words', () => {
  const pieces = text.chunks('One. Two is here. Three!\n\nA new paragraph.', 12);
  assert.deepEqual(pieces, ['One.', 'Two is here.', 'Three!', 'A new', 'paragraph.']);
  const long = text.chunks(`${'word '.repeat(100)}end.`, 300);
  assert.ok(long.every((p) => p.length <= 300));
  assert.equal(long.join(' ').split(' ').length, 101);
  assert.deepEqual(text.chunks('Dr. Smith met Mr. Jones. Then they left.', 300), ['Dr. Smith met Mr. Jones. Then they left.']);
});

test('voices: a document’s language is guessed from its common words, and only when it’s clear', () => {
  assert.equal(text.guessLang('The keeper climbed the stairs every night, and the lamp was old but it still turned for the ships.'), 'en');
  assert.equal(text.guessLang('El guardián subía las escaleras cada noche y la lámpara era vieja, pero todavía giraba para los barcos de la costa.'), 'es');
  assert.equal(text.guessLang('Le gardien montait les escaliers chaque nuit et la lampe était vieille, mais elle tournait encore pour les bateaux.'), 'fr');
  assert.equal(text.guessLang('Der Wärter stieg jede Nacht die Treppe hinauf, und die Lampe war alt, aber sie drehte sich noch für die Schiffe.'), 'de');
  assert.equal(text.guessLang('Too short.'), null);
  assert.equal(text.guessLang('守灯人每晚都爬上楼梯。灯很旧，但它仍然在转动，为过往的船只照亮海岸。守灯人每晚都爬上楼梯。'), null);
});

test('voices: noise for the model is normally distributed and the requested length', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = gaussian(20001, random);
  assert.equal(n.length, 20001);
  const mean = n.reduce((a, b) => a + b, 0) / n.length;
  const sd = Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / n.length);
  assert.ok(Math.abs(mean) < 0.05 && Math.abs(sd - 1) < 0.05, `mean ${mean}, sd ${sd}`);
});

test('voices: the download list is the model’s pinned files, each with a size and a SHA-256', () => {
  assert.equal(REVISION.length, 40);
  assert.equal(FILES.filter((f) => f.path.endsWith('.onnx')).length, 4);
  assert.equal(FILES.filter((f) => f.path.startsWith('voice_styles/')).length, 10);
  assert.ok(FILES.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.size > 0));
});

/** A store with a small made-up model, served by a fake fetch (optionally serving wrong bytes). */
function store({ corrupt = '', oversize = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-voices-'));
  const bodies = { 'onnx/a.onnx': Buffer.from('model bytes '.repeat(500)), 'voice_styles/F1.json': Buffer.from('{"voice":1}') };
  const files = Object.entries(bodies).map(([p, b]) => ({ path: p, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }));
  const asked = [];
  const fetch = async (url) => {
    const p = url.split(`/${REVISION}/`)[1] || url.split('/base/')[1];
    asked.push(p);
    let body = bodies[p];
    if (p === corrupt) body = Buffer.from(body).fill(0x41);
    if (p === oversize) body = Buffer.concat([body, Buffer.from('extra')]);
    return { ok: true, status: 200, body: (async function* () { for (let i = 0; i < body.length; i += 1000) yield body.subarray(i, i + 1000); })() };
  };
  const s = new VoiceStore({ root, fetch, fork: () => { throw new Error('no worker in this test'); }, worker: '', files, base: 'https://example.test/base' });
  return { s, root, asked, files };
}

test('voices: a download is checked file by file and only then marked installed', async () => {
  const { s, asked } = store();
  const seen = [];
  const st = await s.install((x) => seen.push(x.done));
  assert.equal(st.installed, true);
  assert.equal(st.error, '');
  assert.deepEqual(asked, ['onnx/a.onnx', 'voice_styles/F1.json']);
  assert.equal(seen.at(-1), st.total, 'progress reaches the total');
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress only goes up');
});

test('voices: a file that doesn’t match its checksum is deleted and nothing is marked installed', async () => {
  const { s, root } = store({ corrupt: 'voice_styles/F1.json' });
  const st = await s.install();
  assert.equal(st.installed, false);
  assert.match(st.error, /didn’t match its published checksum/);
  const dir = path.join(root, 'supertonic-3');
  assert.equal(fs.existsSync(path.join(dir, 'voice_styles', 'F1.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'voice_styles', 'F1.json.part')), false, 'no half file left behind');
  assert.equal(fs.existsSync(path.join(dir, 'installed.json')), false);
});

test('voices: a download that sends more than expected is stopped', async () => {
  const { s } = store({ oversize: 'onnx/a.onnx' });
  const st = await s.install();
  assert.equal(st.installed, false);
  assert.match(st.error, /larger than expected/);
});

test('voices: a stopped download carries on, keeping files already checked; Remove deletes everything', async () => {
  const { s, root, asked } = store({ corrupt: 'voice_styles/F1.json' });
  await s.install();                                            // the first file arrives, the second is bad
  const fixed = store();
  const again = new VoiceStore({ root, fetch: async (u) => { asked.push(u); return (await fixed.s.fetch(u)); }, fork: () => {}, worker: '', files: fixed.files, base: 'https://example.test/base' });
  asked.length = 0;
  const st = await again.install();
  assert.equal(st.installed, true);
  assert.deepEqual(asked.map((u) => u.split('/base/')[1]), ['voice_styles/F1.json'], 'only the missing file is fetched again');
  const gone = await again.remove();
  assert.equal(gone.installed, false);
  assert.equal(fs.existsSync(path.join(root, 'supertonic-3')), false);
});

test('voices: a sentence longer than the model reads well is spoken in pieces and joined with a short breath', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-voices-'));
  const asked = [];
  // A stand-in for the voice process: answers each piece at once with one sample per character.
  const fork = () => {
    const handlers = {};
    return {
      on: (ev, fn) => { handlers[ev] = fn; },
      postMessage: (m) => setImmediate(() => {
        if (m.type === 'init') handlers.message({ type: 'ready' });
        if (m.type === 'speak') { asked.push(m.text); handlers.message({ type: 'audio', id: m.id, sampleRate: 1000, samples: new Float32Array(m.text.length).fill(1), ms: 5 }); }
      }),
      kill: () => {},
    };
  };
  const s = new VoiceStore({ root, fetch: null, fork, worker: '', fake: true, files: [{ path: 'x.bin', size: 4, sha256: '0'.repeat(64) }] });
  await s.install();
  const long = `${'word '.repeat(150)}end.`;                       // 754 characters
  const res = await s.speak({ text: long, lang: 'en', voice: 'F1', speed: 1, steps: 8 });
  assert.equal(asked.length, 3, 'three pieces of at most 300 characters');
  assert.ok(asked.every((t) => t.length <= 300));
  assert.equal(asked.join(' '), long.trim());
  const voiced = asked.reduce((n, t) => n + t.length, 0);
  assert.equal(res.samples.length, voiced + 2 * 150, 'the pieces, with 0.15 s between them');
  assert.equal(res.samples[asked[0].length], 0, 'the breath is silent');
  const short = await s.speak({ text: 'Short one.', lang: 'en', voice: 'F1', speed: 1, steps: 8 });
  assert.equal(short.samples.length, 'Short one.'.length);
  s.stop();
});
