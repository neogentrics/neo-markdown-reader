// End-to-end test for 3.6.2: long documents in presentation mode, the mouse wheel on slides, and read aloud's skip
// buttons, on slides and on the page. A stand-in for the computer's voice says when each sentence is done.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-slides-'));
const doc = path.join(tmp, 'long.md');
const sentence = (n) => `Sentence number ${n} says something a little longer so that lines fill up.`;
const para = (from, count) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');
const list = Array.from({ length: 40 }, (_, i) => `- **Item ${i}:** the entry for number ${i}, with some words after it.`).join('\n');
const rows = Array.from({ length: 40 }, (_, i) => `| Era ${i} | What happened in era ${i} |`).join('\n');
fs.writeFileSync(doc, `# The long document

## A long section

${para(1, 4)}

${list}

${para(10, 40)}

| When | What |
| --- | --- |
${rows}

## II. A short section

${para(100, 2)}

${para(110, 2)}

## The last section

The first paragraph here. It has two sentences.

The very last paragraph.
`);

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, doc, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.page:not([hidden]) h1');
  await win.evaluate(() => {
    window.__spoken = [];
    window.__nmrSpeech = { speak(u) { window.__spoken.push(u.text); window.__last = u; }, cancel() {}, getVoices: () => [] };
  });
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const count = async () => (await win.textContent('#present-count')).split(' / ').map(Number);
  const said = () => win.evaluate(() => window.__spoken.at(-1));
  const onEnd = () => win.evaluate(() => window.__last.onend());
  const marked = () => win.evaluate(() => {
    const [r] = [...(CSS.highlights.get('nmr-speak') || [])];
    if (!r) return null;
    const box = r.getBoundingClientRect();
    return {
      text: r.toString().trim(), onSlide: !!r.startContainer.parentElement.closest('#present-slide'),
      inView: box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight,
    };
  });
  const overflow = () => win.evaluate(() => { const s = document.getElementById('present-slide'); return s.scrollHeight - s.clientHeight; });
  const slideText = () => win.evaluate(() => document.getElementById('present-slide').textContent);

  await step('a long section becomes several slides, none running off the bottom, at a readable size', async () => {
    await menu('present');
    await win.waitForSelector('#present:not([hidden])');
    const [, total] = await count();
    assert.ok(total >= 8, `${total} slides`);
    for (let i = 1; i <= total; i++) {
      assert.ok(await overflow() <= 1, `slide ${i} overflows by ${await overflow()}`);
      assert.ok(await win.evaluate(() => parseFloat(getComputedStyle(document.getElementById('present-slide')).fontSize)) >= 22);
      await win.keyboard.press('ArrowRight');
    }
    await win.keyboard.press('Home');
  });

  await step('nothing is lost or repeated across the slides', async () => {
    const [, total] = await count();
    let all = '';
    for (let i = 0; i < total; i++) { all += ` ${await slideText()}`; await win.keyboard.press('ArrowRight'); }
    await win.keyboard.press('Home');
    const once = (s) => all.split(s).length - 1;
    for (const n of [1, 4, 10, 25, 49, 100, 111]) assert.equal(once(`number ${n} says`), 1, `sentence ${n}`);
    for (const n of [0, 20, 39]) { assert.equal(once(`Item ${n}:`), 1, `list item ${n}`); assert.equal(all.match(new RegExp(`in era ${n}\\b`, 'g'))?.length, 1, `row ${n}`); }
    assert.equal(once('The very last paragraph.'), 1);
  });

  await step('a later part names the section it continues', async () => {
    await win.keyboard.press('ArrowRight');
    await win.keyboard.press('ArrowRight');
    assert.equal(await win.getAttribute('#present-slide', 'data-continues'), 'A long section');
    await win.keyboard.press('Home');
    assert.equal(await win.getAttribute('#present-slide', 'data-continues'), null);
  });

  await step('the mouse wheel turns the slides both ways', async () => {
    await win.mouse.move(500, 300);
    await win.mouse.wheel(0, 120);
    await win.waitForFunction(() => document.getElementById('present-count').textContent.startsWith('2 '));
    await new Promise((r) => setTimeout(r, 300));
    await win.mouse.wheel(0, 120);
    await win.waitForFunction(() => document.getElementById('present-count').textContent.startsWith('3 '));
    await new Promise((r) => setTimeout(r, 300));
    await win.mouse.wheel(0, -120);
    await win.waitForFunction(() => document.getElementById('present-count').textContent.startsWith('2 '));
  });

  await step('one fast spin turns one slide, not many', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const [before] = await count();
    for (let i = 0; i < 6; i++) await win.mouse.wheel(0, 120);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok((await count())[0] <= before + 2, `${before} → ${(await count())[0]}`);
    await win.keyboard.press('Home');
  });

  await step('read aloud follows every sentence through the split slides, always on screen', async () => {
    await win.keyboard.press('r');
    await win.waitForSelector('#speak-bar:not([hidden])');
    let last = 0;
    for (let i = 0; i < 140; i++) {
      const text = await said();
      const mark = await marked();
      assert.equal(mark?.onSlide, true, `sentence ${i}: ${text}`);
      assert.equal(mark.text, text.trim(), `the mark matches what’s being read at sentence ${i}`);
      assert.equal(mark.inView, true, `sentence ${i} is on screen: ${text}`);
      const [at] = await count();
      assert.ok(at >= last, 'slides only move forward');
      last = at;
      if (/number 49 says/.test(text)) break;
      await onEnd();
    }
    assert.match(await said(), /number 49 says/);
    assert.ok(last > 2);
  });

  await step('skipping by section in slides goes to it, and moves the slide', async () => {
    const [before] = await count();
    await win.click('#speak-next');
    assert.match(await said(), /^(?:II\.|A short section)/);
    assert.match((await marked()).text, /^II\./);
    assert.ok((await count())[0] > before);
    await win.click('#speak-next');
    assert.equal(await said(), 'The last section');
    await win.click('#speak-next');          // no section after it: the next paragraph, not the end of the document
    assert.equal(await said(), 'The first paragraph here.');
    await win.click('#speak-prev');
    assert.equal(await said(), 'The last section');
    await win.click('#speak-prev');
    assert.match(await said(), /^(?:II\.|A short section)/);
  });

  await step('skipping by paragraph goes one at a time, both ways', async () => {
    await win.click('#speak-next-para');
    assert.match(await said(), /number 100 says/);
    await onEnd();
    assert.match(await said(), /number 101 says/);
    await win.click('#speak-next-para');
    assert.match(await said(), /number 110 says/);
    await win.click('#speak-prev-para');
    assert.match(await said(), /number 100 says/);
    assert.equal((await marked()).onSlide, true);
  });

  await step('skipping while paused moves the slide and waits there', async () => {
    await win.click('#speak-play');
    const spoken = await win.evaluate(() => window.__spoken.length);
    const [before] = await count();
    await win.click('#speak-prev');
    await win.click('#speak-prev');
    assert.ok((await count())[0] < before, 'the slide moved');
    assert.equal((await marked()).onSlide, true);
    assert.equal(await win.evaluate(() => window.__spoken.length), spoken, 'nothing was read');
    await win.click('#speak-play');
    assert.equal(await said(), 'A long section');
  });

  await step('leaving and opening a slide while reading stays with the sentence', async () => {
    await win.click('#speak-stop');
    await win.focus('#present');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#present', { state: 'hidden' });
  });

  const scrollTop = () => win.evaluate(() => document.querySelector('.desk:not([hidden]), #desk')?.scrollTop ?? -1);

  await step('on the page, skipping moves the page to the sentence, playing or paused', async () => {
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    await win.click('#speak-next');
    await win.click('#speak-next');
    assert.match(await said(), /^(?:II\.|A short section)/);
    await win.waitForFunction(() => {
      const [r] = [...CSS.highlights.get('nmr-speak')];
      const box = r.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    const was = await scrollTop();
    await win.click('#speak-play');
    await win.click('#speak-prev');
    await win.waitForFunction(() => {
      const [r] = [...CSS.highlights.get('nmr-speak')];
      const box = r.getBoundingClientRect();
      return r.toString().trim() === 'A long section' && box.top >= 0 && box.bottom <= window.innerHeight;
    });
    assert.ok(await scrollTop() < was, 'the page scrolled while paused');
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
