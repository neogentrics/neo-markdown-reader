// End-to-end test: launches the real Electron app and drives it like a user.
// Run with:  npm run test:e2e   (on Linux CI it runs under xvfb-run)
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-e2e-'));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.copyFileSync(path.join(root, 'build/icon.png'), path.join(dir, 'img/logo.png'));
  const notes = path.join(dir, 'notes.md');
  fs.writeFileSync(notes, '# Meeting notes\n\n![logo](img/logo.png)\n\nSee the [other doc](second.md).\n\n```mermaid\ngraph LR; A-->B\n```\n');
  fs.writeFileSync(path.join(dir, 'second.md'), '# Second document\n');

  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, notes, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const errors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));

  const step = async (name, fn) => { await fn(); console.log('ok -', name); };

  await step('opens the file passed on the command line', async () => {
    await win.waitForSelector('#meeting-notes', { timeout: 20000 });
    assert.match(await win.title(), /^notes\.md/);
  });
  await step('loads images relative to the document', async () => {
    await win.waitForFunction(() => document.querySelector('#page img')?.naturalWidth > 0, null, { timeout: 10000 });
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
  await step('follows links to other Markdown files and goes back', async () => {
    await win.click('text=other doc');
    await win.waitForSelector('#second-document', { timeout: 10000 });
    await win.click('#btn-back');
    await win.waitForSelector('#meeting-notes', { timeout: 10000 });
  });
  await step('switches theme', async () => {
    await win.click('#btn-theme');
    await win.click('.seg[data-key="theme"] button[data-value="dark"]');
    await win.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  });
  await step('exports a PDF', async () => {
    const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.printToPDF({})).length);
    assert.ok(bytes > 10000);
  });

  assert.deepEqual(errors, []);
  await app.close();
  console.log('e2e: all passed');
})().catch((err) => { console.error('e2e FAILED:', err); process.exit(1); });
