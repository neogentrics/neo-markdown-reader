// End-to-end test for v2.3 "Connected notes": [[wiki links]] and creating missing documents, Backlinks,
// tags, the Tasks panel and Today's note, the link map, the link checker, Rename with link updates,
// [[ autocomplete in the editor and Ask About This Folder. Native dialogs are answered by stubs in
// the main process; Claude is a local stand-in (see power.e2e.cjs).
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const aiRequests = [];
const aiReply = 'Ship v2.3 is overdue [home.md:6], and the plan still needs writing [plan.md:5].';
const aiServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    aiRequests.push(JSON.parse(raw || '{}'));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_test' });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of aiReply.match(/[\s\S]{1,10}/g)) send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } });
    send('message_stop', {});
    res.end();
  });
});

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-notes-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
const home = path.join(docs, 'home.md');
const plan = path.join(docs, 'plan.md');
const ideas = path.join(docs, 'sub', 'Ideas.md');
fs.writeFileSync(home, '---\ntags: [hub]\n---\n# Home\n\nStart with [[plan]] and [[Ideas#Later|later ideas]]. Also [[Someday]].\n\n- [ ] Ship v2.3 📅 2026-01-01\n');
fs.writeFileSync(plan, '# Plan\n\nBack [home](home.md). #work\n\n- [ ] Write the plan\n- [x] Old task\n\n[[nowhere]] ![chart](missing.png)\n');
fs.writeFileSync(ideas, '# Ideas\n\n## Later\n\nSee [[plan]]. #work #idea\n');
fs.writeFileSync(path.join(docs, 'secret.mdlock'), 'NMRLOCK1 not really locked, never read');
const pad2 = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const step = async (name, fn) => { await fn(); console.log('ok -', name); };

(async () => {
  await new Promise((r) => aiServer.listen(0, '127.0.0.1', r));
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, home, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_REVEAL: '1', NMR_AI_BASE_URL: `http://127.0.0.1:${aiServer.address().port}` },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    global.__answers = [];
    global.__asked = [];
    global.__open = null;
    dialog.showMessageBox = async (_w, o) => { global.__asked.push(o.message); return { response: global.__answers.length ? global.__answers.shift() : (o.cancelId ?? 0) }; };
    dialog.showOpenDialog = async () => (global.__open ? { canceled: false, filePaths: [global.__open] } : { canceled: true, filePaths: [] });
  });
  const answer = (...r) => app.evaluate((_e, list) => { global.__answers.push(...list); global.__asked = []; }, r);
  const asked = () => app.evaluate(() => global.__asked);
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const activeLabel = () => win.$eval('.tab.active .tab-label', (n) => n.textContent);
  const waitTab = (label) => win.waitForFunction((l) => document.querySelector('.tab.active .tab-label')?.textContent === l, label);
  const page = '.page:not([hidden])';
  const view = () => 'window.__editorKit.findView(document.querySelector(".editor-host:not([hidden]) .cm-editor"))';
  const editorText = () => win.evaluate((v) => eval(v).state.doc.toString(), view());

  await win.waitForSelector(`${page} h1`);
  // Toasts replace each other quickly, so keep every one that was shown.
  await win.evaluate(() => {
    window.__toasts = [];
    const t = document.querySelector('.toast');
    new MutationObserver(() => { if (!t.hidden) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  await app.evaluate((_e, dir) => { global.__open = dir; }, docs);
  await menu('open-folder');
  await win.waitForSelector('#folder-name:not(:empty)');

  await step('[[links]] find documents in the folder by name; missing ones look different', async () => {
    await win.waitForSelector(`${page} a.wikilink[data-wiki="plan"]:not(.wikilink-missing)`);
    assert.equal(await win.getAttribute(`${page} a.wikilink[data-wiki="plan"]`, 'href'), 'plan.md');
    assert.equal(await win.textContent(`${page} a.wikilink[data-wiki="Ideas"]`), 'later ideas');
    assert.equal(await win.getAttribute(`${page} a.wikilink[data-wiki="Ideas"]`, 'href'), 'sub/Ideas.md#later');
    assert.ok(await win.$(`${page} a.wikilink-missing[data-wiki="Someday"]`));
    await win.click(`${page} a.wikilink[data-wiki="Ideas"]`);
    await waitTab('Ideas');
  });

  await step('Backlinks at the bottom of the Outline list the documents that link here', async () => {
    await menu('panel-outline');
    await win.waitForSelector('#backlinks:not([hidden]) .backlink');
    assert.equal(await win.textContent('#backlinks-count'), '1');
    assert.match(await win.textContent('#backlinks-list'), /Home[\s\S]*later ideas/);
    await win.click(`${page} a.wikilink[data-wiki="plan"]`);
    await waitTab('plan');
    await win.waitForFunction(() => document.getElementById('backlinks-count').textContent === '2');
    await win.click('#backlinks-list .backlink >> text=Home');
    await waitTab('home');
  });

  await step('clicking a link to a missing document offers to create it', async () => {
    await answer(0);                                          // Create
    await win.click(`${page} a.wikilink-missing[data-wiki="Someday"]`);
    await waitTab('Someday');
    assert.match((await asked())[0], /Create “Someday\.md”\?/);
    assert.equal(fs.readFileSync(path.join(docs, 'Someday.md'), 'utf8').replace(/\r\n/g, '\n'), '# Someday\n\n');
    await win.click('.tab >> text=home');
    await win.waitForSelector(`${page} a.wikilink[data-wiki="Someday"]:not(.wikilink-missing)`);
  });

  await step('tags show as chips in the Files panel and filter the files', async () => {
    await menu('panel-files');
    await win.waitForSelector('#tag-chips:not([hidden]) .tag-chip');
    const chips = await win.$$eval('#tag-chips .tag-chip', (n) => n.map((b) => b.textContent.trim()));
    assert.deepEqual(chips, ['#work 2', '#hub 1', '#idea 1']);
    await win.click('#tag-chips .tag-chip >> text=#work');
    await win.waitForSelector('#files-body .group-head >> text=Tagged #work');
    const shown = await win.$$eval('#files-body .file-item .file-name', (n) => n.map((x) => x.textContent).sort());
    assert.deepEqual(shown, ['Ideas.md', 'plan.md']);
    await win.click('#tag-chips .tag-chip.active');
    await win.waitForSelector('#files-body .tree-root');
  });

  await step('the Tasks panel lists every task, overdue first; ticking one asks, then changes the file', async () => {
    await menu('panel-tasks');
    await win.waitForSelector('#tasks-list .task');
    const groups = await win.$$eval('#tasks-list .task-group .group-head', (n) => n.map((x) => x.textContent));
    assert.deepEqual(groups, ['Overdue', 'No date']);
    assert.deepEqual(await win.$$eval('#tasks-list .task-text > span', (n) => n.map((x) => x.textContent)), ['Ship v2.3', 'Write the plan']);
    assert.match(await win.textContent('#tasks-list .task-group.group-overdue small'), /home · Overdue/);
    await win.check('#tasks-done');
    await win.waitForSelector('#tasks-list .task.done >> text=Old task');
    await win.uncheck('#tasks-done');
    await answer(0);                                          // Just This Time
    await win.check('#tasks-list .task >> nth=1 >> input');
    await win.waitForFunction(() => document.querySelectorAll('#tasks-list .task').length === 1);
    assert.match((await asked())[0], /plan\.md/);
    assert.match(fs.readFileSync(plan, 'utf8'), /^- \[x\] Write the plan$/m);
  });

  await step('Today’s note opens (or creates) Daily/YYYY-MM-DD.md in the folder', async () => {
    await win.click('#tasks-daily');
    await waitTab(today);
    const daily = path.join(docs, 'Daily', `${today}.md`);
    assert.match(fs.readFileSync(daily, 'utf8'), /tags: \[daily\][\s\S]*## Tasks/);
    await win.click('#tasks-daily');                          // the second time it just opens it
    await waitTab(today);
    assert.equal(await win.$$eval('.tab', (n, t) => n.filter((x) => x.textContent.includes(t)).length, today), 1);
  });

  await step('the link map shows every document and opens the one you click', async () => {
    await menu('link-map');
    await win.waitForSelector('#map-dlg[open] .map-node');
    assert.equal(await win.$$eval('#map-svg .map-node', (n) => n.length), 5, 'home, plan, Ideas, Someday and the daily note — never the locked one');
    assert.match(await win.textContent('#map-note'), /5 documents · 4 links · 1 not linked yet/);
    await win.click('#map-svg .map-node[aria-label^="plan,"]');
    await win.waitForSelector('#map-dlg', { state: 'hidden' });
    await waitTab('plan');
  });

  await step('the link checker lists links that go nowhere and opens them at the line', async () => {
    await menu('check-links');
    await win.waitForSelector('#check-dlg[open] .check-hit');
    assert.match(await win.textContent('#check-summary'), /^2 links in 1 document go nowhere/);
    const hits = await win.$$eval('#check-list .check-hit', (n) => n.map((x) => x.textContent));
    assert.match(hits[0], /^8Missing document \[\[nowhere\]\]/);
    assert.match(hits[1], /^8Missing picture missing\.png/);
    await win.click('#check-list .check-hit >> nth=0');
    await win.waitForSelector('#check-dlg', { state: 'hidden' });
  });

  await step('Rename (F2) renames the file and updates the links to it', async () => {
    await menu('rename-doc');
    await win.waitForSelector('#rename-dlg[open]');
    assert.equal(await win.inputValue('#rename-input'), 'plan.md');
    await win.fill('#rename-input', 'Roadmap');
    await answer(0);                                          // Update Links
    await win.click('#rename-form button[type=submit]');
    await waitTab('Roadmap');
    assert.match((await asked()).join('\n'), /Update 2 links to “plan\.md” in 2 other documents\?/);
    assert.equal(fs.existsSync(plan), false);
    assert.match(fs.readFileSync(path.join(docs, 'Roadmap.md'), 'utf8'), /- \[x\] Write the plan/);
    assert.match(fs.readFileSync(home, 'utf8'), /Start with \[\[Roadmap\]\] and/);
    assert.match(fs.readFileSync(ideas, 'utf8'), /See \[\[Roadmap\]\]\./);
    await win.waitForFunction(() => window.__toasts.includes('Renamed — 2 links updated'));
  });

  await step('typing [[ in the editor suggests documents; the link style can be standard Markdown', async () => {
    await win.click('.tab >> text=home');
    await waitTab('home');
    await answer(0);                                          // Just This Time
    await menu('toggle-edit');
    await win.waitForSelector('.editor-host:not([hidden]) .cm-content');
    const original = await editorText();
    await win.evaluate((v) => { const ed = eval(v); ed.dispatch({ selection: { anchor: ed.state.doc.length } }); ed.focus(); }, view());
    await win.keyboard.type('\n[[Ide');
    await win.waitForSelector('.cm-tooltip-autocomplete li >> text=Ideas');
    await win.waitForTimeout(150);                         // the editor ignores Enter for 75 ms after the list opens
    await win.keyboard.press('Enter');
    assert.match(await editorText(), /\n\[\[Ideas\]\]$/);
    await menu('wiki-style');
    await win.keyboard.type(' [[Road');
    await win.waitForSelector('.cm-tooltip-autocomplete li >> text=Roadmap');
    await win.waitForTimeout(150);                         // the editor ignores Enter for 75 ms after the list opens
    await win.keyboard.press('Enter');
    assert.match(await editorText(), /\[\[Ideas\]\] \[Roadmap\]\(Roadmap\.md\)$/);
    await menu('wiki-style');
    await win.evaluate(([v, text]) => { const ed = eval(v); ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: text } }); }, [view(), original]);
    await menu('toggle-edit');
    await win.waitForSelector('.editor-host', { state: 'hidden' }).catch(() => {});
  });

  await step('Ask About This Folder sends the ticked documents (never locked ones) and links each citation', async () => {
    await menu('ai-folder');
    await win.waitForSelector('#ai-dlg[open]');
    await win.fill('#ai-key', 'sk-ant-test-0123456789abcdefghijklmn');
    await win.check('#ai-enabled');
    await win.click('#ai-form button[type=submit]');
    await win.waitForSelector('#ai-dlg', { state: 'hidden' });
    await menu('ai-folder');
    await win.waitForSelector('#ask-dlg[open] .ask-file');
    const listed = await win.$$eval('#ask-files .ask-file span', (n) => n.map((x) => x.textContent.replace(/\\/g, '/')).sort());
    assert.deepEqual(listed, [`Daily/${today}.md`, 'Roadmap.md', 'Someday.md', 'home.md', 'sub/Ideas.md']);
    await win.fill('#ask-filter', 'Daily');
    await win.click('#ask-none');
    await win.fill('#ask-filter', '');
    assert.match(await win.textContent('#ask-size'), /^4 documents will be sent/);
    await win.fill('#ask-question', 'What is still open?');
    await win.click('#ask-go');
    await win.waitForSelector('#ai-panel[open] #ai-body a.cite');
    await win.waitForFunction(() => document.getElementById('ai-stop').hidden);
    const sent = aiRequests.at(-1).messages[0].content;
    assert.match(sent, /<document path="home\.md">\n1\| ---/);
    assert.match(sent, /<document path="sub\/Ideas\.md">/);
    assert.doesNotMatch(sent, /Daily\/|secret|NMRLOCK/);
    assert.match(sent, /<question>\nWhat is still open\?\n<\/question>/);
    const cites = await win.$$eval('#ai-body a.cite', (n) => n.map((a) => a.textContent));
    assert.deepEqual(cites, ['home.md:6'], `citations in the answer (${aiRequests.length} request(s) sent): ${await win.innerHTML('#ai-body')}`);
    assert.match(await win.textContent('#ai-body'), /\[plan\.md:5\]/, 'a citation of a document that wasn’t sent stays plain text');
    await win.click('#ai-body a.cite');
    await win.waitForSelector('#ai-panel', { state: 'hidden' });
    await waitTab('home');
  });

  await step('the new panels and dialogs have no accessibility problems', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.evaluate(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
    const problems = async (where) => {
      const found = await win.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
      });
      assert.deepEqual(found, [], `accessibility problems in ${where}: ${found.join(' | ')}`);
    };
    for (const theme of ['light', 'dark']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      await menu('panel-tasks');
      await win.check('#tasks-done');
      await win.waitForSelector('#tasks-list .task.done');
      await problems(`the Tasks panel (${theme})`);
      await win.uncheck('#tasks-done');
      await menu('panel-files');
      await win.waitForSelector('#tag-chips .tag-chip');
      await problems(`the Files panel with tags (${theme})`);
      await menu('panel-outline');
      await win.waitForSelector('#backlinks:not([hidden])');
      await problems(`Backlinks (${theme})`);
      for (const [id, sel] of [['link-map', '#map-dlg[open] .map-node'], ['check-links', '#check-dlg[open] .check-hit'], ['ai-folder', '#ask-dlg[open] .ask-file'], ['rename-doc', '#rename-dlg[open]']]) {
        await menu(id);
        await win.waitForSelector(sel);
        await problems(`${sel} (${theme})`);
        await win.keyboard.press('Escape');
        await win.waitForFunction((s2) => !document.querySelector(s2), sel);
      }
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  });

  assert.deepEqual(errors, []);
  await app.close();
  aiServer.close();
  console.log('notes e2e: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
