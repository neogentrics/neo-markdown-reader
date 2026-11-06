// Publish anywhere (3.10) in the page: a draft on your blog, a post on Discord, and where this document has been.
// Requests are made by the main process, which keeps your keys. Nothing leaves until you press the button.
import { postHtml } from './post-html.js';

const $ = (id) => document.getElementById(id);
const KINDS = { wordpress: 'WordPress', ghost: 'Ghost', discord: 'Discord', bookstack: 'BookStack', wikijs: 'Wiki.js', outline: 'Outline', notion: 'Notion' };

/** @param {{ api: any, toast: (m: string) => void, activeTab: () => any, textOf: (t: any) => string, render: (s: string) => { html: string }, addServer: (kind: string) => void }} ctx */
export function createSendUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('send-dlg');
  const pages = { blog: $('send-blog-page'), discord: $('send-discord-page'), list: $('sent-page') };
  let doc = null;                // what send:prepare said, with what's needed to send it
  let planTimer = null;
  let asking = 0;                // only the newest question's answer counts: you may have picked another site since

  const page = (name) => { for (const [k, el] of Object.entries(pages)) el.hidden = k !== name; };
  const say = (id, text) => { $(id).textContent = text; };
  /** Several sentences, each in its own element, so each one can be translated. */
  const sayAll = (id, parts, between = ' ') => {
    const out = [];
    parts.forEach((part, i) => {
      if (i) out.push(between);
      const span = document.createElement('span');
      span.textContent = part;
      out.push(span);
    });
    $(id).replaceChildren(...out);
  };
  const show = () => { if (!dlg.open) dlg.showModal(); };
  const plural = (n, one, many) => (n === 1 ? one : many);
  const asked = () => ({ text: ctx.textOf(doc.tab), name: doc.tab.doc.name, path: doc.tab.doc.path || '' });

  async function prepare() {
    const tab = ctx.activeTab();
    if (!tab) { toast('Open a document first.'); return null; }
    const res = await api.sendPrepare({ text: ctx.textOf(tab), name: tab.doc.name, path: tab.doc.path || '' });
    if (res.error) { toast(res.error); return null; }
    doc = { ...res, tab };
    return doc;
  }

  const named = (text, value) => {
    const option = new Option(text, value);
    option.setAttribute('translate', 'no');
    return option;
  };

  function fill(pick, list, row) {
    pick.replaceChildren(...list.map((s) => named(s.name, s.id)));
    $(row).hidden = false;       // even with only one, you see where this is going before you press the button
  }

  // ---------------------------------------------------------------- a draft on your blog
  async function openBlog() {
    if (!await prepare()) return;
    if (!doc.sites.length) { toast('Add your blog first.'); ctx.addServer('wordpress'); return; }
    fill($('send-site'), doc.sites, 'send-site-row');
    $('send-title').value = doc.title;
    $('send-tags').value = doc.tags.join(', ');
    const pick = $('send-featured');
    pick.replaceChildren(new Option('None', ''), ...doc.pictures.map((p) => named(decodeName(p), p)));
    pick.value = doc.featured;
    $('send-featured-row').hidden = !doc.pictures.length;
    $('send-blog-open').hidden = true;
    $('send-blog-go').hidden = false;
    say('send-blog-msg', '');
    page('blog');
    show();
    await status();
  }

  const decodeName = (p) => { try { return decodeURIComponent(p).split('/').pop(); } catch { return p; } };

  async function status() {
    const mine = ++asking;
    $('send-blog-go').disabled = true;
    say('send-blog-what', 'Asking the site…');
    const res = await api.sendStatus({ id: $('send-site').value, path: doc.tab.doc.path || '' });
    if (mine !== asking) return;
    if (res.error) { say('send-blog-what', res.error); return; }
    const said = {
      new: 'This makes a new draft.',
      draft: 'This updates the draft you sent before.',
      published: 'You’ve published the last one, so this makes a new draft and leaves that post alone.',
      gone: 'The last draft isn’t there any more, so this makes a new one.',
    };
    const n = doc.pictures.length;
    sayAll('send-blog-what', n ? [said[res.state], plural(n, '1 picture goes with it.', `${n} pictures go with it.`)] : [said[res.state]]);
    $('send-blog-go').disabled = false;
    $('send-blog-go').focus();
  }

  async function sendDraft() {
    const title = $('send-title').value.trim();
    if (!title) { say('send-blog-msg', 'Give it a title first.'); return; }
    const { html, diagrams } = postHtml(ctx.render, doc.body);
    $('send-blog-go').disabled = true;
    say('send-blog-msg', 'Sending…');
    const res = await api.sendDraft({
      ...asked(),
      id: $('send-site').value,
      title,
      tags: $('send-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      excerpt: doc.excerpt,
      featured: $('send-featured').value,
      html,
    });
    $('send-blog-go').disabled = false;
    if (res.error) { say('send-blog-msg', res.error); return; }
    const parts = [res.action === 'updated' ? 'Your draft is updated.' : 'Your draft is there.'];
    if (res.missing) parts.push(plural(res.missing, '1 picture wasn’t found.', `${res.missing} pictures weren’t found.`));
    if (res.refused.length) parts.push(plural(res.refused.length, `1 picture was refused: ${res.refused[0].message}`, `${res.refused.length} pictures were refused.`));
    if (res.skippedTags.length) parts.push(plural(res.skippedTags.length, '1 tag couldn’t be added.', `${res.skippedTags.length} tags couldn’t be added.`));
    if (diagrams) parts.push(plural(diagrams, '1 diagram or chart went as text, or was left out.', `${diagrams} diagrams or charts went as text, or were left out.`));
    sayAll('send-blog-msg', parts);
    say('send-blog-what', '');
    $('send-blog-go').hidden = true;
    const open = $('send-blog-open');
    open.hidden = false;
    open.onclick = () => api.openExternal(res.url);
    open.focus();
  }

  // ---------------------------------------------------------------- a post on Discord
  async function openDiscord() {
    if (!await prepare()) return;
    if (!doc.channels.length) { toast('Add your Discord channel first.'); ctx.addServer('discord'); return; }
    fill($('send-channel'), doc.channels, 'send-channel-row');
    $('send-mode').value = 'whole';
    $('send-summary').value = doc.opening;
    $('send-discord-open').hidden = true;
    $('send-discord-go').hidden = false;
    say('send-discord-msg', '');
    const ai = await api.aiStatus();
    $('send-ai').hidden = !ai.ready;
    modeShown();
    page('discord');
    show();
    await plan();
  }

  const isSummary = () => $('send-mode').value === 'summary';

  function modeShown() {
    $('send-summary-row').hidden = !isSummary();
  }

  async function plan() {
    const mine = ++asking;
    const words = $('send-summary').value;
    $('send-discord-go').disabled = true;
    if (isSummary() && !words.trim()) { say('send-discord-what', 'Write the summary first.'); return; }
    const res = await api.sendPlan({ ...asked(), summary: isSummary(), words });
    if (mine !== asking) return;
    if (res.error) { say('send-discord-what', res.error); return; }
    const parts = [plural(res.messages, '1 message', `${res.messages} messages`)];
    if (res.pictures) parts.push(plural(res.pictures, '1 picture', `${res.pictures} pictures`));
    sayAll('send-discord-what', parts, ', ');
    $('send-discord-go').disabled = false;
  }

  async function writeSummary() {
    const tab = doc.tab;
    const button = $('send-ai');
    button.disabled = true;
    say('send-discord-msg', 'Asking the AI…');
    const res = await api.aiRun({ id: `send-${Date.now()}`, action: 'summarize', text: ctx.textOf(tab), selection: '', title: doc.title, path: tab.doc.path || '' });
    button.disabled = false;
    say('send-discord-msg', res?.error || 'Check it before you post it.');
    if (res?.text) { $('send-summary').value = res.text.trim(); await plan(); }
  }

  async function sendDiscord() {
    $('send-discord-go').disabled = true;
    say('send-discord-msg', 'Posting…');
    const res = await api.sendDiscord({ ...asked(), id: $('send-channel').value, summary: isSummary(), words: $('send-summary').value });
    $('send-discord-go').disabled = false;
    if (res.error) { say('send-discord-msg', res.error); return; }
    const parts = [plural(res.sent, 'Posted.', `Posted in ${res.sent} messages.`)];
    if (res.missing) parts.push(plural(res.missing, '1 picture wasn’t found.', `${res.missing} pictures weren’t found.`));
    if (res.tooBig) parts.push(plural(res.tooBig, '1 picture was too large for Discord.', `${res.tooBig} pictures were too large for Discord.`));
    sayAll('send-discord-msg', parts);
    say('send-discord-what', '');
    $('send-discord-go').hidden = true;
    const open = $('send-discord-open');
    open.hidden = !res.url;
    open.onclick = () => api.openExternal(res.url);
  }

  // ---------------------------------------------------------------- where it's been
  const WHAT = { draft: 'Draft', update: 'Draft updated', post: 'Posted', summary: 'Summary posted', page: 'Page' };

  async function openList() {
    const tab = ctx.activeTab();
    if (!tab?.doc.path) { toast('Open a saved document first.'); return; }
    const list = await api.sentList(tab.doc.path);
    const rows = $('sent-rows');
    rows.replaceChildren();
    for (const entry of list) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'auto-row-text';
      const name = document.createElement('b');
      name.textContent = entry.where || KINDS[entry.kind];
      name.setAttribute('translate', 'no');
      const small = document.createElement('small');
      const kind = document.createElement('span');
      kind.textContent = KINDS[entry.kind];
      kind.setAttribute('translate', 'no');
      const what = document.createElement('span');
      what.textContent = WHAT[entry.what];
      small.append(kind, ' · ', what, ` · ${new Date(entry.at).toLocaleString()}`);
      text.append(name, small);
      li.append(text);
      if (entry.url) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'link-btn';
        open.textContent = 'Open';
        open.setAttribute('aria-label', `Open ${entry.where || KINDS[entry.kind]}`);
        open.onclick = () => api.openExternal(entry.url);
        li.append(open);
      }
      rows.appendChild(li);
    }
    $('sent-none').hidden = list.length > 0;
    $('sent-forget').hidden = !list.length;
    $('sent-forget').onclick = async () => { await api.sentForget(tab.doc.path); await openList(); };
    page('list');
    show();
  }

  $('send-site').onchange = status;
  $('send-blog-go').onclick = sendDraft;
  $('send-blog-cancel').onclick = () => dlg.close();
  $('send-channel').onchange = plan;
  $('send-mode').onchange = () => { modeShown(); plan(); };
  $('send-summary').oninput = () => { clearTimeout(planTimer); planTimer = setTimeout(plan, 250); };
  $('send-ai').onclick = writeSummary;
  $('send-discord-go').onclick = sendDiscord;
  $('send-discord-cancel').onclick = () => dlg.close();
  $('sent-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => clearTimeout(planTimer));     // not `doc`: this event can land after the dialog has opened again

  return { blog: openBlog, discord: openDiscord, list: openList };
}
