// Dictation (3.5): speak and the editor types. Sound from the microphone is cut at the pauses and worked out
// on this computer (src/main/dictation.js), one stretch at a time, so words appear while you carry on talking.
const $ = (id) => document.getElementById(id);

const RATE = 16000;
const BLOCK = 2048;
const PAUSE_MS = 700;           // this long without speech ends a stretch
const LEAD_MS = 300;            // sound kept from just before speech was noticed
const MIN_SPEECH_MS = 250;
const MAX_MS = 25000;           // the model reads 30 seconds at most

/** Sounds the model writes in brackets instead of words, such as [BLANK_AUDIO] or (music). */
const noise = (text) => /^[[(♪*].*[\])♪*]$/s.test(text.trim());

export function createDictateUi({ api, toast, activeTab, settings }) {
  const button = $('fmt-dictate');
  const status = $('dictate-status');
  let mic = null;               // { stream, audio, node }
  let target = null;            // the tab being typed into
  let queue = Promise.resolve();
  let waiting = 0;

  const say = (text) => { status.textContent = text; };
  const heard = () => { if (mic) say(waiting ? 'Writing…' : 'Listening…'); else if (!waiting) say(''); };

  function send(blocks) {
    const samples = new Float32Array(blocks.length * BLOCK);
    blocks.forEach((b, i) => samples.set(b, i * BLOCK));
    const tab = target;
    const lang = (tab?.el.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
    waiting++;
    heard();
    queue = queue.then(async () => {
      const res = await api.dictateHear({ samples, lang });
      waiting--;
      if (res?.error) toast(`Dictation stopped: ${res.error}`);
      else if (res?.text && !noise(res.text) && tab?.editing) {
        // A space after what's there already, unless the cursor is at the start of a line.
        const { state } = tab.editor.view;
        const before = state.sliceDoc(Math.max(0, state.selection.main.from - 1), state.selection.main.from);
        tab.editor.insert(`${before && !/\s/.test(before) ? ' ' : ''}${res.text}`);
      }
      heard();
    });
  }

  function listen(audio, source) {
    const node = audio.createScriptProcessor(BLOCK, 1, 1);
    const blockMs = (BLOCK / RATE) * 1000;
    let blocks = [];
    let speech = 0;
    let quiet = 0;
    let floor = 0.002;
    const flush = () => {
      if (speech * blockMs >= MIN_SPEECH_MS) send(blocks);
      blocks = [];
      speech = 0;
      quiet = 0;
    };
    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.sqrt(sum / data.length);
      window.__dictation = { blocks: (window.__dictation?.blocks || 0) + 1, peak: Math.max(window.__dictation?.peak || 0, level), floor };   // read by the end-to-end tests
      const loud = level > Math.max(0.006, floor * 3);
      if (!loud) floor = floor * 0.95 + level * 0.05;
      blocks.push(Float32Array.from(data));
      if (loud) { speech++; quiet = 0; } else if (speech) quiet++;
      if (!speech) blocks = blocks.slice(-Math.ceil(LEAD_MS / blockMs));
      else if (quiet * blockMs >= PAUSE_MS || blocks.length * blockMs >= MAX_MS) flush();
    };
    source.connect(node);
    node.connect(audio.destination);
    return { node, flush };
  }

  async function start() {
    const tab = activeTab();
    if (!tab?.editing) { toast('Click Edit first, then start dictation'); return; }
    let model = await api.dictateStatus();
    if (!model.installed) {
      say('Downloading…');
      model = await api.dictateInstall();
      say('');
      if (!model.installed) { if (model.error) toast(model.error); return; }
    }
    let stream;
    try {
      const device = settings().audioInput;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, ...(device ? { deviceId: { ideal: device } } : {}) } });
    } catch {
      toast('The microphone couldn’t be opened. Check that one is plugged in and allowed in your system’s privacy settings');
      return;
    }
    const audio = new AudioContext({ sampleRate: RATE });
    // The download question can come between the click and here, and a context made without a click can start paused.
    if (audio.state === 'suspended') await audio.resume().catch(() => {});
    const source = audio.createMediaStreamSource(stream);
    mic = { stream, audio, ...listen(audio, source) };
    target = tab;
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    fillInputs();                 // device names appear once the microphone has been allowed
    heard();
    tab.editor.focus();
  }

  function stop() {
    if (!mic) return;
    const { stream, audio, node, flush } = mic;
    mic = null;
    flush();
    node.onaudioprocess = null;
    for (const t of stream.getTracks()) t.stop();
    audio.close();
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
    heard();
  }

  async function fillInputs() {
    const list = $('pref-input');
    const found = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter((d) => d.kind === 'audioinput' && !['default', 'communications'].includes(d.deviceId));
    list.replaceChildren(new Option('Computer’s default', ''), ...found.map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
    const want = settings().audioInput || '';
    list.value = found.some((d) => d.deviceId === want) ? want : '';
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', fillInputs);
  fillInputs();
  $('pref-input').onchange = async (e) => {
    await api.setSettings({ audioInput: e.target.value });
    if (mic) { stop(); start(); }
  };
  button.onclick = () => (mic ? stop() : start());
  api.onDictateProgress?.((s) => { if (s.downloading) say(`Downloading… ${Math.floor((100 * s.done) / (s.total || 1))}%`); });

  return {
    toggle: () => (mic ? stop() : start()),
    stop,
    tabChanged() { if (mic && activeTab() !== target) stop(); },
  };
}
