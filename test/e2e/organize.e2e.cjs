// End-to-end test for v1.3: Open Folder, Find in Folder, Quick Open, split view, Compare, highlights,
// bookmarks. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-org-'));
const profile = path.join(tmp, 'profile');
const kb = path.join(tmp, 'kb');
fs.mkdirSync(path.join(kb, 'guides'), { recursive: true });
fs.mkdirSync(path.join(kb, 'notes'), { recursive: true });
fs.mkdirSync(path.join(kb, 'node_modules', 'x'), { recursive: true });
const install = path.join(kb, 'guides', 'install.md');
const install2 = path.join(kb, 'guides', 'install-v2.md');
const meeting = path.join(kb, 'notes', 'meeting.md');
const long = path.join(kb, 'long.md');
fs.writeFileSync(install, '# Install guide\n\nRun the installer, then restart.\n\n## Troubleshooting\n\nIf the installer fails, check your permissions.\n');
fs.writeFileSync(install2, '# Install guide\n\nRun the setup program, then restart your PC.\n\n## Troubleshooting\n\nIf the installer fails, check your permissions.\n\n## FAQ\n\nNew section.\n');
fs.writeFileSync(meeting, '# Meeting 1\n\nDiscussed the installer timeline.\n\nThe installer timeline slipped again.\n');
fs.writeFileSync(long, '# Long\n\n' + Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with enough words to fill the line.`).join('\n\n') + '\n');
const long2 = path.join(kb, 'long-2.md');
fs.writeFileSync(long2, '# Long two\n\n' + Array.from({ length: 120 }, (_, i) => `Another paragraph ${i}, a little different.`).join('\n\n') + '\n');
fs.writeFileSync(path.join(kb, 'node_modules', 'x', 'README.md'), 'installer');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };
const launch = () => electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1' },
});

(async () => {
  let app = await launch();
  let win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const stubDialogs = (a) => a.evaluate(({ dialog }, folder) => {
    global.__pick = null;
    dialog.showOpenDialog = async (_w, o) => (o.properties.includes('openDirectory') ? { canceled: false, filePaths: [folder] } : (global.__pick ? { canceled: false, filePaths: [global.__pick] } : { canceled: true, filePaths: [] }));
    dialog.showMessageBox = async () => ({ response: 0 });
  }, kb);
  await stubDialogs(app);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const activeLabel = () => win.$eval('.tab.active .tab-label', (n) => n.textContent);

  await win.waitForSelector('#welcome-open');

  await step('Open Folder lists the Markdown files as a tree (skipping node_modules)', async () => {
    await menu('open-folder');
    await win.waitForSelector('.side-panel[data-panel="files"]:not([hidden]) .file-item >> visible=true');
    const names = await win.$$eval('.file-item .file-name', (n) => n.map((x) => x.textContent).sort());
    assert.deepEqual(names, ['install-v2.md', 'install.md', 'long-2.md', 'long.md', 'meeting.md']);
    assert.equal(await win.textContent('#folder-name'), 'kb');
  });

  await step('clicking a file opens it; the Files panel marks the open file', async () => {
    await win.click('.file-item[data-path$="install.md"]');
    await win.waitForSelector('.page:not([hidden]) #install-guide');
    assert.equal(await win.$eval('.file-item.active', (n) => n.dataset.path), install);
  });

  await step('the file filter narrows the list', async () => {
    await win.fill('#files-filter', 'meet');
    await win.waitForFunction(() => document.querySelectorAll('#files-body .file-item').length === 1);
    await win.fill('#files-filter', '');
  });

  await step('Find in Folder finds text in every file and opens a result at its line', async () => {
    await menu('find-in-folder');
    await win.fill('#folder-search', 'INSTALLER');
    // install.md ×2, install-v2.md ×1, meeting.md ×2 (node_modules is skipped)
    await win.waitForFunction(() => /5 results in 3 files/.test(document.getElementById('search-summary').textContent));
    await win.click('.search-file:has-text("meeting.md") .search-hit >> nth=1');
    await win.waitForSelector('.page:not([hidden]) #meeting-1');
    assert.equal(await activeLabel(), 'meeting');
  });

  await step('Quick Open finds a file from a few letters', async () => {
    await menu('quick-open');
    await win.keyboard.type('inst v2');
    await win.waitForSelector('.palette-item.selected');
    assert.equal(await win.textContent('.palette-item.selected .pi-label'), 'install-v2.md');
    await win.keyboard.press('Enter');
    await win.waitForSelector('.page:not([hidden]) #faq');
  });

  await step('Quick Open with # jumps to a heading in the current document', async () => {
    await menu('quick-open');
    await win.keyboard.type('#trouble');
    await win.waitForSelector('.palette-item.kind-heading.selected');
    await win.keyboard.press('Enter');
    // Several open documents have this heading; check the one on screen.
    await win.waitForFunction(() => document.querySelector('.page:not([hidden]) #troubleshooting')?.classList.contains('flash'));
  });

  await step('Split view shows a second document beside the first; Swap and Close work', async () => {
    await win.click('.tab:has-text("install") >> nth=0');
    await menu('split-toggle');
    await win.waitForSelector('#desk2:not([hidden])');
    await win.selectOption('#split-select', { label: 'install-v2.md' });
    await win.waitForSelector('#pages2 #faq');
    assert.equal(await activeLabel(), 'install');
    await win.click('#split-swap');
    await win.waitForSelector('#pages2 #install-guide');
    assert.equal(await activeLabel(), 'install-v2');
    await win.click('#split-close');
    await win.waitForSelector('#desk2', { state: 'hidden' });
    assert.equal(await win.$$eval('#pages > .page:not([hidden])', (n) => n.length), 1);
  });

  await step('linked scrolling keeps both sides at the same position', async () => {
    await app.evaluate(({ app: a }, f) => a.emit('second-instance', {}, ['x', f], '/'), long2);
    await win.waitForSelector('.page:not([hidden]) #long-two');
    await app.evaluate(({ app: a }, f) => a.emit('second-instance', {}, ['x', f], '/'), long);
    await win.waitForSelector('.page:not([hidden]) #long');
    await menu('split-toggle');
    await win.waitForSelector('#desk2:not([hidden])');
    await win.selectOption('#split-select', { label: 'long-2.md' });
    await win.waitForSelector('#pages2 #long-two');
    await menu('split-link');
    const ratio = (id) => win.evaluate((i) => { const d = document.getElementById(i); return d.scrollTop / (d.scrollHeight - d.clientHeight); }, id);
    await win.evaluate(() => { const d = document.getElementById('desk'); d.scrollTop = (d.scrollHeight - d.clientHeight) / 2; });
    await win.waitForFunction(() => { const p = document.getElementById('desk2'); return p.scrollTop > 0; });
    assert.ok(Math.abs((await ratio('desk2')) - (await ratio('desk'))) < 0.05, 'right side follows the left');
    // …and the other way round.
    await win.evaluate(() => { const p = document.getElementById('desk2'); p.scrollTop = p.scrollHeight; });
    await win.waitForFunction(() => { const d = document.getElementById('desk'); return d.scrollTop >= d.scrollHeight - d.clientHeight - 2; });
    await menu('split-link');                             // unlink: the right side no longer follows
    await win.evaluate(() => { document.getElementById('desk').scrollTop = 0; });
    await win.waitForTimeout(300);
    assert.ok((await ratio('desk2')) > 0.9, 'unlinked panes scroll independently');
    await menu('split-toggle');
  });

  await step('Compare shows the differences between two documents, word by word', async () => {
    await win.click('.tab:has-text("install") >> nth=0');
    await menu('compare-tabs');
    await win.waitForSelector('.palette-item');
    await win.keyboard.type('v2');
    await win.keyboard.press('Enter');
    await win.waitForSelector('.page:not([hidden]) .diff');
    assert.match(await win.textContent('.page:not([hidden]) .diff-summary'), /5 lines added · 1 removed/);
    assert.ok(await win.$('.page:not([hidden]) .diff ins'));
    assert.equal(await win.$eval('#btn-edit', (b) => b.hidden), true, 'comparisons can’t be edited');
    await menu('close-tab');
  });

  await step('Compare with Saved Version shows unsaved edits', async () => {
    await win.click('.tab:has-text("meeting")');
    await win.click('#btn-edit');                       // dialog stub answers "Just This Time"
    await win.waitForSelector('.cm-editor');
    await win.click('.cm-content');
    await win.keyboard.press('ControlOrMeta+End');
    await win.keyboard.type('\nA new line.');
    await menu('compare-saved');
    await win.waitForSelector('.page:not([hidden]) .diff');
    assert.match(await win.textContent('.page:not([hidden]) .diff-summary'), /2 lines added/);
    await menu('close-tab');
    await win.click('.tab:has-text("meeting")');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });   // Don't Save
    await win.click('#btn-edit');
    await win.waitForSelector('.cm-editor', { state: 'detached' });
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  });

  await step('highlighting selected text marks the right occurrence and keeps a note', async () => {
    await win.evaluate(() => {
      const p = document.querySelectorAll('.page:not([hidden]) p')[1];      // the SECOND "installer timeline"
      const r = document.createRange();
      r.setStart(p.firstChild, 4);
      r.setEnd(p.firstChild, 22);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await menu('highlight');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl');
    assert.equal(await win.$eval('.page:not([hidden]) mark.nmr-hl', (m) => m.closest('p').textContent), 'The installer timeline slipped again.');
    await win.click('.page:not([hidden]) mark.nmr-hl');
    await win.fill('#hl-note', 'Ask about dates');
    await win.click('#hl-note-save');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl.has-note');
    await menu('panel-highlights');
    await win.waitForSelector('.hl-item');
    assert.match(await win.textContent('.hl-item'), /Ask about dates/);
    assert.equal(fs.readFileSync(meeting, 'utf8').includes('mark'), false, 'the file itself is untouched');
  });

  await step('bookmarking a file adds it to the Files panel and Quick Open', async () => {
    await menu('bookmark');
    await win.waitForSelector('#btn-bookmark.on');
    await menu('panel-files');
    await win.waitForSelector('.group-head:has-text("Bookmarks")');
    await menu('quick-open');
    await win.waitForSelector('.palette-item:has-text("★ Bookmark")');
    await win.keyboard.press('Escape');
  });

  assert.deepEqual(errors, []);
  await app.close();

  // ---------------------------------------------------------------- relaunch
  app = await launch();
  win = await app.firstWindow();
  await step('relaunch reopens the folder and the highlights come back', async () => {
    await win.waitForSelector('.tab');
    assert.equal(await win.textContent('#folder-name'), 'kb');
    await win.click('.tab:has-text("meeting")');
    await win.waitForSelector('.page:not([hidden]) mark.nmr-hl.has-note');
    assert.equal(await win.$eval('#btn-bookmark', (b) => b.classList.contains('on')), true);
  });
  await app.close();
  console.log('organize e2e: all passed');
})().catch((err) => { console.error('organize e2e FAILED:', err); process.exit(1); });
