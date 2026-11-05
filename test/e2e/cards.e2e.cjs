// End-to-end test for flashcards (3.6): studying what's due, practising, quizzes, the open folder, documents
// with no saved place for progress, and AI drafts from a stand-in for a model on this computer.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cards-'));
const profile = path.join(tmp, 'profile');
const docs = path.join(tmp, 'docs');
fs.mkdirSync(docs);
const study = path.join(docs, 'study.md');
const STUDY = `# Networks

## Names

Q: What does DNS do?
A: It turns names into **addresses**.

Q: Which port does DNS use?
A: 53

## Links

Q: What does HTTP stand for?
A: Hypertext Transfer Protocol

Firewall
: Filters traffic between networks.

## Glossary

- **Router**: Moves packets between networks.

Some closing words.
`;
fs.writeFileSync(study, STUDY);
const plain = path.join(docs, 'plain.md');
fs.writeFileSync(plain, '# Plain\n\nNothing to learn here.\n\n## Part one\n\nThe sky is blue.\n\n## Part two\n\nGrass is green.\n');
fs.mkdirSync(path.join(docs, 'more'));
fs.writeFileSync(path.join(docs, 'more', 'extra.md'), 'Q: One more?\nA: Yes\n');

let reply = 'Q: What colour is the sky?\nA: Blue\n\nQ: Is it blue?\nA: It is';
const requests = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'small' }] })); return; }
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'c', model: 'small', choices: [{ index: 0, delta: { content: reply } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'c', model: 'small', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), study],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', NMR_USER_DATA: profile, NMR_DISABLE_UPDATES: '1', NMR_NO_TOUR: '1', NMR_NO_REVEAL: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });       // "Allow Once" for editing
  });
  const menu = (id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu().getMenuItemById(itemId).click(), id);
  const text = (sel) => win.textContent(sel);
  const visible = (sel) => win.isVisible(sel);
  const counts = async () => ({ total: await text('#cards-total'), due: await text('#cards-due'), fresh: await text('#cards-new') });
  const progress = () => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'flashcards.json'), 'utf8')); } catch { return {}; } };
  const open = async () => { await menu('study'); await win.waitForSelector('#cards-dlg[open] #cards-home:not([hidden])'); };
  const close = async () => { await win.click('#cards-close'); await win.waitForFunction(() => !document.querySelector('#cards-dlg[open]')); };
  const home = () => win.waitForSelector('#cards-home:not([hidden])');
  await win.waitForSelector('.page:not([hidden]) h1');
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.evaluate(axeSource);
  const problems = async (where) => {
    for (const theme of ['light', 'dark', 'blue']) {
      await win.evaluate((t) => window.reader.setSettings({ theme: t }), theme);
      await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
      const found = await win.evaluate(async () => {
        const r = await window.axe.run(document.getElementById('cards-dlg'), { resultTypes: ['violations'] });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
      });
      assert.deepEqual(found, [], `accessibility problems on ${where} in ${theme}: ${found.join(' | ')}`);
    }
    await win.evaluate(() => window.reader.setSettings({ theme: 'light' }));
  };

  await step('the deck counts the cards in the document', async () => {
    await open();
    assert.deepEqual(await counts(), { total: '5', due: '0', fresh: '5' });
    assert.equal(await visible('#cards-empty'), false);
    assert.equal(await visible('#cards-scope-field'), false, 'no folder is open');
  });

  await step('studying: the question, then the answer, then how well you knew it', async () => {
    await win.click('#cards-study');
    await win.waitForSelector('#cards-run:not([hidden])');
    assert.match(await text('#cards-q'), /What does DNS do\?/);
    assert.equal(await visible('#cards-a'), false);
    assert.equal(await text('#cards-count'), '1 / 5');
    assert.equal(await win.evaluate(() => document.activeElement.id), 'cards-show');
    await win.keyboard.press('Space');
    await win.waitForSelector('#cards-a:not([hidden])');
    assert.equal(await win.innerHTML('#cards-a strong'), 'addresses', 'cards are Markdown');
    assert.equal(await text('[data-name="good"] small'), 'Tomorrow');
    assert.equal(await text('[data-name="easy"] small'), '4 days');
    await problems('the answer side of a card');
    assert.equal(await win.evaluate(() => document.activeElement.dataset.name), 'good');
    await win.keyboard.press('3');
    await win.waitForFunction(() => /Which port/.test(document.getElementById('cards-q').textContent));
    assert.equal(await text('#cards-count'), '2 / 5');
  });

  await step('Again brings a card back in the same sitting', async () => {
    await win.click('#cards-show');
    await win.click('[data-name="again"]');
    await win.waitForFunction(() => /HTTP/.test(document.getElementById('cards-q').textContent));
    assert.equal(await text('#cards-count'), '2 / 5', 'it isn’t finished yet');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      seen.push((await text('#cards-q')).trim());
      await win.click('#cards-show');
      await win.keyboard.press('3');
      await win.waitForFunction((was) => document.getElementById('cards-q').textContent.trim() !== was || !document.querySelector('#cards-done[hidden]'), seen[i]);
    }
    assert.deepEqual(seen, ['What does HTTP stand for?', 'Firewall', 'Router', 'Which port does DNS use?']);
    await win.waitForSelector('#cards-done:not([hidden])');
    assert.equal(await text('#cards-done-h'), 'All done for now');
    assert.equal(await text('#cards-done-big'), '5');
    assert.equal(await text('#cards-done-repeats'), '1');
  });

  await step('progress is saved, without the words of the cards', async () => {
    await win.click('#cards-back');
    await home();
    assert.deepEqual(await counts(), { total: '5', due: '0', fresh: '0' });
    assert.equal(await win.isDisabled('#cards-study'), true);
    assert.match(await text('#cards-note'), /Nothing is due today/);
    await new Promise((r) => setTimeout(r, 500));
    const raw = fs.readFileSync(path.join(profile, 'flashcards.json'), 'utf8');
    assert.ok(!/DNS|Firewall|addresses/.test(raw));
    const [entry] = Object.values(JSON.parse(raw));
    assert.equal(Object.keys(entry.items).length, 5);
  });

  await step('practice goes through everything and changes no dates', async () => {
    const before = JSON.stringify(progress());
    await win.click('#cards-practice');
    await win.waitForSelector('#cards-run:not([hidden])');
    await win.click('#cards-show');
    assert.equal(await visible('[data-name="hard"]'), false);
    assert.equal(await visible('[data-name="easy"]'), false);
    assert.equal(await text('[data-name="good"] small'), '');
    await win.keyboard.press('2');           // not on offer here
    assert.equal(await text('#cards-count'), '1 / 5');
    await win.keyboard.press('3');
    await win.waitForFunction(() => document.getElementById('cards-count').textContent === '2 / 5');
    await win.click('#cards-quit');
    await home();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(JSON.stringify(progress()), before);
  });

  await step('a quiz offers four answers, marks them, and keeps the score', async () => {
    await win.click('#cards-quiz');
    await win.waitForSelector('#cards-options:not([hidden])');
    assert.equal(await win.locator('.cards-option').count(), 4);
    assert.equal(await visible('#cards-show'), false);
    await problems('a quiz question');
    let right = 0;
    let wrong = 0;
    for (let i = 0; i < 5; i++) {
      await win.waitForFunction((n) => document.getElementById('cards-count').textContent.startsWith(`${n} `), i + 1);
      // Get the first one right and the rest wrong.
      const pick = await win.evaluate((want) => [...document.querySelectorAll('.cards-option')].findIndex((b) => b.dataset.right === String(want)), i === 0);
      await win.keyboard.press(String(pick + 1));
      await win.waitForSelector('#cards-next:not([hidden])');
      assert.equal(await win.locator('.cards-option.right').count(), 1);
      if (i === 0) { right++; assert.equal(await win.locator('.cards-option.wrong').count(), 0); } else { wrong++; assert.equal(await win.locator('.cards-option.wrong').count(), 1); }
      await win.keyboard.press('Enter');
    }
    await win.waitForSelector('#cards-done:not([hidden])');
    assert.equal(await text('#cards-done-big'), `${right} / 5`);
    assert.equal(await text('#cards-done-repeats'), String(wrong));
  });

  await step('the ones you missed can be practised straight away', async () => {
    await win.click('#cards-missed');
    await win.waitForSelector('#cards-run:not([hidden])');
    assert.equal(await text('#cards-count'), '1 / 4');
    await win.click('#cards-quit');
    await home();
  });

  await step('Go to Source shows the card in the document', async () => {
    await win.click('#cards-practice');
    await win.waitForSelector('#cards-run:not([hidden])');
    await win.click('#cards-source');
    await win.waitForFunction(() => !document.querySelector('#cards-dlg[open]'));
  });

  await step('the open folder is one deck, and a card’s document is named', async () => {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, docs);
    await menu('open-folder');
    await win.waitForFunction(() => document.querySelectorAll('.file-name').length >= 3);
    await open();
    assert.equal(await visible('#cards-scope-field'), true);
    await win.selectOption('#cards-scope', 'folder');
    await win.waitForFunction(() => document.getElementById('cards-total').textContent === '6');
    assert.equal(await text('#cards-new'), '1');
    assert.equal(await visible('#cards-draft'), false, 'AI drafts work from one document');
    await win.click('#cards-study');
    await win.waitForSelector('#cards-run:not([hidden])');
    assert.equal(await text('#cards-from'), path.join('more', 'extra.md'));
    await win.click('#cards-show');
    await win.keyboard.press('3');
    await win.waitForSelector('#cards-done:not([hidden])');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(Object.keys(progress()).length, 2);
    await close();
  });

  await step('a document with no cards starts with the folder’s, and says how to write them when there are none', async () => {
    await win.click('.file-name:has-text("plain")');
    await win.waitForFunction(() => /Nothing to learn/.test(document.querySelector('.page:not([hidden])').textContent));
    await open();
    await win.waitForFunction(() => document.getElementById('cards-total').textContent === '6');
    assert.equal(await win.inputValue('#cards-scope'), 'folder');
    await win.selectOption('#cards-scope', 'doc');
    await win.waitForSelector('#cards-empty:not([hidden])');
    assert.equal(await visible('#cards-study'), false);
    assert.equal(await visible('#cards-draft'), true);
  });

  await step('AI drafts cards from one chapter, and leaves out ones already there', async () => {
    await win.evaluate((url) => window.reader.aiConfigure({ enabled: true, provider: 'local', localUrl: url, model: 'small' }), `${base}/v1`);
    await win.click('#cards-draft');
    await win.waitForSelector('#cards-ai:not([hidden])');
    assert.deepEqual(await win.$$eval('#cards-ai-from option', (o) => o.map((x) => x.textContent)), ['The whole document', 'Part one', 'Part two']);
    await win.selectOption('#cards-ai-from', { label: 'Part one' });
    await win.selectOption('#cards-ai-count', '5');
    await win.click('#cards-ai-go');
    await win.waitForSelector('.cards-draft-row');
    assert.equal(requests.length, 1);
    const sent = JSON.stringify(requests[0]);
    assert.match(sent, /The sky is blue/);
    assert.doesNotMatch(sent, /Grass is green/, 'only the chapter you chose is sent');
    assert.match(sent, /up to 5 flashcards/);
    assert.equal(await win.locator('.cards-draft-row').count(), 2);
    await problems('the drafted cards');
  });

  await step('only the ticked cards go in, and nothing is saved until you save', async () => {
    await win.locator('.cards-draft-row input').nth(1).uncheck();
    await win.click('#cards-ai-add');
    await home();
    assert.equal(await text('#cards-note'), 'Added to the document. Save it to keep them.');
    assert.deepEqual(await counts(), { total: '1', due: '0', fresh: '1' });
    await close();
    const editor = await win.evaluate(() => document.querySelector('.cm-content').innerText);
    assert.match(editor, /## Flashcards/);
    assert.match(editor, /Q: What colour is the sky\?/);
    assert.doesNotMatch(editor, /Is it blue/);
    assert.doesNotMatch(fs.readFileSync(plain, 'utf8'), /Flashcards/);
  });

  await step('a reply with nothing new in it says so', async () => {
    reply = 'Q: What colour is the sky?\nA: Blue, as before';
    await open();
    await win.waitForFunction(() => document.getElementById('cards-total').textContent === '1');
    await win.click('#cards-draft');
    await win.waitForSelector('#cards-ai:not([hidden])');
    await win.click('#cards-ai-go');
    await win.waitForFunction(() => /No new cards/.test(document.getElementById('cards-ai-msg').textContent));
    assert.equal(await visible('#cards-ai-add'), false);
    reply = 'I can’t help with that.';
    const asked = requests.length;
    await win.click('#cards-ai-go');
    await win.waitForFunction(() => /No new cards/.test(document.getElementById('cards-ai-msg').textContent) && !document.getElementById('cards-ai-go').hidden);
    assert.equal(requests.length, asked + 1);
    await win.click('#cards-ai-back');
    await home();
    await close();
  });

  await step('a new document can be studied, but keeps no progress', async () => {
    const before = JSON.stringify(progress());
    await menu('new-doc');
    await win.waitForSelector('.cm-content:visible');
    await win.click('.cm-content:visible');
    await win.keyboard.insertText('Q: One?\nA: Yes\n\nQ: Two?\nA: No\n');
    await open();
    await win.selectOption('#cards-scope', 'doc');
    await win.waitForFunction(() => document.getElementById('cards-total').textContent === '2');
    assert.match(await text('#cards-note'), /Progress isn’t kept/);
    await win.click('#cards-study');
    await win.waitForSelector('#cards-run:not([hidden])');
    assert.equal(await visible('#cards-source'), false, 'it has no file to go to');
    await win.click('#cards-show');
    assert.equal(await visible('[data-name="hard"]'), false);
    await win.keyboard.press('3');
    await win.waitForFunction(() => document.getElementById('cards-count').textContent === '2 / 2');
    await close();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(JSON.stringify(progress()), before);
  });

  await step('no errors in the page', async () => { assert.deepEqual(errors, []); });

  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});     // a new document is still unsaved
  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* the app may still hold it for a moment */ }
  console.log(`${passed} steps passed`);
})().catch((err) => { console.error(err); process.exit(1); });
