// End-to-end test for v3.0 "Make it yours": the app in your language, right-to-left documents, and
// add-ons (install with approval, code blocks drawn in the sandbox, a colour theme, an export format,
// turning off and removing). Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const i18n = require('../../src/main/i18n.js');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-yours-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const plan = path.join(docs, 'plan.md');
fs.writeFileSync(plan, `# Launch plan

Open the shop in spring.

## Outline

\`\`\`timeline
2026-03: Design
2026-04: Build
2026-05: Launch
\`\`\`

## Budget

Keep it small.
`);
const rtl = path.join(docs, 'arabic.md');
fs.writeFileSync(rtl, '---\nlang: ar\n---\n# خطة الإطلاق\n\nنفتح المتجر في الربيع.\n\n- التصميم\n- البناء\n\n> اقتباس قصير\n');
// The sample add-on, packed the way it's shared: a zip with the add-on in a folder.
const extras = path.join(root, 'samples', 'addons', 'neo-extras');
const pkg = path.join(tmp, 'neo-extras.nmraddon');
fs.writeFileSync(pkg, zipSync(Object.fromEntries(fs.readdirSync(extras).map((f) => [`neo-extras/${f}`, new Uint8Array(fs.readFileSync(path.join(extras, f)))]))));
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const de = i18n.createTranslator('de');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const profile = path.join(tmp, 'profile');
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, plan, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    global.__boxes = [];
    global.__answers = [];
    global.__open = null;
    global.__save = null;
    dialog.showMessageBox = async (_w, o) => { global.__boxes.push(o); return { response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) }; };
    dialog.showOpenDialog = async () => (global.__open ? { canceled: false, filePaths: [global.__open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async (_w, o) => { global.__saveAsked = o; return global.__save ? { canceled: false, filePath: global.__save } : { canceled: true }; };
  });
  const set = (key, value) => app.evaluate((_e, [k, v]) => { global[k] = v; }, [key, value]);
  const answer = (...r) => app.evaluate((_e, list) => { global.__answers.push(...list); }, r);
  const lastBox = () => app.evaluate(() => global.__boxes.at(-1));
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  // macOS puts the app's own menu (named after the app, never translated) first; the rest are ours.
  const menuLabels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label))
    .then((l) => (process.platform === 'darwin' ? l.slice(1) : l));
  const findMenu = (re) => app.evaluate(({ Menu }, src) => {
    const r = new RegExp(src); const out = [];
    const walk = (m) => m.items.forEach((i) => { if (r.test(i.label)) out.push(i.label); if (i.submenu) walk(i.submenu); });
    walk(Menu.getApplicationMenu());
    return out;
  }, re.source);
  const openFile = (f) => app.evaluate(({ app: a }, file) => a.emit('open-file', { preventDefault() {} }, file), f);
  const waitTab = (label) => win.waitForFunction((l) => document.querySelector('.tab.active .tab-label')?.textContent === l, label);
  const savedSettings = () => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); } catch { return {}; } };
  const waitSaved = async (test) => { for (let i = 0; i < 50 && !test(savedSettings()); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(test(savedSettings()), 'saved'); };
  const page = '.page:not([hidden])';
  await win.waitForSelector(`${page} h1`);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  const problems = async (where) => {
    await win.evaluate(axeSource);
    const found = await win.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')} ${(v.nodes[0]?.failureSummary || '').split('\n')[1] || ''}`);
    });
    assert.deepEqual(found, [], `accessibility problems on ${where}: ${found.join(' | ')}`);
  };

  await step('View › Language › Deutsch: menus, the screen and dialogs switch; the document doesn’t', async () => {
    assert.equal((await menuLabels())[0], '&File');
    await menu('language-de');
    await win.waitForFunction(() => document.documentElement.lang === 'de');
    assert.deepEqual(await menuLabels(), ['&File', '&Edit', '&View', '&Tabs', '&Help'].map(de));
    assert.equal(await win.textContent('#side-tab-outline'), de('Outline'));
    assert.equal(await win.getAttribute('#side-tab-search', 'title'), de('Find in folder (Ctrl+Shift+F)'));
    assert.equal(await win.textContent(`${page} h2#outline`), 'Outline', 'the document stays as written');
    assert.equal(await win.textContent('#toc >> text=Outline'), 'Outline', 'and so does its outline');
    await waitSaved((s) => s.language === 'de');
    const checked = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('language-de').checked);
    assert.equal(checked, true);
  });

  await step('install an add-on: the approval box says what it will do, in the chosen language', async () => {
    await menu('addons');
    await win.waitForSelector('#addons-dlg[open]');
    assert.equal(await win.textContent('#addons-h'), de('Add-ons'));
    await set('__open', pkg);
    await answer(1);                                   // Cancel first: nothing is installed
    await win.click('#addons-install');
    for (let i = 0; i < 50 && !(await lastBox()); i++) await new Promise((r) => setTimeout(r, 100));
    const box = await lastBox();
    assert.equal(box.message, de('Install “Neo Extras” 1.0.0?'));
    assert.deepEqual(box.buttons, [de('Install'), de('Cancel')]);
    assert.match(box.detail, new RegExp(de('Adds the light theme “Solar”.').replace(/[.()]/g, '\\$&')));
    assert.ok(box.detail.includes(de('Adds File › Export › Outline (OPML) (.opml).')));
    assert.equal(await win.$('#addons-list .addon-row'), null, 'cancelled: not installed');
    await answer(0);
    await win.click('#addons-install');
    await win.waitForSelector('#addons-list .addon-row');
    assert.equal(await win.textContent('#addons-list .addon-name b'), 'Neo Extras', 'names stay as written');
    assert.ok(fs.existsSync(path.join(profile, 'addons', 'neo-extras', 'addon.json')));
    await problems('the Add-ons dialog');
  });

  await step('back to English; the add-on draws its code blocks in the sandbox', async () => {
    await win.click('#addons-done');
    await menu('language-en');
    await win.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await win.textContent('#side-tab-outline'), 'Outline');
    await win.waitForSelector(`${page} figure.addon-block[data-addon="neo-extras"] svg`, { timeout: 15000 });
    const text = await win.textContent(`${page} figure.addon-block`);
    assert.match(text, /Design[\s\S]*Build[\s\S]*Launch/);
    assert.equal(await win.$(`${page} pre.code-block[data-lang="timeline"]`), null);
  });

  await step('the add-on’s theme is in View › Theme and colours the app', async () => {
    assert.deepEqual(await findMenu(/Solar/), ['Solar (Neo Extras)']);
    await win.evaluate(() => window.reader.setSettings({ theme: 'addon:neo-extras:solar' }));
    await win.waitForFunction(() => document.documentElement.dataset.addonTheme === 'neo-extras:solar');
    assert.equal(await win.evaluate(() => document.documentElement.dataset.theme), 'light', 'over the light theme');
    const bg = await win.$eval(page, (n) => getComputedStyle(n).backgroundColor);
    assert.equal(bg, 'rgb(253, 246, 227)');
    await problems('a document in an add-on theme');
  });

  await step('File › Export gets the add-on’s format; the file is what its script made', async () => {
    assert.deepEqual(await findMenu(/OPML/), ['Outline (OPML) (.opml)…']);
    const out = path.join(tmp, 'plan.opml');
    await set('__save', out);
    await win.evaluate(() => { window.__lastExport = null; });
    await app.evaluate(({ Menu }) => {
      const walk = (m) => { for (const i of m.items) { if (i.label === 'Outline (OPML) (.opml)…') return i; const f = i.submenu && walk(i.submenu); if (f) return f; } return null; };
      walk(Menu.getApplicationMenu()).click();
    });
    await win.waitForFunction(() => window.__lastExport?.ok);
    const xml = fs.readFileSync(out, 'utf8');
    assert.match(xml, /^<\?xml/);
    assert.match(xml, /<title>Launch plan<\/title>/);
    assert.match(xml, /<outline text="Launch plan"><outline text="Outline"><\/outline><outline text="Budget"><\/outline><\/outline>/);
    const asked = await app.evaluate(() => global.__saveAsked);
    assert.match(asked.defaultPath, /plan\.opml$/);
  });

  await step('turning the add-on off puts the code back and takes its menu items away', async () => {
    await menu('addons');
    await win.waitForSelector('#addons-dlg[open] .addon-row');
    await win.click('#addons-list .addon-row input[type=checkbox]');
    await win.waitForSelector('#addons-list .addon-row.off');
    await win.waitForSelector(`${page} pre.code-block[data-lang="timeline"]`);
    assert.equal(await win.$(`${page} figure.addon-block`), null);
    await waitSaved((s) => (s.addonsOff || []).includes('neo-extras'));
    assert.deepEqual(await findMenu(/OPML|Solar/), []);
    assert.equal(await win.evaluate(() => document.documentElement.dataset.addonTheme), undefined, 'its theme is off too');
    await win.click('#addons-list .addon-row input[type=checkbox]');
    await win.waitForSelector(`${page} figure.addon-block svg`);
  });

  await step('removing it asks first, then puts the built-in theme back', async () => {
    await answer(1);
    await win.click('#addons-list .addon-row .link-btn');
    for (let i = 0; i < 50 && !/Remove/.test((await lastBox())?.title || ''); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await lastBox()).message, 'Remove “Neo Extras”?');
    assert.ok(await win.$('#addons-list .addon-row'), 'kept when cancelled');
    await answer(0);
    await win.click('#addons-list .addon-row .link-btn');
    await win.waitForFunction(() => !document.querySelector('#addons-list .addon-row'));
    assert.equal(fs.existsSync(path.join(profile, 'addons', 'neo-extras')), false);
    await win.waitForSelector(`${page} pre.code-block[data-lang="timeline"]`);
    await waitSaved((s) => s.theme === 'system');
    await win.click('#addons-done');
  });

  await step('an Arabic document reads right to left; its lists and quotes turn too', async () => {
    await openFile(rtl);
    await waitTab('arabic');
    await win.waitForSelector(`${page}[dir="rtl"]`);
    assert.equal(await win.getAttribute(page, 'lang'), 'ar');
    const dirs = await win.$$eval(`${page} h1, ${page} p, ${page} ul, ${page} blockquote`, (n) => n.map((e) => getComputedStyle(e).direction));
    assert.ok(dirs.length >= 4 && dirs.every((d) => d === 'rtl'), dirs.join(','));
    const pad = await win.$eval(`${page} ul`, (n) => getComputedStyle(n).paddingRight);
    assert.notEqual(pad, '0px', 'bullets on the right');
    await problems('a right-to-left document');
  });

  assert.deepEqual(errors, []);
  await app.close();
  console.log('v3.0 end-to-end: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
