// Tests for 3.6 flashcards: finding cards in a document, when they come back, what's kept, and the quiz.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { studyOrder, shuffled, quizReady, quizChoices, chaptersOf, dayLabel, cardsAsText } from '../src/renderer/cards-ui.js';

const require = createRequire(import.meta.url);
const { parseCards, parseDraft, intervals, review, isDue, addDays, deck, cleanState, CardStore, GRADES } = require('../src/main/flashcards.js');
const ai = require('../src/main/ai.js');
const sync = require('../src/main/sync.js');
const { Settings } = require('../src/main/settings.js');
const { AnnotationStore } = require('../src/main/annotations.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cards-'));
const pairs = (text) => parseCards(text).map((c) => [c.q, c.a]);

test('Q: and A: lines become cards', () => {
  assert.deepEqual(pairs('Q: What is DNS?\nA: It turns names into addresses.\n'), [['What is DNS?', 'It turns names into addresses.']]);
  assert.deepEqual(pairs('**Q:** One\n**A:** Two\n'), [['One', 'Two']]);
  assert.deepEqual(pairs('**Q**: One\n**A**: Two\n'), [['One', 'Two']]);
  assert.deepEqual(pairs('Question: One\nAnswer: Two\n'), [['One', 'Two']]);
  assert.deepEqual(pairs('q: one\na: two\n'), [['one', 'two']]);
  assert.deepEqual(pairs('Q1: One\nA1: Two\n\nQ 2: Three\nA 2: Four\n'), [['One', 'Two'], ['Three', 'Four']]);
  assert.deepEqual(pairs('Q: One\n\nA: Two\n'), [['One', 'Two']], 'a blank line between them is fine');
});

test('cards can run over several lines, in lists and in quotes', () => {
  assert.deepEqual(pairs('Q: One\nstill the question\nA: Two\n- a list\n- in the answer\n\nNot part of it.\n'), [['One\nstill the question', 'Two\n- a list\n- in the answer']]);
  assert.deepEqual(pairs('- Q: One\n- A: Two\n- Q: Three\n- A: Four\n'), [['One', 'Two'], ['Three', 'Four']]);
  assert.deepEqual(pairs('- Q: One\n- A: Two\n  more\n- Shopping\n'), [['One', 'Two\nmore']]);
  assert.deepEqual(pairs('> Q: One\n> A: Two\n> more\n\nAfter\n'), [['One', 'Two\nmore']]);
  assert.deepEqual(pairs('Q: One\nA: Two\nQ: Three\nA: Four\n'), [['One', 'Two'], ['Three', 'Four']]);
  assert.deepEqual(pairs('Q: One\nA: Two\n# Next\nQ: Three\nA: Four\n---\nAfter\n'), [['One', 'Two'], ['Three', 'Four']]);
});

test('a question with no answer is not a card', () => {
  assert.deepEqual(pairs('Q: Nobody answered this\n\nSomething else.\n'), []);
  assert.deepEqual(pairs('Q: One\nA:\n\nQ: Two\nA: Yes\n'), [['Two', 'Yes']]);
  assert.deepEqual(pairs('A: An answer on its own\n'), []);
});

test('definitions become cards', () => {
  assert.deepEqual(pairs('Firewall\n: Filters traffic.\n'), [['Firewall', 'Filters traffic.']]);
  assert.deepEqual(pairs('Firewall\n\n: Filters traffic.\n'), [['Firewall', 'Filters traffic.']]);
  assert.deepEqual(pairs('Firewall\n~ Filters traffic.\n'), [['Firewall', 'Filters traffic.']]);
  assert.deepEqual(pairs('Port\n: A number.\n  It names a service.\n: Or a harbour.\n\nNext\n: Another.\n'), [['Port', 'A number.\nIt names a service.\n\nOr a harbour.'], ['Next', 'Another.']]);
});

test('bold and listed terms only count under a glossary heading', () => {
  const body = '- **Hash**: A fixed-size fingerprint\n- **Salt:** Random data\n- Nonce — Used once\n\n**Cipher** — Scrambles text\n';
  assert.deepEqual(pairs(body), []);
  assert.deepEqual(pairs(`## Glossary\n\n${body}`), [['Hash', 'A fixed-size fingerprint'], ['Salt', 'Random data'], ['Nonce', 'Used once'], ['Cipher', 'Scrambles text']]);
  assert.equal(pairs(`### Key Terms:\n\n${body}`).length, 4);
  assert.equal(pairs(`## Glosario\n\n${body}`).length, 4);
  assert.deepEqual(pairs('## Glossary\n\n- **Hash**: Yes\n\n### A part of it\n\n- **Salt**: Yes\n\n## Results\n\n- **Note**: No\n').map(([q]) => q), ['Hash', 'Salt']);
});

test('code and front matter are left alone', () => {
  assert.deepEqual(pairs('---\ntitle: Q\nq: yes\na: no\n---\n\n```\nQ: In code\nA: In code\n```\n\n~~~md\nTerm\n: Meaning\n~~~\n'), []);
  assert.deepEqual(pairs('````\n```\nQ: x\nA: y\n```\n````\nQ: After\nA: Yes\n'), [['After', 'Yes']]);
  assert.deepEqual(pairs('---\n\nQ: After a rule\nA: Yes\n'), [['After a rule', 'Yes']], 'a rule at the top isn’t front matter once it has no end');
});

test('Windows line endings and a byte order mark', () => {
  assert.deepEqual(pairs('﻿Q: One\r\nA: Two\r\n'), [['One', 'Two']]);
});

test('each card knows its line, counted from 0 like the page', () => {
  const [a, b] = parseCards('# Title\n\nQ: One\nA: Two\n\nTerm\n: Meaning\n');
  assert.equal(a.line, 2);
  assert.equal(a.kind, 'question');
  assert.equal(b.line, 5);
  assert.equal(b.kind, 'definition');
});

test('a card keeps its id when the answer changes, whatever the spacing or case of the question', () => {
  const id = (t) => parseCards(t)[0].id;
  assert.match(id('Q: One\nA: Two'), /^[0-9a-f]{16}$/);
  assert.equal(id('Q: What is it?\nA: Old'), id('Q: What is it?\nA: New'));
  assert.equal(id('Q: What  is it?\nA: x'), id('Q: what is it?\nA: x'));
  assert.notEqual(id('Q: One\nA: x'), id('Q: Two\nA: x'));
});

test('exact repeats are dropped, but the same question with another answer is its own card', () => {
  const list = parseCards('Q: Why?\nA: One\n\nQ: Why?\nA: One\n\nQ: Why?\nA: Two\n');
  assert.deepEqual(list.map((c) => c.a), ['One', 'Two']);
  assert.notEqual(list[0].id, list[1].id);
});

test('very large documents stop at the limit', () => {
  const text = Array.from({ length: 2500 }, (_, i) => `Q: Number ${i}\nA: Yes\n`).join('\n');
  assert.equal(parseCards(text).length, 2000);
  assert.equal(parseCards(`Q: ${'x'.repeat(9000)}\nA: y`)[0].q.length, 5000);
});

test('Hard, Good and Easy always come back in that order, and later each time', () => {
  let state = null;
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const n = intervals(state);
    assert.ok(n.hard <= n.good && (n.good < n.easy || n.easy === 3650), JSON.stringify(n));
    state = review(state, GRADES.good, '2026-01-01');
    assert.ok(state.interval > last || state.interval === 3650, `${state.interval} after ${last}`);
    last = state.interval;
  }
  assert.ok(last <= 3650);
});

test('the first answers follow the usual steps', () => {
  const one = review(null, GRADES.good, '2026-11-04');
  assert.deepEqual(one, { reps: 1, interval: 1, ease: 2.5, lapses: 0, due: '2026-11-05' });
  const two = review(one, GRADES.good, '2026-11-05');
  assert.equal(two.interval, 6);
  assert.equal(review(two, GRADES.good, '2026-11-11').interval, 15);
  assert.equal(review(null, GRADES.easy, '2026-11-04').interval, 4);
  assert.equal(review(null, GRADES.hard, '2026-11-04').interval, 1);
});

test('Again keeps a card due today, starts it over, and makes it harder', () => {
  const known = review(review(review(null, 3, '2026-01-01'), 3, '2026-01-02'), 3, '2026-01-08');
  const missed = review(known, GRADES.again, '2026-02-01');
  assert.equal(missed.reps, 0);
  assert.equal(missed.due, '2026-02-01');
  assert.equal(missed.lapses, 1);
  assert.equal(missed.ease, 2.3);
  assert.ok(isDue(missed, '2026-02-01'));
});

test('a card never gets easier than the floor, however often it is missed', () => {
  let s = null;
  for (let i = 0; i < 40; i++) s = review(s, GRADES.again, '2026-01-01');
  assert.equal(s.ease, 1.3);
  assert.deepEqual(intervals(s), { hard: 1, good: 1, easy: 4 });
});

test('days are counted on the calendar, across months and clock changes', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  assert.equal(addDays('2026-10-31', 2), '2026-11-02');
});

test('what is due today', () => {
  assert.equal(isDue(null, '2026-11-04'), true);
  assert.equal(isDue({ due: '2026-11-04' }, '2026-11-04'), true);
  assert.equal(isDue({ due: '2026-11-03' }, '2026-11-04'), true);
  assert.equal(isDue({ due: '2026-11-05' }, '2026-11-04'), false);
});

test('a deck says which cards are new, due or waiting', () => {
  const cards = parseCards('Q: New\nA: 1\n\nQ: Due\nA: 2\n\nQ: Later\nA: 3\n');
  const states = { [cards[1].id]: review(null, 3, '2026-01-01'), [cards[2].id]: review(null, 4, '2026-11-04') };
  const list = deck(cards, states, '2026-11-04', { path: 'x.md' });
  assert.deepEqual(list.map((c) => [c.isNew, c.due]), [[true, true], [false, true], [false, false]]);
  assert.equal(list[0].path, 'x.md');
  assert.deepEqual(list[0].next, { hard: 1, good: 1, easy: 4 });
});

test('study order: longest overdue first, then new cards, and nothing that is waiting', () => {
  const c = (id, due, isNew, dueOn) => ({ id, due, isNew, dueOn });
  const order = studyOrder([c('new', true, true, ''), c('later', false, false, '2026-12-01'), c('recent', true, false, '2026-11-03'), c('old', true, false, '2026-10-01')]);
  assert.deepEqual(order.map((x) => x.id), ['old', 'recent', 'new']);
});

test('progress is kept by document, without the words of the cards', async () => {
  const dir = tmp();
  const store = new CardStore(dir);
  const doc = path.join(dir, 'notes.md');
  const [card] = parseCards('Q: The secret question\nA: The secret answer\n');
  const state = store.grade(doc, card.id, GRADES.good, '2026-11-04');
  assert.equal(state.due, '2026-11-05');
  assert.deepEqual(store.get(doc), { [card.id]: state });
  store.flush();
  const raw = fs.readFileSync(path.join(dir, 'flashcards.json'), 'utf8');
  assert.ok(!raw.includes('secret'));
  assert.deepEqual(new CardStore(dir).get(doc), { [card.id]: state });
});

test('a damaged progress file is ignored, and bad entries never get in', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'flashcards.json'), '{not json');
  const store = new CardStore(dir);
  const doc = path.join(dir, 'a.md');
  assert.deepEqual(store.get(doc), {});
  store.set(doc, { nothex: { due: '2026-01-01' }, '0123456789abcdef': { due: 'soon' }, fedcba9876543210: { due: '2026-01-01', reps: -4, interval: 1e9, ease: 99, lapses: 'x' } });
  assert.deepEqual(store.get(doc), { fedcba9876543210: { reps: 0, interval: 3650, ease: 5, lapses: 0, due: '2026-01-01' } });
  assert.equal(cleanState(null), null);
  assert.equal(cleanState({}), null);
});

test('a renamed document keeps its progress', () => {
  const dir = tmp();
  const store = new CardStore(dir);
  const from = path.join(dir, 'old.md');
  const to = path.join(dir, 'new.md');
  const [card] = parseCards('Q: One\nA: Two');
  store.grade(from, card.id, 3, '2026-11-04');
  store.move(from, to);
  assert.deepEqual(store.get(from), {});
  assert.equal(Object.keys(store.get(to)).length, 1);
  store.move(path.join(dir, 'nothing.md'), to);
  assert.equal(Object.keys(store.get(to)).length, 1);
});

test('a quiz offers the right answer and three different wrong ones from the deck', () => {
  const cards = ['Red', 'Blue', 'Green', 'Gold', 'Pink', 'blue '].map((a, i) => ({ q: `Q${i}`, a }));
  for (let i = 0; i < 50; i++) {
    const choices = quizChoices(cards[1], cards);
    assert.equal(choices.length, 4);
    assert.equal(choices.filter((c) => c.right).length, 1);
    assert.equal(choices.find((c) => c.right).text, 'Blue');
    assert.equal(new Set(choices.map((c) => c.text.toLowerCase().trim())).size, 4, 'the same answer written differently is not a wrong answer');
  }
});

test('a quiz needs four different answers', () => {
  const list = (...a) => a.map((x) => ({ a: x }));
  assert.equal(quizReady(list('a', 'b', 'c')), false);
  assert.equal(quizReady(list('a', 'A', 'b', 'c')), false);
  assert.equal(quizReady(list('a', 'b', 'c', 'd')), true);
});

test('shuffling keeps every card and leaves the original alone', () => {
  const list = [1, 2, 3, 4, 5];
  const out = shuffled(list, () => 0);
  assert.deepEqual([...out].sort(), list);
  assert.notDeepEqual(out, list);
  assert.deepEqual(list, [1, 2, 3, 4, 5]);
});

test('chapters are the top level of heading that has more than one', () => {
  assert.deepEqual(chaptersOf('# Book\n\nIntro\n\n## One\n\nA\n\n### Part\n\n## Two\n\nB\n').map((c) => c.title), ['One', 'Two']);
  assert.deepEqual(chaptersOf('# One\nA\n# Two\nB\n').map((c) => [c.title, c.text]), [['One', '# One\nA'], ['Two', '# Two\nB\n']]);
  assert.deepEqual(chaptersOf('Just text\n'), []);
  assert.deepEqual(chaptersOf('# Only one\n'), []);
  assert.deepEqual(chaptersOf('# One\n\n```\n# Not a heading\n```\n\n# **Two**\n').map((c) => c.title), ['One', 'Two']);
});

test('days in words', () => {
  assert.equal(dayLabel(0), 'Today');
  assert.equal(dayLabel(1), 'Tomorrow');
  assert.equal(dayLabel(15), '15 days');
  assert.equal(dayLabel(31), '1 month');
  assert.equal(dayLabel(120), '4 months');
  assert.equal(dayLabel(365), '1 year');
  assert.equal(dayLabel(1100), '3 years');
});

test('new cards go at the end of the document under one heading, and read back as cards', () => {
  const cards = [{ q: 'One?', a: 'Yes' }, { q: 'Two?', a: 'No' }];
  assert.equal(cardsAsText(cards, 'Body'), '\n\n## Flashcards\n\nQ: One?\nA: Yes\n\nQ: Two?\nA: No\n');
  assert.equal(cardsAsText(cards.slice(0, 1), 'Body\n'), '\n## Flashcards\n\nQ: One?\nA: Yes\n');
  assert.equal(cardsAsText(cards.slice(0, 1), '# T\n\n## Flashcards\n\nQ: Old\nA: Old\n'), '\nQ: One?\nA: Yes\n');
  assert.equal(cardsAsText(cards.slice(0, 1), ''), '## Flashcards\n\nQ: One?\nA: Yes\n');
  const whole = `Body${cardsAsText(cards, 'Body')}`;
  assert.deepEqual(pairs(whole), [['One?', 'Yes'], ['Two?', 'No']]);
});

test('an AI draft is read with or without a code block around it', () => {
  const plain = 'Q: One\nA: Two\n\nQ: Three\nA: Four';
  assert.equal(parseDraft(plain).length, 2);
  assert.equal(parseDraft(`\`\`\`\n${plain}\n\`\`\``).length, 2);
  assert.equal(parseDraft(`\`\`\`markdown\n${plain}\n\`\`\`\n`).length, 2);
  assert.equal(parseDraft('Sorry, I can’t do that.').length, 0);
});

test('the AI is asked for the right number of cards, from that text only', () => {
  const prompt = ai.buildPrompt('cards', { text: 'A chapter', title: 'Book', count: 5 });
  assert.match(prompt, /<document title="Book">\nA chapter\n<\/document>/);
  assert.match(prompt, /up to 5 flashcards/);
  assert.match(prompt, /Q: The question\nA: The answer/);
  assert.throws(() => ai.buildPrompt('cards', { text: '  ' }), /empty/);
});

test('progress syncs between computers, and the newest answer wins', async () => {
  const shared = tmp();
  const computer = (name) => {
    const base = tmp();
    const cloud = path.join(base, 'OneDrive');
    fs.mkdirSync(path.join(cloud, 'Notes'), { recursive: true });
    const data = path.join(base, 'data');
    const settings = new Settings(data);
    const annotations = new AnnotationStore(data);
    const cards = new CardStore(data);
    const engine = new sync.SyncEngine({ dir: data, settings, annotations, cards, hostname: name, roots: [{ id: 'onedrive', path: cloud }, { id: 'home', path: path.join(base, 'home') }] });
    const doc = path.join(cloud, 'Notes', 'study.md');
    fs.writeFileSync(doc, 'Q: One\nA: Two\n');
    return { cards, engine, doc };
  };
  const a = computer('a');
  const b = computer('b');
  const [card] = parseCards('Q: One\nA: Two\n');
  await a.engine.configure({ enabled: true, folder: shared });
  await b.engine.configure({ enabled: true, folder: shared });

  const first = a.cards.grade(a.doc, card.id, GRADES.good, '2026-11-04');
  await a.engine.sync();
  await b.engine.sync();
  assert.deepEqual(b.cards.get(b.doc), { [card.id]: first });

  await new Promise((r) => setTimeout(r, 5));
  const second = b.cards.grade(b.doc, card.id, GRADES.good, '2026-11-05');
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.cards.get(a.doc), { [card.id]: second });
  a.engine.stopWatching();
  b.engine.stopWatching();
});
