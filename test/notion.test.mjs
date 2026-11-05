import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notion = require('../src/main/notion.js');
const {
  pageIdOf, splitBlocks, toMarkdown, fromMarkdown, planEdits, picturesIn, swapPictures, fileId, linkOf, withLink, splitTitle, asDocument, tableOf, align, createClient,
} = notion;

const ID = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d';
const BARE = ID.replace(/-/g, '');
const S3 = (file, sig) => `https://prod-files-secure.s3.us-west-2.amazonaws.com/aaaaaaaa-1111-4222-8333-444444444444/deadbeef-1111-4222-8333-444444444444/${file}?X-Amz-Signature=${sig}`;

test('a page is found in whatever you paste', () => {
  assert.equal(pageIdOf(ID), ID);
  assert.equal(pageIdOf(BARE), ID);
  assert.equal(pageIdOf(`https://www.notion.so/neo/My-Page-${BARE}`), ID);
  assert.equal(pageIdOf(`https://www.notion.so/${BARE}?v=abc`), ID);
  assert.equal(pageIdOf(`https://www.notion.so/other-11111111111111111111111111111111?p=${BARE}&pm=s`), ID);
  assert.equal(pageIdOf(`https://neo.notion.site/Page-${BARE}`), ID);
  assert.equal(pageIdOf(`https://evil.example/${BARE}`), null);
  assert.equal(pageIdOf('not a page'), null);
  assert.equal(pageIdOf(''), null);
});

test('blocks are cut at blank lines, but not inside code or tags', () => {
  const text = 'One\n\n```js\na\n\nb\n```\n\n<callout icon="💡">\nTitle\n\nChild\n</callout>\n\n- a\n\n  still a\n\nTwo';
  assert.deepEqual(splitBlocks(text).map((b) => b.raw), ['One', '```js\na\n\nb\n```', '<callout icon="💡">\nTitle\n\nChild\n</callout>', '- a\n\n  still a', 'Two']);
  for (const b of splitBlocks(text)) assert.equal(text.slice(b.start, b.end), b.raw);
});

test('tags on the next line are their own blocks, and code doesn’t count as a tag', () => {
  assert.deepEqual(splitBlocks('<page url="a">A</page>\n<page url="b">B</page>').map((b) => b.raw), ['<page url="a">A</page>', '<page url="b">B</page>']);
  assert.equal(splitBlocks('Use `<callout>` here\n\nNext').length, 2);
  assert.equal(splitBlocks('Write \\<callout> here\n\nNext').length, 2);
});

test('Notion’s words become Markdown marks', () => {
  assert.equal(toMarkdown('<b>bold</b>, <i>it</i>, <s>gone</s> and <code>a<b</code>'), '**bold**, *it*, ~~gone~~ and `a<b`');
  assert.equal(toMarkdown('<b><i>both</i></b>'), '***both***');
  assert.equal(toMarkdown('a<b> spaced </b>b'), 'a **spaced** b');
  assert.equal(toMarkdown('<span color="red">red</span> and <u>under</u>'), 'red and <u>under</u>');
  assert.equal(toMarkdown('line<br />next'), 'line\\\nnext');
  assert.equal(toMarkdown('See <mention url="https://notion.so/x">Plan</mention>'), 'See [Plan](https://notion.so/x)');
  assert.equal(toMarkdown('On <date start="2026-11-04" />'), 'On 2026-11-04');
  assert.equal(toMarkdown('`<b>kept</b>`'), '`<b>kept</b>`');
  assert.equal(toMarkdown('<code>a`b</code>'), '`` a`b ``');
});

test('Notion’s blocks become Markdown', () => {
  assert.equal(toMarkdown('<h2 color="red">Hi</h2>'), '## Hi');
  assert.equal(toMarkdown('<p color="red">Hi</p>\n\n<p />\n\nThere'), 'Hi\n\nThere');
  assert.equal(toMarkdown('<ul>\n<li color="red">a</li>\n<li>b</li>\n</ul>'), '- a\n- b');
  assert.equal(toMarkdown('<ol>\n<li>a</li>\n</ol>'), '1. a');
  assert.equal(toMarkdown('<todo checked="true" color="red">done</todo>'), '- [x] done');
  assert.equal(toMarkdown('<quote color="red">\nSaid\n\nMore\n</quote>'), '> Said\n>\n> More');
  assert.equal(toMarkdown('<equation>x + y</equation>'), '$$\nx + y\n$$');
  assert.equal(toMarkdown('<table-of-contents />\n\nText'), 'Text');
  assert.equal(toMarkdown('<columns>\n<column ratio="50">\nLeft\n</column>\n<column>\nRight\n</column>\n</columns>'), 'Left\n\nRight');
  assert.equal(toMarkdown('<unknown url="https://notion.so/b" alt="breadcrumb" />'), '[Notion block: breadcrumb](https://notion.so/b)');
});

test('callouts become alerts, keeping an icon of their own', () => {
  assert.equal(toMarkdown('<callout icon="💡" color="blue_bg">\nA tip\n</callout>'), '> [!TIP]\n> A tip');
  assert.equal(toMarkdown('<callout icon="📌">\nPinned\n</callout>'), '> [!NOTE]\n> 📌 Pinned');
});

test('toggles become details that open and close', () => {
  assert.equal(toMarkdown('<toggle heading="h2">\nMore\n\nInside\n</toggle>'), '<details><summary>More</summary>\n\nInside\n\n</details>');
  assert.equal(toMarkdown('<toggle>\nJust a title\n</toggle>'), '<details><summary>Just a title</summary>\n</details>');
});

test('styled tables become plain ones, with pipes in cells kept safe', () => {
  const table = '<table header-row="true">\n<colgroup><col color="red" /></colgroup>\n<tr>\n<th>A</th>\n<td color="green_bg">B</td>\n</tr>\n<tr>\n<td>1|2</td>\n<td><b>x</b><br />y</td>\n</tr>\n</table>';
  assert.equal(toMarkdown(table), '| A | B |\n| --- | --- |\n| 1\\|2 | **x**<br>y |');
  assert.equal(toMarkdown('| a |\n| --- |\n| b |'), '| a |\n| --- |\n| b |');
});

test('subpages, databases and files become links', () => {
  assert.equal(toMarkdown(`<page url="https://notion.so/${BARE}">Child</page>`), `[📄 Child](https://notion.so/${BARE})`);
  assert.equal(toMarkdown('<database url="https://notion.so/d" inline="true">Tasks</database>'), '[🗃️ Tasks](https://notion.so/d)');
  assert.equal(toMarkdown('<file source="https://x.test/a%20b.zip" />'), '[📎 a b.zip](https://x.test/a%20b.zip)');
  assert.equal(toMarkdown('<pdf source="https://x.test/a.pdf">Report</pdf>'), '[📄 Report](https://x.test/a.pdf)');
  assert.equal(toMarkdown('<bookmark source="https://x.test" />'), '[https://x.test](https://x.test)');
  assert.equal(toMarkdown('<image source="https://x.test/a.png">Cap</image>'), '![Cap](https://x.test/a.png)');
});

test('code comes through untouched', () => {
  const code = '```html\n<b>x</b>\n\n<callout>\n```';
  assert.equal(toMarkdown(code), code);
  assert.equal(fromMarkdown(code), code);
});

test('Markdown mostly passes straight through to Notion', () => {
  assert.equal(fromMarkdown('# Hi\n\n**Bold** and `code`\n\n| a |\n| --- |\n| b |'), '# Hi\n\n**Bold** and `code`\n\n| a |\n| --- |\n| b |');
  assert.equal(fromMarkdown('##### Small'), '#### Small');
  assert.equal(fromMarkdown('## Head\nText'), '## Head\n\nText');
});

test('alerts, details and page links go back as Notion’s own blocks', () => {
  assert.equal(fromMarkdown('> [!WARNING]\n> Careful'), '<callout icon="⚠️" color="yellow_bg">\nCareful\n</callout>');
  assert.equal(fromMarkdown('> [!NOTE]\n> 📌 Pinned'), '<callout icon="📌" color="blue_bg">\nPinned\n</callout>');
  assert.equal(fromMarkdown('<details><summary>More</summary>\n\nInside\n\n</details>'), '<toggle>\nMore\n\nInside\n</toggle>');
  assert.equal(fromMarkdown(`[📄 Child](https://notion.so/${BARE})`), `<page url="https://notion.so/${BARE}">Child</page>`);
  assert.equal(fromMarkdown('[📄 Report](https://x.test/a.pdf)'), '[📄 Report](https://x.test/a.pdf)');
});

test('pictures on your computer stay behind, and you’re told', () => {
  const notes = { pictures: 0, footnotes: 0 };
  assert.equal(fromMarkdown('![Cat](images/cat.png)\n\n![Web](https://x.test/a.png)', notes), '*(Picture left on your computer: Cat)*\n\n![Web](https://x.test/a.png)');
  assert.equal(notes.pictures, 1);
  fromMarkdown('Text[^1]\n\n[^1]: Note', notes);
  assert.equal(notes.footnotes, 1);
});

test('lining up two lists finds what stayed', () => {
  assert.deepEqual(align(['a', 'b', 'c'], ['a', 'c']), [['=', 0, 0], ['-', 1], ['=', 2, 1]]);
  assert.deepEqual(align(['a'], ['a', 'b']), [['=', 0, 0], ['+', 1]]);
  assert.deepEqual(align([], ['a']), [['+', 0]]);
});

test('nothing is sent when nothing changed, even where Notion and Markdown differ', () => {
  const nfm = '<callout icon="💡" color="red_bg">\n<b>Tip</b>\n</callout>\n\n<p color="red">Red words</p>\n\n<date start="2026-01-01" />';
  assert.equal(planEdits(nfm, toMarkdown(nfm)).changed, false);
});

test('only the block you changed is sent, and the rest keep their colours', () => {
  const nfm = '<p color="red">Keep me red</p>\n\nChange me\n\n<mention url="https://notion.so/a">Keep</mention>';
  const body = toMarkdown(nfm).replace('Change me', 'Changed');
  const plan = planEdits(nfm, body);
  assert.deepEqual(plan.edits, [{ old_str: 'Change me', new_str: 'Changed' }]);
  assert.ok(plan.whole.includes('<p color="red">Keep me red</p>'));
  assert.ok(plan.whole.includes('<mention url="https://notion.so/a">Keep</mention>'));
});

test('a new paragraph is added beside the block before it', () => {
  const plan = planEdits('One\n\nTwo', 'One\n\nNew\n\nTwo');
  assert.deepEqual(plan.edits, [{ old_str: 'One', new_str: 'One\n\nNew' }]);
  assert.equal(plan.whole, 'One\n\nNew\n\nTwo');
});

test('a new paragraph at the top goes before the first block', () => {
  const plan = planEdits('One\n\nTwo', 'New\n\nOne\n\nTwo');
  assert.deepEqual(plan.edits, [{ old_str: 'One', new_str: 'New\n\nOne' }]);
  assert.equal(plan.whole, 'New\n\nOne\n\nTwo');
});

test('a removed paragraph is removed', () => {
  const plan = planEdits('One\n\nGone\n\nTwo', 'One\n\nTwo');
  assert.deepEqual(plan.edits, [{ old_str: 'Gone', new_str: '' }]);
  assert.equal(plan.whole, 'One\n\nTwo');
});

test('an edit that could match twice takes its neighbours, so it matches once', () => {
  const plan = planEdits('Top\n\nSame\n\nMid\n\nSame\n\nEnd', 'Top\n\nSame\n\nMid\n\nNew\n\nEnd');
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].old_str, 'Mid\n\nSame\n\nEnd');
  assert.equal(plan.edits[0].new_str, 'Mid\n\nNew\n\nEnd');
});

test('an edit never matches inside a longer block by accident', () => {
  const plan = planEdits('Same again here\n\nSame', 'Same again here\n\nOther');
  const { old_str: old } = plan.edits[0];
  assert.equal('Same again here\n\nSame'.split(old).length, 2);
});

test('edits that would overlap fall back to the whole page, which keeps the rest', () => {
  const plan = planEdits('A\n\nA\n\nB\n\nA\n\nA', 'X\n\nA\n\nB\n\nA\n\nY');
  assert.equal(plan.changed, true);
  if (plan.edits === null) assert.equal(plan.whole, 'X\n\nA\n\nB\n\nA\n\nY');
  else {
    let page = 'A\n\nA\n\nB\n\nA\n\nA';
    for (const e of plan.edits) {
      assert.equal(page.split(e.old_str).length, 2, e.old_str);
      page = page.replace(e.old_str, e.new_str);
    }
    assert.equal(page, 'X\n\nA\n\nB\n\nA\n\nY');
  }
});

test('an empty page is filled whole', () => {
  const plan = planEdits('', 'First words');
  assert.equal(plan.edits, null);
  assert.equal(plan.whole, 'First words');
});

test('blocks with nothing to show survive an edit next to them', () => {
  const plan = planEdits('One\n\n<table-of-contents />\n\nTwo', 'Changed\n\nAlso changed');
  assert.ok(plan.whole.includes('<table-of-contents />'));
  assert.equal(planEdits('One\n\n<table-of-contents />\n\nTwo', 'One\n\nTwo').changed, false);
});

test('whatever is changed, Notion ends up with what you wrote', () => {
  let seed = 12345;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pool = ['One', 'Two', 'Same', 'Same', '<p color="red">Red</p>', '<table-of-contents />', '<callout icon="💡">\nTip\n</callout>', '```js\nx\n\ny\n```', '- a\n- b', '<b>Bold</b> words', '<columns>\n<column>\nL\n</column>\n<column>\nR\n</column>\n</columns>'];
  const fresh = ['New', 'Same', 'Other words', '## Head', 'Two'];
  for (let round = 0; round < 3000; round++) {
    const page = Array.from({ length: rand(8) }, () => pool[rand(pool.length)]).join('\n\n');
    const parts = splitBlocks(toMarkdown(page)).map((b) => b.raw);
    for (let k = rand(4); k > 0; k--) {
      const at = rand(parts.length + 1);
      const what = rand(3);
      if (what === 0) parts.splice(at, 0, fresh[rand(fresh.length)]);
      else if (what === 1) parts.splice(at, 1);
      else if (at < parts.length) parts[at] = fresh[rand(fresh.length)];
    }
    const body = parts.join('\n\n');
    const plan = planEdits(page, body);
    if (!plan.changed) { assert.equal(toMarkdown(page), body, page); continue; }
    let result = plan.whole;
    if (plan.edits) {
      result = page;
      for (const e of plan.edits) {
        assert.equal(result.split(e.old_str).length, 2, `${JSON.stringify(e.old_str)} in ${JSON.stringify(result)}`);
        result = result.replace(e.old_str, () => e.new_str);
      }
    }
    assert.equal(toMarkdown(result), toMarkdown(plan.whole), JSON.stringify({ page, body }));
    assert.equal(toMarkdown(result), body, JSON.stringify({ page, body, result }));
  }
});

test('a subpage whose link you removed is asked for, so Notion can refuse', () => {
  const nfm = `One\n\n<page url="https://notion.so/${BARE}">Child</page>\n\nTwo`;
  const plan = planEdits(nfm, 'One\n\nTwo');
  assert.equal(plan.changed, true);
  assert.equal(plan.edits[0].old_str, `<page url="https://notion.so/${BARE}">Child</page>`);
});

test('a subpage link you kept stays a subpage', () => {
  const nfm = `One\n\n<page url="https://notion.so/${BARE}">Child</page>`;
  const body = toMarkdown(nfm).replace('One', 'Two');
  const plan = planEdits(nfm, body);
  assert.ok(plan.whole.includes(`<page url="https://notion.so/${BARE}">Child</page>`));
  assert.deepEqual(plan.edits, [{ old_str: 'One', new_str: 'Two' }]);
});

test('a block that became several parts is replaced whole when one part changes', () => {
  const nfm = 'Top\n\n<columns>\n<column>\nLeft\n</column>\n<column>\nRight\n</column>\n</columns>';
  const plan = planEdits(nfm, 'Top\n\nLeft\n\nRight edited');
  assert.equal(plan.edits.length, 1);
  assert.ok(plan.edits[0].old_str.startsWith('<columns>'));
  assert.equal(plan.edits[0].new_str, 'Left\n\nRight edited');
});

test('a Notion picture is the same picture, whatever link it comes with', () => {
  const first = `![Cat](${S3('cat.png', 'aaa')})`;
  const later = `![Cat](${S3('cat.png', 'bbb')})`;
  assert.equal(planEdits(later, first).changed, false);
  assert.equal(planEdits(later, '![Cat](images/notion-deadbeef-cat.png)').changed, false);
  assert.equal(planEdits(later, '![Cat](images/other.png)').changed, true);
});

test('a Notion file link is the same file, whatever signature it has', () => {
  const nfm = `<file source="${S3('a.zip', 'bbb')}">Zip</file>`;
  assert.equal(planEdits(nfm, `[📎 Zip](${S3('a.zip', 'aaa')})`).changed, false);
});

test('pictures on Notion are found and swapped for your copies', () => {
  const url = S3('cat.png', 'aaa');
  const md = `![Cat](${url})\n\n![Web](https://x.test/a.png)\n\n![Again](${url})`;
  const found = picturesIn(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'deadbeef');
  assert.equal(found[0].name, 'cat.png');
  assert.equal(swapPictures(md, new Map([[url, 'images/notion-deadbeef-cat.png']])), '![Cat](images/notion-deadbeef-cat.png)\n\n![Web](https://x.test/a.png)\n\n![Again](images/notion-deadbeef-cat.png)');
  assert.equal(fileId('https://x.test/deadbeef-1111/a.png'), null);
});

test('pictures are copied once, and one that can’t be copied keeps its link', async () => {
  const good = S3('cat.png', 'aaa');
  const bad = good.replace('deadbeef', 'cafebabe').replace('cat.png', 'dog.png');
  const have = S3('old.png', 'aaa').replace('deadbeef', 'abcdef12');
  const saved = [];
  const fetched = [];
  const res = await notion.keepPictures(`![a](${good})\n\n![b](${bad})\n\n![c](${have})`, {
    fetch: async (url, init) => { fetched.push({ url, init }); return new Response('bytes', { status: url === bad ? 403 : 200 }); },
    save: async (p) => { saved.push(p.name); return { ok: true, rel: `images/${p.name}` }; },
    have: (id) => (id === 'abcdef12' ? 'images/notion-abcdef12-old.png' : null),
  });
  assert.deepEqual(saved, ['notion-deadbeef-cat.png']);
  assert.equal(res.missed, 1);
  assert.equal(res.md, `![a](images/notion-deadbeef-cat.png)\n\n![b](${bad})\n\n![c](images/notion-abcdef12-old.png)`);
  assert.ok(fetched.every((f) => !f.init.headers), 'your key never goes to the picture’s host');
});

test('a document’s link lives in its front matter', () => {
  assert.equal(linkOf(`---\nnotion: https://notion.so/${BARE}\n---\n\nText`), ID);
  assert.equal(linkOf(`---\ntitle: X\nnotion: "${ID}"\n---\n`), ID);
  assert.equal(linkOf(`notion: ${ID}`), null);
  assert.equal(linkOf('---\nnotion: https://evil.example/x\n---\n'), null);
});

test('adding a link keeps everything else as it was', () => {
  assert.equal(withLink('Text', 'U'), '---\nnotion: U\n---\n\nText');
  assert.equal(withLink('---\ntitle: X\n---\n\nText', 'U'), '---\ntitle: X\nnotion: U\n---\n\nText');
  assert.equal(withLink('---\nnotion: old\ntitle: X\n---\nText', 'U'), '---\nnotion: U\ntitle: X\n---\nText');
  assert.equal(withLink('---\r\ntitle: X\r\n---\r\nText', 'U'), '---\r\ntitle: X\r\nnotion: U\r\n---\r\nText');
});

test('the title comes off the top of a document', () => {
  assert.deepEqual(splitTitle('# Hello\n\nBody'), { title: 'Hello', rest: 'Body' });
  assert.deepEqual(splitTitle('Body\n\n# Later'), { title: '', rest: 'Body\n\n# Later' });
  assert.deepEqual(splitTitle('# Only'), { title: 'Only', rest: '' });
  assert.equal(asDocument('Hi', 'Body'), '# Hi\n\nBody');
  assert.equal(asDocument('Hi', ''), '# Hi');
});

test('a database becomes a table, title first', () => {
  const source = { properties: { Done: { type: 'checkbox' }, Name: { type: 'title' }, Tags: { type: 'multi_select' }, Due: { type: 'date' }, Total: { type: 'formula' } } };
  const rows = [{
    url: 'https://notion.so/r',
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'A|B' }] },
      Done: { type: 'checkbox', checkbox: true },
      Tags: { type: 'multi_select', multi_select: [{ name: 'x' }, { name: 'y' }] },
      Due: { type: 'date', date: { start: '2026-01-01', end: '2026-01-02' } },
      Total: { type: 'formula', formula: { type: 'number', number: 7 } },
    },
  }];
  assert.equal(tableOf({ source, rows }), '| Name | Done | Tags | Due | Total |\n| --- | --- | --- | --- | --- |\n| [A\\|B](https://notion.so/r) | ✓ | x, y | 2026-01-01 to 2026-01-02 | 7 |');
});

const reply = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

test('requests carry the key, the version and Notion’s newer Markdown', async () => {
  const { fetch, calls } = fakeFetch([reply(200, { markdown: 'Hi', truncated: false, unknown_block_ids: ['x'] })]);
  const client = createClient({ fetch, token: 'k' });
  const res = await client.content(ID);
  assert.deepEqual(res, { markdown: 'Hi', truncated: false, unknown: 1 });
  assert.equal(calls[0].url, `https://api.notion.com/v1/pages/${ID}/markdown?markdown_version=v2`);
  assert.equal(calls[0].headers.authorization, 'Bearer k');
  assert.equal(calls[0].headers['notion-version'], notion.VERSION);
  assert.equal(calls[0].redirect, 'error');
});

test('changes never allow deleting subpages', async () => {
  const { fetch, calls } = fakeFetch([reply(200, {}), reply(200, {})]);
  const client = createClient({ fetch, token: 'k' });
  await client.edit(ID, { edits: [{ old_str: 'a', new_str: 'b' }] });
  await client.edit(ID, { edits: null, whole: 'all' });
  assert.equal(calls[0].body.update_content.allow_deleting_content, false);
  assert.equal(calls[0].body.markdown_version, 'v2');
  assert.equal(calls[1].body.replace_content.allow_deleting_content, false);
  assert.equal(calls[1].body.replace_content.new_str, 'all');
});

test('edits Notion couldn’t place are counted', async () => {
  const { fetch } = fakeFetch([reply(200, { warnings: [{ code: 'no_match' }, { code: 'html_tag_autofix' }, { code: 'indentation_mismatch' }] })]);
  assert.equal(await createClient({ fetch, token: 'k' }).edit(ID, { edits: [] }), 2);
});

test('a busy Notion is waited for, as long as it asks', async () => {
  const waits = [];
  const { fetch, calls } = fakeFetch([reply(429, {}, { 'retry-after': '5' }), reply(529, {}), reply(200, { name: 'Reader', bot: { workspace_name: 'Neo' } })]);
  const client = createClient({ fetch, token: 'k', wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await client.me(), { name: 'Reader', workspace: 'Neo' });
  assert.deepEqual(waits, [5000, 2000]);
  assert.equal(calls.length, 3);
});

test('refusals are said plainly', async () => {
  const says = async (status, body) => {
    const { fetch } = fakeFetch([reply(status, body)]);
    return createClient({ fetch, token: 'k', wait: async () => {} }).meta(ID).catch((e) => e);
  };
  assert.equal((await says(401, { code: 'unauthorized' })).code, 'key');
  assert.match((await says(404, { code: 'object_not_found' })).message, /Connections/);
  assert.equal((await says(403, { code: 'restricted_resource' })).code, 'restricted');
  assert.equal((await says(400, { code: 'validation_error', message: 'Would delete child page X; set allow_deleting_content' })).code, 'would_delete');
  assert.equal((await says(504, 'bad gateway')).code, 'timeout');
  const { fetch } = fakeFetch([new Error('down')]);
  assert.equal((await createClient({ fetch, token: 'k' }).me().catch((e) => e)).code, 'offline');
});

test('search keeps pages and databases, and leaves out the trash', async () => {
  const { fetch, calls } = fakeFetch([reply(200, {
    results: [
      { object: 'page', id: 'p', url: 'u', last_edited_time: 't', properties: { Name: { type: 'title', title: [{ plain_text: 'Plan' }] } } },
      { object: 'data_source', id: 'd', title: [{ plain_text: 'Tasks' }] },
      { object: 'page', id: 'gone', in_trash: true, properties: {} },
      { object: 'page', id: 'partial' },
    ],
  })]);
  const found = await createClient({ fetch, token: 'k' }).search('');
  assert.deepEqual(found.map((f) => [f.kind, f.title]), [['page', 'Plan'], ['database', 'Tasks']]);
  assert.equal(calls[0].body.sort.timestamp, 'last_edited_time');
});

test('a database’s rows are gathered page by page', async () => {
  const { fetch, calls } = fakeFetch([
    reply(200, { data_sources: [{ id: 'ds' }] }),
    reply(200, { title: [{ plain_text: 'Tasks' }], properties: {} }),
    reply(200, { results: [{ object: 'page', id: '1' }], has_more: true, next_cursor: 'c' }),
    reply(200, { results: [{ object: 'page', id: '2' }], has_more: false }),
  ]);
  const res = await createClient({ fetch, token: 'k' }).rows('db');
  assert.equal(res.title, 'Tasks');
  assert.equal(res.rows.length, 2);
  assert.equal(calls[3].body.start_cursor, 'c');
});

test('a new page takes its title from you', async () => {
  const { fetch, calls } = fakeFetch([reply(200, { id: 'n', url: 'u', last_edited_time: 't' })]);
  await createClient({ fetch, token: 'k' }).create({ parent: ID, title: 'Doc', markdown: 'Body' });
  assert.deepEqual(calls[0].body.parent, { page_id: ID });
  assert.equal(calls[0].body.properties.title.title[0].text.content, 'Doc');
  assert.equal(calls[0].body.markdown_version, 'v2');
});
