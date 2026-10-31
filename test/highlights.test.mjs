import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { textIndex, rangeToOffsets, findQuote, wrapOffsets, describeSelection } from '../src/renderer/highlights.js';

const page = (html) => new JSDOM(`<article id="p">${html}</article>`).window.document.getElementById('p');

test('a repeated phrase is found again at the right place using its context', () => {
  const text = 'The cat sat. Later the cat ran. Finally the cat slept.';
  const second = text.indexOf('cat', text.indexOf('cat') + 1);
  const d = describeSelection(text, second, second + 3);
  assert.deepEqual(findQuote(text, d), { start: second, end: second + 3 });
  // The document changes before the quote: still found by its context.
  const edited = 'INTRO. ' + text;
  assert.deepEqual(findQuote(edited, d), { start: second + 7, end: second + 10 });
  assert.equal(findQuote(text, { quote: 'dog' }), null);
});

test('highlights wrap text across formatting and skip code copy buttons', () => {
  const root = page('<p>Hello <b>bold world</b> again</p><pre><code>x</code><button class="copy-btn">Copy</button></pre>');
  const idx = textIndex(root);
  assert.equal(idx.text, 'Hello bold world againx');                 // "Copy" button text excluded
  const start = idx.text.indexOf('lo bold');
  const marks = wrapOffsets(root, start, start + 'lo bold wo'.length, { class: 'nmr-hl', 'data-hl': 'h1' });
  assert.equal(marks.length, 2);                                      // split across <p> text and <b>
  assert.equal(root.querySelectorAll('mark[data-hl="h1"]').length, 2);
  assert.equal([...root.querySelectorAll('mark')].map((m) => m.textContent).join(''), 'lo bold wo');
  assert.equal(textIndex(root).text, idx.text, 'wrapping doesn’t change the text');
});

test('a DOM selection converts to text offsets', () => {
  const root = page('<p>First paragraph.</p><p>Second <i>one</i> here.</p>');
  const doc = root.ownerDocument;
  const range = doc.createRange();
  const second = root.querySelectorAll('p')[1];
  range.setStart(second.firstChild, 0);
  range.setEnd(second.querySelector('i').firstChild, 3);
  const off = rangeToOffsets(root, range);
  assert.equal(textIndex(root).text.slice(off.start, off.end), 'Second one');
});
