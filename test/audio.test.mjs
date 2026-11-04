// Tests for 3.5 "Listen & speak": the audiobook file written by hand, read back box by box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { m4bStart, m4bEnd, id3 } from '../src/renderer/m4b.js';

/** The boxes in `bytes`, by name. Containers are listed as `moov/trak` and so on. */
function boxes(bytes, from = 0, to = bytes.length, prefix = '', out = []) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parents = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'tref']);
  for (let at = from; at < to;) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    assert.ok(size >= 8 && at + size <= to, `${prefix}${type} fits inside its parent`);
    out.push({ path: prefix + type, at, size });
    if (parents.has(type)) boxes(bytes, at + 8, at + size, `${prefix}${type}/`, out);
    at += size;
  }
  return out;
}

const asc = Uint8Array.of(0x12, 0x08);
const frames = [300, 310, 320, 330];
const audioBytes = 1260;
const meta = { title: 'Field guide', author: 'Neo' };
const moovOf = (tail) => [...tail.keys()].find((i) => String.fromCharCode(...tail.subarray(i + 4, i + 8)) === 'moov');

test('audiobook: the boxes nest properly, and the tables match the sound', () => {
  const start = m4bStart();
  const chapters = [{ title: 'One', sample: 0 }, { title: 'Twó', sample: 2048 }];
  const { tail, mdatSize } = m4bEnd({ rate: 44100, frames, asc, bitrate: 96000, chapters, audioAt: start.audioAt, ...meta });
  const titles = moovOf(tail);
  const moov = tail.subarray(titles - 0);
  assert.ok(titles > 0);
  const list = boxes(moov);
  const paths = list.map((b) => b.path);
  for (const want of ['moov/mvhd', 'moov/trak/tkhd', 'moov/trak/tref/chap', 'moov/trak/mdia/minf/stbl/stsd', 'moov/trak/mdia/minf/stbl/stsz', 'moov/trak/mdia/minf/stbl/co64', 'moov/udta/chpl', 'moov/udta/meta']) assert.ok(paths.includes(want), want);
  assert.equal(paths.filter((p) => p === 'moov/trak').length, 2, 'sound and chapter tracks');

  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const [stsz] = list.filter((b) => b.path.endsWith('stsz'));
  assert.equal(view.getUint32(stsz.at + 16), frames.length);
  assert.deepEqual(frames.map((_, i) => view.getUint32(stsz.at + 20 + i * 4)), frames);
  const [sound, words] = list.filter((b) => b.path.endsWith('co64'));
  assert.equal(Number(view.getBigUint64(sound.at + 16)), start.audioAt);
  assert.equal(Number(view.getBigUint64(words.at + 16)), start.audioAt + audioBytes, 'chapter titles follow the sound');
  assert.equal(Number(new DataView(mdatSize.buffer).getBigUint64(0)), 16 + audioBytes + titles);
});

test('audiobook: a document with no headings has no chapter track', () => {
  const { tail } = m4bEnd({ rate: 44100, frames, asc, bitrate: 96000, chapters: [], audioAt: 40, ...meta });
  const paths = boxes(tail).map((b) => b.path);
  assert.equal(paths.filter((p) => p === 'moov/trak').length, 1);
  assert.ok(!paths.some((p) => p.endsWith('chpl') || p.endsWith('tref')));
});

test('MP3 tag: the size is written the way ID3 needs it, and any language fits', () => {
  const tag = id3({ title: 'Crónica 東京', author: 'Neo' });
  assert.equal(String.fromCharCode(...tag.subarray(0, 3)), 'ID3');
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.equal(size, tag.length - 10);
  assert.ok(tag.subarray(6, 10).every((b) => b < 128));
});
