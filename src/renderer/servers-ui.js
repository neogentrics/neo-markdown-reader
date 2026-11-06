// Home server (3.9) in the page: your servers, choosing a folder on one, and publishing to a wiki. Blogs and Discord
// channels (3.10) are in the same list; send-ui.js does the sending.
// Requests are made by the main process, which keeps your passwords and keys.

const $ = (id) => document.getElementById(id);
const HINTS = {
  nextcloud: 'Use an app password, from Personal settings, then Security.',
  webdav: 'The full address of the folder, and your name and password for it.',
  bookstack: 'From your profile, under API Tokens: the token ID, a colon, then the secret, like id:secret.',
  wikijs: 'An API key, from Administration, then API Access.',
  outline: 'An API key, from Settings, then API.',
  wordpress: 'Your user name, and an application password from Users, then Profile. WordPress only offers these on an https address.',
  ghost: 'The Admin API key of a custom integration, from Settings, then Integrations.',
  discord: 'In Discord, open the channel’s settings, then Integrations, then Webhooks, and copy the webhook’s address. Anyone who has it can post, so it’s kept with your keys.',
};

/** @param {{ api: any, toast: (m: string) => void, activeTab: () => any, textOf: (t: any) => string }} ctx */
export function createServersUi(ctx) {
  const { api, toast } = ctx;
  const dlg = $('srv-dlg');
  const pages = { list: $('srv-list-page'), edit: $('srv-edit-page'), browse: $('srv-browse-page'), publish: $('srv-publish-page') };
  let state = null;              // what srv:list returned
  let editing = null;
  let browsing = null;           // { id, rel }
  let job = null;                // what's waiting to be published
  let scope = 'doc';

  const page = (name) => { for (const [k, el] of Object.entries(pages)) el.hidden = k !== name; };
  const say = (id, text) => { $(id).textContent = text; };
  const show = () => { if (!dlg.open) dlg.showModal(); };
  const load = async () => { state = await api.srvList(); return state; };
  const button = (text, label, onclick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.onclick = onclick;
    return b;
  };
  const row = (title, note, ...buttons) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'auto-row-text';
    text.setAttribute('translate', 'no');
    const name = document.createElement('b');
    name.textContent = title;
    const small = document.createElement('small');
    small.textContent = note;
    text.append(name, small);
    li.append(text, ...buttons);
    return li;
  };

  // ---------------------------------------------------------------- your servers
  async function openList() {
    await load();
    const list = $('srv-rows');
    list.replaceChildren();
    for (const s of state.servers) {
      list.appendChild(row(s.name, `${s.kindName} · ${s.host}`,
        button('Test', `Test ${s.name}`, () => test({ id: s.id })),
        button('Edit', `Edit ${s.name}`, () => openEdit(s))));
    }
    for (const x of state.others) {
      list.appendChild(row(x.name, x.host,
        button('Test', `Test ${x.name}`, () => test({ other: x.key })),
        button('Edit', `Edit ${x.name}`, () => { dlg.close(); api.runCommand(x.command, x.arg); })));
    }
    $('srv-none').hidden = list.children.length > 0;
    say('srv-list-msg', '');
    page('list');
    show();
  }

  async function test(which) {
    say('srv-list-msg', 'Testing…');
    const res = await api.srvTest(which);
    say('srv-list-msg', res.error || 'Connected.');
  }

  function fieldsFor(kind) {
    const info = state.kinds[kind];
    $('srv-user-row').hidden = !info.user;
    say('srv-secret-label', kind === 'wordpress' ? 'Application password' : kind === 'discord' ? 'Webhook address' : info.user ? 'Password' : 'Key');
    $('srv-url-row').hidden = !!info.url;
    say('srv-hint', HINTS[kind] || '');
    $('srv-url').placeholder = kind === 'webdav' ? 'https://nas.home/dav/notes' : 'https://server.home';
  }

  function showPlain() {
    say('srv-plain', /^http:\/\/(?!localhost|127\.)/i.test($('srv-url').value.trim()) ? 'This address isn’t encrypted, so your password could be read on the way. That’s usually fine inside your home network.' : '');
  }

  function openEdit(server = null) {
    editing = server;
    say('srv-edit-h', server ? 'Edit server' : 'Add a server');
    $('srv-kind').value = server?.kind || 'nextcloud';
    $('srv-kind').disabled = !!server;
    $('srv-name').value = server?.name || '';
    $('srv-url').value = server?.url || '';
    $('srv-user').value = server?.user || '';
    $('srv-secret').value = '';
    $('srv-secret').placeholder = server?.hasSecret ? 'One is saved. Type a new one to replace it.' : '';
    $('srv-remove').hidden = !server;
    $('srv-insecure').hidden = state.secure;
    fieldsFor($('srv-kind').value);
    showPlain();
    say('srv-edit-msg', '');
    page('edit');
    show();
    $('srv-name').focus();
  }

  const draft = () => ({ id: editing?.id, kind: $('srv-kind').value, name: $('srv-name').value, url: $('srv-url').value, user: $('srv-user').value, secret: $('srv-secret').value });

  async function save() {
    say('srv-edit-msg', 'Testing…');
    const res = await api.srvSave(draft());
    if (res.error) { say('srv-edit-msg', res.error); return; }
    await openList();
    say('srv-list-msg', res.warning || 'Connected.');
  }

  // ---------------------------------------------------------------- a folder on a server
  async function choose(kindTest, none, then) {
    await load();
    const fit = state.servers.filter((s) => kindTest(state.kinds[s.kind]));
    if (!fit.length) { toast(none); openEdit(); return; }
    await then(fit);
  }

  function openBrowse() {
    return choose((k) => k.folders, 'Add your server first.', async (fit) => {
      const pick = $('srv-browse-server');
      pick.replaceChildren(...fit.map((s) => new Option(s.name, s.id)));
      $('srv-browse-server-row').hidden = fit.length < 2;
      await browse(fit[0].id, '');
      page('browse');
      show();
    });
  }

  async function browse(id, rel) {
    browsing = { id, rel };
    say('srv-browse-msg', 'Asking the server…');
    say('srv-browse-at', rel ? `/${rel}` : '/');
    $('srv-browse-up').hidden = !rel;
    const list = $('srv-folders');
    list.replaceChildren();
    const res = await api.srvFolders({ id, rel });
    if (res.error) { say('srv-browse-msg', res.error); return; }
    say('srv-browse-msg', res.folders.length ? '' : 'No folders in here.');
    for (const f of res.folders) {
      const name = f.split('/').pop();
      list.appendChild(row(name, '', button('Go In', `Go into ${name}`, () => browse(id, f))));
    }
  }

  async function openHere() {
    if (!browsing) return;
    say('srv-browse-msg', 'Bringing the folder here… A large folder can take a while the first time.');
    $('srv-open').disabled = true;
    const res = await api.srvOpenFolder(browsing);
    $('srv-open').disabled = false;
    if (res.error) { say('srv-browse-msg', res.error); return; }
    dlg.close();
    toast(res.count === 1 ? '1 document is here, and changes will go both ways.' : `${res.count} documents are here, and changes will go both ways.`);
  }

  // ---------------------------------------------------------------- publishing
  function openPublish(what) {
    scope = what;
    const tab = ctx.activeTab();
    if (what === 'doc' && !tab) { toast('Open a document first.'); return null; }
    return choose((k) => k.wiki, 'Add your wiki first.', async (fit) => {
      const pick = $('srv-wiki');
      pick.replaceChildren(...fit.map((s) => new Option(s.name, s.id)));
      $('srv-wiki-row').hidden = fit.length < 2;
      say('srv-publish-msg', '');
      $('srv-publish-open').hidden = true;
      $('srv-publish-go').hidden = false;
      page('publish');
      show();
      await prepare(fit[0].id);
    });
  }

  async function prepare(id) {
    const tab = ctx.activeTab();
    say('srv-publish-msg', 'Asking the wiki…');
    say('srv-publish-what', '');
    $('srv-publish-go').disabled = true;
    const res = await api.srvPublishPrepare({ id, scope, text: tab ? ctx.textOf(tab) : '', name: tab?.doc.name || '', path: tab?.doc.path || '' });
    if (res.error) { say('srv-publish-msg', res.error); job = null; return; }
    job = res;
    const parts = [];
    if (res.fresh) parts.push(res.fresh === 1 ? '1 new page' : `${res.fresh} new pages`);
    if (res.again) parts.push(res.again === 1 ? '1 page to update' : `${res.again} pages to update`);
    if (res.pictures) parts.push(res.pictures === 1 ? '1 picture' : `${res.pictures} pictures`);
    say('srv-publish-what', parts.join(', '));
    say('srv-place-label', res.placeWord);
    const place = $('srv-place');
    place.replaceChildren(...res.places.map((p) => new Option(p.name, p.id)), new Option('New…', ''));
    if (res.lastPlace && res.places.some((p) => p.id === res.lastPlace)) place.value = res.lastPlace;
    $('srv-place-row').hidden = !!res.freePlace;
    $('srv-new-place').value = res.suggested || '';
    newPlaceShown();
    say('srv-publish-msg', '');
    $('srv-publish-go').disabled = false;
    $('srv-publish-go').focus();
  }

  function newPlaceShown() {
    const free = !!job?.freePlace;
    $('srv-new-row').hidden = !free && $('srv-place').value !== '';
    say('srv-new-label', free ? 'Where in the wiki' : 'Name');
  }

  async function publish() {
    if (!job) return;
    $('srv-publish-go').disabled = true;
    say('srv-publish-msg', 'Publishing…');
    const res = await api.srvPublish({ token: job.token, place: job.freePlace ? '' : $('srv-place').value, newPlace: $('srv-new-place').value });
    $('srv-publish-go').disabled = false;
    if (res.error) { say('srv-publish-msg', res.error); return; }
    job = null;
    const parts = [];
    if (res.made) parts.push(res.made === 1 ? '1 page made' : `${res.made} pages made`);
    if (res.updated) parts.push(res.updated === 1 ? '1 page updated' : `${res.updated} pages updated`);
    if (res.same) parts.push(res.same === 1 ? '1 page already up to date' : `${res.same} pages already up to date`);
    if (res.missing) parts.push(res.missing === 1 ? '1 picture not found' : `${res.missing} pictures not found`);
    if (res.failed.length) parts.push(res.failed.length === 1 ? `1 page refused: ${res.failed[0].rel}, ${res.failed[0].message}` : `${res.failed.length} pages refused`);
    say('srv-publish-msg', parts.join(', '));
    say('srv-publish-what', '');
    $('srv-publish-go').hidden = true;
    const link = res.url;
    const open = $('srv-publish-open');
    open.hidden = !link;
    open.onclick = () => api.openExternal(link);
  }

  api.onServerSynced?.((res) => {
    if (res.error) toast(`${res.error} You’re working from your copy, and changes will go when the server is back.`);
    else if (res.conflicts?.length) toast(res.conflicts.length === 1 ? `Changed in both places, so yours is kept as “${res.conflicts[0].split('/').pop()}”.` : `${res.conflicts.length} documents changed in both places, so yours are kept as copies.`);
  });

  $('srv-add').onclick = () => openEdit();
  $('srv-close').onclick = () => dlg.close();
  $('srv-kind').onchange = () => fieldsFor($('srv-kind').value);
  $('srv-url').oninput = showPlain;
  $('srv-save').onclick = save;
  $('srv-edit-cancel').onclick = () => openList();
  $('srv-remove').onclick = async () => { await api.srvRemove(editing.id); await openList(); };
  $('srv-browse-server').onchange = () => browse($('srv-browse-server').value, '');
  $('srv-browse-up').onclick = () => browse(browsing.id, browsing.rel.split('/').slice(0, -1).join('/'));
  $('srv-open').onclick = openHere;
  $('srv-browse-cancel').onclick = () => dlg.close();
  $('srv-wiki').onchange = () => prepare($('srv-wiki').value);
  $('srv-place').onchange = newPlaceShown;
  $('srv-publish-go').onclick = publish;
  $('srv-publish-cancel').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { if (!dlg.open) job = null; });

  async function addKind(kind) {
    await load();
    openEdit();
    $('srv-kind').value = kind;
    fieldsFor(kind);
  }

  return { list: openList, browse: openBrowse, publish: openPublish, add: addKind };
}
