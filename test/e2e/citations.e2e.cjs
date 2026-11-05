// End-to-end test for citations (3.6): a document with its own bibliography, your library from a file or from a
// stand-in for Zotero, changing style, inserting a citation, and the citations in exported files.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const { PDFDocument } = require('pdf-lib');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cite-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const bib = path.join(docs, 'refs.bib');
fs.writeFileSync(bib, `
@article{smith2020, author = {Smith, John A. and Jones, Bob}, title = {Title of paper}, journal = {Journal of Testing}, year = 2020, volume = 12, number = 3, pages = {45--67}, doi = {10.1000/xyz}}
@book{lee2018, author = {Lee, Kim}, title = {A book}, publisher = {Big Press}, year = 2018}
`);
const paper = path.join(docs, 'paper.md');
fs.writeFileSync(paper, '---\ntitle: A Paper\nbibliography: refs.bib\n---\n\n# Start\n\nAs shown [@smith2020, p. 4], and [see @lee2018]. An unknown one [@nobody].\n');
const styled = path.join(docs, 'styled.md');
fs.writeFileSync(styled, '---\nbibliography: refs.bib\ncitation-style: mla\n---\n\nAs shown [@smith2020, p. 4].\n');
const gone = path.join(docs, 'gone.md');
fs.writeFileSync(gone, '---\nbibliography: missing.bib\n---\n\nAs shown [@smith2020].\n');
const reaching = path.join(docs, 'reaching.md');
fs.writeFileSync(reaching, '---\nbibliography: "\\\\\\\\127.0.0.1\\\\share\\\\refs.bib"\n---\n\nAs shown [@smith2020].\n');
const notBib = path.join(docs, 'notbib.md');
fs.writeFileSync(notBib, '---\nbibliography: ../profile/settings.txt\n---\n\nAs shown [@smith2020].\n');
const plain = path.join(docs, 'plain.md');
fs.writeFileSync(plain, '# Plain\n\nAs shown [@lib2021] by @lib2021. Say hello to @someone [@someone].\n');
const library = path.join(tmp, 'library.json');
fs.writeFileSync(library, JSON.stringify([{ id: 'lib2021', type: 'book', title: 'From the library', author: [{ family: 'Library', given: 'Lee' }], issued: { 'date-parts': [[2021]] }, publisher: 'Press' }]));

let zoteroUp = true;
const asked = [];
const zotero = http.createServer((req, res) => {
  asked.push({ url: req.url, header: req.headers['zotero-allowed-request'] });
  if (!zoteroUp) { res.writeHead(403); res.end('Request not allowed'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify([
    { data: { itemType: 'book', title: 'Out of Zotero', creators: [{ creatorType: 'author', firstName: 'Zoe', lastName: 'Tero' }], date: '2022', publisher: 'Z Press', citationKey: 'tero2022' } },
    { data: { itemType: 'attachment', title: 'A PDF' } },
  ]));
});

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

(async () => {
  await new Promise((r) => zotero.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), paper],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1', NMR_ZOTERO_URL: `http://127.0.0.1:${zotero.address().port}/items` },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, file) => {
    global.__save = null;
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, library);
  const saveTo = (p) => app.evaluate((_e, file) => { global.__save = file; }, p);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const openDoc = async (p) => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, p);
    await menu('open');
    await win.waitForFunction((name) => document.querySelector('.tab.active, .tab[aria-selected="true"]')?.textContent.includes(name), path.basename(p, '.md'));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, library);
  };
  const pageText = () => win.textContent('.page:not([hidden])');
  const pageHas = (re) => win.waitForFunction((src) => new RegExp(src).test(document.querySelector('.page:not([hidden])').textContent), re.source);
  const exported = async (p) => {
    for (let i = 0; i < 200 && !fs.existsSync(p); i++) await new Promise((r) => setTimeout(r, 150));
    await win.waitForFunction(() => !document.body.classList.contains('exporting'), null, { timeout: 60000 });
    assert.ok(fs.existsSync(p), `${path.basename(p)} was not written`);
    return fs.readFileSync(p);
  };
  await win.waitForSelector('.page:not([hidden]) h1');

  await step('a document’s own bibliography gives it citations and a reference list', async () => {
    await pageHas(/\(Smith & Jones, 2020, p\. 4\)/);
    const text = await pageText();
    assert.match(text, /\(see Lee, 2018\)/);
    assert.match(text, /References/);
    assert.match(text, /Lee, K\. \(2018\)\. A book\. Big Press\./);
    assert.match(text, /Smith, J\. A\., & Jones, B\. \(2020\)\. Title of paper\. Journal of Testing, 12\(3\), 45–67\./);
    assert.ok(text.indexOf('Lee, K. (2018)') < text.indexOf('Smith, J. A.'), 'alphabetical');
    assert.doesNotMatch(text, /refs\.bib/, 'the front matter isn’t shown');
    assert.equal(await win.textContent('.page:not([hidden]) .cite-missing'), '@nobody');
    assert.match(await win.textContent('#side-panel-outline'), /References/, 'the list is in the outline');
  });

  await step('a citation goes to its line in the list', async () => {
    await win.click('.page:not([hidden]) a.citation >> nth=0');
    await win.waitForFunction(() => {
      const el = document.getElementById('ref-smith2020');
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  });

  await step('changing the style redraws the page', async () => {
    await menu('citations');
    await win.waitForSelector('#cite-dlg[open]');
    await win.selectOption('#cite-style', 'mla');
    await pageHas(/\(Smith and Jones 4\)/);
    assert.match(await pageText(), /Works Cited/);
    await win.selectOption('#cite-style', 'ieee');
    await pageHas(/\[1, p\. 4\]/);
    await win.selectOption('#cite-style', 'chicago');
    await pageHas(/\(Smith and Jones 2020, 4\)/);
    await win.selectOption('#cite-style', 'harvard');
    await pageHas(/\(Smith and Jones, 2020, p\. 4\)/);
    assert.match(await pageText(), /Reference list/);
    await win.selectOption('#cite-style', 'apa');
    await pageHas(/\(Smith & Jones, 2020, p\. 4\)/);
    await win.click('#cite-close');
  });

  await step('a change to the bibliography file shows on reload', async () => {
    fs.appendFileSync(bib, '\n@book{nobody, author = {Nobody, Ann}, title = {Found}, publisher = {P}, year = 2001}\n');
    await new Promise((r) => setTimeout(r, 2100));
    await menu('reload');
    await pageHas(/\(Nobody, 2001\)/);
    assert.equal(await win.locator('.page:not([hidden]) .cite-missing').count(), 0);
  });

  await step('a document can set its own style', async () => {
    await openDoc(styled);
    await pageHas(/\(Smith and Jones 4\)/);
    await menu('citations');
    await win.waitForSelector('#cite-dlg[open]');
    assert.equal(await win.isVisible('#cite-style-note'), true);
    await win.click('#cite-close');
  });

  await step('a missing file says so, and the page still shows', async () => {
    await openDoc(gone);
    await win.waitForFunction(() => /wasn’t found/.test(document.getElementById('toast').textContent));
    assert.match(await pageText(), /\[@smith2020\]/);
  });

  await step('a document can’t reach a network share or read other kinds of file', async () => {
    await openDoc(reaching);
    await win.waitForFunction(() => /relative to this document/.test(document.getElementById('toast').textContent));
    assert.match(await pageText(), /\[@smith2020\]/);
    await openDoc(notBib);
    await win.waitForFunction(() => /notbib|settings\.txt/.test(document.getElementById('toast').textContent));
    assert.match(await pageText(), /\[@smith2020\]/);
  });

  await step('your library works in every document, and leaves @mentions alone', async () => {
    await openDoc(plain);
    assert.match(await pageText(), /\[@lib2021\]/);
    await menu('citations');
    await win.waitForSelector('#cite-dlg[open]');
    assert.match(await win.textContent('#cite-none'), /Choose a BibTeX/);
    await win.click('#cite-choose');
    await win.waitForSelector('.cite-row');
    assert.equal(await win.textContent('#cite-source'), 'library.json · 1');
    await pageHas(/\(Library, 2021\) by Library \(2021\)/);
    const text = await pageText();
    assert.match(text, /@someone \[@someone\]/);
    assert.match(text, /Library, L\. \(2021\)\. From the library\. Press\./);
  });

  await step('the window finds a source, and copies its citation while reading', async () => {
    await win.fill('#cite-search', 'nothing like this');
    assert.equal(await win.locator('.cite-row').count(), 0);
    assert.equal(await win.textContent('#cite-none'), 'No sources match.');
    await win.fill('#cite-search', 'library 2021');
    await win.fill('#cite-page', '7');
    await win.click('.cite-row');
    await win.waitForFunction(() => !document.querySelector('#cite-dlg[open]'));
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '[@lib2021, p. 7]');
  });

  await step('while editing, a citation goes in at the cursor', async () => {
    await menu('toggle-edit');
    await win.waitForSelector('.cm-content:visible');
    await win.click('.cm-content:visible');
    await win.keyboard.press('Control+End');
    await menu('citations');
    await win.waitForSelector('#cite-dlg[open]');
    await win.keyboard.type('library');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => !document.querySelector('#cite-dlg[open]'));
    await win.waitForFunction(() => /\[@lib2021\]\s*$/.test(document.querySelector('.cm-content').innerText.trim()));
  });

  await step('the editor offers your sources after [@', async () => {
    await win.keyboard.press('Enter');
    await win.keyboard.type('Also [@li');
    await win.waitForSelector('.cm-tooltip-autocomplete');
    assert.match(await win.textContent('.cm-tooltip-autocomplete'), /lib2021/);
    await win.keyboard.press('Enter');
    await win.keyboard.type(']');
    await win.waitForFunction(() => /Also \[@lib2021\]/.test(document.querySelector('.cm-content').innerText));
  });

  await step('Zotero on this computer can be your library', async () => {
    await menu('citations');
    await win.waitForSelector('#cite-dlg[open]');
    await win.click('#cite-zotero');
    await win.waitForFunction(() => document.getElementById('cite-source').textContent === 'Zotero · 1');
    assert.equal(asked[0].header, '1');
    assert.match(await win.textContent('.cite-row'), /Out of Zotero/);
    assert.equal(await win.isVisible('#cite-refresh'), true);
  });

  await step('the window has no accessibility problems', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.evaluate(axeSource);
    for (const theme of ['light', 'dark', 'blue']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      const found = await win.evaluate(async () => {
        const r = await window.axe.run(document.getElementById('cite-dlg'), { resultTypes: ['violations'] });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
      });
      assert.deepEqual(found, [], `${theme}: ${found.join(' | ')}`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  });

  await step('when Zotero says no, the window says what to do, and the library it has is kept', async () => {
    zoteroUp = false;
    await win.click('#cite-refresh');
    await win.waitForFunction(() => /Allow other applications/.test(document.getElementById('cite-msg').textContent));
    assert.equal(await win.textContent('#cite-source'), 'Zotero · 1');
    await win.click('#cite-remove');
    await win.waitForFunction(() => document.getElementById('cite-source').textContent === 'No library chosen yet');
    await win.click('#cite-close');
  });

  await step('citations and the list reach every export', async () => {
    await openDoc(paper);
    await pageHas(/\(Smith & Jones, 2020, p\. 4\)/);

    const html = path.join(tmp, 'paper.html');
    await saveTo(html);
    await menu('export-html');
    const web = (await exported(html)).toString('utf8');
    assert.match(web, /Smith &amp; Jones, 2020, p\. 4/);
    assert.match(web, /id="ref-smith2020"/);
    assert.match(web, /class="csl-entry"/);
    assert.match(web, /\.csl-entry|csl-entry\s*\{/, 'with the hanging indent');

    const txt = path.join(tmp, 'paper.txt');
    await saveTo(txt);
    await menu('export-txt');
    const text = (await exported(txt)).toString('utf8');
    assert.match(text, /\(Smith & Jones, 2020, p\. 4\)/);
    assert.match(text, /Lee, K\. \(2018\)\. A book\. Big Press\./);

    const docx = path.join(tmp, 'paper.docx');
    await saveTo(docx);
    await menu('export-docx');
    const xml = strFromU8(unzipSync(new Uint8Array(await exported(docx)))['word/document.xml']);
    assert.ok(xml.includes('Smith &amp; Jones, 2020, p. 4'), 'the citation');
    assert.ok(xml.includes('References'), 'the heading');
    assert.ok(xml.includes('Big Press'), 'the list');
    assert.match(xml, /<w:i\/>[\s\S]{0,200}A book/, 'titles keep their italics');

    const epub = path.join(tmp, 'paper.epub');
    await saveTo(epub);
    await menu('export-epub');
    const book = unzipSync(new Uint8Array(await exported(epub)));
    const pages = Object.keys(book).filter((n) => /chapter-\d+\.xhtml$/.test(n)).map((n) => strFromU8(book[n])).join('\n');
    assert.match(pages, /class="csl-entry"[^>]*id="ref-lee2018"|id="ref-lee2018"[^>]*class="csl-entry"/);
    assert.match(pages, /href="(?:chapter-\d+\.xhtml)?#ref-smith2020"/);

    const pdf = path.join(tmp, 'paper.pdf');
    await saveTo(pdf);
    await menu('export-pdf');
    await win.waitForSelector('#publish[open]');
    await win.click('#publish-go');
    const doc = await PDFDocument.load(await exported(pdf));
    assert.ok(doc.getPageCount() >= 1);
  });

  await step('the style is remembered, and no errors in the page', async () => {
    await win.evaluate(() => window.reader.setSettings({ citeStyle: 'ieee' }));
    await pageHas(/\[1, p\. 4\]/);
    for (let i = 0; i < 30 && !/"citeStyle":\s*"ieee"/.test(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'), /"citeStyle":\s*"ieee"/);
    assert.deepEqual(errors, []);
  });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  zotero.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
