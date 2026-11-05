// Flashcards (3.6) in the page: review what's due, practise everything, take a quiz, or have the AI draft
// cards from a chapter. The cards are in the document; the main process finds them (src/main/flashcards.js)
// and keeps each card's progress.
const $ = (id) => document.getElementById(id);
const QUIZ_SIZE = 20;
const CHOICES = 4;

/** Due cards first, the longest overdue at the front, then the new ones. */
export function studyOrder(cards) {
  const seen = cards.filter((c) => c.due && !c.isNew).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return [...seen, ...cards.filter((c) => c.isNew)];
}

export function shuffled(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sameText = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** A quiz needs other answers to choose from, each different from the right one and from each other. */
export const quizReady = (cards) => new Set(cards.map((c) => sameText(c.a))).size >= CHOICES;

/** The right answer and three others from the same deck, in a random order. */
export function quizChoices(card, cards, random = Math.random) {
  const taken = new Set([sameText(card.a)]);
  const wrong = [];
  for (const c of shuffled(cards, random)) {
    const key = sameText(c.a);
    if (taken.has(key)) continue;
    taken.add(key);
    wrong.push({ text: c.a, right: false });
    if (wrong.length === CHOICES - 1) break;
  }
  return shuffled([{ text: card.a, right: true }, ...wrong], random);
}

/** The document's chapters: its top level of heading, if it has more than one, with the text of each. */
export function chaptersOf(text) {
  const lines = String(text).split('\n');
  const heads = [];
  let fence = '';
  lines.forEach((line, i) => {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) { if (!fence) fence = open[1][0]; else if (open[1][0] === fence) fence = ''; return; }
    const m = !fence && /^ {0,3}(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (m) heads.push({ level: m[1].length, title: m[2].replace(/[*_`]/g, ''), line: i });
  });
  const counts = [1, 2, 3].map((n) => heads.filter((h) => h.level === n).length);
  const level = counts.findIndex((n) => n > 1) + 1;
  if (!level) return [];
  const top = heads.filter((h) => h.level === level);
  return top.map((h, i) => ({ title: h.title, text: lines.slice(h.line, top[i + 1]?.line ?? lines.length).join('\n') }));
}

/** How long until a card comes back, in words. */
export function dayLabel(days) {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 31) return `${days} days`;
  const months = Math.round(days / 30.4);
  if (months < 12) return months === 1 ? '1 month' : `${months} months`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year' : `${years} years`;
}

/** The lines to add to the document for these cards. */
export function cardsAsText(cards, existing = '') {
  const body = cards.map((c) => `Q: ${c.q}\nA: ${c.a}`).join('\n\n');
  const head = /^#{1,6}[ \t]+Flashcards[ \t]*$/m.test(existing) ? '' : '## Flashcards\n\n';
  const gap = !existing.trim() ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return `${gap}${head}${body}\n`;
}

/**
 * @param {{ api: any, render: Function, toast: (m: string) => void, activeTab: () => any, textOf: (t: any) => string,
 *   folder: () => any, openAtLine: (p: string, line: number) => Promise<void>, selectionIn: (t: any) => string,
 *   aiReady: () => Promise<any>, addToDocument: (t: any, text: string) => Promise<boolean> }} ctx
 */
export function createCardsUi(ctx) {
  const { api, render, toast } = ctx;
  const dlg = $('cards-dlg');
  const pages = { home: $('cards-home'), run: $('cards-run'), done: $('cards-done'), ai: $('cards-ai') };
  const grades = [...$('cards-grades').querySelectorAll('button')];
  let tab = null;
  let deck = { cards: [], keep: false };
  let run = null;                // { mode, queue, at, finished, repeats, right, total, missed, answered }
  let draft = null;              // { id, cards, stop }

  const page = (name) => { for (const [k, el] of Object.entries(pages)) el.hidden = k !== name; };
  const paint = (el, text, card) => { el.innerHTML = render(text, { baseUrl: card?.baseUrl || tab?.doc.baseUrl || '' }).html; };
  const scope = () => ($('cards-scope').value === 'folder' ? 'folder' : 'doc');

  async function loadDeck() {
    const folder = scope() === 'folder';
    const res = await api.cardsDeck(folder ? { folder } : { path: tab?.doc.path || '', text: ctx.textOf(tab) });
    deck = res?.cards ? res : { cards: [], keep: false };
    showHome();
  }

  function showHome(note = '') {
    run = null;
    const { cards, keep } = deck;
    const due = cards.filter((c) => c.due);
    $('cards-total').textContent = String(cards.length);
    $('cards-due').textContent = String(due.filter((c) => !c.isNew).length);
    $('cards-new').textContent = String(cards.filter((c) => c.isNew).length);
    $('cards-empty').hidden = cards.length > 0;
    $('cards-counts').hidden = !cards.length;
    $('cards-study').hidden = !cards.length;
    $('cards-study').disabled = !due.length;
    $('cards-practice').hidden = !cards.length;
    $('cards-quiz').hidden = !cards.length;
    $('cards-quiz').disabled = !quizReady(cards);
    $('cards-quiz').title = quizReady(cards) ? '' : 'A quiz needs at least four different answers.';
    $('cards-draft').hidden = scope() === 'folder';
    $('cards-note').textContent = note
      || (cards.length && !keep ? 'Progress isn’t kept for documents that are locked or haven’t been saved yet.' : '')
      || (cards.length && !due.length ? 'Nothing is due today. Practice All and Quiz Me don’t change when cards come back.' : '');
    page('home');
    (cards.length ? (due.length ? $('cards-study') : $('cards-practice')) : $('cards-close')).focus();
  }

  async function open() {
    if (dlg.open) return;
    tab = ctx.activeTab();
    const usable = !!tab && !tab.doc.compare && !tab.doc.needsPassword;
    const folder = ctx.folder();
    if (!usable && !folder) { toast(tab?.doc.needsPassword ? 'Unlock the document first' : 'Open a document first'); return; }
    if (!usable) tab = null;
    const box = $('cards-scope');
    box.querySelector('[value="doc"]').disabled = !usable;
    box.querySelector('[value="folder"]').disabled = !folder;
    $('cards-scope-field').hidden = !folder;
    box.value = usable ? 'doc' : 'folder';
    dlg.showModal();
    await loadDeck();
    // A document with no cards in an open folder: start with the folder's.
    if (!deck.cards.length && usable && folder) {
      box.value = 'folder';
      await loadDeck();
      if (!deck.cards.length) { box.value = 'doc'; await loadDeck(); }
    }
  }

  // ---------------------------------------------------------------- going through the cards
  function begin(mode, cards) {
    const quiz = mode === 'quiz';
    const queue = quiz ? shuffled(cards).slice(0, QUIZ_SIZE) : cards;
    run = { mode, pool: deck.cards, queue: [...queue], at: 0, finished: 0, repeats: 0, right: 0, total: queue.length, missed: [], answered: false };
    page('run');
    showCard();
  }

  // Practice, quizzes and documents without progress never change a card's schedule.
  const scheduling = () => run.mode === 'study' && deck.keep;

  function showCard() {
    const card = run.queue[run.at];
    if (!card) { finish(); return; }
    run.answered = false;
    $('cards-count').textContent = `${Math.min(run.finished + 1, run.total)} / ${run.total}`;
    $('cards-fill').style.width = `${(run.finished / run.total) * 100}%`;
    $('cards-from').textContent = scope() === 'folder' ? card.rel || '' : '';
    $('cards-source').hidden = !card.path;
    paint($('cards-q'), card.q, card);
    $('cards-a').hidden = true;
    $('cards-a').replaceChildren();
    $('cards-grades').hidden = true;
    $('cards-next').hidden = true;
    const quiz = run.mode === 'quiz';
    $('cards-show').hidden = quiz;
    $('cards-options').hidden = !quiz;
    if (quiz) showChoices(card);
    else $('cards-show').focus();
  }

  function reveal() {
    const card = run?.queue[run.at];
    if (!card || run.answered || run.mode === 'quiz') return;
    run.answered = true;
    paint($('cards-a'), card.a, card);
    $('cards-a').hidden = false;
    $('cards-show').hidden = true;
    const full = scheduling();
    for (const b of grades) {
      const name = b.dataset.name;
      b.hidden = !full && (name === 'hard' || name === 'easy');
      b.querySelector('small').textContent = full ? dayLabel(name === 'again' ? 0 : card.next[name]) : '';
    }
    $('cards-grades').hidden = false;
    grades.find((b) => b.dataset.name === 'good').focus();
  }

  async function grade(value) {
    const card = run?.queue[run.at];
    if (!card || !run.answered || run.mode === 'quiz' || $('cards-grades').hidden) return;
    if (!scheduling() && (value === 2 || value === 4)) return;       // the two-button set
    run.answered = false;
    if (scheduling()) {
      const res = await api.cardsGrade({ path: card.path, id: card.id, grade: value });
      if (!run) return;                  // closed while it was saving
      if (res?.next) card.next = res.next;
      if (res?.state) { card.dueOn = res.state.due; card.isNew = false; card.due = value === 1; }
    }
    if (value === 1) {
      // Comes round again in a few cards.
      run.queue.splice(Math.min(run.at + 4, run.queue.length), 0, card);
      run.repeats++;
    } else run.finished++;
    run.at++;
    showCard();
  }

  function showChoices(card) {
    const box = $('cards-options');
    box.replaceChildren();
    quizChoices(card, run.pool).forEach((choice, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cards-option';
      b.dataset.right = String(choice.right);
      const n = document.createElement('kbd');
      n.textContent = String(i + 1);
      const body = document.createElement('span');
      body.className = 'markdown-body';
      paint(body, choice.text, card);
      for (const a of body.querySelectorAll('a')) a.replaceWith(...a.childNodes);    // a link can't sit inside a button
      b.append(n, body);
      b.onclick = () => choose(b);
      box.appendChild(b);
    });
    box.firstElementChild?.focus();
  }

  function choose(button) {
    if (!run || run.answered) return;
    run.answered = true;
    const card = run.queue[run.at];
    const right = button.dataset.right === 'true';
    if (right) run.right++; else run.missed.push(card);
    for (const b of $('cards-options').children) {
      b.disabled = true;
      if (b.dataset.right === 'true') b.classList.add('right');
    }
    if (!right) button.classList.add('wrong');
    run.finished++;
    $('cards-next').hidden = false;
    $('cards-next').focus();
  }

  function finish() {
    const r = run;
    const quiz = r.mode === 'quiz';
    $('cards-done-h').textContent = quiz ? 'Quiz finished' : r.mode === 'study' ? 'All done for now' : 'Practice finished';
    $('cards-done-big').textContent = quiz ? `${r.right} / ${r.total}` : String(r.total);
    $('cards-done-label').textContent = quiz ? 'Right' : 'Cards';
    $('cards-done-repeats').textContent = String(quiz ? r.missed.length : r.repeats);
    $('cards-done-repeats-label').textContent = quiz ? 'Missed' : 'Repeated';
    $('cards-missed').hidden = !r.missed.length;
    page('done');
    $('cards-back').focus();
  }

  $('cards-show').onclick = reveal;
  for (const b of grades) b.onclick = () => grade(Number(b.dataset.grade));
  $('cards-next').onclick = () => { run.at++; showCard(); };
  $('cards-study').onclick = () => begin('study', studyOrder(deck.cards));
  $('cards-practice').onclick = () => begin('practice', [...deck.cards]);
  $('cards-quiz').onclick = () => begin('quiz', deck.cards);
  $('cards-missed').onclick = () => begin('practice', [...run.missed]);
  $('cards-back').onclick = () => loadDeck();
  $('cards-quit').onclick = () => loadDeck();
  $('cards-scope').onchange = () => loadDeck();
  $('cards-close').onclick = () => dlg.close();
  $('cards-source').onclick = () => {
    const card = run?.queue[run.at];
    if (!card?.path) return;
    dlg.close();
    ctx.openAtLine(card.path, card.line);
  };
  dlg.addEventListener('keydown', (e) => {
    if (!run || pages.run.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = /^[1-4]$/.test(e.key) ? Number(e.key) : 0;
    if (!n) return;
    e.preventDefault();
    if (run.mode === 'quiz') { const b = $('cards-options').children[n - 1]; if (b && !b.disabled) b.click(); } else grade(n);
  });
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    e.preventDefault();
    if (/^https?:/i.test(a.href)) api.openExternal(a.href);
  });
  dlg.addEventListener('close', () => {
    if (dlg.open) return;
    if (draft) { api.aiCancel(draft.id); draft = null; }
    run = null;
  });

  // ---------------------------------------------------------------- drafting cards with AI
  const CHOSEN = 'selection';
  let chapters = [];
  let chosenText = '';

  function fillSources() {
    const text = ctx.textOf(tab);
    chapters = chaptersOf(text);
    chosenText = ctx.selectionIn(tab);
    const box = $('cards-ai-from');
    const option = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
    box.replaceChildren(option('all', 'The whole document'));
    if (chosenText) box.prepend(option(CHOSEN, 'The selected text'));
    chapters.forEach((c, i) => { const o = option(String(i), c.title); o.setAttribute('translate', 'no'); box.appendChild(o); });
    box.selectedIndex = 0;
  }

  const sourceText = () => {
    const v = $('cards-ai-from').value;
    return v === CHOSEN ? chosenText : v === 'all' ? ctx.textOf(tab) : chapters[Number(v)]?.text || '';
  };

  function showDraftList(cards) {
    const list = $('cards-ai-list');
    list.replaceChildren();
    for (const c of cards) {
      const row = document.createElement('label');
      row.className = 'cards-draft-row';
      row.setAttribute('translate', 'no');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.onchange = syncDraft;
      const text = document.createElement('span');
      const q = document.createElement('b');
      q.textContent = c.q;
      const a = document.createElement('span');
      a.textContent = c.a;
      text.append(q, a);
      row.append(box, text);
      row.card = c;
      list.appendChild(row);
    }
    list.hidden = !cards.length;
    syncDraft();
  }

  function syncDraft() {
    const ticked = [...$('cards-ai-list').children].filter((r) => r.querySelector('input').checked);
    $('cards-ai-add').hidden = !$('cards-ai-list').children.length;
    $('cards-ai-add').disabled = !ticked.length;
    return ticked.map((r) => r.card);
  }

  function drafting(on) {
    $('cards-ai-go').hidden = on;
    $('cards-ai-stop').hidden = !on;
    $('cards-ai-from').disabled = on;
    $('cards-ai-count').disabled = on;
  }

  async function startDraft() {
    if (draft) return;
    const st = await ctx.aiReady();
    if (!st) { if (dlg.open) dlg.close(); return; }
    const id = Math.random().toString(36).slice(2);
    draft = { id };
    drafting(true);
    showDraftList([]);
    $('cards-ai-msg').textContent = `Sent to ${st.name}. Writing cards…`;
    const res = await api.cardsDraft({ id, text: sourceText(), count: Number($('cards-ai-count').value), title: tab.result?.title || tab.doc.name, path: tab.doc.path || '' });
    if (!draft || draft.id !== id) return;
    draft = null;
    drafting(false);
    if (res?.error) { $('cards-ai-msg').textContent = res.error; return; }
    const have = new Set(deck.cards.map((c) => sameText(c.q)));
    const fresh = (res.cards || []).filter((c) => !have.has(sameText(c.q)));
    showDraftList(fresh);
    $('cards-ai-msg').textContent = fresh.length
      ? `Written by ${st.name}. Check each card against the document, and untick any you don’t want.`
      : 'No new cards came back. Try another part of the document.';
    (fresh.length ? $('cards-ai-add') : $('cards-ai-go')).focus();
  }

  async function addDraft() {
    const cards = syncDraft();
    if (!cards.length) return;
    const added = await ctx.addToDocument(tab, (text) => cardsAsText(cards, text));
    if (!added) { $('cards-ai-msg').textContent = 'The cards couldn’t be added, because the document can’t be edited.'; return; }
    $('cards-scope').value = 'doc';
    await loadDeck();
    showHome('Added to the document. Save it to keep them.');
  }

  /** @param {boolean} fromMenu  opened straight from AI Assist rather than from the deck. */
  async function openDraft(fromMenu = false) {
    if (fromMenu) {
      const t = ctx.activeTab();
      if (!t || t.doc.compare) { toast('Open a document first'); return; }
      if (t.doc.locked) { toast('AI assist is off for locked documents, so their text never leaves this computer'); return; }
      if (!(await ctx.aiReady())) return;
      await open();
      if (!dlg.open) return;
      if ($('cards-scope').value !== 'doc') { $('cards-scope').value = 'doc'; await loadDeck(); }
    } else if (tab?.doc.locked) { $('cards-note').textContent = 'AI assist is off for locked documents, so their text never leaves this computer.'; return; }
    if (!tab) return;
    fillSources();
    showDraftList([]);
    $('cards-ai-msg').textContent = 'Only the part you choose is sent, to the service you picked in AI assist settings.';
    drafting(false);
    page('ai');
    $('cards-ai-go').focus();
  }

  $('cards-draft').onclick = () => openDraft();
  $('cards-ai-go').onclick = startDraft;
  $('cards-ai-add').onclick = addDraft;
  $('cards-ai-stop').onclick = () => {
    if (!draft) return;
    api.aiCancel(draft.id);
    draft = null;
    drafting(false);
    $('cards-ai-msg').textContent = 'Stopped.';
  };
  $('cards-ai-back').onclick = () => {
    if (draft) { api.aiCancel(draft.id); draft = null; }
    showHome();
  };

  return { open, openDraft: () => openDraft(true) };
}
