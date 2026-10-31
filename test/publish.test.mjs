import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { createRenderer } from '../src/renderer/markdown.js';
import { buildModel, toPlainText } from '../src/renderer/export-model.js';
import { splitSlides } from '../src/renderer/present.js';
import { brandCss, hasBrand } from '../src/renderer/brand.js';

const require = createRequire(import.meta.url);
const publish = require('../src/main/publish.js');
const { buildDocx, collectAssets, pagesForEntries, bookmarkName } = require('../src/main/export-tools.js');
const { sanitize, cleanFont } = require('../src/main/settings.js');

const win = new JSDOM('').window;
const render = createRenderer(win);
const page = (md) => {
  const el = win.document.createElement('article');
  el.innerHTML = render(md).html;
  return el;
};

const SAMPLE = `---
title: Plan
author: Ann
---
# Goals

Ship **fast** and [read more](https://example.com).

- [x] Done
- [ ] Next
  1. Sub step

> [!WARNING]
> Careful.

| A | B |
|:-|-:|
| 1 | 22 |

\`\`\`js
let x = 1;
\`\`\`

## Notes

Term
: Meaning
`;

test('the document model keeps structure, formatting, links and task state', () => {
  const model = buildModel(page(SAMPLE));
  assert.deepEqual(model.map((b) => b.t), ['meta', 'h', 'p', 'list', 'quote', 'table', 'code', 'h', 'deflist']);
  assert.equal(model[0].title, 'Plan');
  assert.deepEqual(model[2].runs.map((r) => [r.text, !!r.b, r.href || '']), [['Ship ', false, ''], ['fast', true, ''], [' and ', false, ''], ['read more', false, 'https://example.com'], ['.', false, '']]);
  const list = model[3];
  assert.deepEqual(list.items.map((i) => i.checked), [true, false]);
  assert.equal(list.items[0].blocks[0].runs[0].text, 'Done');
  assert.equal(list.items[1].blocks[1].ordered, true);
  assert.equal(model[4].alert, 'Warning');
  assert.deepEqual(model[5].rows.map((r) => r.header), [true, false]);
  assert.equal(model[5].rows[1].cells[1].align, 'right');
  assert.equal(model[6].lang, 'js');
});

test('private highlights and copy buttons never reach an export', () => {
  const el = page('Some secret text here.');
  el.querySelector('p').innerHTML = 'Some <mark class="nmr-hl" data-hl="h1">secret</mark> text<button class="copy-btn">Copy</button>';
  const runs = buildModel(el)[0].runs;
  assert.equal(runs.map((r) => r.text).join(''), 'Some secret text');
  assert.ok(runs.every((r) => !r.mark));
});

test('plain text export reads well', () => {
  const text = toPlainText(buildModel(page(SAMPLE)));
  assert.match(text, /^PLAN\nAnn\n\nGoals\n=====\n/);
  assert.match(text, /read more \(https:\/\/example\.com\)/);
  assert.match(text, /- \[x\] Done\n- \[ \] Next\n/);
  assert.match(text, /> WARNING: Careful\./);
  assert.match(text, /A {3}\| B\n----\|----\n1 {3}\| 22/);
  assert.match(text, /\n {4}let x = 1;\n/);
  assert.match(text, /Term\n {4}Meaning/);
});

test('Word export: a real .docx with styles, bookmarks for headings and links to them', async () => {
  const model = buildModel(page('# Intro\n\nSee [the end](#the-end).\n\n## The end\n\nDone.\n'));
  const buf = await buildDocx(model, {}, { paper: 'a4', title: 'Intro', accent: '#aa3300', pageNumbers: true });
  const files = unzipSync(new Uint8Array(buf));
  const xml = strFromU8(files['word/document.xml']);
  assert.match(xml, new RegExp(`w:bookmarkStart[^>]*w:name="${bookmarkName('the-end')}"`));
  assert.match(xml, new RegExp(`w:hyperlink[^>]*w:anchor="${bookmarkName('the-end')}"`));
  assert.match(xml, /w:pgSz w:w="11909" w:h="16834"/);                      // A4 in twentieths of a point
  assert.match(strFromU8(files['word/styles.xml']), /AA3300/);              // accent colour on headings
  assert.ok(Object.keys(files).some((f) => /word\/footer\d*\.xml/.test(f)), 'page-number footer');
  assert.equal(bookmarkName('a b/c'), 'h_a_b_c');
  assert.ok(bookmarkName('x'.repeat(80)).length <= 40);
});

test('Word export: graphics are numbered for drawing and images are listed', () => {
  const el = page('![a](pic.png)\n\n$$\nx\n$$\n');
  const { images, graphics } = collectAssets(buildModel(el));
  assert.deepEqual(images, ['pic.png']);
  assert.equal(graphics.length, 1);
  assert.equal(graphics[0].gid, 0);
  assert.equal(graphics[0].alt, 'x');
});

test('contents page numbers come from the PDF outline, matched by title in order', () => {
  const outline = [{ title: 'Intro', page: 2 }, { title: 'Setup', page: 3 }, { title: 'Intro', page: 7 }, { title: 'End', page: 9 }];
  assert.deepEqual(pagesForEntries([{ text: 'Intro' }, { text: 'Intro' }, { text: 'Missing' }, { text: 'End' }], outline), [2, 7, 0, 9]);
});

test('PDF designer pages: contents, margins, cover and header text', () => {
  const meta = { name: 'plan.md', frontMatter: { title: 'Plan <b>', subtitle: 'Q3', author: 'Ann', date: '2026-10-01', tags: ['a', 'b'] },
    toc: [{ level: 1, text: 'One', id: 'one' }, { level: 2, text: 'Two', id: 'two' }, { level: 3, text: 'Three', id: 'three' }, { level: 4, text: 'Deep', id: 'deep' }] };
  const options = { paper: 'a4', margins: 'narrow', cover: true, contents: true, header: true, pageNumbers: true, chapterBreaks: true };
  const body = publish.buildBodyHtml({ content: '<h1 id="one">One</h1>', meta, options, css: '.x{}', cssHref: 'file:///x.css', theme: 'light', font: 'sans', numbers: [2, 3, 3, 4] });
  assert.match(body, /@page \{ size: A4; margin: 0.75in 0.5in 0.7in; \}/);   // room kept for header & footer
  assert.match(body, /class="publish print has-cover h1-breaks"/);
  assert.equal((body.match(/<li class="lvl-/g) || []).length, 3, 'only the top three heading levels');
  assert.match(body, /href="#two"><span class="t">Two<\/span><span class="dots"><\/span><span class="n">3<\/span>/);
  assert.match(body, /<title>Plan &lt;b&gt;<\/title>/);
  assert.doesNotMatch(body, /<script/);
  const cover = publish.buildCoverHtml({ meta, options, cssHref: 'file:///x.css' });
  assert.match(cover, /pub-cover-title">Plan &lt;b&gt;</);
  assert.match(cover, /pub-cover-kicker">a · b</);
  assert.match(cover, /<strong>Ann<\/strong>/);
  const hf = publish.headerFooter({ meta, options });
  assert.equal(hf.displayHeaderFooter, true);
  assert.match(hf.headerTemplate, /Plan &lt;b&gt;/);
  assert.match(hf.footerTemplate, /class="pageNumber"/);
  assert.equal(publish.headerFooter({ meta, options: { ...options, header: false, pageNumbers: false } }).displayHeaderFooter, false);
});

test('paper size follows the country when set to Auto', () => {
  assert.equal(publish.resolvePaper('auto', 'US'), 'letter');
  assert.equal(publish.resolvePaper('auto', 'DE'), 'a4');
  assert.equal(publish.resolvePaper('legal', 'DE'), 'legal');
  assert.equal(publish.docInfo({ name: 'notes.md' }).title, 'notes');
});

test('web page export inlines local images and only the maths fonts it needs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-pub-'));
  writeFileSync(join(dir, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const src = pathToFileURL(join(dir, 'a.png')).href;
  const css = '@font-face{font-family:KaTeX_Main;src:url("./fonts/missing.woff2") format("woff2"),url("./fonts/missing.woff") format("woff")}.markdown-body{color:red}';
  const html = await publish.buildStandaloneHtml({ content: `<p><img src="${src}" alt=""></p>`, meta: { name: 'a.md' }, css: 'h1{}', exportCss: css, distDir: dir });
  assert.match(html, /src="data:image\/png;base64,iVBORw==/);
  assert.doesNotMatch(html, /KaTeX_Main/, 'no maths → no maths fonts');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<title>a<\/title>/);
  assert.equal(publish.sniffImage(Buffer.from([0xff, 0xd8, 0, 0])), 'jpg');
  assert.equal(publish.sniffImage(Buffer.from('RIFFxxxxWEBP')), null);
});

test('slides split on --- with the front matter as a title slide', () => {
  const slides = splitSlides(page('---\ntitle: Deck\n---\n# One\n\nA\n\n---\n\n## Two\n\nB\n\n---\n\n## Three\n'));
  assert.equal(slides.length, 4);
  assert.ok(slides[0][0].classList.contains('doc-meta'));
  assert.equal(slides[2][0].textContent, 'Two');
});

test('without --- the slides split at the top headings', () => {
  const slides = splitSlides(page('# Title\n\nIntro\n\n## A\n\ntext\n\n### detail\n\nmore\n\n## B\n\nend\n'));
  assert.deepEqual(slides.map((s) => s[0].textContent), ['Title', 'A', 'B']);
  assert.equal(splitSlides(page('Just text.')).length, 1);
});

test('custom theme: accent and fonts become CSS, unsafe font names are cleaned', () => {
  assert.equal(brandCss({}), '');
  assert.equal(hasBrand({}), false);
  const css = brandCss({ accent: '#2b8a3e', headingFont: 'Georgia', bodyFont: 'Evil"; } body { x', codeFont: '' });
  assert.match(css, /--accent: #2b8a3e/);
  assert.match(css, /--font-display: "Georgia"/);
  assert.match(css, /font-family: "Evil body x"/);
  assert.doesNotMatch(css, /}\s*body/);
  assert.equal(brandCss({ accent: 'red; x: y' }), '');
  const s = sanitize({ brand: { accent: '#ABCDEF', bodyFont: 'A{b}', stylesheet: 'C:\\brand\\style.txt' }, exportOptions: { paper: 'tabloid', cover: false } });
  assert.deepEqual(s.brand, { accent: '#abcdef', bodyFont: 'Ab', headingFont: '', codeFont: '', stylesheet: '' });
  assert.equal(s.exportOptions.paper, 'auto');
  assert.equal(s.exportOptions.cover, false);
  assert.equal(cleanFont('x'.repeat(100)).length, 60);
});
