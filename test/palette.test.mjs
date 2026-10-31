import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzy } from '../src/renderer/palette.js';

test('quick open matching: substrings beat scattered letters, words can be typed with spaces', () => {
  assert.ok(fuzzy('inst', 'install.md'));
  assert.ok(fuzzy('inst v2', 'install-v2.md'));
  assert.equal(fuzzy('inst v3', 'install-v2.md'), null);
  assert.equal(fuzzy('zz', 'install.md'), null);
  assert.ok(fuzzy('meet', 'meeting.md').score > fuzzy('mtg', 'meeting.md').score);
  assert.ok(fuzzy('read', 'README.md').score > fuzzy('read', 'spreadsheet-notes.md').score, 'start of name ranks higher');
  assert.deepEqual(fuzzy('', 'anything'), { score: 0, hits: [] });
});
