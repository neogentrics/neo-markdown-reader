// Tests for Send to StoryTracker and pictures on App Link (3.11). The real thing is in test/e2e/link.e2e.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sentPicture, swapSentPictures, pictureBytes } from '../src/renderer/sent-pictures.js';

const require = createRequire(import.meta.url);
const { attachmentsFor, readAttachments, showEveryPicture, MAX_PICTURES } = require('../src/main/link-pictures.js');
const { Handover, storyPlaces, startWith, handoverName } = require('../src/main/story-tracker.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const GIF = Buffer.from('GIF89a\u0001\0\u0001\0', 'latin1');
const BMP = Buffer.from('BM\0\0\0\0\0\0\0\0', 'latin1');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-story-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, name, data) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};

test('a saved document sends the pictures it shows, and only real pictures', async (t) => {
  const dir = folder(t);
  const map = put(dir, 'images/my map.png', PNG);
  const photo = put(dir, 'photo.jpg', JPEG);
  put(dir, 'fake.png', 'not a picture');
  put(dir, 'old.bmp', BMP);
  const text = [
    '![Map](images/my%20map.png)', '![Map again](<images/my map.png>)', '![Photo](photo.jpg "A title")', '![Fake](fake.png)',
    '![Gone](gone.png)', '![Old](old.bmp)', '![Web](https://example.com/web.png)', '[Not a picture](photo.jpg)',
  ].join('\n\n');
  assert.deepEqual(await attachmentsFor(text, path.join(dir, 'doc.md')), [{ name: 'my map.png', path: map }, { name: 'photo.jpg', path: photo }]);
});

test('an unsaved document has no folder to find pictures in', async () => {
  assert.deepEqual(await attachmentsFor('![Map](map.png)', null), []);
  assert.deepEqual(await attachmentsFor('![Map](map.png)', ''), []);
});

test('at most so many pictures go with a document', async (t) => {
  const dir = folder(t);
  const names = Array.from({ length: MAX_PICTURES + 5 }, (_, i) => `p${i}.png`);
  names.forEach((n) => put(dir, n, PNG));
  const found = await attachmentsFor(names.map((n) => `![x](${n})`).join('\n'), path.join(dir, 'doc.md'));
  assert.equal(found.length, MAX_PICTURES);
});

test('a list from another app gives back pictures, and drops everything else', async (t) => {
  const dir = folder(t);
  const png = put(dir, 'a.png', PNG);
  const jpg = put(dir, 'b.jpeg', JPEG);
  const webp = put(dir, 'c.webp', WEBP);
  const gif = put(dir, 'd.gif', GIF);
  const fake = put(dir, 'fake.png', 'not a picture');
  const bmp = put(dir, 'e.bmp', BMP);
  const text = put(dir, 'secret.txt', 'secret');
  const got = await readAttachments([
    { name: '../../Map\u202e.png', path: png }, { path: jpg }, { name: 'c.webp', path: webp }, { name: 'd.gif', path: gif },
    { name: 'fake.png', path: fake }, { name: 'e.bmp', path: bmp }, { name: 'secret.png', path: text }, { name: 'gone.png', path: path.join(dir, 'gone.png') },
    { name: 'near.png', path: 'a.png' }, { name: 'far.png', path: '\\\\server\\share\\a.png' }, { name: 'far.png', path: '//server/share/a.png' },
    { name: 'folder.png', path: fs.mkdirSync(path.join(dir, 'folder.png'), { recursive: true }) }, null, 7, 'a.png', { name: 'nothing' },
  ]);
  assert.deepEqual(got.map((p) => p.name), ['Map.png', 'b.jpeg', 'c.webp', 'd.gif']);
  assert.deepEqual(got.map((p) => p.url.split(';')[0]), ['data:image/png', 'data:image/jpeg', 'data:image/webp', 'data:image/gif']);
  assert.deepEqual(Buffer.from(pictureBytes(got[0].url)), PNG);
});

test('a list that isn’t a list is no pictures at all', async () => {
  for (const list of [undefined, null, 'a.png', 5, {}]) assert.deepEqual(await readAttachments(list), []);
});

test('a picture the text doesn’t show goes at the end, so it isn’t out of sight', () => {
  const pictures = [{ name: 'Map.png' }, { name: 'my photo.jpg' }];
  assert.equal(showEveryPicture('# One\n\n![The map](images/map.png)\n', [pictures[0]]), '# One\n\n![The map](images/map.png)\n');
  assert.equal(showEveryPicture('# One\n\n![The map](images/map.png)\n\n', pictures), '# One\n\n![The map](images/map.png)\n\n![my photo.jpg](<my photo.jpg>)\n');
  assert.equal(showEveryPicture('text', []), 'text');
});

test('a link finds a sent picture by its file name, and nothing else does', () => {
  const pictures = [{ name: 'Map.png', url: 'data:image/png;base64,AA' }, { name: 'my photo.jpg', url: 'data:image/jpeg;base64,AA' }];
  assert.equal(sentPicture('map.png', pictures), pictures[0]);
  assert.equal(sentPicture('./images/MAP.png?v=2', pictures), pictures[0]);
  assert.equal(sentPicture('images/my%20photo.jpg', pictures), pictures[1]);
  assert.equal(sentPicture('other.png', pictures), null);
  assert.equal(sentPicture('https://example.com/map.png', pictures), null);
  assert.equal(sentPicture('C:/pictures/map.png', pictures), null);
  assert.equal(sentPicture('map.png', null), null);
  assert.equal(sentPicture('', pictures), null);
});

test('saving moves the links along with the pictures, and leaves the rest of the text alone', () => {
  const saved = new Map([['Map.png', 'images/Map.png'], ['my photo.jpg', 'images/my-photo.jpg']]);
  const text = '![A](map.png) ![B](<my photo.jpg> "Title") ![C](other.png) ![D](https://example.com/map.png) [E](map.png)';
  assert.equal(swapSentPictures(text, saved), '![A](images/Map.png) ![B](images/my-photo.jpg "Title") ![C](other.png) ![D](https://example.com/map.png) [E](map.png)');
});

test('RT Story Tracker is looked for where its installers put it', () => {
  const env = { LOCALAPPDATA: 'C:\\Local', ProgramFiles: 'C:\\Program Files' };
  const win = storyPlaces({ platform: 'win32', env, home: 'C:\\Users\\a' });
  assert.ok(win.includes(path.join('C:\\Local', 'Programs', 'rt-story-tracker', 'RT Story Tracker.exe')));
  assert.ok(win.includes(path.join('C:\\Program Files', 'RT Story Tracker', 'RT Story Tracker.exe')));
  assert.ok(storyPlaces({ platform: 'darwin', env: {}, home: '/Users/a' }).includes('/Applications/RT Story Tracker.app'));
  assert.ok(storyPlaces({ platform: 'linux', env: {}, home: '/home/a' }).includes('/opt/RT Story Tracker/rt-story-tracker'));
  assert.deepEqual(storyPlaces({ platform: 'win32', env: { NMR_STORY_APP: 'X:\\story.exe' } }), ['X:\\story.exe']);
});

test('the app is started without a shell, and a failure to start is seen', async () => {
  const calls = [];
  const fake = (event, value) => (command, args, options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), { unref() { calls.at(-1).unref = true; } });
    setImmediate(() => child.emit(event, value));
    return child;
  };
  await startWith('C:\\App\\story.exe', 'C:\\Temp\\a & b.md', { platform: 'win32', start: fake('spawn') });
  assert.deepEqual(calls.at(-1).args, ['C:\\Temp\\a & b.md']);
  assert.equal(calls.at(-1).options.shell, undefined);
  assert.equal(calls.at(-1).unref, true);
  await startWith('/Applications/RT Story Tracker.app', '/tmp/a.md', { platform: 'darwin', start: fake('spawn') });
  assert.equal(calls.at(-1).command, 'open');
  assert.deepEqual(calls.at(-1).args, ['-a', '/Applications/RT Story Tracker.app', '/tmp/a.md']);
  await assert.rejects(startWith('/x', '/tmp/a.md', { platform: 'linux', start: fake('error', new Error('no')) }), /no/);
});

test('a document’s name becomes a safe .md file name', () => {
  assert.equal(handoverName('Chapter 1.md'), 'Chapter 1.md');
  assert.equal(handoverName('Notes.txt'), 'Notes.md');
  assert.equal(handoverName('Draft.mdx'), 'Draft.md');
  assert.equal(handoverName('../../Who? "Me": <a|b>*.md'), 'Who Me ab.md');
  assert.equal(handoverName('C:\\Books\\One.markdown'), 'One.md');
  assert.equal(handoverName('Trailing. '), 'Trailing.md');
  assert.equal(handoverName('CON.md'), 'CON document.md');
  assert.equal(handoverName(''), 'Sent document.md');
  assert.equal(handoverName(undefined), 'Sent document.md');
  assert.equal(handoverName('a'.repeat(200)).length, 83);
});

test('with no link, the app gets a plain copy, which goes once it’s had time to read it', async (t) => {
  const tempDir = folder(t);
  const app = put(tempDir, 'story.exe', 'x');
  const got = [];
  const handover = new Handover({ tempDir, places: () => ['/not/here', app], after: 40, start: async (a, file) => { got.push({ a, file, text: fs.readFileSync(file, 'utf8') }); } });
  assert.deepEqual(await handover.send({ name: 'Chapter 1.md', text: '# One\n' }), { name: 'RT Story Tracker' });
  assert.equal(got[0].a, app);
  assert.equal(got[0].text, '# One\n');
  assert.equal(path.basename(got[0].file), 'Chapter 1.md');
  assert.match(path.basename(path.dirname(got[0].file)), /^rtmr-send-[0-9a-f]{16}$/);
  assert.ok(fs.existsSync(got[0].file), 'it’s still there for the app to read');
  await new Promise((r) => { setTimeout(r, 120); });
  assert.equal(fs.existsSync(path.dirname(got[0].file)), false);
});

test('two documents with the same name don’t get in each other’s way', async (t) => {
  const tempDir = folder(t);
  const app = put(tempDir, 'story.exe', 'x');
  const files = [];
  const handover = new Handover({ tempDir, places: () => [app], start: async (_a, file) => { files.push(file); } });
  await handover.send({ name: 'Same.md', text: 'one' });
  await handover.send({ name: 'Same.md', text: 'two' });
  assert.equal(fs.readFileSync(files[0], 'utf8'), 'one');
  assert.equal(fs.readFileSync(files[1], 'utf8'), 'two');
  handover.clear();
  assert.equal(fs.existsSync(path.dirname(files[0])), false, 'closing the app removes what it wrote');
  assert.equal(fs.existsSync(path.dirname(files[1])), false);
});

test('if the app isn’t there, nothing is written', async (t) => {
  const tempDir = folder(t);
  const handover = new Handover({ tempDir, places: () => ['/not/here'], start: async () => assert.fail('nothing to start') });
  await assert.rejects(handover.send({ name: 'a.md', text: 'x' }), /isn’t on this computer/);
  assert.deepEqual(fs.readdirSync(tempDir), []);
});

test('if the app won’t start, the copy goes at once', async (t) => {
  const tempDir = folder(t);
  const app = put(tempDir, 'story.exe', 'x');
  const handover = new Handover({ tempDir, places: () => [app], start: async () => { throw new Error('spawn EACCES'); } });
  await assert.rejects(handover.send({ name: 'a.md', text: 'x' }), /wouldn’t start/);
  assert.deepEqual(fs.readdirSync(tempDir), ['story.exe']);
});

test('a copy left by a crash is swept at the next start, and nothing else is touched', (t) => {
  const tempDir = folder(t);
  const old = path.join(tempDir, 'rtmr-send-0123456789abcdef');
  const onItsWay = path.join(tempDir, 'rtmr-send-fedcba9876543210');
  put(old, 'a.md', 'x');
  put(onItsWay, 'b.md', 'x');
  const other = put(tempDir, 'rtst-send-0123456789abcdef/c.md', 'x');
  const lookalike = put(tempDir, 'rtmr-send-mine/d.md', 'x');
  const long = new Date(Date.now() - 3_600_000);
  fs.utimesSync(old, long, long);
  fs.utimesSync(path.dirname(other), long, long);
  fs.utimesSync(path.dirname(lookalike), long, long);
  new Handover({ tempDir, after: 60_000 }).sweep();
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(onItsWay), true, 'it may still be on its way');
  assert.equal(fs.existsSync(other), true, 'another app’s folder stays');
  assert.equal(fs.existsSync(lookalike), true);
});
