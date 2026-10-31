// End-to-end test for v1.4: the PDF designer, Word / web page / plain-text export, presentation
// mode and custom themes. Native dialogs are answered by stubs in the main process.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { unzipSync, strFromU8 } = require('fflate');

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-pub-'));
const profile = path.join(tmp, 'profile');
const doc = path.join(tmp, 'Quarterly report.md');
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(tmp, 'logo.png'));
const filler = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} of the report, with enough words in it to fill most of a printed line.`).join('\n\n');
fs.writeFileSync(doc, `---
title: Quarterly Report
subtitle: How the third quarter went
author: Neo Gentrics
date: 2026-10-01
logo: logo.png
tags: [report, finance]
---

# Summary

${filler(10)}

![Logo](logo.png)

---

## Numbers

| Region | Sales |
|:--|--:|
| North | 120 |
| South | 95 |

The growth formula is $g = (b - a) / a$ and in full:

$$
g = \\frac{b - a}{a}
$$

---

# Details

${filler(40)}

\`\`\`mermaid
graph LR
  A[Plan] --> B[Build] --> C[Ship]
\`\`\`

## Risks

- [x] Supply checked
- [ ] Hiring plan

\`\`\`js
const total = north + south;
\`\`\`
`);
const brandCss = path.join(tmp, 'brand.css');
fs.writeFileSync(brandCss, '.markdown-body h1 { color: rgb(1, 2, 3); }\n');

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), doc],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, css) => {
    global.__save = null;
    dialog.showSaveDialog = async () => (global.__save ? { canceled: false, filePath: global.__save } : { canceled: true });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [css] });
  }, brandCss);
  const saveTo = (p) => app.evaluate((_e, file) => { global.__save = file; }, p);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  // Settings are written to disk shortly after they change; wait for the write.
  const savedSettings = async (ready) => {
    let s = {};
    for (let i = 0; i < 60; i++) {
      try { s = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')); } catch { s = {}; }
      if (ready(s)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return s;
  };
  const exported = async (p) => {
    for (let i = 0; i < 200 && !fs.existsSync(p); i++) await new Promise((r) => setTimeout(r, 150));
    await win.waitForFunction(() => !document.body.classList.contains('exporting'), null, { timeout: 60000 });
    assert.ok(fs.existsSync(p), `${path.basename(p)} was not written`);
    return fs.readFileSync(p);
  };

  await win.waitForSelector('.page:not([hidden]) #summary');
  await win.waitForSelector('.page:not([hidden]) .mermaid-diagram svg');

  await step('the PDF designer opens with a preview built from the front matter', async () => {
    await menu('export-pdf');
    await win.waitForSelector('#publish[open]');
    assert.equal(await win.textContent('#pv-cover-title'), 'Quarterly Report');
    assert.equal(await win.isVisible('#pv-cover'), true);
    assert.equal(await win.isVisible('#pv-contents'), true);
    await win.click('#publish-form [data-opt="cover"]');                 // off…
    assert.equal(await win.isVisible('#pv-cover'), false);
    await win.click('#publish-form [data-opt="cover"]');                 // …and on again
    await win.click('#publish-form .seg[data-opt="paper"] [data-value="a4"]');
  });

  await step('exports a designed PDF: A4, cover, contents with real page numbers, outline and properties', async () => {
    const out = path.join(tmp, 'report.pdf');
    await saveTo(out);
    await win.click('#publish-go');
    const bytes = await exported(out);
    await win.waitForSelector('#publish', { state: 'hidden' });
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    assert.ok(pages.length >= 4, `expected cover + contents + body pages, got ${pages.length}`);
    const { width, height } = pages[0].getSize();
    assert.ok(Math.abs(width - 595.3) < 2 && Math.abs(height - 841.9) < 2, `cover is not A4: ${width}×${height}`);
    assert.equal(pdf.getTitle(), 'Quarterly Report');
    assert.equal(pdf.getAuthor(), 'Neo Gentrics');
    assert.equal(pdf.getCreator(), 'Neo Markdown Reader');
    const res = await win.evaluate(() => window.__lastExport);
    assert.equal(res.ok, true);
    // Contents: Summary, Numbers, Details, Risks — numbered from the page after the cover.
    assert.equal(res.numbers.length, 4);
    assert.ok(res.numbers.every((n) => n >= 2), `contents page numbers: ${res.numbers}`);
    assert.ok(res.numbers[2] > res.numbers[0], `Details should come after Summary: ${res.numbers}`);
    const s = await savedSettings((x) => x.exportOptions?.paper === 'a4');
    assert.equal(s.exportOptions.paper, 'a4', 'designer choices are remembered');
  });

  await step('exports a Word document with headings, bookmarks, the image and drawn diagrams', async () => {
    const out = path.join(tmp, 'report.docx');
    await saveTo(out);
    await menu('export-docx');
    const files = unzipSync(new Uint8Array(await exported(out)));
    const xml = strFromU8(files['word/document.xml']);
    for (const text of ['Quarterly Report', 'Summary', 'Numbers', 'Risks', 'North', 'const total']) assert.ok(xml.includes(text), `missing “${text}”`);
    assert.ok(xml.includes('w:bookmarkStart'), 'headings are bookmarked');
    const media = Object.keys(files).filter((k) => k.startsWith('word/media/'));
    assert.ok(media.length >= 3, `expected logo, equation and diagram pictures, got ${media.join(', ')}`);
    assert.ok(strFromU8(files['docProps/core.xml']).includes('Quarterly Report'));
  });

  await step('exports a self-contained web page (images and maths fonts inlined, no scripts)', async () => {
    const out = path.join(tmp, 'report.html');
    await saveTo(out);
    await menu('export-html');
    const html = (await exported(out)).toString('utf8');
    assert.match(html, /<title>Quarterly Report<\/title>/);
    assert.match(html, /<img[^>]+src="data:image\/png;base64,/);
    assert.match(html, /data:font\/woff2;base64,/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /src="file:/);
    assert.match(html, /<svg[^>]+id="mmd-/);
  });

  await step('exports plain text', async () => {
    const out = path.join(tmp, 'report.txt');
    await saveTo(out);
    await menu('export-txt');
    const text = (await exported(out)).toString('utf8');
    assert.match(text, /QUARTERLY REPORT/);
    assert.match(text, /Summary\r?\n=======/);
    assert.match(text, /\[x\] Supply checked/);
    assert.match(text, /North\s+\|\s+120/);
  });

  await step('presentation mode splits slides on --- and moves with the keyboard', async () => {
    await menu('present');
    await win.waitForSelector('#present:not([hidden])');
    assert.equal(await win.textContent('#present-count'), '1 / 4');            // title slide + three sections
    assert.ok(await win.$('#present-slide.title-slide .doc-meta-title'));
    await win.keyboard.press('ArrowRight');
    assert.equal(await win.textContent('#present-count'), '2 / 4');
    assert.ok(await win.$('#present-slide #summary'));
    await win.keyboard.press('End');
    assert.equal(await win.textContent('#present-count'), '4 / 4');
    await win.keyboard.press('ArrowLeft');
    assert.equal(await win.textContent('#present-count'), '3 / 4');
    assert.ok(await win.$('#present-slide table'));
    await win.keyboard.press('Escape');
    await win.waitForSelector('#present', { state: 'hidden' });
  });

  await step('a custom accent colour and brand stylesheet restyle the page and travel with exports', async () => {
    await menu('customize-theme');
    await win.waitForSelector('#theme-dlg[open]');
    await win.click('#accent-swatches [data-accent="#2b8a3e"]');
    await win.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#2b8a3e');
    await win.fill('#theme-dlg input[data-key="headingFont"]', 'Georgia');
    await win.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--font-display').includes('Georgia'));
    await win.click('#brand-sheet-pick');
    await win.waitForFunction(() => getComputedStyle(document.querySelector('.page:not([hidden]) h1')).color === 'rgb(1, 2, 3)');
    assert.equal(await win.textContent('#brand-sheet-name'), 'brand.css');
    await win.click('#theme-dlg-close');
    const out = path.join(tmp, 'branded.html');
    await saveTo(out);
    await menu('export-html');
    const html = (await exported(out)).toString('utf8');
    assert.match(html, /rgb\(1, 2, 3\)/);
    assert.match(html, /--accent: #2b8a3e/);
  });

  await step('the custom theme is remembered and can be reset', async () => {
    const s = await savedSettings((x) => x.brand?.stylesheet);
    assert.equal(s.brand.accent, '#2b8a3e');
    assert.equal(s.brand.headingFont, 'Georgia');
    assert.equal(s.brand.stylesheet, brandCss);
    await menu('customize-theme');
    await win.click('#brand-reset');
    await win.waitForFunction(() => getComputedStyle(document.querySelector('.page:not([hidden]) h1')).color !== 'rgb(1, 2, 3)');
    await win.click('#theme-dlg-close');
  });

  assert.deepEqual(errors, [], 'no page errors');
  await app.close();
  console.log('publish e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
