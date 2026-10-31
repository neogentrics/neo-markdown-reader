import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDocs } from '../src/renderer/compare.js';

test('identical documents report no differences', () => {
  const r = compareDocs('# A\n\ntext\n', '# A\r\n\r\ntext\r\n');      // line endings don't count
  assert.equal(r.same, true);
  assert.match(r.html, /identical/);
});

test('added, removed and changed lines are counted and highlighted word by word', () => {
  const before = '# Plan\n\nShip on Monday.\nOld line.\n';
  const after = '# Plan\n\nShip on Friday.\nNew extra line.\n';
  const r = compareDocs(before, after, { leftName: 'v1.md', rightName: 'v2.md' });
  assert.equal(r.added, 2);
  assert.equal(r.removed, 2);
  assert.match(r.html, /<del>Monday<\/del>/);
  assert.match(r.html, /<ins>Friday<\/ins>/);
  assert.match(r.html, /v1\.md/);
});

test('long unchanged stretches are folded, and HTML in documents is escaped', () => {
  const same = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const r = compareDocs(`${same}\n<script>x</script>\n`, `${same}\n<b>y</b>\n`);
  assert.match(r.html, /diff-fold/);
  assert.match(r.html, /unchanged lines/);
  assert.doesNotMatch(r.html, /<script>|<b>y/);
  assert.match(r.html, /&lt;<del>script<\/del>&gt;/);              // shown as text, word-diffed
});
