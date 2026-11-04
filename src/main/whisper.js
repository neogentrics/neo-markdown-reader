'use strict';
// Dictation (3.5): speech to text with OpenAI's Whisper model, run by ONNX Runtime. Sound goes in as 16 kHz
// samples, is turned into the 80-band picture of its frequencies that Whisper reads, and the model writes
// the words one token at a time. Pure JavaScript apart from the model; nothing here touches the network.

const SAMPLE_RATE = 16000;
const N_FFT = 400;
const HOP = 160;
const N_MELS = 80;
const FRAMES = 3000;                    // Whisper always reads 30 seconds; the rest is silence
const BINS = N_FFT / 2 + 1;
const MAX_SECONDS = 30;

/** The triangular frequency bands Whisper was trained with (Slaney's mel scale, area-normalised). */
function melFilters() {
  const minLogHz = 1000;
  const minLogMel = 15;
  const logStep = Math.log(6.4) / 27;
  const toMel = (f) => (f < minLogHz ? (3 * f) / 200 : minLogMel + Math.log(f / minLogHz) / logStep);
  const toHz = (m) => (m < minLogMel ? (200 * m) / 3 : minLogHz * Math.exp(logStep * (m - minLogMel)));
  const top = toMel(SAMPLE_RATE / 2);
  const hz = Array.from({ length: N_MELS + 2 }, (_, i) => toHz((top * i) / (N_MELS + 1)));
  const out = new Float32Array(N_MELS * BINS);
  for (let m = 0; m < N_MELS; m++) {
    const norm = 2 / (hz[m + 2] - hz[m]);
    for (let k = 0; k < BINS; k++) {
      const f = (k * SAMPLE_RATE) / N_FFT;
      const rise = (f - hz[m]) / (hz[m + 1] - hz[m]);
      const fall = (hz[m + 2] - f) / (hz[m + 2] - hz[m + 1]);
      out[m * BINS + k] = Math.max(0, Math.min(rise, fall)) * norm;
    }
  }
  return out;
}

let tables = null;
function dftTables() {
  if (tables) return tables;
  const cos = new Float64Array(N_FFT);
  const sin = new Float64Array(N_FFT);
  const window = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N_FFT);
    sin[i] = Math.sin((2 * Math.PI * i) / N_FFT);
    window[i] = 0.5 - 0.5 * cos[i];
  }
  tables = { cos, sin, window, filters: melFilters() };
  return tables;
}

/** Whisper's input for up to 30 seconds of 16 kHz sound: Float32Array(80 × 3000), band by band. */
function logMel(samples) {
  const { cos, sin, window, filters } = dftTables();
  const n = Math.min(samples.length, SAMPLE_RATE * MAX_SECONDS);
  const pad = N_FFT / 2;
  // The frames are centred, with the sound mirrored at its start and silence after its end.
  const at = (i) => { const j = i < 0 ? -i : i; return j < n ? samples[j] : 0; };
  const used = Math.min(FRAMES, Math.ceil((n + pad) / HOP) + 1);
  const out = new Float32Array(N_MELS * FRAMES);
  const frame = new Float64Array(N_FFT);
  const power = new Float64Array(BINS);
  let peak = -Infinity;
  for (let t = 0; t < FRAMES; t++) {
    if (t < used) {
      for (let i = 0; i < N_FFT; i++) frame[i] = at(t * HOP + i - pad) * window[i];
      for (let k = 0; k < BINS; k++) {
        let re = 0;
        let im = 0;
        for (let i = 0, p = 0; i < N_FFT; i++, p += k) {
          if (p >= N_FFT) p -= N_FFT;
          re += frame[i] * cos[p];
          im -= frame[i] * sin[p];
        }
        power[k] = re * re + im * im;
      }
    }
    for (let m = 0; m < N_MELS; m++) {
      let v = 0;
      if (t < used) for (let k = 0; k < BINS; k++) v += filters[m * BINS + k] * power[k];
      const log = Math.log10(Math.max(v, 1e-10));
      out[m * FRAMES + t] = log;
      if (log > peak) peak = log;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], peak - 8) + 4) / 4;
  return out;
}

/** GPT-2's table from the characters in the vocabulary back to the bytes they stand for. */
function byteTable() {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const table = new Map(keep.map((b) => [String.fromCodePoint(b), b]));
  let extra = 0;
  for (let b = 0; b < 256; b++) if (!keep.includes(b)) table.set(String.fromCodePoint(256 + extra++), b);
  return table;
}

class Whisper {
  /**
   * @param {object} ort       ONNX Runtime
   * @param {string} dir       the folder holding the model
   * @param {Function} read    (file) => Promise<Buffer>
   */
  static async load(ort, dir, read) {
    const join = (f) => `${dir}/${f}`;
    const open = async (f) => ort.InferenceSession.create(await read(join(f)), { graphOptimizationLevel: 'all' });
    const encoder = await open('onnx/encoder_model_int8.onnx');
    const decoder = await open('onnx/decoder_model_merged_int8.onnx');
    const json = async (f) => JSON.parse((await read(join(f))).toString('utf8'));
    return new Whisper(ort, encoder, decoder, await json('generation_config.json'), await json('vocab.json'), await json('config.json'));
  }

  constructor(ort, encoder, decoder, generation, vocab, config) {
    this.ort = ort;
    this.encoder = encoder;
    this.decoder = decoder;
    this.g = generation;
    this.heads = config.decoder_attention_heads;
    this.headDim = config.d_model / config.decoder_attention_heads;
    this.tokens = [];
    for (const [text, id] of Object.entries(vocab)) this.tokens[id] = text;
    this.bytes = byteTable();
    this.past = decoder.inputNames.filter((n) => n.startsWith('past_key_values'));
    this.suppress = new Set(generation.suppress_tokens);
  }

  ids(list) {
    return new this.ort.Tensor('int64', BigInt64Array.from(list.map(BigInt)), [1, list.length]);
  }

  /** One step of the decoder. Returns the scores for the next token and the memory for the step after it. */
  async step(tokens, hidden, memory) {
    const feeds = { input_ids: this.ids(tokens), encoder_hidden_states: hidden, use_cache_branch: new this.ort.Tensor('bool', [!!memory], [1]) };
    for (const name of this.past) {
      feeds[name] = memory ? memory[name] : new this.ort.Tensor('float32', new Float32Array(0), [1, this.heads, 0, this.headDim]);
    }
    const res = await this.decoder.run(feeds);
    const next = {};
    for (const name of this.past) {
      const present = name.replace('past_key_values', 'present');
      // The encoder's part is worked out once, on the first step, and doesn't change after that.
      next[name] = memory && name.includes('.encoder.') ? memory[name] : res[present];
    }
    const { dims, data } = res.logits;
    return { scores: data.subarray((dims[1] - 1) * dims[2], dims[1] * dims[2]), memory: next };
  }

  /** The language being spoken, when nothing says what it is. */
  async detect(hidden) {
    const { scores } = await this.step([this.g.decoder_start_token_id], hidden, null);
    let best = null;
    for (const id of Object.values(this.g.lang_to_id)) if (best === null || scores[id] > scores[best]) best = id;
    return best;
  }

  /**
   * @param {Float32Array} samples  16 kHz sound, up to 30 seconds
   * @param {string} [lang]         the language's two-letter code, if it's known
   * @returns {Promise<string>} what was said
   */
  async transcribe(samples, lang = '') {
    const { ort, g } = this;
    const features = new ort.Tensor('float32', logMel(samples), [1, N_MELS, FRAMES]);
    const { last_hidden_state: hidden } = await this.encoder.run({ input_features: features });
    const language = g.lang_to_id[`<|${lang}|>`] ?? await this.detect(hidden);
    const prompt = [g.decoder_start_token_id, language, g.task_to_id.transcribe, g.no_timestamps_token_id];
    // Speech runs at a few words a second, so anything far longer is the model repeating itself.
    const limit = Math.min(224, Math.ceil(samples.length / SAMPLE_RATE) * 8 + 16);
    const eot = g.eos_token_id;
    const words = [];
    let input = prompt;
    let memory = null;
    while (words.length < limit) {
      const step = await this.step(input, hidden, memory);
      memory = step.memory;
      let best = eot;
      let score = -Infinity;
      for (let id = 0; id < g.no_timestamps_token_id; id++) {
        if (this.suppress.has(id) || step.scores[id] <= score) continue;
        if (!words.length && g.begin_suppress_tokens.includes(id)) continue;
        if (id > eot) continue;
        score = step.scores[id];
        best = id;
      }
      if (best === eot) break;
      words.push(best);
      input = [best];
    }
    return this.text(words);
  }

  text(ids) {
    const bytes = [];
    for (const id of ids) for (const ch of this.tokens[id] ?? '') if (this.bytes.has(ch)) bytes.push(this.bytes.get(ch));
    return new TextDecoder().decode(Uint8Array.from(bytes)).trim();
  }
}

module.exports = { Whisper, logMel, melFilters, SAMPLE_RATE };
