// End-to-end test for 3.8: Notion pages in and out against a stand-in for Notion that keeps its rules: edits must match
// exactly once, subpages can't be deleted without permission, and a page has to be shared before it can be seen.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-notion-'));
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const plain = path.join(docs, 'plain.md');
fs.writeFileSync(plain, '# My Notes\n\nWritten here.\n\n![Cat](images/cat.png)\n');

const PAGE = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const DB = '44444444-4444-4444-8444-444444444444';
const CHILD = '55555555555545558555555555555555';
const KEY = 'ntn_good_key';

const title = (text) => ({ Name: { type: 'title', title: [{ plain_text: text }] } });
const pages = new Map([
  [PAGE, {
    title: 'Plan', edited: '2026-11-01T10:00:00.000Z',
    markdown: `<p color="red">\nStay red\n</p>\n\nChange this line\n\n<callout icon="💡" color="blue_bg">\nA tip\n</callout>\n\n<page url="https://www.notion.so/${CHILD}">\nChild\n</page>`,
  }],
  [PARENT, { title: 'Home', edited: '2026-11-01T09:00:00.000Z', markdown: 'Home page' }],
]);
const seen = [];
let clock = 0;
const tick = () => { clock += 1; return `2026-11-02T10:00:${String(clock % 60).padStart(2, '0')}.000Z`; };

function pageObject(id) {
  const p = pages.get(id);
  return { object: 'page', id, url: `https://www.notion.so/Page-${id.replace(/-/g, '')}`, last_edited_time: p.edited, in_trash: false, properties: title(p.title) };
}

function answer(req, body) {
  const url = new URL(req.url, 'http://x');
  const route = `${req.method} ${url.pathname}`;
  const fail = (status, code, message) => ({ status, body: { object: 'error', status, code, message } });
  const ok = (data) => ({ status: 200, body: data });
  seen.push({ route, body, version: req.headers['notion-version'], key: req.headers.authorization });
  if (req.headers.authorization !== `Bearer ${KEY}`) return fail(401, 'unauthorized', 'API token is invalid.');
  if (route === 'GET /v1/users/me') return ok({ name: 'RT Reader', bot: { workspace_name: 'Neo’s Space' } });
  if (route === 'POST /v1/search') {
    const items = [...pages.keys()].map(pageObject);
    if (!body.filter) items.push({ object: 'data_source', id: SOURCE, title: [{ plain_text: 'Tasks' }] });
    return ok({ object: 'list', results: items.filter((i) => titleText(i).toLowerCase().includes((body.query || '').toLowerCase())), has_more: false });
  }
  if (route === `GET /v1/databases/${DB}`) return ok({ object: 'database', id: DB, data_sources: [{ id: SOURCE, name: 'Tasks' }] });
  if (route === `GET /v1/data_sources/${SOURCE}`) return ok({ object: 'data_source', id: SOURCE, title: [{ plain_text: 'Tasks' }], properties: { Done: { type: 'checkbox' }, Name: { type: 'title' } } });
  if (route === `POST /v1/data_sources/${SOURCE}/query`) {
    return ok({ results: [{ object: 'page', url: 'https://www.notion.so/row', properties: { Name: { type: 'title', title: [{ plain_text: 'Write tests' }] }, Done: { type: 'checkbox', checkbox: true } } }], has_more: false });
  }
  if (route === 'POST /v1/pages') {
    if (body.markdown_version !== 'v2') return fail(400, 'validation_error', 'bad version');
    const id = '66666666-6666-4666-8666-666666666666';
    pages.set(id, { title: body.properties.title.title[0].text.content, edited: tick(), markdown: body.markdown, parent: body.parent.page_id });
    return ok(pageObject(id));
  }
  const m = /^\/v1\/pages\/([0-9a-f-]{36})(\/markdown)?$/.exec(url.pathname);
  const page = m && pages.get(m[1]);
  if (!page) return fail(404, 'object_not_found', 'Could not find page.');
  if (req.method === 'GET' && !m[2]) return ok(pageObject(m[1]));
  if (req.method === 'PATCH' && !m[2]) {
    page.title = body.properties.title.title[0].text.content;
    page.edited = tick();
    return ok(pageObject(m[1]));
  }
  if (req.method === 'GET') {
    if (url.searchParams.get('markdown_version') !== 'v2') return fail(400, 'validation_error', 'bad version');
    return ok({ object: 'page_markdown', id: m[1], markdown: page.markdown, truncated: false, unknown_block_ids: [] });
  }
  if (body.markdown_version !== 'v2') return fail(400, 'validation_error', 'bad version');
  let next = page.markdown;
  if (body.type === 'update_content') {
    for (const edit of body.update_content.content_updates) {
      // Like the real Notion: a signed link is made new on each read, so it never matches what's stored.
      if (/X-Amz/.test(edit.old_str)) return fail(400, 'validation_error', `No matches found for ${edit.old_str.slice(0, 60)}`);
      const count = next.split(edit.old_str).length - 1;
      if (count !== 1) return fail(400, 'validation_error', `old_str matched ${count} times`);
      next = next.replace(edit.old_str, () => edit.new_str);
    }
  } else next = body.replace_content.new_str;
  const allowed = (body.update_content || body.replace_content).allow_deleting_content;
  for (const tag of page.markdown.match(/<page url="[^"]+">/g) || []) {   // the opening tag, however its title is laid out
    if (!next.includes(tag) && !allowed) return fail(400, 'validation_error', 'This would delete child page Child. Set allow_deleting_content to true.');
  }
  page.markdown = next;
  page.edited = tick();
  return ok({ object: 'page_markdown', id: m[1], markdown: next, truncated: false, unknown_block_ids: [] });
}

const titleText = (item) => (item.title ? item.title[0].plain_text : item.properties.Name.title[0].plain_text);

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const { status, body } = answer(req, raw ? JSON.parse(raw) : {});
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), plain],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: path.join(tmp, 'p'), NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NOTION_URL: `http://127.0.0.1:${server.address().port}` },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('.tab');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
  const shot = async (name) => { if (process.env.NMR_SHOTS) await win.screenshot({ path: path.join(process.env.NMR_SHOTS, `notion-${name}.png`) }); };

  const menu =(id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const text = (id) => win.evaluate((x) => document.getElementById(x)?.textContent || '', id);
  const visible = (id) => win.evaluate((x) => { const el = document.getElementById(x); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }, id);
  const click = (id) => win.click(`#${id}`);
  const open = () => win.evaluate(() => document.getElementById('notion-dlg').open);
  const toasted = (re) => until(() => win.evaluate((s) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(s).test(t.textContent)), re.source), `toast ${re}`);
  const shownDoc = () => win.evaluate(() => document.querySelector('.doc:not([hidden]), article:not([hidden])')?.textContent || document.body.textContent);
  const shownEditor = () => win.evaluate(() => [...document.querySelectorAll('.cm-content')].find((e) => e.getClientRects().length)?.textContent || '');
  const chooseRow = async (name) => {
    await until(() => win.evaluate((n) => !!document.querySelector(`#notion-results button[aria-label="Choose ${n}"]`), name), `row ${name}`);
    await win.click(`#notion-results button[aria-label="Choose ${name}"]`);
  };
  const saveAs = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: !f, filePath: f }); }, file);

  await step('the commands are in the File menu, and the menu is still short', async () => {
    const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.filter((i) => i.visible && i.type !== 'separator').map((i) => i.label));
    assert.ok(items.includes('Notion'));
    assert.ok(items.length <= 20, `File has ${items.length}`);
    assert.ok(await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu().getMenuItemById('reopen-closed-tab')));
  });

  await step('with no key, you are shown how to connect first', async () => {
    await menu('notion-bring');
    await until(() => visible('notion-setup-page'), 'the setup page');
    assert.match(await text('notion-steps'), /internal integration/);
    await shot('setup');
  });

  await step('a wrong key is refused and not kept', async () => {
    await win.fill('#notion-key', 'ntn_wrong');
    await click('notion-connect');
    await until(async () => /didn’t accept/.test(await text('notion-setup-msg')), 'the refusal');
    assert.equal((await win.evaluate(() => window.reader.notionState())).hasKey, false);
  });

  await step('the right key connects, and carries on to what you were doing', async () => {
    await win.fill('#notion-key', KEY);
    await click('notion-connect');
    await until(() => visible('notion-pick-page'), 'the page list');
    assert.equal((await win.evaluate(() => window.reader.notionState())).hasKey, true);
    await until(async () => (await win.locator('#notion-results li').count()) === 3, 'three results');
    assert.ok(seen.every((s) => s.version === '2026-03-11'));
    await shot('pick');
  });

  await step('the dialog passes an accessibility check', async () => {
    await win.evaluate(axeSource);
    const res = await win.evaluate(() => window.axe.run(document.getElementById('notion-dlg'), { rules: { 'color-contrast': { enabled: false } } }));
    assert.deepEqual(res.violations.map((v) => v.id), []);
  });

  await step('searching narrows the list', async () => {
    await win.fill('#notion-search', 'pla');
    await until(async () => (await win.locator('#notion-results li').count()) === 1, 'one result');
  });

  const linked = path.join(docs, 'plan.md');
  await step('a page saves as Markdown, linked, and opens', async () => {
    await chooseRow('Plan');
    await until(() => visible('notion-bring-page'), 'the choice');
    assert.equal(await text('notion-bring-what'), 'A page.');
    await saveAs(linked);
    await click('notion-save');
    await until(() => fs.existsSync(linked), 'the file');
    const saved = fs.readFileSync(linked, 'utf8').replace(/\r\n/g, '\n');
    assert.match(saved, new RegExp(`^---\\nnotion: https://www\\.notion\\.so/Page-${PAGE.replace(/-/g, '')}\\n---\\n`));
    assert.match(saved, /# Plan\n\nStay red\n\nChange this line\n\n> \[!TIP\]\n> A tip\n\n\[📄 Child\]/);
    await until(() => win.evaluate(() => [...document.querySelectorAll('.tab')].some((t) => /plan/i.test(t.textContent))), 'its tab');
    assert.equal(await open(), false);
  });

  const editFile = async (change) => {
    fs.writeFileSync(linked, change(fs.readFileSync(linked, 'utf8').replace(/\r\n/g, '\n')));
    await menu('reload');
    await new Promise((r) => setTimeout(r, 400));
  };

  await step('nothing to send is said plainly', async () => {
    await menu('notion-send');
    await toasted(/already match/);
    assert.equal(await open(), false);
  });

  await step('sending shows only what changed, and changes only that', async () => {
    await editFile((t) => t.replace('Change this line', 'A better line'));
    seen.length = 0;
    await menu('notion-send');
    await until(() => visible('notion-send-page'), 'the preview');
    assert.equal(await text('notion-send-to'), 'Plan');
    assert.ok(await win.evaluate(() => [...document.querySelectorAll('#notion-diff ins')].some((e) => /better/.test(e.textContent))));
    assert.ok(!seen.some((s) => s.route.startsWith('PATCH')), 'nothing is sent before you say so');
    await shot('send');
    await click('notion-go');
    await toasted(/^Sent to Notion$/);
    const page = pages.get(PAGE);
    assert.ok(page.markdown.includes('<p color="red">\nStay red\n</p>'), 'the colour stayed');
    assert.ok(page.markdown.includes('<callout icon="💡" color="blue_bg">'), 'the callout stayed');
    assert.ok(page.markdown.includes('A better line'));
    const patch = seen.find((s) => s.route === `PATCH /v1/pages/${PAGE}/markdown`);
    assert.deepEqual(patch.body.update_content.content_updates, [{ old_str: 'Change this line', new_str: 'A better line' }]);
    assert.equal(patch.body.update_content.allow_deleting_content, false);
  });

  await step('a subpage isn’t deleted, and you’re told why', async () => {
    const before = pages.get(PAGE).markdown;
    const good = fs.readFileSync(linked, 'utf8');
    await editFile((t) => t.replace(/\[📄 Child\]\(.*\)\n?/, ''));
    await menu('notion-send');
    await until(() => visible('notion-send-page'), 'the preview');
    await click('notion-go');
    await until(async () => /delete a subpage/.test(await text('notion-send-msg')), 'the refusal');
    assert.equal(pages.get(PAGE).markdown, before);
    await click('notion-send-cancel');
    await editFile(() => good);
  });

  await step('a new title renames the page', async () => {
    await editFile((t) => t.replace('# Plan', '# Better Plan'));
    await menu('notion-send');
    await until(() => visible('notion-send-page'), 'the preview');
    assert.match(await text('notion-send-what'), /renamed to “Better Plan”/);
    await click('notion-go');
    await toasted(/^Sent to Notion$/);
    assert.equal(pages.get(PAGE).title, 'Better Plan');
  });

  await step('sending over someone’s newer change warns you first', async () => {
    pages.get(PAGE).markdown = pages.get(PAGE).markdown.replace('A better line', 'Their line');
    pages.get(PAGE).edited = tick();
    await menu('notion-send');
    await until(() => visible('notion-send-page'), 'the preview');
    assert.match(await text('notion-send-notes'), /changed in Notion since/);
    await click('notion-send-cancel');
  });

  await step('a page that moved on shows a note, and Compare opens both', async () => {
    await menu('notion-compare');
    await until(() => win.evaluate(() => [...document.querySelectorAll('.tab')].some((t) => /\(Notion\)/.test(t.textContent))), 'the comparison');
    assert.match(await shownDoc(), /Their line/);
    await menu('close-tab');
    await until(() => win.evaluate(() => ![...document.querySelectorAll('.tab')].some((t) => /\(Notion\)/.test(t.textContent))), 'it to close');
    await until(() => visible('notion-banner'), 'the note');
    await shot('banner');
  });

  await step('bringing changes in puts them in the editor, unsaved', async () => {
    await click('notion-bring-changes');
    await toasted(/Brought in/);
    await until(() => win.evaluate(() => !!document.querySelector('.cm-content') && /Their line/.test(document.querySelector('.cm-content').textContent)), 'the new words');
    assert.equal(await visible('notion-banner'), false);
    assert.match(fs.readFileSync(linked, 'utf8'), /A better line/, 'the file waits for you to save');
    assert.match(await win.evaluate(() => document.querySelector('.cm-content').textContent), /notion: https/, 'the link stays');
  });

  await step('a database opens as a table from a pasted link', async () => {
    await menu('notion-bring');
    await until(() => visible('notion-pick-page'), 'the page list');
    await win.fill('#notion-search', `https://www.notion.so/neo/Tasks-${DB.replace(/-/g, '')}?v=abc`);
    await until(() => visible('notion-use-link'), 'the link button');
    await click('notion-use-link');
    await until(() => visible('notion-bring-page'), 'the choice');
    assert.equal(await text('notion-bring-what'), 'A database with 1 row.');
    assert.equal(await visible('notion-linked-row'), false);
    await click('notion-just-open');
    await until(() => win.evaluate(() => [...document.querySelectorAll('.tab')].some((t) => /Tasks/.test(t.textContent))), 'its tab');
    await until(async () => /Write tests/.test(await shownEditor()), 'its content');
  });

  await step('a pasted link to something else is refused', async () => {
    const res = await win.evaluate(() => window.reader.notionFetch({ link: 'https://evil.example/11111111111111111111111111111111' }));
    assert.match(res.error, /isn’t a link/);
  });

  await step('a new page goes under the one you choose, and the document is linked to it', async () => {
    await win.click('.tab:has-text("plain")');
    await menu('notion-send');
    await until(() => visible('notion-pick-page'), 'the page list');
    assert.equal(await text('notion-pick-h'), 'Send to Notion');
    await chooseRow('Home');
    await until(() => visible('notion-send-page'), 'the preview');
    assert.equal(await text('notion-send-to'), 'Home');
    assert.match(await text('notion-send-what'), /“My Notes”/);
    assert.match(await text('notion-send-notes'), /1 picture on your computer/);
    await click('notion-go');
    await toasted(/Sent to Notion and linked/);
    const made = [...pages.values()].find((p) => p.parent === PARENT);
    assert.equal(made.title, 'My Notes');
    assert.ok(made.markdown.includes('Written here.'));
    assert.ok(!made.markdown.includes('images/cat.png'), 'the path on this computer isn’t sent');
    await until(async () => /notion: https/.test(await shownEditor()), 'the link in the document');
  });

  await step('password-locked documents are never sent', async () => {
    const res = await win.evaluate((p) => window.reader.notionPrepare({ text: 'x', path: p }), path.join(docs, 'secret.mdlock'));
    assert.match(res.error, /never sent/);
  });

  await step('disconnecting forgets the key', async () => {
    await menu('notion-setup');
    await until(() => visible('notion-disconnect'), 'the button');
    await click('notion-disconnect');
    await toasted(/disconnected/);
    assert.equal((await win.evaluate(() => window.reader.notionState())).hasKey, false);
  });

  await step('the key is kept encrypted, not in plain sight', async () => {
    const dir = path.join(tmp, 'p');
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      if (fs.statSync(file).isFile()) assert.ok(!fs.readFileSync(file).includes(KEY), f);
    }
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
