// v2.3 "Connected notes": wiki links, backlinks, the link map, tags, tasks, the link checker,
// renaming with link updates and asking Claude about a folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/renderer/markdown.js';

const require = createRequire(import.meta.url);
const core = require('../src/main/notes-core.js');
const { FolderIndex } = require('../src/main/folder-index.js');
const ai = require('../src/main/ai.js');
const render = createRenderer(new JSDOM('<!doctype html><html><body></body></html>').window);

const files = (list) => list.map((p) => ({ path: p, rel: p.replace(/^\/f\//, '') }));

test('wiki link targets: name, #heading and |label', () => {
  assert.deepEqual(core.parseWikiTarget('Plan'), { name: 'Plan', heading: '', label: '' });
  assert.deepEqual(core.parseWikiTarget('Plan#Next steps|the plan'), { name: 'Plan', heading: 'Next steps', label: 'the plan' });
  assert.deepEqual(core.parseWikiTarget('#Budget'), { name: '', heading: 'Budget', label: '' });
});

test('extract finds headings, wiki and Markdown links, tags and tasks — not inside code', () => {
  const text = [
    '---', 'title: Weekly', 'tags: [work, Planning]', '---',
    '# Weekly', '', 'See [[Plan]] and [[Budget#Q3|the budget]] and [notes](notes/a.md#top).',
    '![chart](img/chart.png) and https://example.com #idea', '',
    '- [ ] Call Sam 📅 2026-11-03', '- [x] Send minutes due: 2026-10-30', '- [ ] ', '* [ ] Undated',
    '', '```', '[[NotALink]] #nottag', '- [ ] not a task either?', '```', '', 'Inline `[[Nope]]` code.', '# Weekly',
  ].join('\n');
  const d = core.extract(text);
  assert.equal(d.title, 'Weekly');
  assert.deepEqual(d.headings.map((h) => h.slug), ['weekly', 'weekly-1']);
  assert.deepEqual(d.wiki.map((w) => [w.name, w.heading, w.label, w.line]), [['Plan', '', '', 6], ['Budget', 'Q3', 'the budget', 6]]);
  assert.deepEqual(d.links.map((l) => [l.target, l.image]), [['notes/a.md#top', false], ['img/chart.png', true]]);
  assert.deepEqual(d.tags.map((t) => t.tag).sort(), ['Planning', 'idea', 'work']);
  const tasks = d.tasks.filter((t) => t.line < 14);
  assert.deepEqual(tasks.map((t) => [t.text, t.done, t.due]), [
    ['Call Sam 📅 2026-11-03', false, '2026-11-03'], ['Send minutes due: 2026-10-30', true, '2026-10-30'], ['Undated', false, ''],
  ]);
  assert.ok(!d.wiki.some((w) => /Not|Nope/.test(w.name)), 'code is skipped');
  assert.ok(!d.tags.some((t) => t.tag === 'nottag'));
});

test('resolveWiki: by file name, same folder first, then the shallowest; paths too', () => {
  const list = files(['/f/Plan.md', '/f/work/Plan.md', '/f/work/deep/Plan.md', '/f/notes/Budget.markdown', '/f/a/b/Ideas.md']);
  assert.equal(core.resolveWiki('Plan', list, '/f/work/x.md'), '/f/work/Plan.md');
  assert.equal(core.resolveWiki('plan', list, '/f/other/x.md'), '/f/Plan.md');
  assert.equal(core.resolveWiki('Budget', list, '/f/x.md'), '/f/notes/Budget.markdown');
  assert.equal(core.resolveWiki('work/deep/Plan', list, '/f/x.md'), '/f/work/deep/Plan.md');
  assert.equal(core.resolveWiki('Ideas.md', list, '/f/x.md'), '/f/a/b/Ideas.md');
  assert.equal(core.resolveWiki('Missing', list, '/f/x.md'), null);
});

test('backlinks, link map and tag summary across a folder', () => {
  const list = files(['/f/a.md', '/f/b.md', '/f/c.md', '/f/lonely.md']);
  const docs = new Map([
    ['/f/a.md', core.extract('# A\n\nSee [[b]] and [[c]]. #x\n')],
    ['/f/b.md', core.extract('# B\n\nBack to [A](a.md) and [[b#B]]. #x #y\n')],
    ['/f/c.md', core.extract('# C\n\n[[a]] again\n')],
    ['/f/lonely.md', core.extract('# Lonely\n')],
  ]);
  const links = core.allLinks(docs, list);
  const back = core.backlinks(links, '/f/a.md', (p, l) => `${p}:${l}`);
  assert.deepEqual(back.map((b) => b.from).sort(), ['/f/b.md', '/f/c.md']);
  assert.deepEqual(core.backlinks(links, '/f/b.md', () => '').map((b) => b.from), ['/f/a.md'], 'a link to itself isn’t a backlink');
  const g = core.graph(links, list);
  assert.equal(g.edges.length, 2, 'a↔b and a↔c, each counted once');
  assert.equal(g.nodes.find((n) => n.name === 'lonely').degree, 0);
  assert.equal(g.nodes.find((n) => n.name === 'a').degree, 2);
  assert.deepEqual(core.tagSummary(docs).map((t) => [t.tag, t.files.length]), [['x', 2], ['y', 1]]);
});

test('tasks come in the order to do them', () => {
  const docs = new Map([
    ['/f/a.md', core.extract('- [ ] later 📅 2026-12-01\n- [ ] no date\n- [x] done 📅 2026-01-01\n')],
    ['/f/b.md', core.extract('- [ ] today @due(2026-11-02)\n- [ ] late due: 2026-10-01\n')],
  ]);
  assert.deepEqual(core.taskList(docs, '2026-11-02').map((t) => t.text.split(' ')[0]), ['late', 'today', 'later', 'no', 'done']);
});

test('the link checker finds missing documents, headings, pictures and files', () => {
  const list = files(['/f/a.md', '/f/b.md']);
  const docs = new Map([
    ['/f/a.md', core.extract('# A\n\n## Real\n\n[[b]] [[b#Gone]] [[nobody]] [x](b.md#b) [y](b.md#nope) [z](#real) [w](#missing)\n\n![p](pic.png) [f](spec.pdf) [ok](https://x.y)\n')],
    ['/f/b.md', core.extract('# B\n')],
  ]);
  const problems = core.checkLinks(docs, list, (p) => p === '/f/spec.pdf');
  const kinds = problems.map((p) => `${p.kind}:${p.target}`).sort();
  assert.deepEqual(kinds, ['document:[[nobody]]', 'heading:#missing', 'heading:[[b#Gone]]', 'heading:b.md#nope', 'image:pic.png']);
  assert.ok(problems.every((p) => p.path === '/f/a.md' && [4, 6].includes(p.line)));
});

test('renaming rewrites [[links]] and [links](paths), keeping headings and labels', () => {
  const list = files(['/f/notes/Plan.md', '/f/x.md', '/f/notes/y.md']);
  const text = 'See [[Plan]], [[Plan#Goals|our goals]], [[notes/Plan]], [plan](notes/Plan.md#goals) and [[Other]].\n`[[Plan]]` stays.\n';
  const out = core.retargetLinks(text, '/f/x.md', '/f/notes/Plan.md', '/f/notes/Roadmap 2027.md', list);
  assert.equal(out.count, 4);
  assert.match(out.text, /\[\[Roadmap 2027\]\]/);
  assert.match(out.text, /\[\[Roadmap 2027#Goals\|our goals\]\]/);
  assert.match(out.text, /\[plan\]\(notes\/Roadmap%202027\.md#goals\)/);
  assert.match(out.text, /\[\[Other\]\]/);
  assert.match(out.text, /`\[\[Plan\]\]` stays/, 'code is left alone');
  const near = core.retargetLinks('[up](Plan.md)', '/f/notes/y.md', '/f/notes/Plan.md', '/f/archive/Plan.md', list);
  assert.equal(near.text, '[up](../archive/Plan.md)');
});

test('the folder index re-reads only changed files and skips locked ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmr-notes-'));
  const a = join(dir, 'a.md');
  const b = join(dir, 'b.md');
  const locked = join(dir, 'secret.mdlock');
  writeFileSync(a, '# A\n\n- [ ] Write the [[b]] page #todo\n');
  writeFileSync(b, '# B\n\nNothing yet.\n');
  writeFileSync(locked, 'NMRLOCK');
  mkdirSync(join(dir, 'sub'));
  const idx = new FolderIndex();
  await idx.update({ root: dir, files: [a, b, locked] });
  assert.equal(idx.cache.has(locked), false);
  assert.deepEqual(idx.backlinks(b).map((x) => [x.rel, x.title, x.context]), [['a.md', 'A', '[ ] Write the [[b]] page #todo']]);
  assert.deepEqual(idx.tags().map((t) => t.tag), ['todo']);
  assert.equal(idx.tasks('2026-11-02')[0].rel, 'a.md');
  const before = idx.cache.get(a);
  writeFileSync(b, '# B\n\nNow links [[a]].\n');
  utimesSync(b, new Date(), new Date(Date.now() + 5000));
  await idx.update({ root: dir, files: [a, b] });
  assert.equal(idx.cache.get(a), before, 'unchanged file kept');
  assert.equal(idx.backlinks(a).length, 1);
  const moved = idx.retarget(b, join(dir, 'sub', 'b.md'));
  assert.equal(moved.length, 1);
  assert.match(moved[0].text, /\[\[b\]\]/, 'the name is unchanged, so [[b]] still finds it');
});

test('[[links]] render as links: found, missing and to a heading', () => {
  const wiki = (w) => (w.name === 'Plan' ? { href: `plan.md${w.heading ? '#goals' : ''}`, missing: false } : { href: `${w.name}.md`, missing: true });
  const { html } = render('See [[Plan]], [[Plan#Goals|our goals]] and [[Later]]. `[[code]]`', { wiki });
  assert.match(html, /<a href="plan\.md" class="wikilink" data-wiki="Plan">Plan<\/a>/);
  assert.match(html, /<a href="plan\.md#goals" class="wikilink" data-wiki="Plan">our goals<\/a>/);
  assert.match(html, /<a href="Later\.md" class="wikilink wikilink-missing" data-wiki="Later" title="[^"]*create it">Later<\/a>/);
  assert.match(html, /<code>\[\[code\]\]<\/code>/);
  const plain = render('[[My Plan#Next steps]]').html;
  assert.match(plain, /href="My%20Plan\.md#next-steps"/);
  assert.match(plain, />My Plan › Next steps</);
});

test('asking about a folder numbers the lines, wraps each document and asks for [path:line] citations', () => {
  const prompt = ai.buildFolderPrompt('What is due?', [{ rel: 'a.md', text: '# A\n- [ ] Pay rent' }, { rel: 'sub/"b".md', text: 'two' }, { rel: 'empty.md', text: '  ' }]);
  assert.match(prompt, /<document path="a\.md">\n1\| # A\n2\| - \[ \] Pay rent\n<\/document>/);
  assert.match(prompt, /<document path="sub\/&quot;b&quot;\.md">/);
  assert.doesNotMatch(prompt, /empty\.md/);
  assert.match(prompt, /<question>\nWhat is due\?\n<\/question>/);
  assert.match(prompt, /\[path:line\]/);
  assert.throws(() => ai.buildFolderPrompt('  ', [{ rel: 'a.md', text: 'x' }]), /Type a question/);
  assert.throws(() => ai.buildFolderPrompt('Q', [{ rel: 'a.md', text: 'x'.repeat(ai.MAX_CHARS + 10) }]), /too long/);
});
