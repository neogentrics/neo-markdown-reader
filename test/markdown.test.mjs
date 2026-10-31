import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createRenderer, resolveMediaUrl, slugify } from '../src/renderer/markdown.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const render = createRenderer(window);
const BASE = 'file:///C:/Users/me/Docs/';

test('GitHub-flavoured tables, task lists and strikethrough', () => {
  const { html } = render('| a | b |\n|---|:-:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~');
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<th style="text-align:center">b<\/th>/);
  assert.match(html, /class="task-list-item-checkbox"[^>]*checked/);
  assert.match(html, /<s>gone<\/s>/);
});

test('scripts and event handlers are stripped, styling is kept', () => {
  const { html } = render('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n<span style="color:red" onclick="x()">red</span>\n\n<iframe src="https://evil"></iframe>\n\n[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<script|onerror|onclick|<iframe|href="javascript:/i);
  assert.match(html, /<span style="color:red">red<\/span>/);
});

test('relative and Windows-style image paths resolve against the document folder', () => {
  const { html } = render('![a](images/pic.png) ![b](../up.jpg) ![c](https://x.org/y.png) <img src="C:\\pics\\z.png">', { baseUrl: BASE });
  assert.match(html, /src="file:\/\/\/C:\/Users\/me\/Docs\/images\/pic.png"/);
  assert.match(html, /src="file:\/\/\/C:\/Users\/me\/up.jpg"/);
  assert.match(html, /src="https:\/\/x.org\/y.png"/);
  assert.match(html, /src="file:\/\/\/C:\/pics\/z.png"/);
  assert.equal(resolveMediaUrl('#anchor', BASE), '#anchor');
  assert.doesNotMatch(html, /loading="lazy"/, 'local images must load eagerly so they appear without scrolling');
});

test('headings get GitHub-style ids and build the outline', () => {
  const { toc, html, title } = render('# Hello World!\n\n## Step 1: Install\n\n### `code` heading\n\n## Step 1: Install');
  assert.deepEqual(toc.map((h) => h.id), ['hello-world', 'step-1-install', 'code-heading', 'step-1-install-1']);
  assert.match(html, /<h2 id="step-1-install">/);
  assert.equal(title, 'Hello World!');
  assert.equal(slugify('Ünïcode Wörds & Stuff'), 'ünïcode-wörds--stuff');
});

test('callouts, footnotes, emoji, highlight, sub/sup', () => {
  const { html } = render('> [!WARNING]\n> careful\n\nText[^1] :rocket: ==hi== H~2~O x^2^\n\n[^1]: note');
  assert.match(html, /markdown-alert markdown-alert-warning/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /🚀/);
  assert.match(html, /<mark>hi<\/mark>/);
  assert.match(html, /<sub>2<\/sub>/);
  assert.match(html, /<sup>2<\/sup>/);
});

test('code is syntax-highlighted and mermaid is left for the diagram renderer', () => {
  const { html } = render('```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /<pre class="code-block" data-lang="js"><code class="hljs language-js"><span class="hljs-keyword">const<\/span>/);
  assert.match(html, /<pre class="mermaid-src">graph TD; A--&gt;B;\n<\/pre>/);
});

test('math renders through KaTeX', () => {
  const { html } = render('Inline $a^2+b^2=c^2$ and\n\n$$\\frac{1}{2}$$');
  assert.match(html, /class="katex"/);
  assert.match(html, /katex-display|<eqn>/);
});

test('front matter becomes a header card and supplies the title', () => {
  const { html, title, frontMatter } = render('---\ntitle: My Report\nauthor: Josh\ntags: [a, b]\nstatus: draft\n---\n\n# Body');
  assert.equal(title, 'My Report');
  assert.equal(frontMatter.status, 'draft');
  assert.match(html, /<header class="doc-meta"><div class="doc-meta-title">My Report<\/div>/);
  assert.match(html, /<span class="tag">a<\/span>/);
  assert.doesNotMatch(html, /title: My Report/);
});

test('word count and the bundled showcase render without errors', () => {
  const src = readFileSync(new URL('../samples/showcase.md', import.meta.url), 'utf8');
  const out = render(src, { baseUrl: BASE });
  assert.ok(out.stats.words > 200);
  assert.ok(out.toc.length > 10);
  assert.match(out.html, /markdown-alert-tip/);
});
