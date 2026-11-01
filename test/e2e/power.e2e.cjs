// End-to-end test for v2.0: colour themes, password-locked documents, running code blocks and the
// optional AI assist. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const locked = require('../../src/main/locked.js');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-power-'));
const profile = path.join(tmp, 'profile');
const doc = path.join(tmp, 'secret.md');
const lockedPath = path.join(tmp, 'secret.mdlock');
const PASSWORD = 'correct horse battery';
fs.writeFileSync(doc, '# Secret plan\n\nThe launch date is the 14th.\n');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };
const launch = (files = []) => electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...files],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1' },
});

(async () => {
  let app = await launch([doc]);
  let win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const stub = (a) => a.evaluate(({ dialog }) => {
    global.__save = null;
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
  });
  await stub(app);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const activeLabel = () => win.$eval('.tab.active .tab-label', (n) => n.textContent);
  const page = '.page:not([hidden])';

  await win.waitForSelector(`${page} #secret-plan`);

  await step('four new colour themes switch the page, with dark ones marked dark', async () => {
    await win.click('#btn-theme');
    for (const [theme, tone] of [['mist', 'light'], ['forest', 'dark'], ['dusk', 'dark'], ['contrast', 'dark'], ['light', 'light']]) {
      await win.click(`#theme-menu [data-key="theme"] [data-value="${theme}"]`);
      await win.waitForFunction(([t, d]) => document.documentElement.dataset.theme === t && document.documentElement.dataset.tone === d, [theme, tone]);
    }
    await win.keyboard.press('Escape');
  });

  await step('Protect with Password saves an encrypted copy and opens it', async () => {
    await menu('lock-protect');
    await win.waitForSelector('#lock-dlg[open]');
    assert.equal(await win.isDisabled('#lock-go'), true);
    await win.fill('#lock-pw', 'short');
    assert.equal(await win.textContent('#lock-meter span'), 'Too short');
    await win.fill('#lock-pw', PASSWORD);
    await win.fill('#lock-pw2', PASSWORD + 'x');
    assert.match(await win.textContent('#lock-msg'), /don’t match/);
    await win.fill('#lock-pw2', PASSWORD);
    await win.click('#lock-go');
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret.mdlock');
    await win.waitForSelector(`${page} #secret-plan`);
    const text = fs.readFileSync(lockedPath, 'utf8');
    assert.doesNotMatch(text, /launch date|Secret/);
    assert.equal((await locked.unlock(text, PASSWORD)).content, '# Secret plan\n\nThe launch date is the 14th.\n');
    assert.ok(fs.existsSync(doc), 'the original stays unless you ask');
    assert.ok(await win.$('.tab.active.locked'));
  });

  await step('Lock Now hides the text; a wrong password is refused, the right one opens it', async () => {
    await menu('lock-now');
    await win.waitForSelector(`${page} .lock-screen`);
    assert.equal(await win.$(`${page} #secret-plan`), null);
    await win.fill(`${page} .lock-input`, 'not the password');
    await win.click(`${page} .lock-form button`);
    await win.waitForSelector(`${page} .lock-error:not([hidden])`);
    assert.match(await win.textContent(`${page} .lock-error`), /isn’t right/);
    await win.fill(`${page} .lock-input`, PASSWORD);
    await win.click(`${page} .lock-form button`);
    await win.waitForSelector(`${page} #secret-plan`);
  });

  await step('highlights are refused in locked documents (they would be stored unencrypted)', async () => {
    await win.evaluate(() => {
      const p = document.querySelector('.page:not([hidden]) p');
      const r = document.createRange(); r.selectNodeContents(p);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await menu('highlight');
    await win.waitForFunction(() => /locked documents/.test(document.getElementById('toast').textContent));
    assert.equal(await win.$('mark.nmr-hl'), null);
  });

  await step('editing and saving a locked document keeps it encrypted', async () => {
    await menu('toggle-edit');
    await win.waitForSelector('.cm-content');
    await win.click('.cm-content');
    await win.keyboard.press('ControlOrMeta+End');
    await win.keyboard.type('\nMoved to the 21st.');
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('dirty'));
    const text = fs.readFileSync(lockedPath, 'utf8');
    assert.doesNotMatch(text, /21st/);
    assert.match((await locked.unlock(text, PASSWORD)).content, /Moved to the 21st\./);
    await menu('toggle-edit');
    await win.waitForSelector('.cm-content', { state: 'detached' });
  });

  await step('Save an Unlocked Copy writes plain Markdown where you choose', async () => {
    const out = path.join(tmp, 'secret-copy.md');
    await app.evaluate((_e, f) => { global.__save = f; }, out);
    await menu('lock-remove');
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret-copy');
    assert.match(fs.readFileSync(out, 'utf8'), /Moved to the 21st\./);
    await menu('close-tab');
  });

  await step('after a restart the locked tab asks for the password again', async () => {
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label')?.textContent === 'secret.mdlock');
    await new Promise((r) => setTimeout(r, 800));
    await app.close();
    app = await launch();
    win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(e.message));
    await stub(app);
    await win.waitForSelector('.tab.locked');
    await win.click('.tab.locked');
    await win.waitForSelector(`${page} .lock-screen`);
    assert.equal(await win.$(`${page} #secret-plan`), null);
    const settingsText = fs.readFileSync(path.join(profile, 'settings.json'), 'utf8');
    assert.doesNotMatch(settingsText, /launch date|21st/, 'no document text in settings');
  });

  assert.deepEqual(errors, [], 'no page errors');
  await app.close();
  console.log('power e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
