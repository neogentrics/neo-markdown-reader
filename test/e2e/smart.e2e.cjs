// End-to-end test for smart search (3.6), with a stand-in for the model (NMR_FAKE_TTS) that treats a few words as
// meaning the same thing: asking before downloading, reading a folder in the background, finding by meaning,
// related documents, keeping up with changes, and removing it all again.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-smart-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
const write = (name, text) => { const p = path.join(docs, name); fs.writeFileSync(p, text); return p; };
const garage = write('garage.md', '# Garage\n\nThe brakes on the old sedan need replacing before the trip.\n');
write('sub/shop.md', '# Shop\n\nA sedan with new brakes is safer on the road.\n');
write('pets.md', '# Pets\n\nA small kitten sleeps on the windowsill all afternoon.\n');
write('locked.mdlock', 'not really locked, and never to be read');

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };
/** Ask the app until it says yes. (waitForFunction takes an unfinished promise as a yes.) */
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    assert.ok(Date.now() < end, 'timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), garage],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_FAKE_TTS: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, folder) => {
    global.__asked = [];
    global.__answer = 1;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(o.message); return { response: global.__answer }; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, docs);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const asked = () => app.evaluate(() => global.__asked);
  const answer = (n) => app.evaluate((_e, v) => { global.__answer = v; }, n);
  const hits = () => win.$$eval('#search-results .search-file-head', (els) => els.map((e) => e.firstChild.textContent));
  const findFor = async (query) => {
    await win.fill('#folder-search', query);
    await win.press('#folder-search', 'Enter');
    await win.waitForFunction(() => !/^Searching/.test(document.getElementById('search-summary').textContent));
  };
  const box = '#search-meaning';
  await win.waitForSelector('.page:not([hidden]) h1');
  await menu('open-folder');
  await win.waitForFunction(() => document.querySelectorAll('.file-name').length >= 3);
  await menu('find-in-folder');
  await win.waitForSelector('#side-panel-search:not([hidden])');

  await step('exact search is unchanged, and related documents stay hidden', async () => {
    await findFor('automobile');
    assert.equal(await win.textContent('#search-summary'), 'No results.');
    assert.equal(await win.isChecked(box), false);
    assert.equal(fs.existsSync(path.join(profile, 'smart-search')), false, 'nothing is downloaded yet');
  });

  await step('turning it on asks first, and saying no changes nothing', async () => {
    await win.click(box);
    await win.waitForFunction(() => !document.getElementById('search-meaning').checked);
    assert.deepEqual(await asked(), ['Download smart search?']);
    assert.equal(fs.existsSync(path.join(profile, 'smart-search')), false);
  });

  await step('saying yes downloads it and reads the folder', async () => {
    await answer(0);
    await win.click(box);
    await win.waitForFunction(() => document.getElementById('search-results').textContent.includes('garage'), null, { timeout: 15000 });
    await win.waitForFunction(() => /Closest documents/.test(document.getElementById('search-summary').textContent), null, { timeout: 15000 });
  });

  await step('it finds documents by meaning, not exact words', async () => {
    await findFor('automobile');
    const list = await hits();
    assert.ok(list.slice(0, 2).includes('garage.md') && list.slice(0, 2).includes('shop.md'), list.join());
    assert.equal(list[list.length - 1], 'pets.md');
    assert.doesNotMatch(await win.textContent('#search-results'), /locked/);
    await findFor('feline');
    assert.equal((await hits())[0], 'pets.md');
  });

  await step('a result opens its document at the passage', async () => {
    await win.click('#search-results .search-hit');
    await win.waitForFunction(() => /Pets/.test(document.querySelector('.page:not([hidden])').textContent));
  });

  await step('related documents appear under the outline', async () => {
    await win.click('.tab >> text=garage');
    await menu('panel-outline');
    await win.waitForSelector('#related:not([hidden]) .backlink');
    const names = await win.$$eval('#related-list .backlink b', (els) => els.map((e) => e.textContent));
    assert.equal(names[0], 'shop');
    assert.ok(!names.includes('garage'));
    await win.click('#related-list .backlink');
    await win.waitForFunction(() => /Shop/.test(document.querySelector('.page:not([hidden])').textContent));
  });

  await step('new and changed documents are read as the folder changes', async () => {
    write('new.md', '# New\n\nA feline named Biscuit watches the birds.\n');
    await menu('find-in-folder');
    await until(() => win.evaluate(async () => (await window.reader.smartSearch('Biscuit')).results[0]?.name === 'new.md'));
  });

  await step('the index is kept between runs, with no words from the documents', async () => {
    const dir = path.join(profile, 'smart-search', 'multilingual-e5-small', 'indexes');
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    const raw = fs.readFileSync(path.join(dir, files[0])).toString('latin1');
    assert.match(raw, /garage\.md/);
    assert.doesNotMatch(raw, /brakes|windowsill|never to be read/);
    assert.doesNotMatch(raw, /locked\.mdlock/);
  });

  await step('the choice is hidden while replacing, and comes back after', async () => {
    await win.click('#replace-toggle');
    assert.equal(await win.isVisible(box), false);
    await win.click('#replace-toggle');
    assert.equal(await win.isVisible(box), true);
  });

  await step('turning it off goes back to exact words', async () => {
    await win.click(box);
    await findFor('automobile');
    assert.equal(await win.textContent('#search-summary'), 'No results.');
    await until(() => win.evaluate(async () => (await window.reader.smartStatus()).enabled === false));
    await menu('panel-outline');
    await win.click('.tab >> text=garage');
    await win.waitForFunction(() => document.getElementById('related').hidden);
  });

  await step('removing the download takes the indexes with it, and asks first', async () => {
    await menu('find-in-folder');
    await win.waitForSelector('#side-panel-search:not([hidden])');
    await win.click(box);
    await until(() => win.evaluate(async () => (await window.reader.smartStatus()).enabled));
    await answer(1);
    await menu('smart-remove');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(fs.existsSync(path.join(profile, 'smart-search', 'multilingual-e5-small')), 'Cancel keeps it');
    await answer(0);
    await menu('smart-remove');
    await win.waitForFunction(() => !document.getElementById('search-meaning').checked);
    assert.equal(fs.existsSync(path.join(profile, 'smart-search', 'multilingual-e5-small')), false);
    assert.equal((await asked()).filter((m) => /Remove the smart search/.test(m)).length, 2);
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
