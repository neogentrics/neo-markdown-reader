'use strict';
// Flashcards (3.6). Cards are written in the document itself, as Q: / A: lines or as definitions, so
// they stay with your notes. What the app keeps is only how each card is going: a fingerprint of its
// question and the day it comes back, never the words of the card.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_CARDS = 2000;          // in one document
const MAX_TEXT = 5000;           // in one side of a card
const MAX_PER_FILE = 5000;       // progress kept for one document
const MAX_FILES = 2000;
const MAX_INTERVAL = 3650;       // ten years, in days
const START_EASE = 2.5;
const MIN_EASE = 1.3;
const GRADES = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });

// ======================================================================== finding cards
const QUOTE = /^ {0,3}>[ \t]?/;
const BULLET = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]+/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEFINITION = /^ {0,3}[:~][ \t]+(\S.*)$/;
// Bold and plain lines only count as definitions under a heading like these. Elsewhere, "**Note:** …" is just a note.
const GLOSSARY = /^(?:glossary|definitions?|key terms?|key words?|terms|vocabulary|glosario|definiciones|vocabulario|t[ée]rminos(?: clave)?|glossaire|d[ée]finitions|vocabulaire|glossar|begriffe|definitionen|vokabeln)$/i;
const BOLD_AFTER = /^(?:\*\*|__)(.+?)(?:\*\*|__)[ \t]*[:：—–-][ \t]*(\S.*)$/;     // **Term**: meaning
const BOLD_INSIDE = /^(?:\*\*|__)(.+?)[:：](?:\*\*|__)[ \t]*(\S.*)$/;              // **Term:** meaning
const PLAIN = /^([^:：—–]{1,80}?)[ \t]*[:：—–][ \t]+(\S.*)$/;                       // - Term: meaning

const label = (words) => new RegExp(`^(?:\\*\\*|__)?(?:${words})(?:[ \\t]?\\d+)?(?:\\*\\*|__)?[ \\t]*[:：](?:\\*\\*|__)?[ \\t]*(.*)$`, 'i');
const ASKED = label('Q|Question');
const ANSWERED = label('A|Answer');

/** The text after a `Q:` or `A:` label, with or without bold and numbers, or null if the line has no such label. */
const afterLabel = (line, which) => which.exec(line)?.[1] ?? null;

/** A line without its quote mark and bullet. */
function bare(line) {
  const quoted = QUOTE.test(line);
  const noQuote = quoted ? line.replace(QUOTE, '') : line;
  const bullet = BULLET.exec(noQuote);
  return { text: bullet ? noQuote.slice(bullet[0].length) : noQuote, quoted, indent: bullet ? bullet[0].length : 0 };
}

const ends = (line) => !line.trim() || HEADING.test(line) || FENCE.test(line) || RULE.test(line);

/** Where a card's text stops: a blank line, a heading, a code block, a rule or (for `stop`) the next label. */
function gather(lines, from, first, { quoted, indent }, stop) {
  const out = first ? [first] : [];
  let i = from;
  for (; i < lines.length; i++) {
    let line = lines[i];
    if (quoted) { if (!QUOTE.test(line)) break; line = line.replace(QUOTE, ''); }
    const leading = line.length - line.trimStart().length;
    if (ends(line) || stop(bare(line).text) || (indent && leading < indent && BULLET.test(line))) break;
    out.push(line.slice(Math.min(indent, leading)).trimEnd());
  }
  return { text: out.join('\n').trim(), next: i };
}

/** Where the text after the front matter starts. */
function bodyStart(lines) {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) if (/^(?:---|\.\.\.)\s*$/.test(lines[i])) return i + 1;
  return 0;
}

const fold = (s) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const fingerprint = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The cards in a Markdown document, in order. A card's id comes from its question, so correcting an
 * answer keeps its progress.
 * @returns {{ id: string, q: string, a: string, line: number, kind: 'question'|'definition' }[]}  line counts from 0
 */
function parseCards(markdown) {
  const lines = String(markdown ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const found = [];
  const add = (q, a, line, kind) => { if (q && a) found.push({ q: q.slice(0, MAX_TEXT), a: a.slice(0, MAX_TEXT), line, kind }); };
  const isQ = (t) => ASKED.test(t);
  const isA = (t) => ANSWERED.test(t);
  let fence = '';
  let glossary = 0;              // the level of the glossary heading we're under
  let i = bodyStart(lines);

  while (i < lines.length && found.length < MAX_CARDS) {
    const line = lines[i];
    const open = FENCE.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !line.trim().slice(open[1].length).trim()) fence = '';
      i++;
      continue;
    }
    if (open) { fence = open[1]; i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (glossary && level <= glossary) glossary = 0;
      if (GLOSSARY.test(heading[2].replace(/[*_`]/g, '').replace(/[:：]$/, '').trim())) glossary = level;
      i++;
      continue;
    }

    const shape = bare(line);
    const asked = afterLabel(shape.text, ASKED);
    if (asked !== null) {
      const question = gather(lines, i + 1, asked.trim(), shape, (t) => isQ(t) || isA(t));
      let at = question.next;
      if (at < lines.length && !lines[at].trim()) at++;              // a blank line between Q: and A: is fine
      const answerShape = at < lines.length ? bare(lines[at]) : null;
      const answered = answerShape ? afterLabel(answerShape.text, ANSWERED) : null;
      if (answered === null) { i = Math.max(question.next, i + 1); continue; }
      const answer = gather(lines, at + 1, answered.trim(), answerShape, isQ);
      add(question.text, answer.text, i, 'question');
      i = Math.max(answer.next, at + 1);
      continue;
    }

    // Term
    // : What it means
    const blankFirst = !lines[i + 1]?.trim() && lines[i + 1] !== undefined;
    const defAt = blankFirst ? i + 2 : i + 1;
    if (line.trim() && !DEFINITION.test(line) && !RULE.test(line) && DEFINITION.test(lines[defAt] ?? '')) {
      const parts = [];
      let at = defAt;
      for (;;) {
        const def = DEFINITION.exec(lines[at] ?? '');
        if (!def) break;
        const body = [def[1].trimEnd()];
        at++;
        while (at < lines.length && /^(?: {2,}|\t)\S/.test(lines[at])) body.push(lines[at++].trim());
        parts.push(body.join('\n'));
        if (!lines[at]?.trim() && DEFINITION.test(lines[at + 1] ?? '')) at++;
      }
      add(line.trim(), parts.join('\n\n'), i, 'definition');
      i = at;
      continue;
    }

    if (glossary && line.trim()) {
      const m = BOLD_INSIDE.exec(shape.text) || BOLD_AFTER.exec(shape.text) || (shape.indent ? PLAIN.exec(shape.text) : null);
      if (m) {
        const more = gather(lines, i + 1, m[2].trim(), shape, (t) => /^(?:\*\*|__)/.test(t));
        add(m[1].trim(), more.text, i, 'definition');
        i = Math.max(more.next, i + 1);
        continue;
      }
    }
    i++;
  }
  return identify(found);
}

/** Give each card its id, and drop exact repeats. Two cards may ask the same thing and answer differently. */
function identify(found) {
  const seen = new Map();
  const whole = new Set();
  const out = [];
  for (const c of found) {
    const q = fold(c.q);
    const both = `${q}\n${fold(c.a)}`;
    if (whole.has(both)) continue;
    whole.add(both);
    const n = (seen.get(q) || 0) + 1;
    seen.set(q, n);
    out.push({ id: fingerprint(n === 1 ? q : `${q}\n${n}`), ...c });
  }
  return out;
}

// ======================================================================== when a card comes back
// Based on Algorithm SM-2, (C) Copyright SuperMemo World, 1991 (https://www.supermemo.com), counted in
// whole days, with Hard and Easy either side of Good.
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}

const fresh = () => ({ reps: 0, interval: 0, ease: START_EASE, lapses: 0, due: '' });
const capped = (n) => Math.min(MAX_INTERVAL, Math.max(1, Math.round(n)));

/** How many days away a card would come back for Hard, Good and Easy. */
function intervals(state) {
  const { reps, interval, ease } = state || fresh();
  const good = capped(reps === 0 ? 1 : reps === 1 ? 6 : Math.max(interval + 1, interval * ease));
  const hard = reps === 0 ? 1 : capped(Math.min(good - 1, Math.max(interval + 1, interval * 1.2)));
  const easy = capped(Math.max(reps === 0 ? 4 : good + 1, good * 1.3));
  return { hard, good, easy };
}

/** A card's progress after answering it. Again keeps it due today. */
function review(state, grade, today = isoDay()) {
  const s = state || fresh();
  const next = intervals(s);
  if (grade === GRADES.again) return { reps: 0, interval: 0, ease: Math.max(MIN_EASE, round2(s.ease - 0.2)), lapses: s.lapses + 1, due: today };
  const interval = grade === GRADES.hard ? next.hard : grade === GRADES.easy ? next.easy : next.good;
  const ease = grade === GRADES.hard ? s.ease - 0.15 : grade === GRADES.easy ? s.ease + 0.15 : s.ease;
  return { reps: s.reps + 1, interval, ease: Math.max(MIN_EASE, round2(ease)), lapses: s.lapses, due: addDays(today, interval) };
}
const round2 = (n) => Math.round(n * 100) / 100;

const isDue = (state, today = isoDay()) => !state?.due || state.due <= today;

/** Cards with what the page needs to show them. */
function deck(cards, states, today = isoDay(), where = {}) {
  return cards.map((c) => {
    const state = states[c.id] || null;
    return { ...c, ...where, isNew: !state?.due, due: isDue(state, today), next: intervals(state), dueOn: state?.due || '' };
  });
}

/** An AI's answer as cards, whether or not it wrapped them in a code block. */
function parseDraft(text) {
  return parseCards(String(text ?? '').trim().replace(/^```[^\n]*\n/, '').replace(/\n```$/, ''));
}

// ======================================================================== progress
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Progress as it may be stored, or null. Fields are always in this order, so two copies compare equal. */
function cleanState(v) {
  if (!v || typeof v !== 'object') return null;
  const count = (n, max) => (Number.isFinite(n) && n >= 0 ? Math.min(max, Math.floor(n)) : 0);
  if (typeof v.due !== 'string' || !DAY.test(v.due)) return null;
  return {
    reps: count(v.reps, 100000),
    interval: count(v.interval, MAX_INTERVAL),
    ease: Number.isFinite(v.ease) ? Math.min(5, Math.max(MIN_EASE, round2(v.ease))) : START_EASE,
    lapses: count(v.lapses, 100000),
    due: v.due,
  };
}

const sorted = (items) => Object.fromEntries(Object.entries(items).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

class CardStore {
  constructor(dir, platform = process.platform) {
    this.file = path.join(dir, 'flashcards.json');
    this.platform = platform;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) this.data = {};
    this._timer = null;
  }

  key(p) { const r = path.resolve(p); return this.platform === 'win32' || this.platform === 'darwin' ? r.toLowerCase() : r; }

  /** { id: progress } for a document. */
  get(p) { return { ...(this.data[this.key(p)]?.items || {}) }; }

  set(p, items) {
    const clean = {};
    for (const [id, v] of Object.entries(items || {}).slice(0, MAX_PER_FILE)) {
      const state = /^[0-9a-f]{16}$/.test(id) ? cleanState(v) : null;
      if (state) clean[id] = state;
    }
    const k = this.key(p);
    if (Object.keys(clean).length) this.data[k] = { path: path.resolve(p), items: sorted(clean), updated: Date.now() };
    else delete this.data[k];
    const keys = Object.keys(this.data);
    if (keys.length > MAX_FILES) {
      keys.sort((a, b) => (this.data[a].updated || 0) - (this.data[b].updated || 0));
      for (const old of keys.slice(0, keys.length - MAX_FILES)) delete this.data[old];
    }
    this.save();
    this.onChange?.();          // sync (3.1) listens for changes made on this computer
  }

  /** Record an answer, and return the card's new progress. */
  grade(p, id, grade, today = isoDay()) {
    const items = this.get(p);
    const state = review(items[id] || null, grade, today);
    this.set(p, { ...items, [id]: state });
    return state;
  }

  /** A renamed document keeps its progress. */
  move(from, to) {
    const entry = this.data[this.key(from)];
    if (!entry) return;
    delete this.data[this.key(from)];
    this.data[this.key(to)] = { ...entry, path: path.resolve(to) };
    this.save();
    this.onChange?.();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch { /* non-fatal */ }
  }
}

module.exports = { parseCards, parseDraft, intervals, review, isDue, isoDay, addDays, deck, cleanState, CardStore, GRADES };
