// Export as audio (3.5): a document read by the natural voices into an MP3, or an audiobook with a chapter for
// each heading. It runs in the background, so a whole book doesn't hold up the app: sound is encoded and written
// to disk a sentence at a time, and the finished file only appears at the end.
import { collectSentences } from './read-ui.js';
import { m4bStart, m4bEnd, id3 } from './m4b.js';
import { modelLang, guessLang, applyPronunciation } from '../main/voice-text.js';

const $ = (id) => document.getElementById(id);
const NATURAL = 'natural:';
const GAP_SECONDS = 0.35;               // between sentences
const HEADING_GAP_SECONDS = 0.9;        // before a heading
const AAC_BITRATE = 96000;
const MP3_KBPS = 64;
const WRITE_BYTES = 1 << 20;

/** Sound goes to disk in large pieces, in order. */
function diskWriter(api, id) {
  let held = [];
  let size = 0;
  let queue = Promise.resolve();
  const flush = () => {
    if (!size) return queue;
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of held) { out.set(p, at); at += p.length; }
    held = [];
    size = 0;
    queue = queue.then(() => api.audioWrite(id, out));
    return queue;
  };
  return {
    add(bytes) {
      held.push(bytes);
      size += bytes.length;
      return size >= WRITE_BYTES ? flush() : queue;
    },
    flush,
  };
}

let lameLoaded = null;
/** The MP3 encoder is LAME, kept in a file of its own (see THIRD_PARTY_NOTICES.md). */
function loadLame() {
  lameLoaded ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'lame.min.js' });
    s.onload = () => resolve(window.lamejs);
    s.onerror = () => reject(new Error('The MP3 encoder couldn’t be loaded'));
    document.head.append(s);
  });
  return lameLoaded;
}

async function mp3File(disk, meta) {
  const lame = await loadLame();
  await disk.add(id3(meta));
  let encoder = null;
  return {
    add(samples, rate) {
      encoder ??= new lame.Mp3Encoder(1, rate, MP3_KBPS);
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
      return disk.add(Uint8Array.from(encoder.encodeBuffer(pcm)));
    },
    chapter() {},
    async finish() {
      if (encoder) await disk.add(Uint8Array.from(encoder.flush()));
      await disk.flush();
      return { tail: new Uint8Array(0), patches: [] };
    },
  };
}

async function m4bFile(disk, meta) {
  const start = m4bStart();
  await disk.add(start.head);
  const frames = [];
  const chapters = [];
  let asc = null;
  let encoder = null;
  let failed = null;
  let rate = 0;
  let position = 0;
  let writing = Promise.resolve();
  const open = (r) => {
    rate = r;
    encoder = new AudioEncoder({
      output(chunk, info) {
        if (info?.decoderConfig?.description) asc = new Uint8Array(info.decoderConfig.description.buffer ?? info.decoderConfig.description);
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        frames.push(bytes.length);
        writing = writing.then(() => disk.add(bytes));
      },
      error(err) { failed = err; },
    });
    encoder.configure({ codec: 'mp4a.40.2', sampleRate: r, numberOfChannels: 1, bitrate: AAC_BITRATE, aac: { format: 'aac' } });
  };
  return {
    async add(samples, r) {
      if (failed) throw failed;
      if (!encoder) open(r);
      const data = new AudioData({ format: 'f32', sampleRate: r, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((position / r) * 1e6), data: samples });
      encoder.encode(data);
      data.close();
      position += samples.length;
      while (encoder.encodeQueueSize > 8) await new Promise((done) => { setTimeout(done, 10); });
      await writing;
    },
    chapter(title) { chapters.push({ title, sample: position }); },
    async finish() {
      await encoder.flush();
      await writing;
      encoder.close();
      if (failed) throw failed;
      await disk.flush();
      const end = m4bEnd({ rate, frames, asc, bitrate: AAC_BITRATE, chapters, audioAt: start.audioAt, ...meta });
      return { tail: end.tail, patches: [{ at: start.sizeAt, bytes: end.mdatSize }] };
    },
  };
}

export function createAudioUi({ api, toast, activeTab, settings, reading }) {
  const dlg = $('audio-dlg');
  const job = $('audio-job');
  const voice = $('audio-voice');
  let natural = null;
  let aacWorks = false;
  let running = null;           // { cancelled }

  function formats() {
    const m4b = $('audio-format').querySelector('[value=m4b]');
    m4b.disabled = !aacWorks;
    $('audio-no-m4b').hidden = aacWorks;
    if (!aacWorks) $('audio-format').value = 'mp3';
  }

  function voices() {
    voice.replaceChildren(...natural.voices.map((id) => new Option(`${id[0] === 'F' ? 'Female' : 'Male'} voice ${id[1]}`, id)));
    const want = settings().readAloud?.voice || '';
    if (want.startsWith(NATURAL)) voice.value = want.slice(NATURAL.length);
    $('audio-need-voices').hidden = natural.installed;
    $('audio-ready').hidden = !natural.installed;
    $('audio-go').disabled = !natural.installed;
  }

  async function open() {
    const tab = activeTab();
    if (!tab || tab.doc.compare || tab.doc.needsPassword) { toast('Open a document first'); return; }
    if (running) { toast('Audio is already being made'); return; }
    natural = await api.voiceStatus();
    aacWorks = await AudioEncoder?.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: AAC_BITRATE }).then((r) => r.supported, () => false);
    formats();
    voices();
    dlg.showModal();
  }

  /** One sentence's sound, made again if read aloud stopped the voice in the meantime. */
  async function sound(line, lang, voiceId, speed, cancelled) {
    for (;;) {
      if (cancelled()) return null;
      const res = await api.voiceSpeak({ text: line, lang, voice: voiceId, speed, steps: 8 });
      if (res?.error !== 'cancelled') {
        if (!res || res.error) throw new Error(res?.error || 'The voice stopped');
        return res;
      }
    }
  }

  async function make(tab, format, voiceId) {
    const items = collectSentences(tab.el).map((it) => ({ text: it.text, heading: it.heading, level: Number(it.block.tagName?.[1]) || 0, title: it.heading ? it.block.textContent.trim() : '' }));
    if (!items.length) { toast('There’s no text to read here'); return; }
    const lang = modelLang(tab.el.lang || guessLang(items.slice(0, 80).map((it) => it.text).join(' ')) || 'en');
    if (!lang) { toast('The natural voices don’t read this language yet'); return; }
    const front = tab.result?.frontMatter || {};
    const title = String(front.title || tab.result?.title || tab.doc.name || 'Untitled');
    const meta = { title, author: String(front.author || '') };
    const started = await api.audioBegin({ format, name: `${(tab.doc.name || 'Audio').replace(/\.[^.]+$/, '')}.${format}` });
    if (!started?.id) return;

    const state = { cancelled: false };
    running = state;
    job.hidden = false;
    const cancelled = () => state.cancelled;
    const say = (text) => { $('audio-job-text').textContent = text; };
    say('Making audio… 0%');
    const list = await api.sayRules(tab.doc.path || null);
    const words = items.map((it) => applyPronunciation(it.text, list));
    const speed = 1.05 * (Number(settings().readAloud?.rate) || 1);
    // Chapters are the top two levels of heading the document uses.
    const levels = [...new Set(items.filter((it) => it.heading).map((it) => it.level))].sort().slice(0, 2);
    const total = words.reduce((n, w) => n + w.length, 0);
    let done = 0;
    let lastTitle = null;
    try {
      const disk = diskWriter(api, started.id);
      const file = format === 'mp3' ? await mp3File(disk, meta) : await m4bFile(disk, meta);
      const t0 = performance.now();
      const ahead = new Map();
      const get = (i) => {
        if (i < words.length && !ahead.has(i)) ahead.set(i, sound(words[i], lang, voiceId, speed, cancelled));
        return ahead.get(i);
      };
      for (let i = 0; i < words.length && !state.cancelled; i++) {
        get(i);
        get(i + 1);
        const res = await get(i);
        ahead.delete(i);
        if (!res) break;
        const it = items[i];
        if (it.heading && i) await file.add(new Float32Array(Math.round(res.sampleRate * HEADING_GAP_SECONDS)), res.sampleRate);
        if (it.heading && levels.includes(it.level) && it.title !== lastTitle) { file.chapter(it.title); lastTitle = it.title; }
        await file.add(res.samples, res.sampleRate);
        await file.add(new Float32Array(Math.round(res.sampleRate * GAP_SECONDS)), res.sampleRate);
        done += words[i].length;
        const part = done / total;
        const left = ((performance.now() - t0) / part) * (1 - part) / 60000;
        say(`Making audio… ${Math.floor(part * 100)}%${left >= 1 ? ` (about ${Math.ceil(left)} min left)` : ''}`);
      }
      if (state.cancelled) { await api.audioAbort(started.id); toast('Audio export cancelled'); return; }
      const { tail, patches } = await file.finish();
      const saved = await api.audioFinish(started.id, { tail, patches });
      toast(saved?.ok ? `Saved ${saved.name}` : 'The audio couldn’t be saved');
    } catch (err) {
      await api.audioAbort(started.id);
      toast(`The audio couldn’t be made: ${err.message}`);
    } finally {
      running = null;
      job.hidden = true;
    }
  }

  $('audio-get-voices').onclick = async () => {
    natural = await api.voiceInstall();
    voices();
    reading().refreshVoices?.();
    if (natural.error) toast(natural.error);
  };
  $('audio-cancel').onclick = () => dlg.close();
  $('audio-go').onclick = () => {
    const tab = activeTab();
    dlg.close();
    if (tab) make(tab, $('audio-format').value, voice.value);
  };
  $('audio-job-cancel').onclick = () => {
    if (!running) return;
    running.cancelled = true;
    $('audio-job-text').textContent = 'Stopping…';
  };

  return { open };
}
