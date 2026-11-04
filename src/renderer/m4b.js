// Audiobook files (3.5): the box structure of an .m4b, written by hand so chapters need no extra library.
// The file is laid out as ftyp, mdat (the sound, then the chapter titles), moov, because the sound's size isn't
// known until it's finished. Chapters are written twice: a text track for Apple's players, and a Nero
// "chpl" list for most others.

const encoder = new TextEncoder();
const FRAME = 1024;                     // samples in one AAC frame
const MOVIE_SCALE = 1000;
const MAX_CHPL = 255;

const u8 = (n) => Uint8Array.of(n & 255);
const u16 = (n) => Uint8Array.of((n >>> 8) & 255, n & 255);
const u32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const u64 = (n) => { const big = BigInt(n); return Uint8Array.from({ length: 8 }, (_, i) => Number((big >> BigInt(56 - 8 * i)) & 255n)); };
const zeros = (n) => new Uint8Array(n);
const text = (s) => encoder.encode(s);

function join(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const box = (type, ...parts) => {
  const body = join(parts);
  return join([u32(body.length + 8), Uint8Array.from(type, (c) => c.charCodeAt(0)), body]);   // one byte a letter, © included
};
const full = (type, version, flags, ...parts) => box(type, u8(version), u8(flags >> 16), u16(flags & 0xffff), ...parts);

const MATRIX = join([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function mvhd(ms, nextTrack) {
  return full('mvhd', 0, 0, u32(0), u32(0), u32(MOVIE_SCALE), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(nextTrack));
}

function tkhd(id, ms, flags, volume) {
  return full('tkhd', 0, flags, u32(0), u32(0), u32(id), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(volume), u16(0), MATRIX, u32(0), u32(0));
}

const mdhd = (rate, samples) => full('mdhd', 1, 0, u64(0), u64(0), u32(rate), u64(samples), u16(0x55c4), u16(0));
const hdlr = (kind, name) => full('hdlr', 0, 0, u32(0), text(kind), zeros(12), text(name), u8(0));
const dinf = () => box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));

function descriptor(tag, ...parts) {
  const body = join(parts);
  return join([u8(tag), Uint8Array.of(0x80, 0x80, 0x80, body.length), body]);
}

function esds(asc, bitrate) {
  const config = descriptor(4, u8(0x40), u8(0x15), zeros(3), u32(bitrate), u32(bitrate), descriptor(5, asc));
  return full('esds', 0, 0, descriptor(3, u16(1), u8(0), config, descriptor(6, u8(2))));
}

function mp4a(rate, asc, bitrate) {
  return box('mp4a', zeros(6), u16(1), zeros(8), u16(1), u16(16), zeros(4), u32(rate * 65536), esds(asc, bitrate));
}

function sizes(list) {
  const out = new Uint8Array(list.length * 4);
  const view = new DataView(out.buffer);
  list.forEach((n, i) => view.setUint32(i * 4, n));
  return out;
}

function audioTrack({ rate, frames, offset, asc, bitrate, ms, chapters }) {
  const samples = frames.length * FRAME;
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), mp4a(rate, asc, bitrate)),
    full('stts', 0, 0, u32(1), u32(frames.length), u32(FRAME)),
    full('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
    full('stsz', 0, 0, u32(0), u32(frames.length), sizes(frames)),
    full('co64', 0, 0, u32(1), u64(offset)));
  return box('trak', tkhd(1, ms, 3, 0x0100), ...(chapters ? [box('tref', box('chap', u32(2)))] : []),
    box('mdia', mdhd(rate, samples), hdlr('soun', 'Audio'), box('minf', full('smhd', 0, 0, zeros(4)), dinf(), stbl)));
}

/** Each chapter title as a sample of the text track. */
function titleSample(title) {
  const words = text(title);
  return join([u16(words.length), words, u32(12), text('encd'), u32(0x100)]);
}

function textTrack({ rate, durations, lengths, offset, ms }) {
  const stts = join(durations.map((d) => join([u32(1), u32(d)])));
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), box('text', zeros(6), u16(1), zeros(43))),
    full('stts', 0, 0, u32(durations.length), stts),
    full('stsc', 0, 0, u32(1), u32(1), u32(durations.length), u32(1)),
    full('stsz', 0, 0, u32(0), u32(lengths.length), sizes(lengths)),
    full('co64', 0, 0, u32(1), u64(offset)));
  const gmhd = box('gmhd',
    full('gmin', 0, 0, u16(0x40), u16(0x8000), u16(0x8000), u16(0x8000), u16(0), u16(0)),
    box('text', u16(1), zeros(12), u32(1), zeros(16), u32(0x4000), u16(0)));
  return box('trak', tkhd(2, ms, 0, 0), box('mdia', mdhd(rate, durations.reduce((a, b) => a + b, 0)), hdlr('text', 'Chapters'), box('minf', gmhd, dinf(), stbl)));
}

function chpl(chapters, rate) {
  const list = chapters.slice(0, MAX_CHPL);
  const rows = list.map((c) => {
    let title = text(c.title);
    if (title.length > 255) title = title.subarray(0, 255);
    return join([u64(Math.round((c.sample / rate) * 1e7)), u8(title.length), title]);
  });
  return full('chpl', 1, 0, u32(0), u8(list.length), ...rows);
}

const tag = (name, value) => box(name, box('data', u32(1), u32(0), text(value)));

function metadata({ title, author }) {
  const items = [tag('©nam', title), tag('©alb', title), ...(author ? [tag('©ART', author)] : []), tag('©too', 'RT Markdown Reader'),
    box('stik', box('data', u32(21), u32(0), u8(2)))];
  return full('meta', 0, 0, full('hdlr', 0, 0, u32(0), text('mdir'), text('appl'), zeros(9)), box('ilst', ...items));
}

/** What goes first: the file type, and the start of the sound with room for its size. */
export function m4bStart() {
  const ftyp = box('ftyp', text('M4B '), u32(0), text('isom'), text('iso2'), text('M4B '), text('M4A '), text('mp42'));
  return { head: join([ftyp, u32(1), text('mdat'), zeros(8)]), sizeAt: ftyp.length + 8, audioAt: ftyp.length + 16 };
}

/**
 * What follows the sound, and the size to write at `sizeAt`.
 * @param {object} o
 * @param {number} o.rate         samples per second
 * @param {number[]} o.frames     the size of each AAC frame
 * @param {Uint8Array} o.asc      the encoder's AudioSpecificConfig
 * @param {number} o.bitrate
 * @param {{ title: string, sample: number }[]} o.chapters  where each one starts, in samples
 * @param {number} o.audioAt      where the sound starts in the file
 * @param {string} o.title
 * @param {string} [o.author]
 */
export function m4bEnd({ rate, frames, asc, bitrate, chapters, audioAt, title, author = '' }) {
  const audioBytes = frames.reduce((a, b) => a + b, 0);
  const samples = frames.length * FRAME;
  const ms = Math.round((samples / rate) * 1000);
  const titles = chapters.map((c) => titleSample(c.title));
  const body = join(titles);
  const durations = chapters.map((c, i) => Math.max(1, (chapters[i + 1]?.sample ?? samples) - c.sample));
  const textAt = audioAt + audioBytes;
  const tracks = [audioTrack({ rate, frames, offset: audioAt, asc, bitrate, ms, chapters: chapters.length > 0 })];
  if (chapters.length) tracks.push(textTrack({ rate, durations, lengths: titles.map((t) => t.length), offset: textAt, ms }));
  const moov = box('moov', mvhd(ms, tracks.length + 1), ...tracks, box('udta', ...(chapters.length ? [chpl(chapters, rate)] : []), metadata({ title, author })));
  return { tail: join([body, moov]), mdatSize: u64(16 + audioBytes + body.length) };
}

/** A small ID3v2.3 tag for the start of an MP3: its title and author. */
export function id3({ title, author = '' }) {
  const frame = (id, value) => {
    const words = new Uint8Array(new Uint16Array([0xfeff, ...[...value].flatMap((c) => { const s = []; for (let i = 0; i < c.length; i++) s.push(c.charCodeAt(i)); return s; })]).buffer);
    return join([text(id), u32(words.length + 1), u16(0), u8(1), words]);
  };
  const body = join([frame('TIT2', title), ...(author ? [frame('TPE1', author)] : []), frame('TSSE', 'RT Markdown Reader')]);
  const n = body.length;
  return join([text('ID3'), Uint8Array.of(3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127), body]);
}
