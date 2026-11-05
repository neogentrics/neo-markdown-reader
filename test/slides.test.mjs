// Tests for 3.6.2: long slides shared out over several, and read aloud's skip buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/renderer/markdown.js';
import { splitSlides, paginate } from '../src/renderer/present.js';
import { sectionFrom, paragraphFrom } from '../src/renderer/read-ui.js';

const require = createRequire(import.meta.url);
const { voiceLabel, VOICE_NAMES } = require('../src/main/voice-text.js');

const win = new JSDOM('').window;
const render = createRenderer(win);
const page = (md) => { const el = win.document.createElement('div'); el.innerHTML = render(md).html; return el; };
const words = (s) => s.replace(/\s+/g, ' ').trim();

/** Slides that hold `room` characters. */
const room = (n) => (nodes) => nodes.reduce((sum, x) => sum + x.textContent.length, 0) <= n;
const pagesOf = (md, n) => {
  const [slide] = splitSlides(page(md));
  return paginate(slide, room(n));
};
const textOf = (pages) => words(pages.flat().map((n) => n.textContent).join(' '));

test('blocks that fit stay on one slide', () => {
  const pages = pagesOf('# One\n\nShort text.\n\nMore text.\n', 500);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 3);
});

test('blocks move to the next slide when one is full', () => {
  const pages = pagesOf('First paragraph of text.\n\nSecond paragraph of text.\n\nThird paragraph of text.\n', 60);
  assert.ok(pages.length >= 2);
  for (const p of pages) assert.ok(room(60)(p));
  assert.equal(textOf(pages), 'First paragraph of text. Second paragraph of text. Third paragraph of text.');
});

test('a long list is cut between its items, and numbers carry on', () => {
  const items = Array.from({ length: 12 }, (_, i) => `${i + 1}. Item number ${i + 1} here`).join('\n');
  const pages = pagesOf(items, 80);
  assert.ok(pages.length >= 3);
  const lists = pages.flat();
  assert.ok(lists.every((n) => n.tagName === 'OL'));
  assert.equal(lists[1].getAttribute('start'), String(lists[0].querySelectorAll('li').length + 1));
  assert.equal(lists.reduce((sum, n) => sum + n.querySelectorAll('li').length, 0), 12);
});

test('a long table is cut between its rows, and every part keeps its header', () => {
  const rows = Array.from({ length: 10 }, (_, i) => `| Row ${i} | Value ${i} |`).join('\n');
  const pages = pagesOf(`| Name | Value |\n| --- | --- |\n${rows}\n`, 90);
  assert.ok(pages.length >= 3);
  const parts = pages.flat();
  for (const n of parts) assert.match(n.querySelector('thead').textContent, /Name/);
  assert.equal(parts.reduce((sum, n) => sum + n.querySelectorAll('tbody tr').length, 0), 10);
});

test('a long paragraph is cut at a sentence, keeping its bold and every word', () => {
  const text = `${'This is a sentence of about forty characters. '.repeat(6)}And **this bold part** ends it.`;
  const pages = pagesOf(text, 120);
  assert.ok(pages.length >= 3);
  for (const p of pages.slice(0, -1)) assert.match(words(p[0].textContent), /\.$/, 'ends with a sentence');
  assert.equal(textOf(pages), words(text.replace(/\*\*/g, '')));
  assert.equal(pages.flat().flatMap((n) => [...n.querySelectorAll('strong')]).length, 1);
});

test('a short paragraph moves whole instead of being cut', () => {
  const pages = pagesOf(`${'x'.repeat(50)}\n\nA short paragraph with several words in it.\n`, 70);
  assert.equal(pages.length, 2);
  assert.equal(words(pages[1][0].textContent), 'A short paragraph with several words in it.');
});

test('a long quote is cut too, even with one paragraph in it', () => {
  const pages = pagesOf(`> ${'Denial is universal, and every subject has it. '.repeat(10)}\n`, 150);
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.equal(p[0].tagName, 'BLOCKQUOTE');
  assert.equal(textOf(pages), words('Denial is universal, and every subject has it. '.repeat(10)));
});

test('a heading is never left alone at the bottom of a slide', () => {
  const pages = pagesOf(`## Top\n\n${'x'.repeat(34)}\n\n### A heading\n\nText that won't fit under it on the same slide.\n`, 60);
  const last = pages[pages.length - 1];
  assert.equal(last[0].tagName, 'H3');
  assert.ok(pages.every((p) => p[p.length - 1].tagName !== 'H3'));
});

test('a block that can’t be cut gets a slide of its own, and nothing hangs', () => {
  const pages = pagesOf(`Before.\n\n\`\`\`\n${'code line\n'.repeat(40)}\`\`\`\n\nAfter.\n`, 60);
  assert.ok(pages.some((p) => p.length === 1 && p[0].tagName === 'PRE'));
  assert.match(textOf(pages), /^Before\..*After\.$/);
  const stuck = paginate(splitSlides(page('# Heading\n\n```\nlong code block here\n```\n'))[0], () => false);
  assert.equal(stuck.flat().length, 2);
});

const item = (block, heading = false) => ({ block, heading });
//                 0: heading  1, 2: one paragraph   3: another   4: heading   5: paragraph
const flow = [item('h1', true), item('p1'), item('p1'), item('p2'), item('h2', true), item('p3')];

test('next section goes to the next heading, and says when there isn’t one', () => {
  assert.equal(sectionFrom(flow, 0, 1), 4);
  assert.equal(sectionFrom(flow, 2, 1), 4);
  assert.equal(sectionFrom(flow, 4, 1), -1, 'no jumping to the end of the document');
  assert.equal(sectionFrom(flow, 5, 1), -1);
});

test('previous section goes to the start of this one, then the one before', () => {
  assert.equal(sectionFrom(flow, 5, -1), 4);
  assert.equal(sectionFrom(flow, 4, -1), 0);
  assert.equal(sectionFrom(flow, 0, -1), -1);
});

test('a heading read as two sentences is still one section', () => {
  // "I." and "THE BEGINNING" are two sentences of one heading.
  const two = [item('h1', true), item('h1', true), item('p1'), item('h2', true), item('h2', true), item('p2')];
  assert.equal(sectionFrom(two, 0, 1), 3);
  assert.equal(sectionFrom(two, 1, 1), 3);
  assert.equal(sectionFrom(two, 3, 1), -1);
  assert.equal(sectionFrom(two, 5, -1), 3);
  assert.equal(sectionFrom(two, 4, -1), 3);
  assert.equal(sectionFrom(two, 3, -1), 0);
  assert.equal(sectionFrom(two, 0, -1), -1);
});

test('next paragraph goes past the rest of this one, and stays put at the end', () => {
  assert.equal(paragraphFrom(flow, 1, 1), 3);
  assert.equal(paragraphFrom(flow, 2, 1), 3);
  assert.equal(paragraphFrom(flow, 3, 1), 4);
  assert.equal(paragraphFrom(flow, 5, 1), 5);
});

test('previous paragraph goes to the start of this one, then the one before', () => {
  assert.equal(paragraphFrom(flow, 2, -1), 1);
  assert.equal(paragraphFrom(flow, 1, -1), 0);
  assert.equal(paragraphFrom(flow, 3, -1), 1);
  assert.equal(paragraphFrom(flow, 0, -1), 0);
});

test('every natural voice has its own name', () => {
  const ids = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
  assert.equal(new Set(ids.map((id) => VOICE_NAMES[id])).size, 10);
  assert.equal(voiceLabel('F1'), 'Clara (female)');
  assert.equal(voiceLabel('M1'), 'Ethan (male)');
});
