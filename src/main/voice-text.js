'use strict';
// Natural voices (3.2): preparing text for the Supertonic model. Pure functions, no Node APIs, so the page
// can use them too (which languages a natural voice can read, and what language a document is in).
//
// prepare() and chunks() are adapted from Supertone's MIT-licensed example (github.com/supertone-inc/supertonic,
// nodejs/helper.js; see THIRD_PARTY_NOTICES.md).

/**
 * Read aloud says each listed word the way the list spells it. Only whole words match, in any capitals,
 * and the longest wins, so "New Orleans" comes before "New". What's replaced isn't looked at again.
 */
function applyPronunciation(text, list) {
  if (!list?.length) return text;
  const words = new Map(list.map((r) => [r.word.toLowerCase(), r.say]));
  const alternatives = [...words.keys()].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu'), (m) => words.get(m.toLowerCase()) ?? m);
}

/** Languages the model speaks. Anything else is read by the computer's own voices. */
const LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];

const REPLACE = [
  ['–', '-'], ['‑', '-'], ['—', '-'], ['_', ' '], ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
  ['´', "'"], ['`', "'"], ['[', ' '], [']', ' '], ['|', ' '], ['/', ' '], ['#', ' '], ['→', ' '], ['←', ' '],
  ['@', ' at '], ['e.g.,', 'for example, '], ['i.e.,', 'that is, '],
];
const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

/** The language code the model gets: the given language if the model speaks it, else null. */
function modelLang(lang) {
  const base = String(lang || '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(base) ? base : null;
}

/** Text as the model expects it: normalised, symbols spoken or dropped, ending in punctuation, tagged. */
function prepare(text, lang) {
  let t = String(text).normalize('NFKD').replace(EMOJI, '');
  for (const [k, v] of REPLACE) t = t.replaceAll(k, v);
  // Spaces are collapsed before punctuation is pulled in: a dropped emoji leaves two of them ("home  !").
  t = t.replace(/[♥☆♡©\\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.!?;:'])/g, '$1')
    .replace(/"{2,}/g, '"').replace(/'{2,}/g, "'")
    .trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

/** Split text into pieces the model reads well: sentences, packed up to `max` characters. */
function chunks(text, max = 300) {
  const out = [];
  for (const para of String(text).trim().split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)) {
    const sentences = para.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|St\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/);
    let cur = '';
    for (let s of sentences) {
      // A single sentence longer than the limit is cut at word boundaries.
      while (s.length > max) {
        const space = s.lastIndexOf(' ', max);
        const cut = space > 0 ? space : max;          // mid-word only when there's no space at all
        if (cur) { out.push(cur); cur = ''; }
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (cur && cur.length + s.length + 1 > max) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
  }
  return out.filter(Boolean);
}

// Small, very common words that mark a language. Enough to tell the app's languages (and a few near ones)
// apart in a page of text; not a general language detector.
const MARKERS = {
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'it', 'with', 'for', 'this', 'you', 'are', 'was'],
  es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'las', 'por', 'con', 'una', 'para', 'es', 'del'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'une', 'que', 'pour', 'dans', 'pas', 'qui', 'du'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'den', 'auf', 'ich', 'sie'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'non', 'una', 'sono', 'gli', 'della', 'con', 'del', 'le'],
  pt: ['o', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'com', 'não', 'uma', 'os', 'se'],
  nl: ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'niet', 'op', 'te', 'zijn', 'met', 'voor', 'ik'],
};

/**
 * The language a piece of text is most likely in, for a document that doesn't say: one of the keys of
 * MARKERS, or null when there's too little text or no clear winner.
 */
function guessLang(text) {
  const words = String(text).toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 8) return null;
  const sample = words.slice(0, 2000);
  const score = {};
  for (const [lang, list] of Object.entries(MARKERS)) {
    const set = new Set(list);
    score[lang] = sample.filter((w) => set.has(w)).length / sample.length;
  }
  const [[best, a], [, b]] = Object.entries(score).sort((x, y) => y[1] - x[1]);
  return a >= 0.08 && a >= b * 1.3 ? best : null;
}

/** The natural voices' names. The ids are what's saved, so a name can change without losing anyone's choice. */
const VOICE_NAMES = { F1: 'Clara', F2: 'Maya', F3: 'Nora', F4: 'Sofia', F5: 'Zoe', M1: 'Ethan', M2: 'Leo', M3: 'Marcus', M4: 'Owen', M5: 'Theo' };
const voiceLabel = (id) => `${VOICE_NAMES[id] || id} (${id[0] === 'F' ? 'female' : 'male'})`;

module.exports = { VOICE_NAMES, voiceLabel, applyPronunciation, LANGS, modelLang, prepare, chunks, guessLang };
