// Notion (3.8) in the page: connecting, choosing pages, seeing what will change, and the note that a page has moved on.
// Requests are made by the main process (src/main/notion.js), which keeps your key and what's about to be sent.
import { diffWordsWithSpace } from 'diff';

const $ = (id) => document.getElementById(id);
const CHECK_EVERY = 60 * 1000;
const mayBeLinked = (text) => /^---[ \t]*\r?\n/.test(text) && /^notion:/m.test(text);

/**
 * @param {{ api: any, toast: (m: string) => void, activeTab: () => any, textOf: (t: any) => string, newDocument: (d: { name: string, content: string }) => Promise<void>,
 *   enterEditor: (t: any) => Promise<any>, openCompare: (left: any, right: any) => Promise<void> }} ctx
 */
export function createNotionUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('notion-dlg');
  const banner = $('notion-banner');
  const pages = { setup: $('notion-setup-page'), pick: $('notion-pick-page'), bring: $('notion-bring-page'), send: $('notion-send-page') };
  let afterConnect = null;       // what you were doing when it turned out you weren't connected
  let picking = null;            // { pagesOnly, chose(item) }
  let found = null;              // a page or database fetched and waiting
  let job = null;                // { token, tab, created }
  let searchTimer = 0;
  let searchRun = 0;
  const lastCheck = new Map();   // tab id -> when it was last asked about
  let changed = null;            // { tab, edited, title }

  const page = (name) => { for (const [k, el] of Object.entries(pages)) el.hidden = k !== name; };
  const say = (id, text) => { $(id).textContent = text; };
  const show = () => { if (!dlg.open) dlg.showModal(); };

  /** Run something that needs Notion, connecting first if that hasn't happened yet. */
  async function connected(then) {
    const state = await api.notionState();
    if (state.hasKey) { await then(); return; }
    afterConnect = then;
    await openSetup();
  }

  // ---------------------------------------------------------------- connecting
  async function openSetup() {
    const state = await api.notionState();
    $('notion-key').value = '';
    say('notion-setup-msg', '');
    $('notion-insecure').hidden = state.secure;
    $('notion-connected').hidden = !state.hasKey;
    $('notion-steps').hidden = state.hasKey;
    $('notion-disconnect').hidden = !state.hasKey;
    $('notion-key').placeholder = state.hasKey ? 'A key is saved. Type a new one to replace it.' : '';
    page('setup');
    show();
    $('notion-key').focus();
  }

  async function connect() {
    say('notion-setup-msg', 'Asking Notion…');
    const res = await api.notionConnect({ key: $('notion-key').value });
    if (res.error) { say('notion-setup-msg', res.error); return; }
    const then = afterConnect;
    afterConnect = null;
    toast(res.workspace ? `Connected to ${res.workspace}` : 'Connected to Notion');
    if (then) await then(); else dlg.close();
  }

  // ---------------------------------------------------------------- choosing
  function openPick({ heading, hint, pagesOnly, chose }) {
    picking = { pagesOnly, chose };
    say('notion-pick-h', heading);
    say('notion-pick-hint', hint);
    $('notion-search').value = '';
    say('notion-pick-msg', '');
    page('pick');
    show();
    $('notion-search').focus();
    runSearch();
  }

  async function runSearch() {
    const text = $('notion-search').value.trim();
    const run = ++searchRun;
    const list = $('notion-results');
    if (/^https?:|^[0-9a-f-]{32,36}$/i.test(text)) {
      list.replaceChildren();
      say('notion-pick-msg', '');
      $('notion-use-link').hidden = false;
      return;
    }
    $('notion-use-link').hidden = true;
    say('notion-pick-msg', 'Asking Notion…');
    const res = await api.notionSearch({ query: text, pagesOnly: picking?.pagesOnly });
    if (run !== searchRun) return;
    list.replaceChildren();
    if (res.error) { say('notion-pick-msg', res.error); return; }
    say('notion-pick-msg', res.items.length ? '' : 'Nothing found. Notion only shows pages you’ve shared with your connection.');
    for (const item of res.items) {
      const row = document.createElement('li');
      const text2 = document.createElement('span');
      text2.className = 'auto-row-text';
      text2.setAttribute('translate', 'no');
      const name = document.createElement('b');
      name.textContent = item.title;
      const kind = document.createElement('small');
      kind.textContent = item.kind === 'database' ? 'Database' : 'Page';
      text2.append(name, kind);
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'link-btn';
      use.textContent = 'Choose';
      use.setAttribute('aria-label', `Choose ${item.title}`);
      use.onclick = () => picking?.chose(item);
      row.append(text2, use);
      list.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- bringing in
  function bring() {
    return connected(async () => openPick({
      heading: 'Bring In a Notion Page',
      hint: 'Search your shared pages and databases, or paste a link to one.',
      pagesOnly: false,
      chose: fetchIt,
    }));
  }

  async function fetchIt(item) {
    say('notion-pick-msg', 'Asking Notion…');
    const res = await api.notionFetch(item);
    if (res.error) { say('notion-pick-msg', res.error); return; }
    found = res;
    $('notion-bring-h').textContent = res.title;
    const parts = res.kind === 'database'
      ? [res.rows === 1 ? 'A database with 1 row.' : `A database with ${res.rows} rows.`]
      : [res.pictures === 1 ? 'A page with 1 picture.' : res.pictures ? `A page with ${res.pictures} pictures.` : 'A page.'];
    if (res.more) parts.push(`Only the first ${res.rows} rows are brought in.`);
    if (res.truncated) parts.push('It’s too long for Notion to send all of it.');
    if (res.unknown) parts.push('Some of its blocks can’t be shown as Markdown.');
    say('notion-bring-what', parts.join(' '));
    say('notion-bring-pictures', res.pictures ? 'Pictures on Notion only work for about an hour, so saving keeps a copy beside your document.' : '');
    $('notion-keep-linked').checked = true;
    $('notion-linked-row').hidden = res.kind === 'database';
    say('notion-bring-msg', '');
    page('bring');
    $('notion-save').focus();
  }

  async function keep(how) {
    if (!found) return;
    say('notion-bring-msg', how === 'save' ? 'Saving…' : '');
    const res = await api.notionKeep({ token: found.token, how, linked: $('notion-keep-linked').checked });
    if (res.canceled) { say('notion-bring-msg', ''); return; }
    if (res.error) { say('notion-bring-msg', res.error); return; }
    found = null;
    dlg.close();
    if (res.open) await ctx.newDocument(res.open);
    if (res.missed) toast(res.missed === 1 ? '1 picture couldn’t be copied, so it still points to Notion.' : `${res.missed} pictures couldn’t be copied, so they still point to Notion.`);
  }

  // ---------------------------------------------------------------- sending
  const docOf = (tab) => ({ text: ctx.textOf(tab), name: tab.doc.name || '', path: tab.doc.path || '' });
  const canSend = (tab) => tab && !tab.doc.compare && !tab.doc.data && !tab.doc.needsPassword;

  function showDiff(before, after) {
    // Long stretches that stay the same are shortened, so the changes in a long document can be found.
    const brief = (s) => (s.length > 480 ? `${s.slice(0, 200)}\n\n…\n\n${s.slice(-200)}` : s);
    $('notion-diff').replaceChildren(...diffWordsWithSpace(before, after).map((p) => {
      if (!p.added && !p.removed) return document.createTextNode(brief(p.value));
      const el = document.createElement(p.added ? 'ins' : 'del');
      el.textContent = p.value;
      return el;
    }));
  }

  function showNotes(notes, extra = []) {
    const lines = [...extra];
    if (notes?.pictures) lines.push(notes.pictures === 1 ? '1 picture on your computer stays behind: Notion can only take pictures from the web.' : `${notes.pictures} pictures on your computer stay behind: Notion can only take pictures from the web.`);
    if (notes?.hosted) lines.push('Pictures and files stored on Notion can’t be changed from here, so those stay as they are.');
    if (notes?.footnotes) lines.push('Notion has no footnotes, so yours go over as plain text.');
    say('notion-send-notes', lines.join(' '));
  }

  function send() {
    const tab = ctx.activeTab();
    if (!canSend(tab)) { toast('Open a document first.'); return null; }
    return connected(async () => {
      const res = await api.notionPrepare(docOf(tab));
      if (res.error) { toast(res.error); return; }
      if (res.same) {
        if (dlg.open) dlg.close();
        toast(res.hosted ? 'Pictures and files stored on Notion can’t be changed from here. Do that in Notion.' : 'This document and its Notion page already match.');
        return;
      }
      if (res.unlinked) { chooseParent(tab); return; }
      job = { token: res.token, tab, created: false };
      say('notion-send-h', 'Send to Notion');
      say('notion-send-to', res.title);
      say('notion-send-what', res.rename ? `The page will be renamed to “${res.rename}”.` : 'What will change on this page:');
      showDiff(res.before, res.after);
      const extra = [];
      if (res.moved) extra.push('This page has changed in Notion since you last brought it in, and sending replaces what’s different.');
      if (res.truncated) extra.push('Notion only sent part of this long page, so the rest is left as it is.');
      showNotes(res.notes, extra);
      say('notion-send-msg', '');
      $('notion-send-new').hidden = false;
      page('send');
      show();
      $('notion-go').focus();
    });
  }

  function chooseParent(tab) {
    openPick({
      heading: 'Send to Notion',
      hint: 'Choose the page to put it under.',
      pagesOnly: true,
      async chose(item) {
        const res = await api.notionPrepareNew({ ...docOf(tab), parent: item.id, parentTitle: item.title });
        if (res.error) { say('notion-pick-msg', res.error); return; }
        job = { token: res.token, tab, created: true };
        say('notion-send-h', 'Send to Notion');
        say('notion-send-to', res.parentTitle);
        say('notion-send-what', `A new page, “${res.title}”, will be made under this one:`);
        showDiff('', res.after);
        showNotes(res.notes);
        say('notion-send-msg', '');
        $('notion-send-new').hidden = true;
        page('send');
        $('notion-go').focus();
      },
    });
  }

  async function replaceText(tab, text) {
    const view = await ctx.enterEditor(tab);
    if (!view) return false;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    return true;
  }

  async function go() {
    const now = job;
    if (!now) return;
    $('notion-go').disabled = true;
    say('notion-send-msg', 'Sending…');
    const res = await api.notionSend({ token: now.token, path: now.tab?.doc.path || '' });
    $('notion-go').disabled = false;
    if (job !== now) return;
    if (res.error) { say('notion-send-msg', res.error); return; }
    job = null;
    dlg.close();
    settled(now.tab);
    if (now.created) {
      const linked = res.text && await replaceText(now.tab, res.text);
      toast(linked ? 'Sent to Notion and linked. Save the document to keep the link.' : 'Sent to Notion, but this document couldn’t be linked to the new page.');
      return;
    }
    toast(res.missed ? `Sent, but Notion couldn’t place ${res.missed} of the changes. Use Compare with Notion to see them.` : 'Sent to Notion');
  }

  // ---------------------------------------------------------------- keeping in step
  function hideBanner() {
    banner.hidden = true;
    changed = null;
  }

  /** You've dealt with it, so it stays gone until the page changes again. */
  function settled(tab) {
    lastCheck.set(tab.id, { at: Date.now(), res: {} });
    hideBanner();
  }

  function showBanner(tab, res) {
    changed = { tab, edited: res.edited, title: res.title };
    banner.hidden = false;
  }

  /** Ask whether this tab's page has moved on: when you come to it, and when you come back to the app. */
  async function check(tab = ctx.activeTab(), { force = false } = {}) {
    if (changed && changed.tab !== tab) hideBanner();
    if (!canSend(tab)) return;
    const text = ctx.textOf(tab);
    if (!mayBeLinked(text)) return;
    const last = lastCheck.get(tab.id);
    if (!force && last && Date.now() - last.at < CHECK_EVERY) {
      if (last.res.changed) showBanner(tab, last.res);
      return;
    }
    const res = await api.notionCheck({ text });
    lastCheck.set(tab.id, { at: Date.now(), res });
    if (ctx.activeTab() !== tab) return;
    if (res.changed) showBanner(tab, res);
    else if (changed?.tab === tab) hideBanner();
  }

  async function pull(tab) {
    return api.notionPull({ text: ctx.textOf(tab), path: tab.doc.path || '' });
  }

  async function compare(tab = ctx.activeTab()) {
    if (!canSend(tab)) { toast('Open a document first.'); return; }
    const res = await pull(tab);
    if (res.error) { toast(res.error); return; }
    await check(tab, { force: true });
    await ctx.openCompare({ name: `${res.title} (Notion)`, content: res.content }, { name: tab.doc.name, content: ctx.textOf(tab) });
  }

  async function bringChanges() {
    const tab = changed?.tab;
    if (!tab) return;
    const res = await pull(tab);
    if (res.error) { toast(res.error); return; }
    if (!await replaceText(tab, res.content)) { toast('The change couldn’t be made, because the document can’t be edited.'); return; }
    await api.notionSeen({ text: res.content, edited: res.edited });
    settled(tab);
    toast('Brought in. Save the document to keep it.');
  }

  async function openPage() {
    const tab = ctx.activeTab();
    const res = tab ? await api.notionOpen({ text: ctx.textOf(tab) }) : { error: 'Open a document first.' };
    if (res.error) toast(res.error);
  }

  $('notion-connect').onclick = connect;
  $('notion-disconnect').onclick = async () => { await api.notionForget(); hideBanner(); dlg.close(); toast('Notion disconnected'); };
  $('notion-setup-close').onclick = () => { afterConnect = null; dlg.close(); };
  $('notion-pick-cancel').onclick = () => dlg.close();
  $('notion-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 300); };
  $('notion-use-link').onclick = () => fetchIt({ link: $('notion-search').value.trim() });
  $('notion-save').onclick = () => keep('save');
  $('notion-just-open').onclick = () => keep('open');
  $('notion-bring-cancel').onclick = () => { found = null; dlg.close(); };
  $('notion-go').onclick = go;
  $('notion-send-cancel').onclick = () => { job = null; dlg.close(); };
  $('notion-send-new').onclick = () => { const tab = job?.tab; job = null; if (tab) chooseParent(tab); };
  $('notion-compare').onclick = () => compare(changed?.tab);
  $('notion-bring-changes').onclick = bringChanges;
  $('notion-not-now').onclick = async () => {
    const now = changed;
    if (!now) return;
    settled(now.tab);
    await api.notionSeen({ text: ctx.textOf(now.tab), edited: now.edited });
  };
  dlg.addEventListener('close', () => { if (dlg.open) return; job = null; found = null; picking = null; afterConnect = null; });
  window.addEventListener('focus', () => { check(); });

  return { setup: openSetup, bring, send, compare: () => compare(), open: openPage, tabChanged: () => check() };
}
