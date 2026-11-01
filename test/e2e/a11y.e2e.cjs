// Accessibility checks (v2.1): axe-core finds no serious or critical problems on the main screens,
// dialogs and every theme, and tabs and the sidebar work from the keyboard.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-a11y-'));
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const second = path.join(tmp, 'second.md');
const third = path.join(tmp, 'third.md');
fs.writeFileSync(second, '# Second\n\nText.\n');
fs.writeFileSync(third, '# Third\n\nMore text.\n');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'profile'), NMR_DISABLE_UPDATES: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  const menu = (id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).click(), id);
  await win.waitForSelector('#welcome-open');
  // Measure settled colours: with reduced motion the app skips its fades and theme transitions
  // (mid-fade colours are neither the old nor the new one, and would trip the contrast check).
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.evaluate(axeSource);
  const problems = async (where) => {
    const found = await win.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')} ${(v.nodes[0]?.failureSummary || '').split('\n')[1] || ''}`);
    });
    assert.deepEqual(found, [], `accessibility problems on ${where}: ${found.join(' | ')}`);
  };

  await step('the welcome screen has no accessibility problems', () => problems('the welcome screen'));

  await step('a rich document has none in any of the seven themes', async () => {
    await win.click('#welcome-showcase');
    await win.waitForSelector('.page:not([hidden]) .mermaid-diagram svg');
    for (const theme of ['light', 'sepia', 'mist', 'dark', 'forest', 'dusk', 'contrast']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      await problems(`the showcase in the ${theme} theme`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  });

  await step('dialogs and Quick Open have none', async () => {
    for (const [id, sel] of [['export-pdf', '#publish[open]'], ['customize-theme', '#theme-dlg[open]'], ['ai-settings', '#ai-dlg[open]'], ['shortcuts', '#shortcuts[open]'], ['quick-open', '#palette:not([hidden])']]) {
      await menu(id);
      await win.waitForSelector(sel);
      await problems(sel);
      await win.keyboard.press('Escape');
      await win.waitForSelector(sel, { state: 'detached' }).catch(() => {});
      await win.waitForFunction((s) => !document.querySelector(s), sel);
    }
  });

  await step('page tabs: arrow keys move between tabs and Delete closes one', async () => {
    // Open the two files the way the app does when they're passed to it.
    for (const [f, n] of [[second, 2], [third, 3]]) {
      await app.evaluate(({ app: a }, file) => a.emit('open-file', { preventDefault() {} }, file), f);
      await win.waitForFunction((count) => document.querySelectorAll('.tab').length === count, n);
    }
    await win.focus('.tab.active');
    assert.equal(await win.$eval('.tab.active .tab-label', (n) => n.textContent), 'third');
    assert.equal(await win.$eval('.tab.active', (n) => n.tabIndex), 0);
    await win.keyboard.press('ArrowLeft');
    assert.equal(await win.$eval('.tab.active .tab-label', (n) => n.textContent), 'second');
    assert.equal(await win.evaluate(() => document.activeElement.classList.contains('active')), true);
    await win.keyboard.press('Home');
    assert.equal(await win.$eval('.tab.active .tab-label', (n) => n.textContent), 'showcase');
    await win.keyboard.press('End');
    assert.equal(await win.$eval('.tab.active .tab-label', (n) => n.textContent), 'third');
    await win.keyboard.press('Delete');
    await win.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
    assert.equal(await win.evaluate(() => document.activeElement.classList.contains('tab')), true, 'focus stays on the tabs');
  });

  await step('sidebar panels: arrow keys switch between Outline, Files, Search and Notes', async () => {
    await win.focus('.side-tabs [aria-selected="true"]');
    await win.keyboard.press('ArrowRight');
    assert.equal(await win.$eval('.side-tabs [aria-selected="true"]', (n) => n.dataset.panel), 'files');
    assert.equal(await win.isVisible('#side-panel-files'), true);
    await win.keyboard.press('End');
    assert.equal(await win.$eval('.side-tabs [aria-selected="true"]', (n) => n.dataset.panel), 'highlights');
    await win.keyboard.press('Home');
    assert.equal(await win.$eval('.side-tabs [aria-selected="true"]', (n) => n.dataset.panel), 'outline');
  });

  await step('Windows high-contrast mode: still no problems', async () => {
    await win.emulateMedia({ forcedColors: 'active' });
    await problems('high-contrast mode');
    await win.emulateMedia({ forcedColors: 'none' });
  });

  assert.deepEqual(errors, [], 'no page errors');
  await app.close();
  console.log('a11y e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
