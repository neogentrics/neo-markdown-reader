// Citations (3.6) on the page: [@key] in the text becomes a citation in the chosen style, and the sources
// cited become a bibliography at the end. The syntax is the one Pandoc uses, so documents move between them.
// The styles are written here rather than taken from citeproc, whose licence doesn't suit a closed-source app.
//
// A style answers two questions: how a citation reads in the text, and how a source reads in the list.
// Sources are the plain records made by src/main/bibliography.js.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const IEEE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

const it = (s) => (s ? `<i>${esc(s)}</i>` : '');
const family = (n) => n.literal || n.family || '';
const initials = (given, spaced = true) => String(given || '').split(/[\s]+/).filter(Boolean)
  .map((part) => part.split('-').map((p) => `${[...p][0]?.toUpperCase() || ''}.`).join('-')).join(spaced ? ' ' : '');
const doiUrl = (e) => (e.doi ? `https://doi.org/${e.doi}` : '');
const link = (url) => (url ? `<a href="${esc(url)}">${esc(url)}</a>` : '');
const ordinal = (n) => { const v = Number(n); if (!Number.isInteger(v)) return String(n); const r = v % 100; return `${v}${r > 10 && r < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`; };
const dot = (s) => (!s ? '' : /[.?!]["”’]?$/.test(s.replace(/<[^>]+>/g, '')) ? s : `${s}.`);
/** A title in quotes, with the punctuation inside. */
const quoted = (title, mark) => { const t = esc(title); return /[?!]$/.test(title) ? `“${t}”` : `“${t}${mark}”`; };
const people = (e) => (e.author?.length ? e.author : e.editor || []);
const edited = (e) => !e.author?.length && !!e.editor?.length;
const yearOf = (e, suffix = '') => `${e.year || 'n.d.'}${e.year ? suffix : (suffix ? `-${suffix}` : '')}`;
const shortTitle = (e) => { const words = String(e.title || e.id).split(/\s+/); return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' '); };

/** "Smith", "Smith and Jones" or "Smith et al.", or a short title when nobody is named. */
function shortNames(e, { and = 'and', etAl = 3, title = true } = {}) {
  const list = people(e);
  if (!list.length) return title ? (e.type === 'book' || e.type === 'report' ? it(shortTitle(e)) : `“${esc(shortTitle(e))}”`) : '';
  if (list.length >= etAl) return `${esc(family(list[0]))} et al.`;
  if (list.length === 1) return esc(family(list[0]));
  return `${list.slice(0, -1).map((n) => esc(family(n))).join(', ')}${list.length > 2 ? ',' : ''} ${and} ${esc(family(list[list.length - 1]))}`;
}

/** A page reference as typed, without any "p." the style doesn't want, or with the one it does. */
function pageRef(locator, form) {
  const s = String(locator || '').trim();
  if (!s) return '';
  const pages = /^(?:pp?\.?\s*)?(\d[\d\s,–—-]*[a-z]?)$/i.exec(s);
  if (!pages) return esc(s);                           // "chap. 3", "para. 2", "sec. 4": as typed
  const value = pages[1].trim().replace(/(\d)-(\d)/g, '$1–$2');
  if (form === 'bare') return esc(value);
  return `${/[–,]/.test(value) ? 'pp.' : 'p.'} ${esc(value)}`;
}

// ------------------------------------------------------------------------ APA 7
const apaName = (n) => (n.literal ? esc(n.literal) : `${esc(n.family)}${n.given ? `, ${esc(initials(n.given))}` : ''}`);
const apaEditor = (n) => (n.literal ? esc(n.literal) : `${n.given ? `${esc(initials(n.given))} ` : ''}${esc(n.family)}`);
function apaNames(list) {
  if (list.length > 20) return `${list.slice(0, 19).map(apaName).join(', ')}, … ${apaName(list[list.length - 1])}`;
  if (list.length === 1) return apaName(list[0]);
  return `${list.slice(0, -1).map(apaName).join(', ')}, &amp; ${apaName(list[list.length - 1])}`;
}
const andList = (list, fmt, word) => (list.length < 2 ? list.map(fmt).join('') : `${list.slice(0, -1).map(fmt).join(', ')}${list.length > 2 ? ',' : ''} ${word} ${fmt(list[list.length - 1])}`);

function apaDate(e, suffix) {
  if (!e.year) return `(n.d.${suffix ? `-${suffix}` : ''})`;
  if (e.type !== 'web' || !e.month) return `(${e.year}${suffix})`;
  return `(${e.year}${suffix}, ${MONTHS[e.month - 1]}${e.day ? ` ${e.day}` : ''})`;
}

const apa = {
  name: 'APA (7th edition)',
  heading: 'References',
  order: 'author',
  cite(e, { suffix, locator, suppress }) {
    const who = suppress ? '' : `${shortNames(e, { and: '&amp;' })}, `;
    return `${who}${yearOf(e, suffix)}${locator ? `, ${pageRef(locator)}` : ''}`;
  },
  narrative(e, { suffix, locator }) {
    return `${shortNames(e)} (${yearOf(e, suffix)}${locator ? `, ${pageRef(locator)}` : ''})`;
  },
  reference(e, { suffix }) {
    const list = people(e);
    const who = list.length ? `${apaNames(list)}${edited(e) ? (list.length > 1 ? ' (Eds.)' : ' (Ed.)') : ''}` : '';
    const date = apaDate(e, suffix);
    const start = who ? `${dot(who)} ${date}.` : '';
    const ed = e.edition ? `${ordinal(e.edition)} ed.` : '';
    const tail = [];
    let body;
    if (e.type === 'article') {
      const issue = e.issue ? `(${esc(e.issue)})` : '';
      const where = [e.container ? it(e.container) : '', e.volume ? `<i>${esc(e.volume)}</i>${issue}` : issue, esc(e.pages || '')].filter(Boolean).join(', ');
      body = `${dot(esc(e.title))} ${dot(where)}`;
    } else if (e.type === 'chapter') {
      const eds = e.editor?.length && e.author?.length ? `${andList(e.editor, apaEditor, '&amp;')} (${e.editor.length > 1 ? 'Eds.' : 'Ed.'}), ` : '';
      const notes = [ed, e.pages ? `pp. ${esc(e.pages)}` : ''].filter(Boolean).join(', ');
      body = `${dot(esc(e.title))} ${e.container ? `In ${eds}${it(e.container)}${notes ? ` (${notes})` : ''}.` : ''}`;
      if (e.publisher) tail.push(dot(esc(e.publisher)));
    } else if (e.type === 'thesis') {
      const kind = e.genre === 'masters' ? 'Master’s thesis' : 'Doctoral dissertation';
      body = `${it(e.title)} [${kind}${e.school ? `, ${esc(e.school)}` : ''}].`;
    } else if (e.type === 'web') {
      body = `${it(e.title)}.${e.container ? ` ${dot(esc(e.container))}` : ''}`;
    } else {
      const notes = [ed, e.number ? `Report No. ${esc(e.number)}` : ''].filter(Boolean).join(', ');
      body = `${it(e.title)}${notes ? ` (${notes})` : ''}.`;
      if (e.publisher) tail.push(dot(esc(e.publisher)));
    }
    const out = who ? `${start} ${body}` : `${body} ${date}.`;
    const url = doiUrl(e) || e.url;
    return [out.trim(), ...tail, link(url)].filter(Boolean).join(' ');
  },
};

// ------------------------------------------------------------------------ MLA 9
const fullName = (n) => (n.literal ? esc(n.literal) : `${n.given ? `${esc(n.given)} ` : ''}${esc(n.family)}`);
const invertedName = (n) => (n.literal ? esc(n.literal) : `${esc(n.family)}${n.given ? `, ${esc(n.given)}` : ''}`);
function mlaNames(list) {
  if (list.length >= 3) return `${invertedName(list[0])}, et al.`;
  if (list.length === 2) return `${invertedName(list[0])}, and ${fullName(list[1])}`;
  return list.length ? invertedName(list[0]) : '';
}
const mlaDate = (e) => (e.day && e.month ? `${e.day} ${MLA_MONTHS[e.month - 1]} ${e.year}` : e.month ? `${MLA_MONTHS[e.month - 1]} ${e.year}` : e.year || '');

const mla = {
  name: 'MLA (9th edition)',
  heading: 'Works Cited',
  order: 'author',
  cite(e, { locator, suppress, suffix }) {
    const who = suppress ? '' : shortNames(e);
    const extra = suffix ? `, ${it(shortTitle(e))}` : '';
    return [`${who}${extra}`, pageRef(locator, 'bare')].filter(Boolean).join(' ');
  },
  narrative(e, { locator }) {
    return `${shortNames(e)}${locator ? ` (${pageRef(locator, 'bare')})` : ''}`;
  },
  reference(e) {
    const list = people(e);
    const who = list.length ? `${mlaNames(list)}${edited(e) ? (list.length > 1 ? ', editors' : ', editor') : ''}` : '';
    const ed = e.edition ? `${ordinal(e.edition)} ed.` : '';
    const url = doiUrl(e) || e.url;
    const container = e.type === 'article' || e.type === 'chapter' || e.type === 'web';
    const title = e.type === 'book' || e.type === 'report' || e.type === 'thesis' || e.type === 'misc' ? `${it(e.title)}.` : quoted(e.title, '.');
    const eds = e.type === 'chapter' && e.editor?.length && e.author?.length ? `edited by ${andList(e.editor, fullName, 'and')}` : '';
    const parts = [
      container && e.container ? it(e.container) : '',
      !container ? ed : '',
      eds,
      container && e.type !== 'article' ? ed : '',
      e.volume ? `vol. ${esc(e.volume)}` : '',
      e.issue ? `no. ${esc(e.issue)}` : '',
      e.type !== 'thesis' ? esc(e.publisher || '') : '',
      esc(e.type === 'thesis' ? e.year || '' : mlaDate(e)),
      e.pages ? `pp. ${esc(e.pages)}` : '',
      link(url),
    ].filter(Boolean);
    const thesis = e.type === 'thesis' ? ` ${[esc(e.school || ''), e.genre === 'masters' ? 'MA thesis' : 'PhD dissertation'].filter(Boolean).join(', ')}.` : '';
    const rest = parts.length ? ` ${parts.join(', ')}.` : '';
    return `${who ? `${dot(who)} ` : ''}${title}${rest}${thesis}`;
  },
};

// ------------------------------------------------------------------------ Chicago (author-date, 18th edition)
function chicagoNames(list) {
  const shown = list.length > 6 ? list.slice(0, 3) : list;
  const names = shown.map((n, i) => (i === 0 ? invertedName(n) : fullName(n)));
  if (list.length > 6) return `${names.join(', ')}, et al`;
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

const chicago = {
  name: 'Chicago (author-date)',
  heading: 'References',
  order: 'author',
  cite(e, { suffix, locator, suppress }) {
    const who = suppress ? '' : `${shortNames(e)} `;
    return `${who}${yearOf(e, suffix)}${locator ? `, ${pageRef(locator, 'bare')}` : ''}`;
  },
  narrative(e, { suffix, locator }) {
    return `${shortNames(e)} (${yearOf(e, suffix)}${locator ? `, ${pageRef(locator, 'bare')}` : ''})`;
  },
  reference(e, { suffix }) {
    const list = people(e);
    const who = list.length ? `${chicagoNames(list)}${edited(e) ? (list.length > 1 ? ', eds' : ', ed') : ''}` : '';
    const year = yearOf(e, suffix);
    const ed = e.edition ? `${ordinal(e.edition)} ed.` : '';
    const url = doiUrl(e) || e.url;
    let body;
    if (e.type === 'article') {
      const issue = e.issue ? ` (${esc(e.issue)})` : '';
      const where = `${it(e.container)}${e.volume ? ` ${esc(e.volume)}` : ''}${issue}${e.pages ? `: ${esc(e.pages)}` : ''}`;
      body = `${quoted(e.title, '.')} ${dot(where)}`;
    } else if (e.type === 'chapter') {
      const eds = e.editor?.length && e.author?.length ? `, edited by ${andList(e.editor, fullName, 'and')}` : '';
      body = `${quoted(e.title, '.')} In ${it(e.container)}${eds}${e.pages ? `, ${esc(e.pages)}` : ''}. ${dot(esc(e.publisher || ''))}`;
    } else if (e.type === 'thesis') {
      body = `${quoted(e.title, '.')} ${e.genre === 'masters' ? 'Master’s thesis' : 'PhD diss.'}${e.school ? `, ${esc(e.school)}` : ''}.`;
    } else if (e.type === 'web') {
      const on = e.month ? ` ${MONTHS[e.month - 1]}${e.day ? ` ${e.day}` : ''}, ${e.year}.` : '';
      body = `${quoted(e.title, '.')}${e.container ? ` ${dot(esc(e.container))}` : ''}${on}`;
    } else {
      body = `${it(e.title)}.${ed ? ` ${ed}` : ''}${e.publisher ? ` ${dot(esc(e.publisher))}` : ''}`;
    }
    return `${who ? `${dot(who)} ` : ''}${year}. ${body.trim()}${url ? ` ${link(url)}.` : ''}`;
  },
};

// ------------------------------------------------------------------------ IEEE
const ieeeName = (n) => (n.literal ? esc(n.literal) : `${n.given ? `${esc(initials(n.given))} ` : ''}${esc(n.family)}`);
function ieeeNames(list) {
  if (list.length > 6) return `${ieeeName(list[0])} et al.`;
  return andList(list, ieeeName, 'and');
}

const ieee = {
  name: 'IEEE',
  heading: 'References',
  order: 'cited',
  numbered: true,
  cite(e, { number, locator }) { return `[${number}${locator ? `, ${pageRef(locator)}` : ''}]`; },
  narrative(e, { number, locator }) { return `[${number}${locator ? `, ${pageRef(locator)}` : ''}]`; },
  reference(e) {
    const list = people(e);
    const who = list.length ? `${ieeeNames(list)}${edited(e) ? (list.length > 1 ? ', Eds' : ', Ed') : ''}` : '';
    const ed = e.edition ? `${ordinal(e.edition)} ed.` : '';
    const when = e.month ? `${IEEE_MONTHS[e.month - 1]} ${e.year}` : e.year || '';
    const lead = who ? `${who}, ` : '';
    if (e.type === 'article') {
      const parts = [it(e.container), e.volume ? `vol. ${esc(e.volume)}` : '', e.issue ? `no. ${esc(e.issue)}` : '', e.pages ? `pp. ${esc(e.pages)}` : '', esc(when)].filter(Boolean);
      return `${lead}${quoted(e.title, ',')} ${parts.join(', ')}${e.doi ? `, doi: ${esc(e.doi)}` : ''}.`;
    }
    if (e.type === 'chapter') {
      const eds = e.editor?.length && e.author?.length ? `, ${andList(e.editor, ieeeName, 'and')}, ${e.editor.length > 1 ? 'Eds.' : 'Ed.'}` : '';
      const parts = [esc(e.publisher || ''), esc(e.year || ''), e.pages ? `pp. ${esc(e.pages)}` : ''].filter(Boolean);
      return `${lead}${quoted(e.title, ',')} in ${it(e.container)}${ed ? `, ${ed}` : ''}${eds}${parts.length ? `, ${parts.join(', ')}` : ''}.`;
    }
    if (e.type === 'thesis') {
      return `${lead}${quoted(e.title, ',')} ${e.genre === 'masters' ? 'M.S. thesis' : 'Ph.D. dissertation'}${e.school ? `, ${esc(e.school)}` : ''}${e.year ? `, ${esc(e.year)}` : ''}.`;
    }
    if (e.type === 'web') {
      return `${who ? `${who}. ` : ''}${quoted(e.title, '.')}${e.container ? ` ${dot(esc(e.container))}` : ''}${e.url ? ` ${link(e.url)}` : ''}`;
    }
    const pub = [esc(e.place || ''), esc(e.publisher || '')].filter(Boolean).join(': ');
    return `${lead}${dot(`${it(e.title)}${ed ? `, ${ed}` : ''}`)}${pub ? ` ${pub}` : ''}${e.year ? `, ${esc(e.year)}` : ''}.`.replace(/\.,/, ',');
  },
};

// ------------------------------------------------------------------------ Harvard (Cite Them Right)
const harvardName = (n) => (n.literal ? esc(n.literal) : `${esc(n.family)}${n.given ? `, ${esc(initials(n.given, false))}` : ''}`);
const harvardNames = (list) => andList(list, harvardName, 'and').replace(/, and /, ' and ');
const single = (s) => { const t = esc(s); return `‘${t}’`; };

const harvard = {
  name: 'Harvard',
  heading: 'Reference list',
  order: 'author',
  cite(e, { suffix, locator, suppress }) {
    const who = suppress ? '' : `${shortNames(e, { etAl: 4 })}, `;
    return `${who}${yearOf(e, suffix)}${locator ? `, ${pageRef(locator)}` : ''}`;
  },
  narrative(e, { suffix, locator }) {
    return `${shortNames(e, { etAl: 4 })} (${yearOf(e, suffix)}${locator ? `, ${pageRef(locator)}` : ''})`;
  },
  reference(e, { suffix }) {
    const list = people(e);
    const who = list.length ? `${harvardNames(list)}${edited(e) ? ' (ed.)' : ''} ` : '';
    const year = `(${yearOf(e, suffix)})`;
    const ed = e.edition ? `${ordinal(e.edition)} edn.` : '';
    const url = e.doi ? `doi:${esc(e.doi)}` : e.url ? `Available at: ${link(e.url)}` : '';
    const pub = [esc(e.place || ''), esc(e.publisher || '')].filter(Boolean).join(': ');
    let body;
    if (e.type === 'article') {
      const issue = e.issue ? `(${esc(e.issue)})` : '';
      const where = [it(e.container), `${esc(e.volume || '')}${issue}`, e.pages ? `pp. ${esc(e.pages)}` : ''].filter(Boolean).join(', ');
      body = `${single(e.title)}, ${dot(where)}`;
    } else if (e.type === 'chapter') {
      const eds = e.editor?.length && e.author?.length ? `${harvardNames(e.editor)} (ed${e.editor.length > 1 ? 's' : ''}.) ` : '';
      const tail = [`${pub}`, e.pages ? `pp. ${esc(e.pages)}` : ''].filter(Boolean).join(', ');
      body = `${single(e.title)}, in ${eds}${it(e.container)}.${ed ? ` ${ed}` : ''}${tail ? ` ${tail}.` : ''}`;
    } else if (e.type === 'thesis') {
      body = `${it(e.title)}. ${e.genre === 'masters' ? 'Master’s thesis' : 'PhD thesis'}${e.school ? `. ${esc(e.school)}` : ''}.`;
    } else if (e.type === 'web') {
      body = `${it(e.title)}.`;
    } else {
      body = `${it(e.title)}.${ed ? ` ${ed}` : ''}${pub ? ` ${pub}.` : ''}`;
    }
    return `${who}${year} ${body}${url ? ` ${url}${e.doi ? '.' : ''}` : ''}`;
  },
};

export const STYLES = { apa, mla, chicago, ieee, harvard };

/** A style from what people write in front matter: "apa", "APA 7", "chicago-author-date", "mla9". */
export function styleKey(value, fallback = 'apa') {
  const s = String(value ?? '').toLowerCase();
  return Object.keys(STYLES).find((k) => s.startsWith(k)) || (STYLES[fallback] ? fallback : 'apa');
}

// ======================================================================== finding citations in the text
const KEY = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_:.#$%&+?<>~/-]*';
const ITEM = new RegExp(`^(.*?)(?:^|\\s)(-?)@(${KEY})(.*)$`, 'su');
const BARE = new RegExp(`^@(${KEY})`, 'u');

/** "see @a, p. 3; -@b" → [{ prefix, suppress, key, locator }], or null if any part isn't a citation. */
export function parseItems(text) {
  const items = [];
  for (const part of text.split(';')) {
    const m = ITEM.exec(part.trim());
    if (!m) return null;
    items.push({ prefix: m[1].trim(), suppress: m[2] === '-', key: m[3].replace(/[.:]+$/, ''), locator: m[4].replace(/^\s*,?\s*/, '').trim() });
  }
  return items;
}

/** What each cited source needs: its number, and an a/b when one author has two sources from a year. */
export function assign(entries, style) {
  const suffixes = new Map();
  if (!style.numbered) {
    const groups = new Map();
    for (const e of entries) {
      const k = `${people(e).map(family).join('|').toLowerCase()}#${e.year || ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      [...list].sort((a, b) => String(a.title).localeCompare(String(b.title))).forEach((e, i) => suffixes.set(e.id, String.fromCharCode(97 + (i % 26))));
    }
  }
  const numbers = new Map(entries.map((e, i) => [e.id, i + 1]));
  return { suffixOf: (id) => suffixes.get(id) || '', numberOf: (id) => numbers.get(id) };
}

export const sortKey = (e) => `${people(e).map(family).join(' ') || e.title || ''} ${e.year || ''} ${e.title || ''}`.toLocaleLowerCase();

/** The sources in the order the list shows them. */
export function listOrder(entries, style) {
  if (style.order === 'cited') return entries;
  return [...entries].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export const refId = (key) => `ref-${encodeURIComponent(key).replace(/%/g, '_')}`;

/** One source's line in the list, as HTML. */
export function referenceHtml(e, style, info) {
  const number = style.numbered ? `<span class="csl-number">[${info.numberOf(e.id)}]</span> ` : '';
  return `${number}${style.reference(e, { suffix: info.suffixOf(e.id) })}`;
}

/** A citation as HTML: each source links to its line in the list. */
function citationHtml(items, style, info, sources, narrative) {
  const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  const parts = items.map((item) => {
    const e = sources.get(item.key);
    if (!e) return `<span class="cite-missing" title="${esc(`No source called ${item.key}`)}">${esc(`@${item.key}`)}</span>`;
    const opts = { suffix: info.suffixOf(e.id), number: info.numberOf(e.id), locator: item.locator, suppress: item.suppress };
    const text = narrative ? style.narrative(e, opts) : style.cite(e, opts);
    const title = plain(style.reference(e, { suffix: opts.suffix }));
    return `${item.prefix ? `${esc(item.prefix)} ` : ''}<a class="citation" href="#${refId(e.id)}" title="${esc(title)}">${text}</a>`;
  });
  if (narrative || style.numbered) return parts.join(', ');
  return `(${parts.join('; ')})`;
}

const REFERENCE_HEADS = /^(?:references?|bibliography|works cited|reference list|referencias|bibliografía|obras citadas|références|bibliographie|literatur|literaturverzeichnis|quellen)$/i;
const PLACEHOLDER = /^\s*<!--\s*(?:bibliography|references)\s*-->\s*$/i;

/**
 * Adds citations to a markdown-it instance. `context()` gives { sources: Map, style: key, strict } for this
 * document, or null when it has nothing to cite from, in which case the page is exactly as it was.
 * strict: the document names its own bibliography, so an unknown key is shown as a mistake. Otherwise it
 * might be an @mention, and is left alone.
 */
export function citationsPlugin(md, context) {
  const known = (ctx, key) => ctx.sources.has(key);

  function bracket(state, silent) {
    if (state.src[state.pos] !== '[' || state.linkLevel > 0) return false;
    const ctx = context(state.env);
    if (!ctx) return false;
    const end = state.src.indexOf(']', state.pos);
    if (end < 0) return false;
    const inner = state.src.slice(state.pos + 1, end);
    if (!inner.includes('@') || /[[\n]/.test(inner)) return false;
    const after = state.src[end + 1];
    if (after === '(' || after === '[' || after === ':') return false;       // a link
    const items = parseItems(inner);
    if (!items) return false;
    if (!ctx.strict && !items.some((i) => known(ctx, i.key))) return false;
    if (!silent) state.push('cite', '', 0).meta = { items, narrative: false };
    state.pos = end + 1;
    return true;
  }

  function bare(state, silent) {
    if (state.src[state.pos] !== '@' || state.linkLevel > 0) return false;
    const before = state.src[state.pos - 1];
    if (before && /[\p{L}\p{N}_@.]/u.test(before)) return false;              // an email address
    const ctx = context(state.env);
    if (!ctx) return false;
    const m = BARE.exec(state.src.slice(state.pos, state.pos + 200));
    if (!m) return false;
    const key = m[1].replace(/[.:,?!]+$/, '');
    if (!known(ctx, key)) return false;
    let next = state.pos + 1 + key.length;
    let locator = '';
    const page = /^ \[([^\]\n@]*)\](?![([:])/.exec(state.src.slice(next, next + 80));
    if (page) { locator = page[1]; next += page[0].length; }
    if (!silent) state.push('cite', '', 0).meta = { items: [{ prefix: '', suppress: false, key, locator }], narrative: true };
    state.pos = next;
    return true;
  }

  md.inline.ruler.before('link', 'citation', bracket);
  md.inline.ruler.before('link', 'citation_bare', bare);
  md.renderer.rules.cite = (tokens, i) => tokens[i].content;

  md.core.ruler.after('inline', 'citations', (state) => {
    const ctx = context(state.env);
    if (!ctx) return;
    const found = [];
    for (const block of state.tokens) {
      if (block.type !== 'inline') continue;
      for (const t of block.children || []) if (t.type === 'cite') found.push(t);
    }
    if (!found.length) return;

    const style = STYLES[ctx.style] || STYLES.apa;
    const seen = new Map();
    for (const t of found) for (const item of t.meta.items) { const e = ctx.sources.get(item.key); if (e && !seen.has(e.id)) seen.set(e.id, e); }
    const entries = [...seen.values()];
    const info = assign(entries, style);
    for (const t of found) t.content = citationHtml(t.meta.items, style, info, ctx.sources, t.meta.narrative);
    if (!entries.length) return;

    const list = listOrder(entries, style)
      .map((e) => `<p class="csl-entry${style.numbered ? ' numbered' : ''}" id="${esc(refId(e.id))}">${referenceHtml(e, style, info)}</p>`).join('\n');
    const block = new state.Token('html_block', '', 0);
    block.content = `<div class="bibliography">\n${list}\n</div>\n`;

    // Where it goes: a marker, or a References heading with nothing after it, or a new heading at the end.
    const marker = state.tokens.findIndex((t) => t.type === 'html_block' && PLACEHOLDER.test(t.content));
    if (marker >= 0) { state.tokens.splice(marker, 1, block); return; }
    let end = state.tokens.length;
    while (state.tokens[end - 1]?.type === 'footnote_reference_close') {       // notes written at the end stay notes
      end--;
      while (end > 0 && state.tokens[end].type !== 'footnote_reference_open') end--;
    }
    const title = end >= 3 && state.tokens[end - 1].type === 'heading_close' ? state.tokens[end - 2].content.trim() : '';
    if (REFERENCE_HEADS.test(title)) { state.tokens.splice(end, 0, block); return; }
    const open = new state.Token('heading_open', 'h2', 1);
    open.markup = '##';
    const text = new state.Token('inline', '', 0);
    text.content = style.heading;
    const word = new state.Token('text', '', 0);
    word.content = style.heading;
    text.children = [word];
    const close = new state.Token('heading_close', 'h2', -1);
    close.markup = '##';
    state.tokens.splice(end, 0, open, text, close, block);
  });
}

/** A line for pickers: Smith & Jones (2020) Title. */
export function pickerLine(e) {
  const list = people(e);
  const who = list.length ? (list.length > 2 ? `${family(list[0])} et al.` : list.map(family).join(' & ')) : '';
  return { who, year: e.year || '', title: e.title || e.id };
}

/** Sources matching a search, by author, year, title or key. */
export function searchSources(entries, query) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  return entries.filter((e) => {
    const hay = `${people(e).map(family).join(' ')} ${e.year || ''} ${e.title || ''} ${e.id} ${e.container || ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
