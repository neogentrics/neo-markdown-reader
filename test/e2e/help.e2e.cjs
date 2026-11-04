// End-to-end test for v3.4: short menus, Preferences and the Help Center. Everything moved out of the
// menus must still work: from Preferences, with Find a Command, and with its shortcut.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-help-'));
const doc = path.join(tmp, 'a.md');
fs.writeFileSync(doc, '# Title\n\nSome text.\n');

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

  await step('the menus are short: no long lists, and no settings left in them', async () => {
    const shown = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items
      .filter((m) => m.submenu && m.visible !== false)
      .map((m) => ({ label: m.label.replace(/&/g, ''), items: m.submenu.items.filter((i) => i.visible && i.type !== 'separator').map((i) => i.label) })));
    for (const m of shown) assert.ok(m.items.length <= 20, `${m.label} has ${m.items.length} items`);
    const all = shown.flatMap((m) => m.items);
    for (const gone of ['Theme', 'Language', 'Add-ons…', 'Sync Between Computers…', 'Editing Permissions…', 'Allow Running Code Blocks', 'Open Backups Folder']) assert.ok(!all.includes(gone), gone);
    assert.ok(all.includes('Preferences…'));
    assert.ok(all.includes('Help Center'));
  });

  await step('everything moved is still found by name, and keeps its shortcut setting', async () => {
    const list = await win.evaluate(() => window.reader.listCommands());
    const labels = list.map((c) => c.label);
    for (const want of ['Sync Between Computers…', 'Add-ons…', 'Editing Permissions…', 'Connect Claude…', 'Follow System', 'Open Backups Folder', 'Customize Keyboard Shortcuts…']) assert.ok(labels.includes(want), want);
    assert.equal(list.find((c) => c.key === 'find-next').accelerator, 'F3');
  });

  await step('Preferences changes settings on the spot', async () => {
    await menu('preferences');
    await win.waitForSelector('#prefs-dlg[open]');
    assert.equal(await win.isVisible('#pref-language'), true);
    await win.click('.prefs-nav [data-pane=appearance]');
    await win.selectOption('#pref-theme', 'sepia');
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'sepia');
    await win.selectOption('#pref-width', 'wide');
    await win.click('#pref-larger');
    await win.waitForFunction(() => true);
    assert.equal(await setting('pageWidth'), 'wide');
    await win.click('.prefs-nav [data-pane=general]');
    await win.uncheck('#pref-restore');
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.restoreSession === false));
    await win.check('#pref-restore');
    await win.click('.prefs-nav [data-pane=editing]');
    await win.uncheck('#pref-run');
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.runCode === 'off'));
    await win.check('#pref-run');
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.runCode !== 'off'));
  });

  await step('the voices are easy to find: the list is in Preferences, with natural voices on offer', async () => {
    await win.click('.prefs-nav [data-pane=voices]');
    const options = await win.$$eval('#pref-voice option', (o) => o.map((x) => x.textContent));
    assert.ok(options.includes('Get natural voices…'));
    assert.ok(options.includes('System default'));
    await win.selectOption('#pref-rate', '1.25');
    await win.waitForFunction(() => window.reader.init().then((r) => r.settings.readAloud.rate === 1.25));
  });

  await step('bigger settings open their own window on top, and Done comes back', async () => {
    await win.click('.prefs-nav [data-pane=ai]');
    assert.match(await win.textContent('#pref-ai-status'), /AI assist is off/);
    await win.click('[data-run=ai-settings]');
    await win.waitForSelector('#ai-dlg[open]');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    assert.equal(await win.isVisible('#prefs-dlg'), true);
    await win.click('[data-run=connect-claude]');
    await win.waitForSelector('#claude-dlg[open]');
    await win.click('#claude-done');
    await win.click('.prefs-nav [data-pane=sync]');
    await win.click('[data-run=sync]');
    await win.waitForSelector('#sync-dlg[open]');
    await win.keyboard.press('Escape');
    await win.click('#prefs-done');
    await win.waitForSelector('#prefs-dlg', { state: 'hidden' });
    await win.click('#btn-prefs');
    await win.waitForSelector('#prefs-dlg[open]');
    await win.click('#prefs-done');
  });

  await step('the Help Center opens on a home page with the tutorial, quick links and common questions', async () => {
    await menu('help-center');
    await win.waitForSelector('#help-dlg[open]');
    assert.equal(await win.isVisible('#help-home'), true);
    assert.ok((await win.$$('#help-home [data-do=tutorial]')).length === 1);
    assert.ok((await win.$$('#help-home .help-cards button')).length >= 9);
    assert.ok((await win.$$('#help-faq details')).length >= 6);
    assert.ok((await win.$$('#help-nav button')).length >= 12);
  });

  await step('every guide opens, every link in it goes somewhere real', async () => {
    const titles = await win.$$eval('#help-nav button', (b) => b.map((x) => x.dataset.slug));
    const commands = (await win.evaluate(() => window.reader.listCommands())).map((c) => c.key);
    const panes = await win.$$eval('.prefs-nav button', (b) => b.map((x) => x.dataset.pane));
    const hrefs = [...await win.$$eval('#help-faq a', (a) => a.map((x) => x.getAttribute('href')))];
    for (const slug of titles) {
      await win.click(`#help-nav [data-slug="${slug}"]`);
      assert.equal(await win.isVisible('#help-article h1'), true, slug);
      hrefs.push(...await win.$$eval('#help-article a', (a) => a.map((x) => x.getAttribute('href'))));
    }
    assert.ok(hrefs.length > 20);
    for (const href of hrefs) {
      if (href.startsWith('#help=')) assert.ok(titles.includes(href.slice(6)), href);
      else if (href.startsWith('#do=preferences:')) assert.ok(panes.includes(href.split(':')[1]), href);
      else if (href.startsWith('#do=') && !['#do=preferences', '#do=tutorial'].includes(href)) assert.ok(commands.includes(href.slice(4)), href);
      else assert.ok(/^(#do=|https:)/.test(href), href);
    }
  });

  await step('the AI guide shows its picture; search finds guides; a guide can take you to the setting', async () => {
    await win.click('#help-nav [data-slug=ai]');
    await win.waitForFunction(() => document.querySelector('#help-article img')?.naturalWidth > 0);
    await win.fill('#help-search', 'natural voices');
    await win.waitForFunction(() => document.querySelector('#help-nav button')?.dataset.slug === 'voices');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => /Getting the natural voices/.test(document.getElementById('help-article').textContent));
    await win.fill('#help-search', 'zzzz');
    await win.waitForSelector('#help-none:not([hidden])');
    await win.fill('#help-search', '');
    await win.click('#help-article a[href="#do=preferences:voices"]');
    await win.waitForSelector('#prefs-dlg[open]');
    assert.equal(await win.isVisible('#pref-voice'), true);
    await win.click('#prefs-done');
    await win.click('#help-go-home');
    assert.equal(await win.isVisible('#help-home'), true);
    await win.click('#help-home [data-do=tutorial]');
    await win.waitForSelector('#tour-card:not([hidden])');
    await win.click('#tour-later');
  });

  await app.close();
  console.log('help e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
