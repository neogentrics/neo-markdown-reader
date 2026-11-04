// End-to-end test for v3.1 "Across your computers": two copies of the app, each with its own profile and
// its own copy of a cloud folder (at different paths, as on two real computers), syncing through one
// shared folder. A highlight with a note, a bookmark and a theme made on the first appear on the second;
// a highlight removed on the second disappears from the first. Native dialogs are answered by stubs.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-sync-'));
const shared = path.join(tmp, 'shared');
fs.mkdirSync(shared);
const TEXT = '# Spring plan\n\nOpen the shop in spring, once the paint is dry.\n\nKeep the budget small.\n';

/** One "computer": a profile, a cloud folder at its own path, and the same document inside it. */
function computer(name) {
  const cloud = path.join(tmp, name, 'OneDrive');
  fs.mkdirSync(path.join(cloud, 'Notes'), { recursive: true });
  const doc = path.join(cloud, 'Notes', 'plan.md');
  fs.writeFileSync(doc, TEXT);
  return { name, cloud, doc, profile: path.join(tmp, name, 'profile') };
}
const desk = computer('desk');
const laptop = computer('laptop');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

async function launch(c) {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, c.doc, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: c.profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1',
      NMR_SYNC_ROOTS: JSON.stringify([{ id: 'onedrive', path: c.cloud }]),
    },
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, shared);
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.page:not([hidden]) h1');
  const menu = (id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
  return { app, win, errors, menu };
}

/** Wait for a sync that finished after `since`. */
const synced = (win, since) => win.waitForFunction((t) => (window.__syncStatus?.lastSync || 0) > t, since, { timeout: 20000 });

(async () => {
  // ---------------------------------------------------------------- the desk
  let { app, win, errors, menu } = await launch(desk);
  await step('turning sync on: choose the folder, name the computer, and it syncs', async () => {
    await menu('sync');
    await win.waitForSelector('#sync-dlg[open]');
    assert.match(await win.textContent('#sync-state'), /Choose a folder/);
    const t = Date.now();
    await win.click('#sync-choose');
    await synced(win, t);
    assert.match(await win.textContent('#sync-state'), /On · last synced/);
    assert.ok(await win.$eval('#sync-enabled', (b) => b.checked));
    await win.fill('#sync-name', 'Desk');
    await win.dispatchEvent('#sync-name', 'change');
    await win.click('#sync-done');
    const devices = path.join(shared, 'Neo Markdown Reader', 'devices');
    assert.equal(fs.readdirSync(devices).filter((f) => f.endsWith('.json')).length, 1);
  });

  await step('a highlight with a note, a bookmark and a theme are made on the desk', async () => {
    await win.evaluate(() => {
      const p = document.querySelector('.page:not([hidden]) p');
      const r = document.createRange();
      r.setStart(p.firstChild, 5);
      r.setEnd(p.firstChild, 13);                 // "the shop"
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await menu('highlight');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl');
    await win.click('.page:not([hidden]) mark.nmr-hl');
    await win.fill('#hl-note', 'Ask about the lease');
    await win.click('#hl-note-save');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl.has-note');
    await menu('bookmark');
    await win.waitForSelector('#btn-bookmark.on');
    await win.evaluate(() => window.reader.setSettings({ theme: 'sepia' }));
    const t = Date.now();
    await menu('sync');
    await win.click('#sync-now');
    await synced(win, t);
    await win.click('#sync-done');
  });
  assert.deepEqual(errors, []);
  await app.close();

  // ---------------------------------------------------------------- the laptop
  ({ app, win, errors, menu } = await launch(laptop));
  await step('the laptop joins the same folder and gets the highlight, the note, the bookmark and the theme', async () => {
    await menu('sync');
    await win.waitForSelector('#sync-dlg[open]');
    const t = Date.now();
    await win.click('#sync-choose');
    await synced(win, t);
    await win.waitForSelector('.sync-device:has-text("Desk")');
    await win.click('#sync-done');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl.has-note');
    assert.equal(await win.$eval('.page:not([hidden]) mark.nmr-hl', (m) => m.textContent), 'the shop');
    await win.waitForSelector('#btn-bookmark.on');
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'sepia');
    assert.equal(fs.readFileSync(laptop.doc, 'utf8'), TEXT, 'the document itself is untouched');
  });

  await step('removing the highlight on the laptop', async () => {
    await win.click('.page:not([hidden]) mark.nmr-hl');
    await win.click('#hl-delete');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl', { state: 'detached' });
  });
  assert.deepEqual(errors, []);
  await app.close();                               // quitting syncs one last time

  // ---------------------------------------------------------------- back at the desk
  ({ app, win, errors, menu } = await launch(desk));
  await step('back at the desk, sync is still on and the highlight is gone there too', async () => {
    await synced(win, 0);
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl', { state: 'detached' });
    assert.equal(await win.$$eval('.page:not([hidden]) mark.nmr-hl', (m) => m.length), 0);
    await win.waitForSelector('#btn-bookmark.on');
    await menu('sync');
    await win.waitForSelector('.sync-device:has-text("(")');        // the laptop, with its system
  });

  await step('turning sync off stops it; the folder and the other computer’s file stay', async () => {
    await win.click('#sync-enabled');
    await win.waitForFunction(() => window.__syncStatus && !window.__syncStatus.enabled);
    assert.match(await win.textContent('#sync-state'), /off on this computer/);
    assert.equal(fs.readdirSync(path.join(shared, 'Neo Markdown Reader', 'devices')).filter((f) => f.endsWith('.json')).length, 2);
  });
  assert.deepEqual(errors, []);
  await app.close();
  console.log('sync e2e: all passed');
})().catch((err) => { console.error('sync e2e FAILED:', err); process.exit(1); });
