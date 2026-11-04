// End-to-end test for v3.5 "Listen & speak": the read-aloud bar stands out and moves, reading follows the
// slides, the sound can go to a chosen device, and the new themes and fonts work. Speech is a local stand-in.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-listen-'));
const doc = path.join(tmp, 'talk.md');
fs.writeFileSync(doc, '# The talk\n\nFirst slide here. It has two sentences.\n\n---\n\n## Second\n\nThe middle part. Read on.\n\n---\n\n## Third\n\nThe last part.\n');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, doc, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1' },
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
    await win.selectOption('#pop-font', 'sans');
    await win.keyboard.press('Escape');
  });

  await app.close();
  console.log('listen e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
