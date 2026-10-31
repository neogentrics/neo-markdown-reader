// End-to-end test: launches the real Electron app and drives it like a user.
// Run with:  npm run test:e2e   (on Linux CI it runs under xvfb-run)
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-e2e-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'img'), { recursive: true });
fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(docs, 'img/logo.png'));
const notes = path.join(docs, 'notes.md');
const second = path.join(docs, 'second.md');
const third = path.join(docs, 'third.md');
fs.writeFileSync(notes, '# Meeting notes\n\n![logo](img/logo.png)\n\nSee the [other doc](second.md).\n\n| Item | Owner |\n|---|---|\n| Ship | Josh |\n\n```mermaid\ngraph LR; A-->B\n```\n');
fs.writeFileSync(second, '# Second document\n\nGo to the [third](third.md).\n');
fs.writeFileSync(third, '# Third document\n');

const launch = (args = []) => electron.launch({
  executablePath: require(path.join(root, 'node_modules/electron')),
  args: [root, ...args, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1' },
});

const step = async (name, fn) => { await fn(); console.log('ok -', name); };
const menu = (app, id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
const tabLabels = (win) => win.$$eval('.tab .tab-label', (n) => n.map((x) => x.textContent));
const activeLabel = (win) => win.$eval('.tab.active .tab-label', (n) => n.textContent);
const activeH1 = (win) => win.$eval('.page:not([hidden]) h1', (n) => n.textContent);
const windowCount = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

(async () => {
  // ------------------------------------------------------------------ first launch
  let app = await launch([notes]);
  const errors = [];
  let win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));

  await step('opens the file passed on the command line in a tab', async () => {
    await win.waitForSelector('.page:not([hidden]) #meeting-notes', { timeout: 20000 });
    assert.deepEqual(await tabLabels(win), ['notes']);
    assert.match(await win.title(), /^notes\.md/);
  });
  await step('picks up an edit saved right after the file opened', async () => {
    fs.appendFileSync(notes, '\n## Edited right away\n');
    await win.waitForSelector('#edited-right-away', { timeout: 10000 });
  });
  await step('shows the menu bar by default', async () => {
    if (process.platform === 'darwin') return;              // macOS menus live in the system menu bar
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), true);
  });
  await step('loads images relative to the document', async () => {
    await win.waitForFunction(() => document.querySelector('.page:not([hidden]) img')?.naturalWidth > 0, null, { timeout: 10000 });
  });
  await step('renders Mermaid diagrams', async () => {
    await win.waitForSelector('.mermaid-diagram svg', { timeout: 20000 });
  });
  await step('page has no Node.js access', async () => {
    assert.equal(await win.evaluate(() => typeof require + typeof process), 'undefinedundefined');
  });
  await step('live-reloads when the file changes', async () => {
    fs.appendFileSync(notes, '\n## Added later\n');
    await win.waitForSelector('#added-later', { timeout: 10000 });
  });
  await step('follows links inside the tab; Back goes back exactly one document', async () => {
    await win.click('text=other doc');
    await win.waitForSelector('.page:not([hidden]) #second-document');
    await win.click('text=third');
    await win.waitForSelector('.page:not([hidden]) #third-document');
    await menu(app, 'back');
    await win.waitForSelector('.page:not([hidden]) #second-document');
    await win.waitForTimeout(400);
    assert.equal(await activeH1(win), 'Second document');
    await win.click('#btn-back');
    await win.waitForSelector('.page:not([hidden]) #meeting-notes');
    assert.deepEqual(await tabLabels(win), ['notes']);
  });
  await step('Ctrl+click (Cmd+click on Mac) opens a linked document in a new tab', async () => {
    await win.click('text=other doc', { modifiers: ['ControlOrMeta'] });   // Cmd+click on macOS, Ctrl+click elsewhere
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    assert.equal(await activeLabel(win), 'second');
  });
  await step('double-clicking another file (second instance) adds a tab to this window', async () => {
    await app.evaluate(({ app: a }, file) => a.emit('second-instance', {}, ['NeoMarkdownReader.exe', file], process.cwd()), third);
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 3);
    assert.equal(await activeLabel(win), 'third');
    assert.equal(await windowCount(app), 1);
  });
  await step('opening a file that is already open focuses its tab', async () => {
    await app.evaluate(({ app: a }, file) => a.emit('second-instance', {}, ['x.exe', file], process.cwd()), notes);
    await win.waitForFunction(() => document.querySelector('.tab.active .tab-label').textContent === 'notes');
    assert.equal((await tabLabels(win)).length, 3);
  });
  await step('Next/Previous Tab cycle through tabs', async () => {
    await menu(app, 'next-tab');
    assert.equal(await activeLabel(win), 'second');
    await menu(app, 'prev-tab');
    assert.equal(await activeLabel(win), 'notes');
  });
  await step('Close Tab and Reopen Closed Tab', async () => {
    await win.click('.tab:nth-child(3)');            // third
    await menu(app, 'close-tab');
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    await menu(app, 'reopen-closed-tab');
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 3);
    assert.equal(await activeLabel(win), 'third');
  });
  await step('Move Tab to New Window splits it off into a second window', async () => {
    await menu(app, 'move-tab-to-window');
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await windowCount(app), 2);
    const second = app.windows().find((w) => w !== win);
    await second.waitForSelector('.page:not([hidden]) #third-document', { timeout: 15000 });
    assert.deepEqual(await tabLabels(second), ['third']);
  });
  await step('clicking an image opens the image viewer; Esc closes it', async () => {
    await win.bringToFront();
    await win.click('.tab:nth-child(1)');
    await win.click('.page:not([hidden]) img');
    await win.waitForSelector('#lightbox:not([hidden])');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#lightbox', { state: 'hidden' });
  });
  await step('Copy as Formatted Text puts rich HTML on the clipboard', async () => {
    await win.evaluate(() => window.getSelection().removeAllRanges());
    // Send the same command the Edit menu sends, to the window showing notes.md.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('notes'));
      w.webContents.send('menu:command', { cmd: 'copy-rich' });
    });
    await win.waitForTimeout(800);
    const html = await app.evaluate(async ({ clipboard }) => {
      const [item] = await clipboard.read();
      return item.types.includes('text/html') ? (await item.getType('text/html')).text() : '';
    });
    assert.match(html, /<h1[^>]*>Meeting notes<\/h1>/);
    assert.match(html, /<table/);
  });
  await step('switches theme', async () => {
    await win.click('#btn-theme');
    await win.click('.seg[data-key="theme"] button[data-value="dark"]');
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  });
  await step('menu bar can be set to auto-hide', async () => {
    if (process.platform === 'darwin') return;
    await menu(app, 'toggle-menubar');
    await win.waitForTimeout(300);
    // The setting applies to every open window.
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isMenuBarVisible())), [false, false]);
    await menu(app, 'toggle-menubar');
  });
  await step('exports a PDF', async () => {
    // Two windows are open now; export the one showing notes.md (with its image and diagram).
    const bytes = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('notes'));
      return (await w.webContents.printToPDF({ printBackground: true })).length;
    });
    assert.ok(bytes > 10000, `PDF unexpectedly small: ${bytes} bytes`);
  });

  assert.deepEqual(errors, []);
  // Scroll and quit straight away: the final position must still be saved.
  await win.evaluate(() => document.getElementById('desk').scrollTo(0, 99999));
  await new Promise((r) => setTimeout(r, 100));
  await app.close();

  // ------------------------------------------------------------------ relaunch: session restore
  app = await launch();
  await step('relaunch restores both windows and their tabs', async () => {
    const first = await app.firstWindow();
    await first.waitForSelector('.tab', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(await windowCount(app), 2);
    const all = [];
    for (const w of app.windows()) { await w.waitForSelector('.tab'); all.push(...(await tabLabels(w))); }
    assert.deepEqual(all.sort(), ['notes', 'second', 'third']);
  });
  await step('restored tab resumes at the saved reading position', async () => {
    let nw = null;
    for (const x of app.windows()) if ((await tabLabels(x)).includes('notes')) nw = x;
    await nw.click('.tab:nth-child(1)');
    await nw.waitForTimeout(500);
    const top = await nw.evaluate(() => document.getElementById('desk').scrollTop);
    assert.ok(top > 50, `expected to resume scrolled down, got scrollTop=${top}`);
  });
  await app.close();
  console.log('e2e: all passed');
})().catch((err) => { console.error('e2e FAILED:', err); process.exit(1); });
