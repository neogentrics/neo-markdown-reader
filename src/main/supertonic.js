'use strict';
// Natural voices (3.2): Supertonic 3 text-to-speech, run on this computer with ONNX Runtime.
//
// Adapted from Supertone's MIT-licensed Node.js example (github.com/supertone-inc/supertonic,
// nodejs/helper.js; see THIRD_PARTY_NOTICES.md). Changes: flat typed arrays instead of nested arrays
// (a sentence's latent is ~100k numbers per step), the output trimmed to its predicted length, and the
// ONNX Runtime module passed in, so this runs on the WebAssembly runtime and can be tested without it.
//
// The model itself is not part of the app. It's downloaded once, when the reader asks for a natural
// voice (see voices.js), and is under its own license (BigScience OpenRAIL-M).
const { prepare } = require('./voice-text');

/** A voice style file (voice_styles/*.json) as the two tensors the models take. */
function voiceStyle(ort, json) {
  const flat = (v) => Float32Array.from(v.data.flat(Infinity));
  return {
    ttl: new ort.Tensor('float32', flat(json.style_ttl), json.style_ttl.dims),
    dp: new ort.Tensor('float32', flat(json.style_dp), json.style_dp.dims),
  };
}

/** Standard normal noise (Box–Muller). */
function gaussian(n, random = Math.random) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(1e-10, random());
    const v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

class Supertonic {
  /**
   * @param {object} ort       the ONNX Runtime module
   * @param {object} sessions  { dp, enc, est, voc } InferenceSessions
   * @param {object} cfg       onnx/tts.json
   * @param {object} indexer   onnx/unicode_indexer.json (code point -> token id)
   */
  constructor(ort, sessions, cfg, indexer) {
    this.ort = ort;
    this.s = sessions;
    this.indexer = indexer;
    this.sampleRate = cfg.ae.sample_rate;
    this.chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
    this.latentDim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  }

  /** Load the four models from `dir` (the downloaded onnx/ folder). `read` returns a file's bytes. */
  static async load(ort, dir, read) {
    const join = (f) => `${dir}/${f}`;
    const open = async (f) => ort.InferenceSession.create(await read(join(f)), { graphOptimizationLevel: 'all' });
    const [dp, enc, est, voc] = await Promise.all(['duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx'].map(open));
    const json = async (f) => JSON.parse(new TextDecoder().decode(await read(join(f))));
    return new Supertonic(ort, { dp, enc, est, voc }, await json('tts.json'), await json('unicode_indexer.json'));
  }

  ids(text) {
    const codes = Array.from(text, (c) => c.charCodeAt(0));
    const ids = new BigInt64Array(codes.length);
    codes.forEach((c, i) => { ids[i] = BigInt(this.indexer[c] ?? 0); });
    return ids;
  }

  /**
   * Speak one piece of text (≤ ~300 characters; see voice-text.chunks()).
   * @returns {Promise<Float32Array>} mono samples at this.sampleRate
   */
  async speak(text, { lang = 'en', style, speed = 1.05, steps = 8, random = Math.random, between = null } = {}) {
    const { ort } = this;
    const ids = this.ids(prepare(text, lang));
    const n = ids.length;
    const textIds = new ort.Tensor('int64', ids, [1, n]);
    const textMask = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]);

    const { duration } = await this.s.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
    const seconds = duration.data[0] / speed;
    const { text_emb: textEmb } = await this.s.enc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });

    const wavLen = Math.floor(seconds * this.sampleRate);
    const latentLen = Math.max(1, Math.ceil(wavLen / this.chunk));
    let latent = gaussian(this.latentDim * latentLen, random);
    const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
    const total = new ort.Tensor('float32', Float32Array.of(steps), [1]);
    for (let step = 0; step < steps; step++) {
      await between?.();          // a chance to give up on this sentence: most of the time goes here
      const out = await this.s.est.run({
        noisy_latent: new ort.Tensor('float32', latent, [1, this.latentDim, latentLen]),
        text_emb: textEmb, style_ttl: style.ttl, text_mask: textMask, latent_mask: latentMask,
        total_step: total, current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      });
      latent = Float32Array.from(out.denoised_latent.data);
    }
    await between?.();
    const { wav_tts: wav } = await this.s.voc.run({ latent: new ort.Tensor('float32', latent, [1, this.latentDim, latentLen]) });
    return Float32Array.from(wav.data.subarray(0, Math.min(wav.data.length, wavLen)));
  }
}

module.exports = { Supertonic, voiceStyle, gaussian };
