// End-to-end test for v2.4 "Read, listen & share": CSV / JSON / notebooks read-only, charts, read aloud,
// focus mode, folding sections, hover previews, e-book and slide exports, and AI writing help.
// Native dialogs are answered by stubs in the main process; speech and Claude are local stand-ins.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { unzipSync, strFromU8 } = require('fflate');

const aiRequests = [];
let aiReply = 'The plan is ready.';
const aiServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    aiRequests.push(JSON.parse(raw || '{}'));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_test' });
    const send = (type, d) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
    send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of aiReply.match(/[\s\S]{1,6}/g)) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } });
    send('message_stop', {});
    res.end();
  });
});

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-read-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const guide = path.join(docs, 'guide.md');
fs.writeFileSync(guide, `---
title: Field guide
author: Neo
---
# Field guide

Welcome to the guide. It covers planning and travel. Read the [packing list](packing.md#budget) before you go.[^1]

## Planning

Start early. Book trains three weeks ahead!

\`\`\`js
console.log('not read aloud');
\`\`\`

## Travel

Trains are faster than buses.

<!-- chart: bar; title: Trips per month -->
| Month | Trips |
|---|---|
| Jan | 3 |
| Feb | 5 |

\`\`\`chart
type: line
title: Spend
Month, Euro
Jan, 120
Feb, 180
\`\`\`

Teh plan is redy.

[^1]: Updated every spring.
`);
fs.writeFileSync(path.join(docs, 'packing.md'), '# Packing list\n\nPack light.\n\n## Budget\n\nKeep €100 in cash.\n');
const csv = path.join(docs, 'sales.csv');
fs.writeFileSync(csv, 'Region,Sales,Note\nNorth,1200,steady\nSouth,980,"new shop, May"\nEast,1530,\nWest,40,small\n');
const json = path.join(docs, 'config.json');
fs.writeFileSync(json, '{"name":"neo","list":[1,2]}');
const nb = path.join(docs, 'analysis.ipynb');
fs.writeFileSync(nb, JSON.stringify({ metadata: { kernelspec: { display_name: 'Python 3', language: 'python' } }, cells: [
  { cell_type: 'markdown', source: '# Analysis' },
  { cell_type: 'code', execution_count: 1, source: 'print(6 * 7)', outputs: [{ output_type: 'stream', text: ['42\n'] }] },
] }));

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, guide, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'profile'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_AI_BASE_URL: `http://127.0.0.1:${aiServer.address().port}` },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    global.__answers = [];
    global.__save = null;
    dialog.showMessageBox = async (_w, o) => ({ response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) });
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
  });
  const answer = (...r) => app.evaluate((_e, list) => { global.__answers.push(...list); }, r);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const openFile = (f) => app.evaluate(({ app: a }, file) => a.emit('open-file', { preventDefault() {} }, file), f);
  const waitTab = (label) => win.waitForFunction((l) => document.querySelector('.tab.active .tab-label')?.textContent === l, label);
  const page = '.page:not([hidden])';
  await win.waitForSelector(`${page} h1`);
  await win.emulateMedia({ reducedMotion: 'reduce' });     // no fades to wait for
  // Speech is a stand-in that records what would be said; each sentence "ends" when the test says so.
  await win.evaluate(() => {
    window.__spoken = [];
    window.__nmrSpeech = { speak(u) { window.__spoken.push(u.text); window.__last = u; }, cancel() {}, getVoices: () => [] };
  });

  await step('charts: a ```chart block and a table marked <!-- chart --> are drawn, labelled for screen readers', async () => {
    await win.waitForSelector(`${page} figure.chart svg`);
    const labels = await win.$$eval(`${page} figure.chart svg`, (n) => n.map((s) => s.getAttribute('aria-label')));
    assert.deepEqual(labels, ['Trips per month. Bar chart. Trips: Jan 3, Feb 5', 'Spend. Line chart. Euro: Jan 120, Feb 180']);
    assert.ok(await win.$(`${page} table`), 'the table stays');
  });

  await step('read aloud: sentence by sentence from the top, skipping code; next section; Esc stops', async () => {
    await win.evaluate(() => document.getElementById('desk').scrollTo(0, 0));
    await menu('read-aloud');
    await win.waitForSelector('#speak-bar:not([hidden])');
    for (let i = 0; i < 3; i++) await win.evaluate(() => window.__last.onend());
    const spoken = await win.evaluate(() => window.__spoken);
    assert.equal(spoken[0], 'Field guide');
    assert.ok(spoken.includes('Welcome to the guide.'));
    assert.ok(!spoken.some((s) => /not read aloud/.test(s)));
    assert.equal(await win.evaluate(() => CSS.highlights.has('nmr-speak')), true, 'the sentence is highlighted');
    assert.match(await win.textContent('#speak-status'), /^\d+ of \d+$/);
    await win.click('#speak-next');
    await win.waitForFunction(() => window.__spoken.at(-1) === 'Planning');
    await win.click('#speak-next');
    await win.waitForFunction(() => window.__spoken.at(-1) === 'Travel');
    await win.click('#speak-play');
    assert.equal(await win.getAttribute('#speak-play', 'aria-label'), 'Read', 'paused');
    await win.selectOption('#speak-rate', '1.5');
    await win.click('#speak-play');
    assert.equal(await win.evaluate(() => window.__last.rate), 1.5);
    await win.keyboard.press('Escape');
    await win.waitForSelector('#speak-bar', { state: 'hidden' });
    assert.equal(await win.evaluate(() => CSS.highlights.has('nmr-speak')), false);
    const rate = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'profile', 'settings.json'), 'utf8')).readAloud?.rate; } catch { return null; } };
    for (let i = 0; i < 40 && rate() !== 1.5; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(rate(), 1.5, 'the speed is remembered');
  });

  await step('folding: fold all, the outline opens the section it goes to; exports show everything', async () => {
    await menu('fold-all');
    await win.waitForFunction(() => document.querySelectorAll('.page:not([hidden]) h2.folded').length === 2);
    assert.equal(await win.isVisible(`${page} >> text=Start early`), false);
    await win.click('#toc >> text=Travel');
    await win.waitForSelector(`${page} h2#travel:not(.folded)`);
    assert.equal(await win.isVisible(`${page} >> text=Trains are faster`), true);
    assert.equal(await win.isVisible(`${page} >> text=Start early`), false, 'Planning stays folded');
    await win.click(`${page} h2#planning .fold-btn`);
    assert.equal(await win.isVisible(`${page} >> text=Start early`), true);
    await menu('fold-all');
    await app.evaluate((_e, f) => { global.__save = f; }, path.join(tmp, 'guide.html'));
    await win.evaluate(() => { window.__lastExport = null; });
    await menu('export-html');
    await win.waitForFunction(() => window.__lastExport?.ok);
    const html = fs.readFileSync(path.join(tmp, 'guide.html'), 'utf8');
    assert.match(html, /Start early/);
    assert.doesNotMatch(html, /fold-btn|fold-hidden/);
    await menu('unfold-all');
  });

  await step('focus mode dims everything but the paragraph being read', async () => {
    await menu('focus-mode');
    await win.waitForSelector(`${page} > .in-focus`);
    assert.equal(await win.evaluate(() => document.body.classList.contains('focus-mode')), true);
    const dim = await win.$eval(`${page} > :not(.in-focus):not(.fold-hidden)`, (n) => getComputedStyle(n).opacity);
    assert.ok(Number(dim) < 0.5, `dimmed (${dim})`);
    await menu('focus-mode');
    assert.equal(await win.$(`${page} > .in-focus`), null);
  });

  await step('hover previews: a link to another document shows its section; a footnote shows its note', async () => {
    // Scrolling hides a preview, so bring the link into view first, then point at it.
    await win.evaluate(() => document.getElementById('desk').scrollTo(0, 0));
    await win.waitForTimeout(150);
    await win.hover(`${page} a[href="packing.md#budget"]`);
    await win.waitForSelector('#peek:not([hidden]) .peek-name');
    assert.equal(await win.textContent('#peek .peek-name'), 'packing.md');
    assert.match(await win.textContent('#peek'), /Budget[\s\S]*Keep €100/);
    assert.doesNotMatch(await win.textContent('#peek'), /Pack light/, 'just the linked section');
    await win.hover(`${page} .footnote-ref a`);
    await win.waitForFunction(() => /Updated every spring/.test(document.getElementById('peek').textContent));
    await win.mouse.move(5, 5);
    await win.waitForSelector('#peek', { state: 'hidden' });
  });

  await step('a CSV opens read-only as a table that sorts by any column', async () => {
    await openFile(csv);
    await waitTab('sales.csv');
    await win.waitForSelector(`${page} .sort-btn`);
    assert.equal(await win.isVisible('#btn-edit'), false, 'no Edit button');
    assert.match(await win.textContent(`${page} .data-note`), /4 rows · 3 columns/);
    const col = (i) => win.$$eval(`${page} tbody tr`, (rows, k) => rows.map((r) => r.cells[k].textContent), i);
    await win.click(`${page} th:nth-child(2) .sort-btn`);
    assert.deepEqual(await col(1), ['40', '980', '1200', '1530'], 'as numbers, not text');
    await win.click(`${page} th:nth-child(2) .sort-btn`);
    assert.deepEqual(await col(1), ['1530', '1200', '980', '40']);
    assert.equal(await win.getAttribute(`${page} th:nth-child(2)`, 'aria-sort'), 'descending');
    await win.click(`${page} th:nth-child(1) .sort-btn`);
    assert.deepEqual(await col(0), ['East', 'North', 'South', 'West']);
    await menu('toggle-edit');
    assert.equal(await win.$('.editor-host:not([hidden]) .cm-editor'), null, 'still not editable');
  });

  await step('JSON is formatted and a notebook shows its cells and saved outputs (no Run buttons)', async () => {
    await openFile(json);
    await waitTab('config.json');
    assert.match(await win.textContent(`${page} pre code`), /"name": "neo",\n {2}"list": \[/);
    await openFile(nb);
    await waitTab('analysis.ipynb');
    await win.waitForSelector(`${page} .nb-in`);
    assert.equal(await win.textContent(`${page} h1`), 'Analysis');
    assert.match(await win.textContent(`${page}`), /print\(6 \* 7\)[\s\S]*42/);
    assert.equal(await win.$(`${page} .run-btn`), null);
  });

  await step('exports: an EPUB e-book, slides as PDF, and slides as PowerPoint', async () => {
    await win.click('.tab >> text=guide');
    await waitTab('guide');
    const run = async (id, file) => {
      await app.evaluate((_e, f) => { global.__save = f; }, file);
      await win.evaluate(() => { window.__lastExport = null; });
      await menu(id);
      await win.waitForFunction(() => window.__lastExport, null, { timeout: 60000 });
      const res = await win.evaluate(() => window.__lastExport);
      assert.equal(res.ok, true, JSON.stringify(res));
      return fs.readFileSync(file);
    };
    const epub = unzipSync(new Uint8Array(await run('export-epub', path.join(tmp, 'guide.epub'))));
    assert.equal(strFromU8(epub.mimetype), 'application/epub+zip');
    assert.match(strFromU8(epub['OEBPS/content.opf']), /<dc:title>Field guide<\/dc:title>[\s\S]*<dc:creator>Neo<\/dc:creator>/);
    const chapters = Object.keys(epub).filter((n) => /chapter-\d+\.xhtml$/.test(n)).sort();
    assert.equal(chapters.length, 3, 'intro, Planning, Travel');
    assert.match(strFromU8(epub['OEBPS/chapter-1.xhtml']), /href="chapter-3\.xhtml#fn1"/, 'the footnote link points into the right chapter');
    assert.match(strFromU8(epub['OEBPS/chapter-3.xhtml']), /<svg class="chart-svg"[\s\S]*fill:#3b5bdb/, 'charts keep plain colours');
    assert.doesNotMatch(strFromU8(epub['OEBPS/chapter-1.xhtml']), /packing\.md/, 'links to files on this computer are dropped');
    const pdf = await run('export-slides', path.join(tmp, 'guide (slides).pdf'));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(pdf);
    assert.ok(doc.getPageCount() >= 4, `a page per slide (${doc.getPageCount()})`);
    const { width, height } = doc.getPage(0).getSize();
    assert.ok(Math.abs(width / height - 16 / 9) < 0.01, `16:9 pages (${width}×${height})`);
    const pptx = unzipSync(new Uint8Array(await run('export-pptx', path.join(tmp, 'guide.pptx'))));
    const slides = Object.keys(pptx).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert.ok(slides.length >= 3, `${slides.length} slides`);
    assert.ok(Object.keys(pptx).some((n) => /^ppt\/media\//.test(n)), 'the charts are pictures in the deck');
    const all = slides.map((n) => strFromU8(pptx[n])).join('');
    assert.match(all, /<a:t>Planning<\/a:t>/);
  });

  await step('AI writing help: proofread a selection, see the change, accept it, undo it', async () => {
    await menu('ai-settings');
    await win.waitForSelector('#ai-dlg[open]');
    await win.fill('#ai-key', 'sk-ant-test-0123456789abcdefghijklmn');
    await win.check('#ai-enabled');
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    await answer(0);                                    // Just This Time
    await menu('toggle-edit');
    await win.waitForSelector('.editor-host:not([hidden]) .cm-content');
    const select = (needle) => win.evaluate((n) => {
      const v = window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor'));
      const at = v.state.doc.toString().indexOf(n);
      v.dispatch({ selection: { anchor: at, head: at + n.length } });
      v.focus();
    }, needle);
    const text = () => win.evaluate(() => window.__editorKit.findView(document.querySelector('.editor-host:not([hidden]) .cm-editor')).state.doc.toString());
    await select('Teh plan is redy.');
    aiReply = 'The plan is ready.';
    await menu('ai-proofread');
    await win.waitForSelector('#ai-edit-dlg[open]');
    await win.waitForFunction(() => !document.getElementById('ai-edit-accept').disabled);
    assert.deepEqual(await win.$$eval('#ai-edit-diff del', (n) => n.map((x) => x.textContent)), ['Teh', 'redy']);
    assert.deepEqual(await win.$$eval('#ai-edit-diff ins', (n) => n.map((x) => x.textContent)), ['The', 'ready']);
    const sent = aiRequests.at(-1).messages[0].content;
    assert.match(sent, /<text>\nTeh plan is redy\.\n<\/text>/);
    assert.match(sent, /<context_before>[\s\S]*Trains are faster/);
    await win.click('#ai-edit-accept');
    await win.waitForSelector('#ai-edit-dlg', { state: 'hidden' });
    assert.match(await text(), /The plan is ready\./);
    await win.keyboard.press('ControlOrMeta+z');
    assert.match(await text(), /Teh plan is redy\./, 'one undo puts it back');
  });

  await step('translating asks for the language; Reject leaves the text alone', async () => {
    aiReply = 'El plan está listo.';
    const v = 'window.__editorKit.findView(document.querySelector(".editor-host:not([hidden]) .cm-editor"))';
    await win.evaluate((x) => { const ed = eval(x); const n = 'Teh plan is redy.'; const at = ed.state.doc.toString().indexOf(n); ed.dispatch({ selection: { anchor: at, head: at + n.length } }); ed.focus(); }, v);
    await menu('ai-translate');
    await win.waitForSelector('#ai-edit-lang:not([hidden])');
    await win.fill('#ai-edit-language', 'Spanish');
    await win.click('#ai-edit-lang button[type=submit]');
    await win.waitForFunction(() => !document.getElementById('ai-edit-accept').disabled);
    assert.match(aiRequests.at(-1).messages[0].content, /Translate the text into Spanish/);
    await win.click('#ai-edit-reject');
    await win.waitForSelector('#ai-edit-dlg', { state: 'hidden' });
    assert.match(await win.evaluate((x) => eval(x).state.doc.toString(), v), /Teh plan is redy\./);
    await menu('toggle-edit');
  });

  await step('the new controls have no accessibility problems, in light and dark themes', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const problems = async (where) => {
      const found = await win.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes[0]?.target.join(' ')}`);
      });
      assert.deepEqual(found, [], `accessibility problems in ${where}: ${found.join(' | ')}`);
    };
    for (const theme of ['light', 'dark']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      await win.click('.tab >> text=guide');
      await menu('read-aloud');
      await win.waitForSelector('#speak-bar:not([hidden])');
      await menu('fold-all');
      await problems(`the guide with charts, folded sections and the read-aloud bar (${theme})`);
      await win.keyboard.press('Escape');
      await menu('unfold-all');
      await win.click('.tab >> text=sales.csv');
      await waitTab('sales.csv');
      await problems(`the CSV table (${theme})`);
      await win.click('.tab >> text=analysis.ipynb');
      await problems(`the notebook (${theme})`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  });

  assert.deepEqual(errors, []);
  await app.close();
  aiServer.close();
  console.log('read e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
