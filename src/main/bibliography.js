'use strict';
// Citations (3.6): reading sources from BibTeX and CSL JSON files and from Zotero on this computer. Every
// source becomes the same plain record, which the page formats (src/renderer/citations.js):
//   { id, type, title, author: [{ family, given } | { literal }], editor, year, month, day, container,
//     volume, issue, pages, publisher, place, edition, school, number, doi, url, genre }
// type: article | book | chapter | thesis | report | web | misc

const MAX_ENTRIES = 20000;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const intOf = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

/** "2020-03-05", "March 2020", "2020" → { year, month, day }. */
function parseDate(v) {
  const s = str(v);
  const iso = /^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?/.exec(s);
  if (iso) return { year: iso[1], month: intOf(iso[2]), day: intOf(iso[3]) };
  const year = /\b(\d{4})\b/.exec(s)?.[1] || '';
  const month = MONTHS[/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i.exec(s)?.[1]?.toLowerCase()] || 0;
  return { year, month, day: 0 };
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => (Array.isArray(v) ? v.length : v !== '' && v !== 0 && v !== undefined && v !== null)));

// ======================================================================== BibTeX
const ACCENTS = {
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ć', N: 'Ń', S: 'Ś', Z: 'Ź' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', C: 'Č', S: 'Š', Z: 'Ž', R: 'Ř', E: 'Ě' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
};
const LETTERS = { ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı' };

/** LaTeX in a field as plain text. */
function fromLatex(value) {
  let s = String(value);
  s = s.replace(/\\([`'^"~=])\s*\{?\\?([A-Za-z])\}?/g, (all, mark, letter) => ACCENTS[mark]?.[letter] ?? letter);
  s = s.replace(/\\([cv])\s*\{\\?([A-Za-z])\}/g, (all, mark, letter) => ACCENTS[mark]?.[letter] ?? letter);
  s = s.replace(/\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L|i)(?![A-Za-z])(?:\{\}|\s)?/g, (all, name) => LETTERS[name]);
  s = s.replace(/\\(?:emph|textit|textbf|textsc|texttt|mkbibquote|enquote|url|mbox|text)\s*\{/g, '{');
  s = s.replace(/\\([&%$#_{}])/g, '$1').replace(/~/g, ' ');
  s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/``|''/g, '"');
  s = s.replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Split a BibTeX name list on " and " outside braces. */
function splitNames(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (!depth && /^\s+and\s+/i.test(s.slice(i, i + 12))) {
      out.push(cur);
      cur = '';
      i += /^\s+and\s+/i.exec(s.slice(i, i + 12))[0].length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((n) => n.trim()).filter(Boolean);
}

/** One BibTeX name: "Last, First", "First Last", "First von Last", or {A Company}. */
function parseName(raw) {
  const name = raw.trim();
  if (/^\{.*\}$/.test(name) && !/\}.*\{/.test(name)) return { literal: fromLatex(name) };
  if (/^others$/i.test(name)) return null;
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of name) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === ',' && !depth) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  if (parts.length >= 2) {
    const given = parts.length === 3 ? parts[2] : parts[1];
    return clean({ family: fromLatex(parts[0]), given: fromLatex(given) });
  }
  const words = fromLatex(name).split(' ');
  if (words.length === 1) return { family: words[0] };
  const particle = words.findIndex((w, i) => i > 0 && i < words.length - 1 && /^[a-z]/.test(w));
  const at = particle > 0 ? particle : words.length - 1;
  return { family: words.slice(at).join(' '), given: words.slice(0, at).join(' ') };
}

const namesOf = (value) => (value ? splitNames(value).map(parseName).filter(Boolean) : []);

const BIB_TYPES = {
  article: 'article', book: 'book', mvbook: 'book', booklet: 'book', manual: 'book', proceedings: 'book', collection: 'book',
  inbook: 'chapter', incollection: 'chapter', inproceedings: 'chapter', conference: 'chapter', bookinbook: 'chapter',
  phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report',
  online: 'web', electronic: 'web', www: 'web', webpage: 'web',
};

function fromBibFields(key, kind, f) {
  const date = f.date ? parseDate(fromLatex(f.date)) : { year: /\d{4}/.exec(fromLatex(f.year || ''))?.[0] || '', month: 0, day: intOf(f.day) };
  if (!date.month && f.month) {
    const m = fromLatex(f.month).toLowerCase();
    date.month = MONTHS[m.slice(0, 3)] || (intOf(m) <= 12 ? intOf(m) : 0);
  }
  const text = (...names) => { for (const n of names) if (f[n]) return fromLatex(f[n]); return ''; };
  const type = BIB_TYPES[kind] || (f.url && !f.journal && !f.publisher ? 'web' : 'misc');
  return clean({
    id: key, type,
    title: text('title'),
    author: namesOf(f.author),
    editor: namesOf(f.editor),
    year: date.year, month: date.month, day: date.day,
    container: type === 'article' ? text('journal', 'journaltitle') : type === 'web' ? text('organization', 'howpublished') : text('booktitle', 'maintitle', 'journal', 'journaltitle'),
    volume: text('volume'),
    issue: text('number', 'issue'),
    pages: text('pages').replace(/-+/g, '–'),
    publisher: text('publisher', 'institution', 'organization'),
    place: text('address', 'location'),
    edition: text('edition').replace(/(?:st|nd|rd|th)?\s*(?:ed\.?|edition)?$/i, ''),
    school: text('school', 'institution'),
    genre: kind === 'phdthesis' ? 'phd' : kind === 'mastersthesis' ? 'masters' : /master/i.test(text('type')) ? 'masters' : /ph\.?d|doctor/i.test(text('type')) ? 'phd' : '',
    number: type === 'report' ? text('number') : '',
    doi: text('doi').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
    url: f.url ? String(f.url).replace(/[{}]/g, '').trim() : '',
  });
}

/** A brace- or quote-delimited value, or a number or macro, with # joins. Returns [value, next index]. */
function readValue(s, start, macros) {
  let i = start;
  let out = '';
  for (;;) {
    while (/\s/.test(s[i] || '')) i++;
    if (s[i] === '{') {
      let depth = 0;
      const from = i + 1;
      for (; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '{') depth++;
        else if (s[i] === '}' && --depth === 0) break;
      }
      out += s.slice(from, i);
      i++;
    } else if (s[i] === '"') {
      let depth = 0;
      const from = ++i;
      for (; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
        else if (s[i] === '"' && depth === 0) break;
      }
      out += s.slice(from, i);
      i++;
    } else {
      const m = /^[^\s,#}]+/.exec(s.slice(i, i + 200));
      if (!m) break;
      i += m[0].length;
      const word = m[0].toLowerCase();
      out += macros.get(word) ?? (/^\d+$/.test(word) ? m[0] : MONTHS[word] ? m[0] : m[0]);
    }
    while (/\s/.test(s[i] || '')) i++;
    if (s[i] === '#') { i++; continue; }
    break;
  }
  return [out, i];
}

/** Sources in a .bib file. A damaged entry is skipped; the rest still load. */
function parseBibtex(text) {
  const s = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const macros = new Map();
  const entries = [];
  let skipped = 0;
  let i = 0;
  while (i < s.length && entries.length < MAX_ENTRIES) {
    const at = s.indexOf('@', i);
    if (at < 0) break;
    const head = /^@\s*([A-Za-z]+)\s*([{(])/.exec(s.slice(at, at + 60));
    if (!head) { i = at + 1; continue; }
    const kind = head[1].toLowerCase();
    const close = head[2] === '{' ? '}' : ')';
    i = at + head[0].length;
    if (kind === 'comment' || kind === 'preamble') {
      let depth = 1;
      for (; i < s.length && depth; i++) {
        if (s[i] === head[2]) depth++;
        else if (s[i] === close) depth--;
      }
      continue;
    }
    if (kind === 'string') {
      const m = /^\s*([^\s=]+)\s*=/.exec(s.slice(i, i + 200));
      if (!m) continue;
      const [value, next] = readValue(s, i + m[0].length, macros);
      macros.set(m[1].toLowerCase(), value);
      i = next + 1;
      continue;
    }
    const keyMatch = /^\s*([^\s,{}]+)\s*,/.exec(s.slice(i, i + 300));
    if (!keyMatch) { skipped++; continue; }
    i += keyMatch[0].length;
    const fields = {};
    let ok = false;
    for (;;) {
      while (/[\s,]/.test(s[i] || '')) i++;
      if (i >= s.length) break;
      if (s[i] === close) { i++; ok = true; break; }
      const name = /^([A-Za-z][\w:.+-]*)\s*=/.exec(s.slice(i, i + 80));
      if (!name) break;
      const [value, next] = readValue(s, i + name[0].length, macros);
      fields[name[1].toLowerCase()] = value;
      i = next;
    }
    if (!ok) { skipped++; continue; }
    entries.push(fromBibFields(keyMatch[1], kind, fields));
  }
  return { entries, skipped };
}

// ======================================================================== CSL JSON
const CSL_TYPES = {
  'article-journal': 'article', 'article-magazine': 'article', 'article-newspaper': 'article', article: 'article',
  book: 'book', chapter: 'chapter', 'paper-conference': 'chapter', 'entry-encyclopedia': 'chapter', 'entry-dictionary': 'chapter',
  thesis: 'thesis', report: 'report', webpage: 'web', 'post-weblog': 'web', post: 'web',
};

const cslNames = (list) => (Array.isArray(list) ? list.map((n) => {
  if (!n || typeof n !== 'object') return null;
  if (n.literal) return { literal: str(n.literal) };
  const family = [str(n['non-dropping-particle']), str(n.family)].filter(Boolean).join(' ');
  return family ? clean({ family, given: str(n.given) }) : null;
}).filter(Boolean) : []);

function fromCsl(item) {
  if (!item || typeof item !== 'object' || !str(item.id)) return null;
  const parts = item.issued?.['date-parts']?.[0];
  const date = Array.isArray(parts) ? { year: str(parts[0]), month: intOf(parts[1]), day: intOf(parts[2]) } : parseDate(item.issued?.raw || item.issued?.literal);
  const type = CSL_TYPES[item.type] || 'misc';
  return clean({
    id: str(item.id), type,
    title: str(item.title),
    author: cslNames(item.author),
    editor: cslNames(item.editor),
    year: date.year, month: date.month, day: date.day,
    container: str(item['container-title']),
    volume: str(item.volume),
    issue: str(item.issue),
    pages: str(item.page).replace(/-+/g, '–'),
    publisher: type === 'thesis' ? '' : str(item.publisher),
    place: str(item['publisher-place']),
    edition: str(item.edition),
    school: type === 'thesis' ? str(item.publisher) : '',
    genre: /master/i.test(str(item.genre)) ? 'masters' : /ph\.?d|doctor/i.test(str(item.genre)) ? 'phd' : '',
    number: str(item.number),
    doi: str(item.DOI).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
    url: str(item.URL),
  });
}

function parseCslJson(text) {
  let data;
  try { data = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch { throw new Error('That file isn’t valid JSON.'); }
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!items) throw new Error('That file isn’t a list of sources in CSL JSON.');
  const entries = [];
  let skipped = 0;
  for (const item of items.slice(0, MAX_ENTRIES)) {
    const e = fromCsl(item);
    if (e) entries.push(e); else skipped++;
  }
  return { entries, skipped };
}

// ======================================================================== Zotero
const ZOTERO_TYPES = {
  journalArticle: 'article', magazineArticle: 'article', newspaperArticle: 'article', book: 'book', bookSection: 'chapter',
  conferencePaper: 'chapter', encyclopediaArticle: 'chapter', dictionaryEntry: 'chapter', thesis: 'thesis', report: 'report',
  webpage: 'web', blogPost: 'web', forumPost: 'web',
};

/** The key Zotero or Better BibTeX gave an item, or one made like theirs: smith2020network. */
function zoteroKey(d, taken) {
  const given = str(d.citationKey) || /^(?:Citation Key|bibtex):\s*(\S+)/mi.exec(str(d.extra))?.[1];
  if (given) return given;
  const first = (d.creators || []).find((c) => c.creatorType === 'author') || d.creators?.[0];
  const name = str(first?.lastName || first?.name).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'anon';
  const year = /\d{4}/.exec(str(d.date))?.[0] || 'nd';
  const word = str(d.title).normalize('NFD').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 3 && !['with', 'from', 'that', 'this'].includes(w)) || '';
  const base = `${name}${year}${word}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  return key;
}

function parseZotero(items) {
  const taken = new Set();
  const entries = [];
  for (const raw of Array.isArray(items) ? items.slice(0, MAX_ENTRIES) : []) {
    const d = raw?.data || raw;
    if (!d || typeof d !== 'object' || ['attachment', 'note', 'annotation'].includes(d.itemType)) continue;
    const id = zoteroKey(d, taken);
    if (taken.has(id)) continue;
    taken.add(id);
    const people = (role) => (d.creators || []).filter((c) => c.creatorType === role).map((c) => (c.name ? { literal: str(c.name) } : clean({ family: str(c.lastName), given: str(c.firstName) })));
    const date = parseDate(d.date);
    const type = ZOTERO_TYPES[d.itemType] || 'misc';
    entries.push(clean({
      id, type,
      title: str(d.title),
      author: people('author'),
      editor: people('editor'),
      year: date.year, month: date.month, day: date.day,
      container: str(d.publicationTitle || d.bookTitle || d.proceedingsTitle || d.encyclopediaTitle || d.dictionaryTitle || d.websiteTitle || d.blogTitle || d.forumTitle),
      volume: str(d.volume),
      issue: str(d.issue),
      pages: str(d.pages).replace(/-+/g, '–'),
      publisher: type === 'thesis' ? '' : str(d.publisher || d.institution),
      place: str(d.place),
      edition: str(d.edition),
      school: type === 'thesis' ? str(d.university) : '',
      genre: /master/i.test(str(d.thesisType)) ? 'masters' : /ph\.?d|doctor/i.test(str(d.thesisType)) ? 'phd' : '',
      number: str(d.reportNumber),
      doi: str(d.DOI).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
      url: str(d.url),
    }));
  }
  return { entries, skipped: 0 };
}

const ZOTERO_URL = 'http://127.0.0.1:23119/api/users/0/items';

/** The library from Zotero running on this computer. Nothing leaves the computer. */
async function fetchZotero(fetchFn, url = ZOTERO_URL) {
  const items = [];
  for (let start = 0; start < MAX_ENTRIES; start += 100) {
    let res;
    try {
      res = await fetchFn(`${url}?format=json&limit=100&start=${start}`, { headers: { 'Zotero-Allowed-Request': '1' } });
    } catch { throw new Error('Zotero isn’t running. Open Zotero, then try again.'); }
    if (res.status === 403 || res.status === 404) throw new Error('Zotero needs to allow this. In Zotero, open Settings → Advanced and tick “Allow other applications on this computer to communicate with Zotero”.');
    if (!res.ok) throw new Error(`Zotero answered with an error (${res.status}).`);
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) break;
    items.push(...page);
    if (page.length < 100) break;
  }
  return parseZotero(items);
}

/** Read a file of sources by its extension. */
function parseFile(name, text) {
  return /\.json$/i.test(name) ? parseCslJson(text) : parseBibtex(text);
}

const isBibPath = (p) => typeof p === 'string' && /\.(?:bib|bibtex|json)$/i.test(p);

module.exports = { parseBibtex, parseCslJson, parseZotero, fetchZotero, parseFile, isBibPath, fromLatex, parseName, parseDate, ZOTERO_URL };
