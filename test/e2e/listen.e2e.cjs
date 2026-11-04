// End-to-end test for v3.5 "Listen & speak": the read-aloud bar stands out and moves, reading follows the
// slides, the sound can go to a chosen device, and the new themes and fonts work. Speech is a local stand-in.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-listen-'));
const doc = path.join(tmp, 'talk.md');
fs.writeFileSync(doc, '# The talk\n\nFirst slide here. It has two sentences.\n\n---\n\n## Second\n\nThe middle part. Read on.\n\n---\n\n## Third\n\nThe last part.\n');

// A second of sound and two of silence, as the microphone stand-in.
const sound = path.join(tmp, 'mic.wav');
{
  const rate = 16000;
  const pcm = Buffer.alloc(rate * 3 * 2);
  for (let i = 0; i < rate; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 300 * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(sound, Buffer.concat([head, pcm]));
}

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, doc, '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${sound}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_FAKE_TTS: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForSelector('.tab.active');
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const setting = (key) => win.evaluate((k) => window.reader.init().then((r) => r.settings[k]), key);
  const count = () => win.textContent('#present-count');
  const said = () => win.evaluate(() => window.__spoken.at(-1));
  const next = () => win.evaluate(() => window.__last.onend());
  const marked = () => win.evaluate(() => {
    const h = CSS.highlights.get('nmr-speak');
    if (!h) return null;
    const [r] = [...h];
    return { text: r.toString(), onSlide: !!r.startContainer.parentElement.closest('#present-slide') };
  });

  await win.evaluate(() => {
    window.__spoken = [];
    window.__nmrSpeech = { speak(u) { window.__spoken.push(u.text); window.__last = u; }, cancel() {}, getVoices: () => [] };
  });

  await step('the bar shows up against the page in every theme', async () => {
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    for (const theme of ['light', 'sepia', 'mist', 'yellow', 'dark', 'forest', 'dusk', 'blue', 'red', 'contrast']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      const ratio = await win.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/[\d.]+/g).map(Number).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const page = getComputedStyle(document.querySelector('.page:not([hidden])')).backgroundColor;
        const bar = getComputedStyle(document.getElementById('speak-bar')).backgroundColor;
        const [a, b] = [lum(page), lum(bar)].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
      assert.ok(ratio >= 4.5, `the bar and the page in ${theme}: ${ratio.toFixed(2)}`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  });

  await step('the bar can be dragged, stays put, and goes back on a double-click', async () => {
    const box = await win.locator('#speak-grip').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.mouse.move(220, 180, { steps: 5 });
    await win.mouse.up();
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.speakBar));
    const moved = await win.locator('#speak-bar').boundingBox();
    assert.ok(Math.abs(moved.y - 180) < 40 && moved.x < 260, `moved to ${moved.x}, ${moved.y}`);

    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    const again = await win.locator('#speak-bar').boundingBox();
    assert.ok(Math.abs(again.y - moved.y) < 2, 'it opens where it was left');

    await win.focus('#speak-grip');
    await win.keyboard.press('ArrowDown');
    await win.waitForFunction((y) => document.getElementById('speak-bar').getBoundingClientRect().top > y + 10, again.y);

    await win.dblclick('#speak-grip');
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.speakBar === null));
    const home = await win.locator('#speak-bar').boundingBox();
    assert.ok(home.y > moved.y + 100, `back at the bottom: ${JSON.stringify([home, moved, await win.getAttribute('#speak-bar', 'style'), await win.evaluate(() => innerHeight)])}`);
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
  });

  await step('reading in a presentation shows each sentence and turns the slides by itself', async () => {
    await menu('present');
    await win.waitForSelector('#present:not([hidden])');
    assert.equal(await count(), '1 / 3');
    await win.keyboard.press('r');
    await win.waitForSelector('#speak-bar:not([hidden])');
    assert.equal(await win.isVisible('#speak-play'), true);
    assert.equal(await win.evaluate(() => {
      const r = document.getElementById('speak-play').getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).closest('#speak-bar');
    }), true, 'the bar is above the slide');
    assert.equal(await said(), 'The talk');
    assert.deepEqual(await marked(), { text: 'The talk', onSlide: true });

    await next();
    await next();
    assert.equal(await said(), 'It has two sentences.');
    assert.deepEqual(await marked(), { text: 'It has two sentences.', onSlide: true });
    assert.equal(await count(), '1 / 3');
    await next();
    assert.equal(await count(), '2 / 3', 'the slide turned with the reading');
    assert.deepEqual(await marked(), { text: 'Second', onSlide: true });
  });

  await step('moving to another slide brings the reading along, and pausing holds it', async () => {
    await win.keyboard.press('ArrowRight');
    assert.equal(await count(), '3 / 3');
    assert.equal(await said(), 'Third');
    await win.keyboard.press('ArrowLeft');
    assert.equal(await count(), '2 / 3');
    assert.equal(await said(), 'Second');
    await win.click('#speak-play');
    await win.waitForFunction(() => document.getElementById('speak-status').textContent === 'Paused');
    await win.focus('#present');
    await win.keyboard.press('ArrowRight');
    assert.equal(await count(), '3 / 3');
    assert.equal(await said(), 'Second', 'nothing is said while paused');
    await win.click('#speak-play');
    await win.waitForFunction(() => window.__spoken.at(-1) === 'Third');
  });

  await step('leaving the slides carries on reading on the page', async () => {
    await win.focus('#present');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#present', { state: 'hidden' });
    assert.equal(await win.isVisible('#speak-bar'), true);
    assert.deepEqual(await marked(), { text: 'Third', onSlide: false });
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
  });

  await step('a presentation that starts during reading opens on the sentence being read', async () => {
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    for (let i = 0; i < 4; i++) await next();
    const now = await said();
    await menu('present');
    await win.waitForSelector('#present:not([hidden])');
    assert.equal(await count(), '2 / 3');
    assert.equal((await marked()).text, now);
    await win.focus('#present');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#present', { state: 'hidden' });
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
  });

  await step('Preferences offers the sound devices and keeps the choice', async () => {
    await menu('preferences');
    await win.waitForSelector('#prefs-dlg[open]');
    await win.click('.prefs-nav [data-pane=voices]');
    assert.equal(await win.isVisible('#pref-output'), true);
    const options = await win.$$eval('#pref-output option', (o) => o.map((x) => x.textContent));
    assert.equal(options[0], 'Computer’s default');
    await win.evaluate(() => {
      const list = document.getElementById('pref-output');
      list.append(new Option('Test speakers', 'test-device'));
      list.value = 'test-device';
      list.dispatchEvent(new Event('change'));
    });
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.audioOutput === 'test-device'));
    await win.evaluate(() => window.reader.setSettings({ audioOutput: '' }));
    await win.click('#prefs-done');
  });

  await step('the pronunciation list changes what is said, not what is shown', async () => {
    await menu('pronunciation');
    await win.waitForSelector('#say-dlg[open]');
    const row = win.locator('.say-row').first();
    await row.locator('input').nth(0).fill('talk');
    await row.locator('input').nth(1).fill('tawk');
    await win.click('#say-add');
    const folder = await win.$eval('#say-scope-folder', (o) => o.textContent);
    assert.match(folder, /rt-listen-/);
    await win.locator('.say-row').nth(1).locator('input').nth(0).fill('');
    await win.click('#say-done');
    await win.waitForFunction(() => !document.querySelector('#say-dlg[open]'));
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    assert.equal(await said(), 'The tawk');
    assert.equal((await marked()).text, 'The talk');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });

    await menu('pronunciation');
    await win.waitForSelector('#say-dlg[open]');
    assert.equal(await win.locator('.say-row input').first().inputValue(), 'talk', 'the list is kept');
    await win.selectOption('#say-scope', 'folder');
    await win.locator('.say-row input').nth(0).fill('sentences');
    await win.locator('.say-row input').nth(1).fill('lines');
    await win.click('#say-done');
    await win.waitForFunction(() => !document.querySelector('#say-dlg[open]'));
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    await next();
    await next();
    assert.equal(await said(), 'It has two lines.');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
  });

  await step('the Glass look frosts any theme, and never reaches High Contrast', async () => {
    await win.click('#btn-theme');
    await win.click('#theme-menu [data-key="surface"] [data-value="glass"]');
    await win.waitForFunction(() => document.documentElement.dataset.surface === 'glass');
    const look = () => win.evaluate(() => ({
      toolbar: getComputedStyle(document.querySelector('.toolbar')).backdropFilter,
      page: getComputedStyle(document.querySelector('.page:not([hidden])')).backgroundColor,
    }));
    for (const theme of ['light', 'dark', 'red']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      const now = await look();
      assert.match(now.toolbar, /blur\(22px\)/, theme);
      assert.match(now.page, /color\(srgb .* \/ 0\.86\)|rgba\(.*0\.86\)/, `${theme}: ${now.page}`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'contrast' }));
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'contrast');
    assert.equal(await win.evaluate(() => getComputedStyle(document.querySelector('.page:not([hidden])')).backgroundColor), 'rgb(0, 0, 0)');
    await win.evaluate(() => window.reader.setSettings({ theme: 'light', surface: 'solid' }));
    await win.waitForFunction(() => document.documentElement.dataset.surface === 'solid');
    await win.keyboard.press('Escape');
  });

  await step('dictation needs Edit, asks before the download, and types what it hears', async () => {
    await menu('dictate');
    await win.waitForFunction(() => /Click Edit first/.test(document.body.textContent));
    await app.evaluate(({ dialog }) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (...args) => { const o = args.at(-1); globalThis.__asked.push(o.message); return { response: 0 }; };
    });
    await menu('toggle-edit');
    await win.evaluate(() => {
      for (const b of document.querySelectorAll('dialog[open] .big-btn')) b.click();
    });
    await win.waitForSelector('#fmt-dictate');
    await win.waitForFunction(() => document.getElementById('fmt-dictate').offsetParent);
    await win.click('#fmt-dictate');
    await win.waitForFunction(() => document.getElementById('fmt-dictate').classList.contains('active'), null, { timeout: 15000 });
    assert.deepEqual(await app.evaluate(() => globalThis.__asked.filter((m) => /dictation/i.test(m))), ['Download dictation?']);
    await win.waitForFunction(() => /I said \d+ seconds/.test(document.querySelector('.cm-content').textContent), null, { timeout: 20000 });
    await win.click('#fmt-dictate');
    await win.waitForFunction(() => !document.getElementById('fmt-dictate').classList.contains('active'));
    await win.keyboard.press('Control+z');
    await menu('toggle-edit');
    await win.evaluate(() => { for (const b of document.querySelectorAll('dialog[open] button')) if (/Discard|Don.t Save/i.test(b.textContent)) b.click(); });
  });

  await step('audio export makes real files, with chapters, and leaves nothing behind when cancelled', async () => {
    const save = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    const decode = (file) => win.evaluate(async (bytes) => {
      const c = new AudioContext();
      const b = await c.decodeAudioData(Uint8Array.from(bytes).buffer);
      c.close();
      return b.duration;
    }, [...fs.readFileSync(file)]);
    const exportAs = async (format) => {
      await menu('export-audio');
      await win.waitForSelector('#audio-dlg[open]');
      if (await win.isVisible('#audio-get-voices')) await win.click('#audio-get-voices');
      await win.waitForFunction(() => !document.getElementById('audio-go').disabled);
      await win.selectOption('#audio-format', format);
      await win.click('#audio-go');
    };

    const mp3 = path.join(tmp, 'talk.mp3');
    await save(mp3);
    await exportAs('mp3');
    await win.waitForFunction(() => /Saved talk\.mp3/.test(document.body.textContent), null, { timeout: 60000 });
    assert.equal(fs.readFileSync(mp3).subarray(0, 3).toString(), 'ID3');
    const seconds = await decode(mp3);
    assert.ok(seconds > 3, `${seconds} seconds of MP3`);
    assert.ok(!fs.existsSync(`${mp3}.part`));

    const aac = await win.evaluate(() => AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: 96000 }).then((r) => r.supported, () => false));
    if (aac) {
      const book = path.join(tmp, 'talk.m4b');
      await save(book);
      await exportAs('m4b');
      await win.waitForFunction(() => /Saved talk\.m4b/.test(document.body.textContent), null, { timeout: 60000 });
      const bytes = fs.readFileSync(book);
      assert.equal(bytes.subarray(4, 12).toString('latin1'), 'ftypM4B ');
      for (const title of ['The talk', 'Second', 'Third']) assert.ok(bytes.includes(Buffer.from(title)), title);
      assert.ok(bytes.includes(Buffer.from('chpl')));
      const length = await decode(book);
      assert.ok(Math.abs(length - seconds) < 1, `the audiobook is ${length} seconds, the MP3 ${seconds}`);
    } else {
      console.log('   (no AAC encoder on this computer: audiobook skipped)');
    }

    const stopped = path.join(tmp, 'stopped.mp3');
    await save(stopped);
    // The stand-in voice is quick, so Cancel is pressed the moment the job appears.
    const pressed = win.evaluate(() => new Promise((done) => {
      const watch = setInterval(() => {
        if (document.getElementById('audio-job').hidden) return;
        clearInterval(watch);
        document.getElementById('audio-job-cancel').click();
        done();
      }, 1);
    }));
    await exportAs('mp3');
    await pressed;
    await win.waitForFunction(() => /Audio export cancelled/.test(document.body.textContent), null, { timeout: 20000 });
    assert.ok(!fs.existsSync(stopped) && !fs.existsSync(`${stopped}.part`), 'nothing is left');
  });

  await step('colour-safe colours replace red and green, and changes are marked without colour', async () => {
    const token = (n) => win.evaluate((x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim(), n);
    assert.equal(await token('--del-fill'), '#e03131');
    await menu('preferences');
    await win.waitForSelector('#prefs-dlg[open]');
    await win.click('.prefs-nav [data-pane=appearance]');
    await win.check('#pref-colorsafe');
    await win.waitForFunction(() => document.documentElement.dataset.colors === 'safe');
    assert.equal(await token('--del-fill'), '#d55e00');
    assert.equal(await token('--add-fill'), '#0072b2');
    assert.equal(await token('--chart-3'), '#009e73');
    const line = await win.evaluate(() => {
      const box = document.createElement('table');
      box.className = 'diff';
      box.innerHTML = '<tr><td><ins>a</ins><del>b</del></td></tr>';
      document.body.append(box);
      const [ins, del] = [box.querySelector('ins'), box.querySelector('del')].map((n) => getComputedStyle(n).textDecorationLine);
      box.remove();
      return { ins, del };
    });
    assert.deepEqual(line, { ins: 'underline', del: 'line-through' });
    await win.evaluate(() => window.reader.setSettings({ theme: 'dark' }));
    await win.waitForFunction(() => document.documentElement.dataset.tone === 'dark');
    assert.equal(await token('--del-text'), '#ffa45c');
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
    await win.uncheck('#pref-colorsafe');
    await win.waitForFunction(() => document.documentElement.dataset.colors === 'normal');
    await win.click('#prefs-done');
  });

  await step('the fonts change the page and its headings', async () => {
    await win.click('#btn-theme');
    const fonts = await win.$$eval('#pop-font option', (o) => o.map((x) => x.value));
    assert.ok(fonts.length >= 12, `${fonts.length} fonts`);
    for (const want of ['times', 'georgia', 'century']) assert.ok(fonts.includes(want), want);
    await win.selectOption('#pop-font', 'times');
    await win.waitForFunction(() => document.documentElement.dataset.font === 'times');
    const look = await win.evaluate(() => {
      const page = document.querySelector('.page:not([hidden]) .markdown-body') || document.querySelector('.page:not([hidden])');
      return [getComputedStyle(page).fontFamily, getComputedStyle(page.querySelector('h1')).fontFamily];
    });
    assert.match(look[0], /Times New Roman/);
    assert.match(look[1], /Times New Roman/);
    await win.selectOption('#pop-font', 'courier');
    await win.waitForFunction(() => /Courier/.test(getComputedStyle(document.querySelector('.page:not([hidden]) h1')).fontFamily));
    assert.equal(await setting('font'), 'courier');
    const word = path.join(tmp, 'talk.docx');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, word);
    await win.keyboard.press('Escape');
    await menu('export-docx');
    await win.waitForFunction(() => /Saved|Exported/.test(document.body.textContent), null, { timeout: 30000 });
    const styles = strFromU8(unzipSync(fs.readFileSync(word))['word/styles.xml']);
    assert.match(styles, /Courier New/, 'Word uses the font');
    await win.click('#btn-theme');
    await win.selectOption('#pop-font', 'sans');
    await win.keyboard.press('Escape');
  });

  await app.close();
  console.log('listen e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
