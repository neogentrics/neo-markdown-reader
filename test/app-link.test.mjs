// Tests for App Link's small rules (3.6). The real thing, over a real connection, is in test/e2e/link.e2e.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sharedFolder, endpointFor, validEndpoint, validId, cleanName, documentName } = require('../src/main/app-link.js');

test('every app on a computer finds the same folder', () => {
  assert.equal(sharedFolder({ env: { APPDATA: 'C:\\Roaming' }, platform: 'win32', home: 'C:\\Users\\a' }), path.join('C:\\Roaming', 'Recon Towers', 'app-link'));
  assert.equal(sharedFolder({ env: {}, platform: 'darwin', home: '/Users/a' }), path.join('/Users/a', 'Library', 'Application Support', 'Recon Towers', 'app-link'));
  assert.equal(sharedFolder({ env: {}, platform: 'linux', home: '/home/a' }), path.join('/home/a', '.config', 'Recon Towers', 'app-link'));
  assert.equal(sharedFolder({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/home/a' }), path.join('/x', 'Recon Towers', 'app-link'));
});

test('an endpoint is a pipe or a socket on this computer, nothing else', () => {
  assert.equal(validEndpoint(endpointFor('C:\\Data', 'win32'), 'win32'), true);
  assert.equal(validEndpoint('\\\\server\\pipe\\x', 'win32'), false);
  assert.equal(validEndpoint('\\\\.\\pipe\\..\\x', 'win32'), false);
  assert.equal(validEndpoint('C:\\file', 'win32'), false);
  assert.equal(validEndpoint('/home/a/app.sock', 'linux'), true);
  assert.equal(validEndpoint('relative.sock', 'linux'), false);
  assert.equal(validEndpoint(5, 'linux'), false);
});

test('app ids are short lowercase names', () => {
  assert.equal(validId('rt-story-tracker'), true);
  assert.equal(validId('storytracker'), true);
  assert.equal(validId('rt-markdown-reader'), true);
  for (const id of ['', 'Story', '../x', '-x', 'a'.repeat(65), 7, '__proto__']) assert.equal(validId(id), false, String(id));
});

test('a name can’t hide anything from the person reading it', () => {
  assert.equal(cleanName('Story\u202eTracker\u0007\n'), 'StoryTracker');
  assert.equal(cleanName(`  ${'a'.repeat(100)}`).length, 80);
  assert.equal(cleanName(5, 'fallback'), 'fallback');
  assert.equal(cleanName('\u0007', 'fallback'), 'fallback');
});

test('a document’s name loses its folders and gets an extension', () => {
  assert.equal(documentName('../../Chapter 1'), 'Chapter 1.md');
  assert.equal(documentName('C:\\Books\\Notes.txt'), 'Notes.txt');
  assert.equal(documentName(''), 'Sent document.md');
  assert.equal(documentName(undefined), 'Sent document.md');
});
