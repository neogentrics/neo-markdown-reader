// End-to-end test for v2.2 "Write faster": pictures, tables, pasting from spreadsheets / web pages /
// Word, version history, replace in folder, commands in Quick Open and your own shortcuts.
// Native dialogs are answered by stubs in the main process (see editing.e2e.cjs).
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-write-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
const notes = path.join(docs, 'notes.md');
const plan = path.join(docs, 'plan.md');
const other = path.join(docs, 'sub', 'other.md');
fs.writeFileSync(notes, '# Notes\n\nFirst line.\n');
fs.writeFileSync(plan, '# Plan\n\nAsk Acme about the Acme logo.\n');
fs.writeFileSync(other, '# Other\n\nAcme again.\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, notes, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));

  await app.evaluate(({ dialog }) => {
    global.__answers = [];
    global.__asked = [];
    global.__open = null;
    global.__save = null;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(o.message); return { response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) }; };
    dialog.showOpenDialog = async () => (global.__open ? { canceled: false, filePaths: [global.__open] } : { canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
  });
  const answer = (...r) => app.evaluate((_e, list) => { global.__answers.push(...list); global.__asked = []; }, r);
  const asked = () => app.evaluate(() => global.__asked);
  const setOpen = (p) => app.evaluate((_e, v) => { global.__open = v; }, p);
  const setSave = (p) => app.evaluate((_e, v) => { global.__save = v; }, p);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const editorText = () => win.evaluate(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString());
  const putCursor = (needle) => win.evaluate((n) => {
    const view = window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor'));
    const at = view.state.doc.toString().indexOf(n);
    view.dispatch({ selection: { anchor: at < 0 ? view.state.doc.length : at } });
    view.focus();
  }, needle);
  /** Fire a paste on the editor with the given clipboard contents. */
  const paste = (clip) => win.evaluate(({ text, html, png }) => {
    const dt = new DataTransfer();
    if (text) dt.setData('text/plain', text);
    if (html) dt.setData('text/html', html);
    if (png) dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }));
    document.querySelector('.editor-host:not([hidden]) .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, clip);

  await win.waitForSelector('.page:not([hidden]) #notes', { timeout: 20000 });
  await answer(0);                                         // Just This Time
  await win.click('#btn-edit');
  await win.waitForSelector('.cm-editor', { timeout: 10000 });

  await step('a pasted screenshot is saved in an images folder next to the document and linked', async () => {
    await putCursor('First line.');
    await paste({ png: PNG.toString('base64') });
    await win.waitForFunction(() => /!\[Pasted image\]\(images\/pasted-[\d-]+\.png\)/.test(window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString()), null, { timeout: 5000 });
    const saved = fs.readdirSync(path.join(docs, 'images'));
    assert.equal(saved.length, 1);
    assert.ok(fs.readFileSync(path.join(docs, 'images', saved[0])).equals(PNG));
    await win.waitForSelector('.page:not([hidden]) img[src*="images/pasted-"]', { timeout: 5000 });
  });

  await step('a picture dropped on the editor is saved under its own name at the drop point', async () => {
    await win.evaluate((png) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'team photo.png', { type: 'image/png' }));
      const el = document.querySelector('.editor-host:not([hidden]) .cm-content');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 20, clientY: r.top + 10, bubbles: true, cancelable: true }));
    }, PNG.toString('base64'));
    await win.waitForFunction(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString().includes('](images/team-photo.png)'), null, { timeout: 5000 });
    assert.ok(fs.existsSync(path.join(docs, 'images', 'team-photo.png')));
  });

  await step('cells pasted from a spreadsheet become a Markdown table', async () => {
    await putCursor('');
    await paste({ text: 'Fruit\tCount\nApple\t3\nKiwi\t12\n', html: '<table><tr><td>Fruit</td><td>Count</td></tr></table>' });
    await win.waitForFunction(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString().includes('| Fruit | Count |'), null, { timeout: 5000 });
    assert.match(await editorText(), /\| Fruit \| Count \|\n\| ----- \| ----: \|\n\| Apple \|     3 \|/);
    await win.waitForSelector('.page:not([hidden]) table td', { timeout: 5000 });
  });

  await step('formatted text from a web page or Word is pasted as Markdown (scripts dropped)', async () => {
    await putCursor('');
    await paste({ text: 'Agenda Budget', html: '<h3>Agenda</h3><ul><li><b>Budget</b></li><li>Hiring</li></ul><script>alert(1)</script>' });
    await win.waitForFunction(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString().includes('### Agenda'), null, { timeout: 5000 });
    assert.match(await editorText(), /### Agenda\n\n- \*\*Budget\*\*\n- Hiring/);
    assert.ok(!(await editorText()).includes('alert'));
  });

  await step('Edit Table edits the table under the cursor in a grid', async () => {
    await putCursor('| Apple');
    await win.click('#fmt-bar button[data-cmd="table"]');
    await win.waitForSelector('#table-dlg[open] input[data-r="0"][data-c="0"]');
    assert.equal(await win.$eval('#table-dlg-title', (n) => n.textContent), 'Edit Table');
    await win.fill('#table-grid input[data-r="0"][data-c="0"]', 'Green apple');
    await win.click('#table-add-row');
    await win.fill('#table-grid input[data-r="2"][data-c="0"]', 'Pear');
    await win.fill('#table-grid input[data-r="2"][data-c="1"]', '7');
    await win.click('#table-grid button[aria-label="Move row 3 up"]');
    await win.click('#table-ok');
    await win.waitForFunction(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString().includes('| Green apple |'), null, { timeout: 5000 });
    assert.match(await editorText(), /\| Fruit       \| Count \|\n\| ----------- \| ----: \|\n\| Green apple \|     3 \|\n\| Pear        \|     7 \|\n\| Kiwi        \|    12 \|/);
  });

  await step('saving keeps the earlier version: History compares and restores it', async () => {
    await menu('save');
    await win.waitForFunction(() => !document.querySelector('.tab.active').classList.contains('dirty'), null, { timeout: 5000 });
    await menu('panel-history');
    await win.waitForSelector('#hist-list .hist-item', { timeout: 5000 });
    assert.equal(await win.$$eval('#hist-list .hist-item', (n) => n.length), 1);
    assert.match(await win.$eval('#hist-list .hist-when span', (n) => n.textContent), /Before saving/);
    await win.click('#hist-list .hist-item button:has-text("Compare")');
    await win.waitForSelector('.page:not([hidden]).compare-page', { timeout: 5000 });
    await menu('close-tab');
    await win.waitForSelector('.page:not([hidden]) #notes');
    await answer(0);                                     // confirm Restore
    await win.click('#hist-list .hist-item button:has-text("Restore")');
    await win.waitForTimeout(600);
    assert.match((await asked())[0], /Restore “notes\.md” to the version from/);
    assert.equal(fs.readFileSync(notes, 'utf8'), '# Notes\n\nFirst line.\n');
    await win.waitForFunction(() => !window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString().includes('Fruit'), null, { timeout: 5000 });
    await win.waitForFunction(() => document.querySelectorAll('#hist-list .hist-item').length === 2, null, { timeout: 5000 });
    assert.match(await win.$eval('#hist-list .hist-when span', (n) => n.textContent), /Before restoring/);
  });

  await step('Replace in Folder previews every match, changes only ticked ones, and undoes the batch', async () => {
    await menu('toggle-edit');                           // Done
    await win.waitForFunction(() => !document.body.classList.contains('editing'));
    await setOpen(docs);
    await menu('open-folder');
    await win.waitForSelector('#files-body .file-item', { timeout: 5000 });
    await menu('replace-in-folder');
    await win.waitForSelector('#replace-box:not([hidden])');
    await win.fill('#folder-search', 'Acme');
    await win.fill('#folder-replace', 'Globex');
    await win.click('#rep-preview');
    await win.waitForSelector('.replace-hit', { timeout: 5000 });
    assert.equal(await win.$$eval('.replace-hit', (n) => n.length), 3);
    assert.match(await win.$eval('.replace-hit .hit-text', (n) => n.innerHTML), /<del>Acme<\/del><ins>Globex<\/ins>/);
    await win.click('.replace-file:has-text("plan.md") .replace-hit:nth-of-type(2) input');      // keep the second Acme in plan.md
    assert.equal(await win.$eval('.replace-apply', (n) => n.textContent), 'Replace 2');
    await answer(0);
    await win.click('.replace-apply');
    await win.waitForFunction(() => /Replaced 2 in 2 files/.test(document.getElementById('search-summary').textContent), null, { timeout: 8000 });
    assert.match((await asked())[0], /Replace 2 matches in 2 files\?/);
    assert.equal(fs.readFileSync(plan, 'utf8'), '# Plan\n\nAsk Globex about the Acme logo.\n');
    assert.equal(fs.readFileSync(other, 'utf8'), '# Other\n\nGlobex again.\n');
    await answer(0);
    await win.click('#rep-undo');
    await win.waitForFunction(() => document.getElementById('rep-undo').hidden, null, { timeout: 5000 });
    assert.equal(fs.readFileSync(plan, 'utf8'), '# Plan\n\nAsk Acme about the Acme logo.\n');
    assert.equal(fs.readFileSync(other, 'utf8'), '# Other\n\nAcme again.\n');
  });

  await step('a bad pattern gets a plain explanation and changes nothing', async () => {
    await win.check('#rep-regex');
    await win.fill('#folder-search', '(Acme');
    await win.click('#rep-preview');
    await win.waitForFunction(() => /isn’t valid/.test(document.getElementById('search-summary').textContent), null, { timeout: 5000 });
    await win.uncheck('#rep-regex');
  });

  await step('File › Import Word Document converts a .docx, with its pictures, and opens it', async () => {
    const docx = require('docx');
    const d = new docx.Document({ sections: [{ children: [
      new docx.Paragraph({ text: 'Quarterly Review', heading: docx.HeadingLevel.HEADING_1 }),
      new docx.Paragraph({ children: [new docx.TextRun('Revenue '), new docx.TextRun({ text: 'grew', bold: true })] }),
      new docx.Paragraph({ children: [new docx.ImageRun({ type: 'png', data: PNG, transformation: { width: 10, height: 10 } })] }),
    ] }] });
    const src = path.join(docs, 'Quarterly Review.docx');
    fs.writeFileSync(src, await docx.Packer.toBuffer(d));
    const out = path.join(docs, 'quarterly.md');
    await setOpen(src);
    await setSave(out);
    await menu('import-docx');
    await win.waitForSelector('.page:not([hidden]) #quarterly-review', { timeout: 10000 });
    assert.equal(fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n'), '# Quarterly Review\n\nRevenue **grew**\n\n![](images/Quarterly-Review-1.png)\n');
    assert.ok(fs.existsSync(path.join(docs, 'images', 'Quarterly-Review-1.png')));
    await win.waitForSelector('.page:not([hidden]) img[src*="Quarterly-Review-1.png"]');
  });

  await step('typing > in Quick Open runs any menu command by name', async () => {
    await menu('quick-open');
    await win.waitForSelector('#palette:not([hidden])');
    await win.keyboard.type('>show files');
    await win.waitForSelector('#palette-list .kind-command', { timeout: 5000 });
    assert.match(await win.$eval('#palette-list .kind-command .pi-label', (n) => n.textContent), /Show Files/);
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => document.querySelector('.side-tabs button.active')?.dataset.panel === 'files', null, { timeout: 5000 });
  });

  await step('a shortcut can be changed, clashes are explained, and everything can be reset', async () => {
    const accel = (id) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu().getMenuItemById(i).accelerator || '', id);
    await menu('customize-shortcuts');
    await win.waitForSelector('#keys-dlg[open] .keys-row');
    await win.fill('#keys-filter', 'print');
    await win.click('.keys-row:has-text("Print") button:has-text("Change")');
    await win.waitForSelector('.keys-row.recording');
    await win.keyboard.press('ControlOrMeta+Alt+J');
    await win.waitForFunction(() => !document.querySelector('.keys-row.recording'), null, { timeout: 5000 });
    assert.equal(await accel('print'), 'CmdOrCtrl+Alt+J');
    await win.click('.keys-row:has-text("Print") button:has-text("Change")');
    await win.keyboard.press('ControlOrMeta+K');                             // already Go to File or Heading
    await win.waitForSelector('#keys-msg button', { timeout: 5000 });
    assert.match(await win.$eval('#keys-msg', (n) => n.textContent), /already used by Go to File or Heading/);
    await win.click('#keys-msg button');
    await win.waitForFunction(() => document.getElementById('keys-msg').textContent === '');
    assert.equal(await accel('print'), 'CmdOrCtrl+K');
    assert.equal(await accel('quick-open'), '');
    await answer(0);
    await win.click('#keys-reset-all');
    await win.waitForTimeout(400);
    assert.equal(await accel('print'), 'CmdOrCtrl+P');
    assert.equal(await accel('quick-open'), 'CmdOrCtrl+K');
    await win.click('#keys-close');
  });

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  await app.close();
  console.log('write e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
