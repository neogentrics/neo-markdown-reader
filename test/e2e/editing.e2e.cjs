// End-to-end test for v1.2 editing: permission prompt, saving, backups, conflicts, new documents.
// Native dialogs can't be clicked in CI, so the test answers them by replacing dialog.* in the main
// process with stubs that record the question and give a scripted answer.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-edit-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs, { recursive: true });
const notes = path.join(docs, 'notes.md');
const locked = path.join(docs, 'locked.md');
const created = path.join(docs, 'from-template.md');
fs.writeFileSync(notes, '﻿# Notes\r\n\r\nFirst line.\r\n');        // Windows-style file with a BOM
fs.writeFileSync(locked, '# Locked\n');
fs.chmodSync(locked, 0o444);
const canLock = !(process.getuid && process.getuid() === 0);           // root ignores read-only

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, notes, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));

  // ---- dialog stubs: answers are queued per test step; every question is recorded
  await app.evaluate(({ dialog }) => {
    global.__answers = [];
    global.__asked = [];
    global.__savePath = null;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(o.message); return { response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) }; };
    dialog.showSaveDialog = async () => (global.__savePath ? { canceled: false, filePath: global.__savePath } : { canceled: true });
  });
  const answer = (...responses) => app.evaluate((_e, r) => { global.__answers.push(...r); global.__asked = []; }, responses);
  const asked = () => app.evaluate(() => global.__asked);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const typeAtEnd = async (text) => { await win.click('.cm-content'); await win.keyboard.press('ControlOrMeta+End'); await win.keyboard.type(text); };
  const activeDirty = () => win.$eval('.tab.active', (t) => t.classList.contains('dirty'));

  await win.waitForSelector('.page:not([hidden]) #notes', { timeout: 20000 });

  await step('documents open read-only; cancelling the permission prompt keeps them that way', async () => {
    assert.equal(await win.$eval('#btn-edit .edit-label', (n) => n.textContent), 'Edit');
    await answer(3);                                                     // Cancel
    await win.click('#btn-edit');
    await win.waitForTimeout(400);
    assert.match((await asked())[0], /Allow Neo Markdown Reader to edit “notes\.md”\?/);
    assert.equal(await win.$('.cm-editor'), null);
  });

  await step('"Just this time" opens the editor beside the live preview', async () => {
    await answer(0);
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor', { timeout: 10000 });
    await typeAtEnd('\n## Added in the editor\n');
    await win.waitForSelector('.page:not([hidden]) #added-in-the-editor', { timeout: 5000 });
    assert.equal(await activeDirty(), true);
  });

  await step('Save keeps the original line endings and BOM, and backs up the original first', async () => {
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('dirty'), null, { timeout: 5000 });
    const disk = fs.readFileSync(notes, 'utf8');
    assert.ok(disk.startsWith('﻿# Notes\r\n'), 'BOM and CRLF kept');
    assert.ok(disk.includes('\r\n## Added in the editor\r\n'));
    assert.ok(!/[^\r]\n/.test(disk), 'no bare LF line endings');
    const backups = fs.readdirSync(path.join(profile, 'backups'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(profile, 'backups', backups[0]), 'utf8'), '﻿# Notes\r\n\r\nFirst line.\r\n');
  });

  await step('a change by another program while editing shows a banner instead of overwriting your text', async () => {
    await typeAtEnd('\nMy unsaved line.');
    await win.waitForTimeout(300);
    fs.appendFileSync(notes, '\r\nOther program\r\n');
    await win.waitForSelector('#disk-banner:not([hidden])', { timeout: 8000 });
    assert.match(await win.$eval('.cm-content', (n) => n.textContent), /My unsaved line\./);
    await win.click('#disk-keep');
  });

  await step('saving over an outside change asks first; Cancel leaves the file alone', async () => {
    await answer(0);                                                     // Cancel
    await menu('save');
    await win.waitForTimeout(500);
    assert.match((await asked())[0], /was changed by another program/);
    assert.ok(fs.readFileSync(notes, 'utf8').includes('Other program'));
    assert.equal(await activeDirty(), true);
    await answer(1);                                                     // Replace With My Version
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('dirty'), null, { timeout: 5000 });
    const disk = fs.readFileSync(notes, 'utf8');
    assert.ok(disk.includes('My unsaved line.') && !disk.includes('Other program'));
  });

  await step('Done with unsaved changes asks; "Don’t Save" discards them', async () => {
    await typeAtEnd('\nThrow this away.');
    await answer(1);                                                     // Don't Save
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor', { state: 'detached', timeout: 5000 });
    assert.match((await asked())[0], /Save your changes to “notes\.md”\?/);
    assert.ok(!(await win.textContent('.page:not([hidden])')).includes('Throw this away'));
    assert.ok(!fs.readFileSync(notes, 'utf8').includes('Throw this away'));
  });

  await step('closing the tab only ends "Just this time": editing again asks again', async () => {
    await menu('close-tab');
    await win.waitForTimeout(400);                                       // let the window report its tabs
    await app.evaluate(({ app: a }, f) => a.emit('second-instance', {}, ['x', f], '/'), notes);
    await win.waitForSelector('.page:not([hidden]) #notes');
    await answer(3);
    await win.click('#btn-edit');
    await win.waitForTimeout(400);
    assert.equal((await asked()).length, 1, 'permission was asked again');
  });

  await step('"Always for this file" is remembered and can be revoked', async () => {
    await answer(1);
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor');
    // Settings are written to disk shortly after a change; wait for it.
    let saved = null;
    for (let i = 0; i < 20 && !saved?.editGrants?.files?.length; i++) {
      await win.waitForTimeout(150);
      try { saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); } catch { /* not written yet */ }
    }
    assert.deepEqual(saved.editGrants.files, [notes]);
    await win.click('#btn-edit');                                        // Done (no changes)
    await win.waitForSelector('.cm-editor', { state: 'detached' });
    await answer();
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor');
    assert.equal((await asked()).length, 0, 'no prompt the second time');
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor', { state: 'detached' });
    await menu('grants');
    await win.waitForSelector('#grants[open] li');
    await win.click('#grants li .link-btn');
    await win.waitForSelector('#grants[open] .grants-empty');
    await win.click('#grants-close');
  });

  await step('read-only files stay locked', async () => {
    if (!canLock) return;                                                // running as root: chmod has no effect
    await app.evaluate(({ app: a }, f) => a.emit('second-instance', {}, ['x', f], '/'), locked);
    await win.waitForSelector('.page:not([hidden]) #locked');
    assert.equal(await win.$eval('#btn-edit .edit-label', (n) => n.textContent), 'Read-only');
    await answer(0);
    await win.click('#btn-edit');
    await win.waitForTimeout(400);
    assert.match((await asked())[0], /is read-only/);
    assert.equal(await win.$('.cm-editor'), null);
  });

  await step('New from Template opens an unsaved document in the editor; Save asks where', async () => {
    await menu('template-meeting');
    await win.waitForSelector('.tab.active.untitled');
    await win.waitForSelector('.cm-editor');
    assert.match(await win.$eval('.cm-content', (n) => n.textContent), /Action items/);
    await app.evaluate((_e, p) => { global.__savePath = p; }, created);
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('untitled'), null, { timeout: 5000 });
    assert.equal(await win.$eval('.tab.active .tab-label', (n) => n.textContent), 'from-template');
    assert.match(fs.readFileSync(created, 'utf8'), /## Action items/);
  });

  await step('closing a tab with unsaved changes asks; Cancel keeps it open', async () => {
    await typeAtEnd('\n- [ ] one more thing');
    await answer(2);                                                     // Cancel
    const before = await win.$$eval('.tab', (t) => t.length);
    await menu('close-tab');
    await win.waitForTimeout(500);
    assert.equal(await win.$$eval('.tab', (t) => t.length), before);
    await answer(1);                                                     // Don't Save
    await menu('close-tab');
    await win.waitForFunction((n) => document.querySelectorAll('.tab').length === n - 1, before);
  });

  await step('a blank new document starts in the editor', async () => {
    await menu('new-doc');
    await win.waitForSelector('.tab.active.untitled');
    await win.waitForSelector('.cm-editor');
    assert.match(await win.$eval('.tab.active .tab-label', (n) => n.textContent), /^Untitled-\d+$/);
  });

  assert.deepEqual(errors, []);
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });   // "Close Without Saving" if asked
  await app.close();
  console.log('editing e2e: all passed');
})().catch((err) => { console.error('editing e2e FAILED:', err); process.exit(1); });
