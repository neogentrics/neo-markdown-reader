// End-to-end test for v3.2 "Natural voices": getting them (the app asks first, with the size and the
// licence), reading with one sentence by sentence while the next is made ahead, pausing, a language they
// don't speak, and removing them. NMR_FAKE_TTS stands in for the 400 MB model: nothing is downloaded and
// the voice process makes a tone instead of speech. Audio playback is replaced by window.__nmrAudio.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-voices-'));
const doc = path.join(tmp, 'story.md');
fs.writeFileSync(doc, '# The lighthouse\n\nThe keeper climbed the stairs every night. The lamp was old, but it still turned.\n\n## Morning\n\nShips passed the rocks safely. Nobody thanked the lamp, and it did not mind.\n');
const zh = path.join(tmp, 'zh.md');
fs.writeFileSync(zh, '---\nlang: zh\n---\n# 灯塔\n\n守灯人每晚都爬上楼梯。\n');
const profile = path.join(tmp, 'profile');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, doc, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_FAKE_TTS: '1' },
  });
  await app.evaluate(({ dialog }) => {
    global.__boxes = [];
    global.__answers = [];
    dialog.showMessageBox = async (_w, o) => { global.__boxes.push(o); return { response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) }; };
  });
  const answer = (...r) => app.evaluate((_e, list) => { global.__answers.push(...list); }, r);
  const boxes = () => app.evaluate(() => global.__boxes.splice(0));
  const menu = (id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.page:not([hidden]) h1');
  await win.evaluate(() => {
    // The computer's own voice: records what it's asked to say.
    window.__spoken = [];
    window.__nmrSpeech = { speak(u) { window.__spoken.push(u.text); window.__last = u; }, cancel() {}, getVoices: () => [] };
    // Audio playback: records what it's given and "plays" it in 40 ms.
    window.__played = [];
    window.__nmrAudio = {
      play(samples, sampleRate) {
        window.__played.push({ n: samples.length, sampleRate, float: samples instanceof Float32Array });
        let done;
        const ended = new Promise((r) => { done = r; });
        const t = setTimeout(done, 40);
        return { ended, stop: () => { clearTimeout(t); done(); } };
      },
    };
  });

  await step('the voice list offers natural voices before they are downloaded', async () => {
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    await win.click('#speak-play');                       // pause the computer's voice
    await win.waitForFunction(() => document.getElementById('speak-status').textContent === 'Paused');
    const opts = await win.$$eval('#speak-voice option', (o) => o.map((x) => x.value));
    assert.ok(opts.includes('natural:get'));
    assert.deepEqual(await win.$$eval('#speak-voice optgroup', (g) => g.map((x) => x.label)), ['Natural voices (offline)', 'This computer’s voices']);
  });

  await step('choosing them asks first; Cancel downloads nothing', async () => {
    await answer(2);
    await win.selectOption('#speak-voice', 'natural:get');
    await win.waitForFunction(() => document.getElementById('speak-voice').value === '');
    const [box] = await boxes();
    assert.equal(box.message, 'Download the natural voices?');
    assert.match(box.detail, /About \d+ MB, downloaded once/);
    assert.match(box.detail, /OpenRAIL-M license/);
    assert.equal(fs.existsSync(path.join(profile, 'voices', 'supertonic-3', 'installed.json')), false);
  });

  await step('Download gets them, and the first natural voice is chosen', async () => {
    await answer(0);
    await win.selectOption('#speak-voice', 'natural:get');
    await win.waitForFunction(() => document.getElementById('speak-voice').value === 'natural:F1', null, { timeout: 15000 });
    assert.deepEqual((await boxes()).map((b) => b.message), ['Download the natural voices?']);
    assert.ok(fs.existsSync(path.join(profile, 'voices', 'supertonic-3', 'installed.json')));
    const names = await win.$$eval('#speak-voice optgroup:first-child option', (o) => o.map((x) => x.textContent));
    assert.equal(names.length, 11);
    assert.equal(names[0], 'Female voice 1');
    assert.equal(names[5], 'Male voice 1');
    assert.equal(names[10], 'Remove natural voices…');
    assert.equal((await win.evaluate(() => window.reader.voiceStatus())).installed, true);
  });

  await step('reading with a natural voice: sentence by sentence, each made in the voice process, the next made ahead', async () => {
    const before = await win.evaluate(() => window.__spoken.length);
    await win.click('#speak-play');
    await win.waitForFunction(() => window.__played.length >= 3, null, { timeout: 15000 });
    const played = await win.evaluate(() => window.__played);
    assert.ok(played.every((p) => p.float && p.n > 0 && p.sampleRate === 44100));
    assert.equal(await win.evaluate(() => window.__spoken.length), before, 'the computer’s voice is silent');
    const last = await win.evaluate(() => window.__lastNatural);
    assert.ok(last.index >= 2);
    assert.ok(last.waited < 500, `sentence ${last.index} was made ahead (waited ${Math.round(last.waited)} ms)`);
    assert.equal(await win.evaluate(() => CSS.highlights.has('nmr-speak')), true, 'the sentence is highlighted');
    assert.equal((await win.evaluate(() => window.reader.setSettings({}))).readAloud.voice, 'natural:F1', 'the choice is remembered');
  });

  await step('pause and resume carry on from the same sentence', async () => {
    await win.click('#speak-play');
    await win.waitForFunction(() => document.getElementById('speak-status').textContent === 'Paused');
    const at = await win.evaluate(() => window.__played.length);
    await win.waitForTimeout(200);
    assert.equal(await win.evaluate(() => window.__played.length), at, 'nothing plays while paused');
    await win.click('#speak-play');
    await win.waitForFunction((n) => window.__played.length > n, at, { timeout: 10000 });
    await win.waitForFunction(() => document.getElementById('speak-status').textContent === 'Finished', null, { timeout: 15000 });
    await win.click('#speak-stop');
  });

  await step('a language the natural voices don’t speak is read by the computer’s voice instead', async () => {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zh);
    await menu('open');
    await win.waitForSelector('.page:not([hidden]) h1:has-text("灯塔")');
    await win.evaluate(() => { window.__spoken.length = 0; window.__played.length = 0; });
    await menu('read-aloud');
    await win.waitForSelector('.toast:has-text("don’t read this language")');
    await win.waitForFunction(() => window.__spoken.length > 0);
    assert.equal(await win.evaluate(() => window.__played.length), 0);
    await win.click('#speak-stop');
  });

  await step('Remove asks first, deletes the files, and goes back to the computer’s voice', async () => {
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    await answer(0);
    await win.selectOption('#speak-voice', 'natural:remove');
    await win.waitForFunction(() => [...document.getElementById('speak-voice').options].some((o) => o.value === 'natural:get'));
    const [box] = await boxes();
    assert.equal(box.message, 'Remove the natural voices?');
    assert.equal(await win.$eval('#speak-voice', (s) => s.value), '');
    assert.equal(fs.existsSync(path.join(profile, 'voices', 'supertonic-3')), false);
    await win.click('#speak-stop');
  });

  assert.deepEqual(errors, []);
  await app.close();
  console.log('voices e2e: all passed');
})().catch((err) => { console.error('voices e2e FAILED:', err); process.exit(1); });
