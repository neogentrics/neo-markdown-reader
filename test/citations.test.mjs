// Tests for 3.6 citations: reading sources, each style's citations and reference lists, and the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/renderer/markdown.js';
import { STYLES, styleKey, parseItems, assign, listOrder, refId, searchSources, pickerLine } from '../src/renderer/citations.js';
import { bibliographyOf, citationText } from '../src/renderer/cite-ui.js';

const require = createRequire(import.meta.url);
const { parseBibtex, parseCslJson, parseZotero, fetchZotero, parseFile, isBibPath, fromLatex, parseName, parseDate } = require('../src/main/bibliography.js');

const render = createRenderer(new JSDOM('').window);
const plain = (html) => html.replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1');

const article = {
  id: 'smith2020', type: 'article', title: 'Title of paper', author: [{ family: 'Smith', given: 'John A.' }, { family: 'Jones', given: 'Bob' }],
  year: '2020', month: 3, container: 'Journal of Testing', volume: '12', issue: '3', pages: '45–67', doi: '10.1000/xyz',
};
const book = { id: 'smith2019', type: 'book', title: 'A book', author: [{ family: 'Smith', given: 'John A.' }], year: '2019', publisher: 'Big Press', place: 'New York', edition: '2' };
const chapter = {
  id: 'lee2018', type: 'chapter', title: 'A chapter', author: [{ family: 'Lee', given: 'Kim' }], editor: [{ family: 'Ross', given: 'Mary' }, { family: 'Wu', given: 'Tom' }],
  year: '2018', container: 'Collected works', pages: '10–20', publisher: 'Big Press',
};
const thesis = { id: 'kay2021', type: 'thesis', title: 'A long study', author: [{ family: 'Kay', given: 'Ann' }], year: '2021', school: 'UTSA', genre: 'phd' };
const web = { id: 'site2022', type: 'web', title: 'A page', author: [{ literal: 'World Health Organization' }], year: '2022', month: 5, day: 4, container: 'WHO', url: 'https://example.org/a' };
const many = { id: 'many2020', type: 'article', title: 'Team paper', author: 'ABCDEFGH'.split('').map((c) => ({ family: `Name${c}`, given: c })), year: '2020', container: 'J' };
const nobody = { id: 'anon', type: 'book', title: 'A book with no named author at all', publisher: 'Press' };

const ref = (key, e) => { const s = STYLES[key]; return plain(s.reference(e, { suffix: '' })); };

test('APA references', () => {
  assert.equal(ref('apa', article), 'Smith, J. A., &amp; Jones, B. (2020). Title of paper. <i>Journal of Testing</i>, <i>12</i>(3), 45–67. https://doi.org/10.1000/xyz');
  assert.equal(ref('apa', book), 'Smith, J. A. (2019). <i>A book</i> (2nd ed.). Big Press.');
  assert.equal(ref('apa', chapter), 'Lee, K. (2018). A chapter. In M. Ross &amp; T. Wu (Eds.), <i>Collected works</i> (pp. 10–20). Big Press.');
  assert.equal(ref('apa', thesis), 'Kay, A. (2021). <i>A long study</i> [Doctoral dissertation, UTSA].');
  assert.equal(ref('apa', web), 'World Health Organization. (2022, May 4). <i>A page</i>. WHO. https://example.org/a');
  assert.equal(ref('apa', nobody), '<i>A book with no named author at all</i>. (n.d.). Press.');
});

test('MLA references', () => {
  assert.equal(ref('mla', article), 'Smith, John A., and Bob Jones. “Title of paper.” <i>Journal of Testing</i>, vol. 12, no. 3, Mar. 2020, pp. 45–67, https://doi.org/10.1000/xyz.');
  assert.equal(ref('mla', book), 'Smith, John A. <i>A book</i>. 2nd ed., Big Press, 2019.');
  assert.equal(ref('mla', chapter), 'Lee, Kim. “A chapter.” <i>Collected works</i>, edited by Mary Ross and Tom Wu, Big Press, 2018, pp. 10–20.');
  assert.equal(ref('mla', thesis), 'Kay, Ann. <i>A long study</i>. 2021. UTSA, PhD dissertation.');
  assert.equal(ref('mla', web), 'World Health Organization. “A page.” <i>WHO</i>, 4 May 2022, https://example.org/a.');
  assert.match(ref('mla', many), /^NameA, A, et al\. /);
});

test('Chicago references', () => {
  assert.equal(ref('chicago', article), 'Smith, John A., and Bob Jones. 2020. “Title of paper.” <i>Journal of Testing</i> 12 (3): 45–67. https://doi.org/10.1000/xyz.');
  assert.equal(ref('chicago', book), 'Smith, John A. 2019. <i>A book</i>. 2nd ed. Big Press.');
  assert.equal(ref('chicago', chapter), 'Lee, Kim. 2018. “A chapter.” In <i>Collected works</i>, edited by Mary Ross and Tom Wu, 10–20. Big Press.');
  assert.equal(ref('chicago', thesis), 'Kay, Ann. 2021. “A long study.” PhD diss., UTSA.');
  assert.equal(ref('chicago', web), 'World Health Organization. 2022. “A page.” WHO. May 4, 2022. https://example.org/a.');
  assert.match(ref('chicago', many), /^NameA, A, B NameB, C NameC, et al\. 2020\./);
});

test('IEEE references', () => {
  assert.equal(ref('ieee', article), 'J. A. Smith and B. Jones, “Title of paper,” <i>Journal of Testing</i>, vol. 12, no. 3, pp. 45–67, Mar. 2020, doi: 10.1000/xyz.');
  assert.equal(ref('ieee', book), 'J. A. Smith, <i>A book</i>, 2nd ed. New York: Big Press, 2019.');
  assert.equal(ref('ieee', chapter), 'K. Lee, “A chapter,” in <i>Collected works</i>, M. Ross and T. Wu, Eds., Big Press, 2018, pp. 10–20.');
  assert.equal(ref('ieee', thesis), 'A. Kay, “A long study,” Ph.D. dissertation, UTSA, 2021.');
  assert.match(ref('ieee', many), /^A\. NameA et al\., /);
});

test('Harvard references', () => {
  assert.equal(ref('harvard', article), 'Smith, J.A. and Jones, B. (2020) ‘Title of paper’, <i>Journal of Testing</i>, 12(3), pp. 45–67. doi:10.1000/xyz.');
  assert.equal(ref('harvard', book), 'Smith, J.A. (2019) <i>A book</i>. 2nd edn. New York: Big Press.');
  assert.equal(ref('harvard', chapter), 'Lee, K. (2018) ‘A chapter’, in Ross, M. and Wu, T. (eds.) <i>Collected works</i>. Big Press, pp. 10–20.');
});

test('a question mark in a title takes the place of the full stop', () => {
  const asked = { ...article, title: 'Does it work?' };
  assert.match(ref('mla', asked), /“Does it work\?” <i>/);
  assert.match(ref('apa', asked), /Does it work\? <i>/);
});

test('names run to the limit each style sets', () => {
  const people = (n) => ({ ...article, author: Array.from({ length: n }, (_, i) => ({ family: `N${i + 1}`, given: 'A' })) });
  const apa21 = ref('apa', people(21));
  assert.match(apa21, /N19, A\., … N21, A\. \(2020\)/);
  assert.doesNotMatch(apa21, /N20/);
  assert.match(ref('apa', people(20)), /N19, A\., &amp; N20, A\. \(2020\)/);
  assert.match(ref('chicago', people(6)), /and A N6\. 2020/);
  assert.match(ref('ieee', people(6)), /A\. N5 and A\. N6,|A\. N5, and A\. N6,/);
});

test('in-text citations in each style', () => {
  const cite = (key, e, o = {}) => STYLES[key].cite(e, { suffix: '', number: 1, locator: '', suppress: false, ...o });
  assert.equal(cite('apa', article), 'Smith &amp; Jones, 2020');
  assert.equal(cite('apa', article, { locator: '12' }), 'Smith &amp; Jones, 2020, p. 12');
  assert.equal(cite('apa', article, { locator: '12-14' }), 'Smith &amp; Jones, 2020, pp. 12–14');
  assert.equal(cite('apa', article, { locator: 'chap. 3' }), 'Smith &amp; Jones, 2020, chap. 3');
  assert.equal(cite('apa', many), 'NameA et al., 2020');
  assert.equal(cite('apa', article, { suppress: true }), '2020');
  assert.equal(cite('apa', nobody), '<i>A book with no…</i>, n.d.');
  assert.equal(cite('mla', article, { locator: 'p. 12' }), 'Smith and Jones 12');
  assert.equal(cite('mla', many), 'NameA et al.');
  assert.equal(cite('chicago', article, { locator: 'pp. 12–14' }), 'Smith and Jones 2020, 12–14');
  assert.equal(cite('ieee', article, { number: 4, locator: '12' }), '[4, p. 12]');
  assert.equal(cite('harvard', article, { locator: '12' }), 'Smith and Jones, 2020, p. 12');
  const three = { ...article, author: article.author.concat({ family: 'Lee', given: 'K' }) };
  assert.equal(cite('harvard', three), 'Smith, Jones, and Lee, 2020');
  assert.equal(cite('apa', three), 'Smith et al., 2020');
});

test('the words of a source can’t become markup', () => {
  const bad = { ...book, title: '<img src=x onerror=alert(1)>', author: [{ family: '<b>x</b>' }], publisher: '"><script>' };
  for (const key of Object.keys(STYLES)) assert.doesNotMatch(ref(key, bad), /<img|<script|<b>/, key);
  const { html } = render('[@smith2019]', { citeFor: () => ({ sources: new Map([[bad.id, { ...bad, id: 'smith2019' }]]), style: 'apa', strict: false }) });
  assert.doesNotMatch(html, /onerror="|<script/);
});

test('style names from front matter', () => {
  assert.equal(styleKey('APA 7'), 'apa');
  assert.equal(styleKey('chicago-author-date'), 'chicago');
  assert.equal(styleKey('mla9'), 'mla');
  assert.equal(styleKey('nonsense', 'ieee'), 'ieee');
  assert.equal(styleKey(undefined, 'harvard'), 'harvard');
  assert.equal(styleKey('nonsense', 'nope'), 'apa');
});

test('reading citations as Pandoc writes them', () => {
  assert.deepEqual(parseItems('@a'), [{ prefix: '', suppress: false, key: 'a', locator: '' }]);
  assert.deepEqual(parseItems('@a, p. 3'), [{ prefix: '', suppress: false, key: 'a', locator: 'p. 3' }]);
  assert.deepEqual(parseItems('see @a p. 3; -@b'), [{ prefix: 'see', suppress: false, key: 'a', locator: 'p. 3' }, { prefix: '', suppress: true, key: 'b', locator: '' }]);
  assert.deepEqual(parseItems('@doe:2020.x-1'), [{ prefix: '', suppress: false, key: 'doe:2020.x-1', locator: '' }]);
  assert.equal(parseItems('me@example.com'), null);
  assert.equal(parseItems('just text'), null);
  assert.equal(parseItems('@a; not one'), null);
});

test('two works by one author in a year get a and b, in title order', () => {
  const a = { id: 'a', title: 'Zebras', author: [{ family: 'Kim' }], year: '2020' };
  const b = { id: 'b', title: 'Apples', author: [{ family: 'Kim' }], year: '2020' };
  const c = { id: 'c', title: 'Other', author: [{ family: 'Kim' }], year: '2021' };
  const info = assign([a, b, c], STYLES.apa);
  assert.deepEqual([info.suffixOf('a'), info.suffixOf('b'), info.suffixOf('c')], ['b', 'a', '']);
  assert.equal(assign([a, b], STYLES.ieee).suffixOf('a'), '', 'numbers tell them apart already');
});

test('lists are alphabetical, or in citing order for numbered styles', () => {
  const list = [{ id: 'z', author: [{ family: 'Zhou' }], year: '2001' }, { id: 'a', author: [{ family: 'Ali' }], year: '2002' }, { id: 'n', title: 'No author' }];
  assert.deepEqual(listOrder(list, STYLES.apa).map((e) => e.id), ['a', 'n', 'z']);
  assert.deepEqual(listOrder(list, STYLES.ieee).map((e) => e.id), ['z', 'a', 'n']);
});

const sources = new Map([article, book, chapter].map((e) => [e.id, e]));
const page = (text, o = {}) => render(text, { citeFor: () => ({ sources, style: 'apa', strict: false, ...o }) });

test('with no sources the page is exactly as before', () => {
  const text = 'A [@smith2020] and @smith2020 mention.\n\n- me@example.com\n';
  assert.equal(render(text).html, render(text, { citeFor: () => null }).html);
  assert.match(render(text).html, /\[@smith2020\]/);
});

test('a citation becomes a link to its line in the list', () => {
  const { html, toc } = page('# Doc\n\nAs shown [@smith2020, p. 4].\n');
  assert.match(html, /\(<a class="citation" href="#ref-smith2020" title="[^"]*Title of paper[^"]*">Smith &amp; Jones, 2020, p\. 4<\/a>\)/);
  assert.match(html, /<h2[^>]*>References<\/h2>/);
  assert.match(html, /<p class="csl-entry" id="ref-smith2020">Smith, J\. A\., &amp; Jones, B\./);
  assert.deepEqual(toc.map((h) => h.text), ['Doc', 'References']);
});

test('several sources, a prefix, an author left out, and a name in the sentence', () => {
  const { html } = page('One [see @smith2020; @lee2018]. Two [-@smith2019]. @smith2019 says so. And @lee2018 [p. 9] too.\n');
  const text = new JSDOM(html).window.document.body.textContent;
  assert.match(text, /One \(see Smith & Jones, 2020; Lee, 2018\)\./);
  assert.match(text, /Two \(2019\)\./);
  assert.match(text, /Smith \(2019\) says so\./);
  assert.match(text, /And Lee \(2018, p\. 9\) too\./);
});

test('only sources you cited are listed, each once', () => {
  const { html } = page('[@smith2020] and [@smith2020] again.\n');
  assert.equal(html.match(/class="csl-entry/g).length, 1);
  assert.doesNotMatch(html, /A book/);
});

test('numbered styles count in citing order', () => {
  const { html } = page('[@smith2019] then [@lee2018] then [@smith2019; @lee2018].\n', { style: 'ieee' });
  const text = new JSDOM(html).window.document.body.textContent;
  assert.match(text, /\[1\] then \[2\] then \[1\], \[2\]\./);
  assert.ok(html.indexOf('id="ref-smith2019"') < html.indexOf('id="ref-lee2018"'));
});

test('the list goes under your own heading, at a marker, or at the end', () => {
  assert.equal(page('[@smith2020]\n\n## Sources cited\n\nMore.\n').html.match(/<h2/g).length, 2);
  const own = page('[@smith2020]\n\n# Bibliography\n').html;
  assert.equal(own.match(/<h1/g).length, 1);
  assert.doesNotMatch(own, /<h2/);
  const marked = page('[@smith2020]\n\n<!-- bibliography -->\n\n## Appendix\n\nLast.\n').html;
  assert.ok(marked.indexOf('csl-entry') < marked.indexOf('Appendix'));
  assert.doesNotMatch(marked, />References</);
});

test('footnotes stay notes, and citations inside them count', () => {
  const { html } = page('Text.[^1]\n\n[^1]: As in [@lee2018].\n');
  assert.match(html, /class="footnotes"/);
  assert.match(html, /id="ref-lee2018"/);
  assert.ok(html.indexOf('csl-entry') < html.indexOf('class="footnotes"'));
});

test('links, emails, code and unknown keys are left alone', () => {
  const { html } = page('[@smith2020](https://example.org) me@smith2020 `[@smith2020]` [@nobody] @nobody\n\n```\n[@smith2020]\n```\n');
  assert.doesNotMatch(html, /csl-entry|class="citation"/);
  assert.match(html, /\[@nobody\]/);
  assert.match(html, /me@smith2020/);
});

test('an unknown key is shown as a mistake when the document names its own bibliography', () => {
  const { html } = page('[@smith2020; @nobody]\n', { strict: true });
  assert.match(html, /class="cite-missing"[^>]*>@nobody</);
  assert.match(html, /class="citation"/);
  assert.match(page('[@nobody] only\n', { strict: true }).html, /cite-missing/);
});

test('front matter that sets up citations isn’t shown on the page', () => {
  const { html } = render('---\ntitle: T\nbibliography: refs.bib\ncitation-style: mla\n---\n\nText\n');
  assert.doesNotMatch(html, /refs\.bib|citation-style/);
  assert.deepEqual(bibliographyOf({ bibliography: 'a.bib' }), ['a.bib']);
  assert.deepEqual(bibliographyOf({ bibliography: ['a.bib', 'b.json', 3] }), ['a.bib', 'b.json']);
  assert.deepEqual(bibliographyOf(null), []);
});

test('the front matter reaches the citations', () => {
  let seen = null;
  render('---\nbibliography: x.bib\n---\n\n[@a]\n', { citeFor: (fm) => { seen = fm; return null; } });
  assert.equal(seen.bibliography, 'x.bib');
});

test('text for the editor', () => {
  assert.equal(citationText('a'), '[@a]');
  assert.equal(citationText('a', '12'), '[@a, p. 12]');
  assert.equal(citationText('a', 'chap. 3'), '[@a, chap. 3]');
});

test('finding sources', () => {
  const all = [article, book, chapter];
  assert.deepEqual(searchSources(all, 'smith 2019').map((e) => e.id), ['smith2019']);
  assert.deepEqual(searchSources(all, 'testing').map((e) => e.id), ['smith2020']);
  assert.equal(searchSources(all, '').length, 3);
  assert.deepEqual(pickerLine(article), { who: 'Smith & Jones', year: '2020', title: 'Title of paper' });
  assert.equal(pickerLine(many).who, 'NameA et al.');
});

test('ids are safe in a page', () => {
  assert.equal(refId('doe:2020/x y'), 'ref-doe_3A2020_2Fx_20y');
  assert.equal(refId('smith2020'), 'ref-smith2020');
});

const BIB = String.raw`
% a comment
@string{jt = "Journal of Testing"}
@comment{ignore @article{not, title={no}} }
@preamble{"\newcommand{\x}{y}"}
@article{smith2020,
  author  = {Smith, John A. and Bob Jones},
  title   = {Title of {DNA} paper: a {\"u}ber test},
  journal = jt,
  year    = 2020,
  month   = mar,
  volume  = {12},
  number  = 3,
  pages   = {45--67},
  doi     = {https://doi.org/10.1000/xyz},
}
@book{book1, author = {{World Health Organization}}, title = "A \& B", publisher = {Big Press}, address = {New York}, edition = {2nd}, year = {2019}}
@incollection{ch1, author = {Ludwig van Beethoven}, editor = {Ross, Mary}, title = {Chapter}, booktitle = {Book}, pages = {1-9}, publisher = {P}, date = {2018-05-04}}
@phdthesis{th1, author = {Kay, Ann}, title = {Study}, school = {UTSA}, year = {2021}}
@online{web1, title = {Page}, url = {https://example.org/a_b}, year = 2022}
@article{broken, title = {No end
@misc{after, title = {Still read}}
`;

test('BibTeX', () => {
  const { entries, skipped } = parseBibtex(BIB);
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.deepEqual(by.smith2020.author, [{ family: 'Smith', given: 'John A.' }, { family: 'Jones', given: 'Bob' }]);
  assert.equal(by.smith2020.title, 'Title of DNA paper: a über test');
  assert.equal(by.smith2020.container, 'Journal of Testing');
  assert.equal(by.smith2020.year, '2020');
  assert.equal(by.smith2020.month, 3);
  assert.equal(by.smith2020.issue, '3');
  assert.equal(by.smith2020.pages, '45–67');
  assert.equal(by.smith2020.doi, '10.1000/xyz');
  assert.deepEqual(by.book1.author, [{ literal: 'World Health Organization' }]);
  assert.equal(by.book1.title, 'A & B');
  assert.equal(by.book1.edition, '2');
  assert.equal(by.book1.place, 'New York');
  assert.equal(by.ch1.type, 'chapter');
  assert.deepEqual(by.ch1.author, [{ family: 'van Beethoven', given: 'Ludwig' }]);
  assert.equal(by.ch1.container, 'Book');
  assert.deepEqual([by.ch1.year, by.ch1.month, by.ch1.day], ['2018', 5, 4]);
  assert.equal(by.th1.genre, 'phd');
  assert.equal(by.th1.school, 'UTSA');
  assert.equal(by.web1.type, 'web');
  assert.equal(by.web1.url, 'https://example.org/a_b');
  assert.ok(!by.not);
  assert.ok(skipped >= 0);
});

test('a damaged BibTeX file never stops the rest', () => {
  assert.deepEqual(parseBibtex('').entries, []);
  assert.deepEqual(parseBibtex('not bibtex at all @ nothing').entries, []);
  assert.equal(parseBibtex('@article{a, title={One}}\n@article{b, title={Two').entries.length, 1);
  assert.doesNotThrow(() => parseBibtex('@article{'));
  assert.doesNotThrow(() => parseBibtex('@string{x'));
});

test('LaTeX in fields', () => {
  assert.equal(fromLatex(String.raw`Caf{\'e} \"{o} \~n \c{c} \ss{} \o{} \& 50\% a---b a--b {\emph{Word}} \textit{it}`), 'Café ö ñ ç ß ø & 50% a—b a–b Word it');
  assert.deepEqual(parseName('Jean-Paul Sartre'), { family: 'Sartre', given: 'Jean-Paul' });
  assert.deepEqual(parseName('Plato'), { family: 'Plato' });
  assert.deepEqual(parseName('van der Berg, Jan'), { family: 'van der Berg', given: 'Jan' });
  assert.deepEqual(parseName('King, Jr., Martin'), { family: 'King', given: 'Martin' });
  assert.equal(parseName('others'), null);
});

test('dates', () => {
  assert.deepEqual(parseDate('2020-03-05'), { year: '2020', month: 3, day: 5 });
  assert.deepEqual(parseDate('March 2020'), { year: '2020', month: 3, day: 0 });
  assert.deepEqual(parseDate('2020'), { year: '2020', month: 0, day: 0 });
  assert.deepEqual(parseDate(''), { year: '', month: 0, day: 0 });
});

test('CSL JSON', () => {
  const { entries } = parseCslJson(JSON.stringify([
    { id: 'a', type: 'article-journal', title: 'T', author: [{ family: 'Doe', given: 'J', 'non-dropping-particle': 'de' }, { literal: 'Team' }], issued: { 'date-parts': [[2020, 3, 5]] }, 'container-title': 'J', page: '1-9', DOI: '10.1/x', volume: 4, issue: '2' },
    { id: 'b', type: 'thesis', title: 'S', publisher: 'UTSA', genre: 'PhD dissertation', issued: { raw: '2021' } },
    { title: 'no id' },
  ]));
  assert.deepEqual(entries[0].author, [{ family: 'de Doe', given: 'J' }, { literal: 'Team' }]);
  assert.deepEqual([entries[0].year, entries[0].month, entries[0].day, entries[0].pages, entries[0].volume], ['2020', 3, 5, '1–9', '4']);
  assert.deepEqual([entries[1].school, entries[1].genre, entries[1].year], ['UTSA', 'phd', '2021']);
  assert.equal(entries.length, 2);
  assert.throws(() => parseCslJson('{nope'), /valid JSON/);
  assert.throws(() => parseCslJson('{"a":1}'), /CSL JSON/);
});

const ZOTERO = [
  { data: { itemType: 'journalArticle', title: 'Neural networks in practice', creators: [{ creatorType: 'author', firstName: 'Ann', lastName: 'García' }], date: '2020-05', publicationTitle: 'J', volume: '1', issue: '2', pages: '1-5', DOI: 'https://doi.org/10.1/a' } },
  { data: { itemType: 'attachment', title: 'PDF' } },
  { data: { itemType: 'note', note: 'x' } },
  { data: { itemType: 'book', title: 'Named', creators: [{ creatorType: 'editor', name: 'A Group' }], date: '2019', publisher: 'P', extra: 'Citation Key: mykey\nOther: x' } },
  { data: { itemType: 'bookSection', title: 'Neural networks in practice', creators: [{ creatorType: 'author', lastName: 'García', firstName: 'Ann' }], date: '2020', bookTitle: 'B' } },
  { data: { itemType: 'thesis', title: 'S', university: 'UTSA', thesisType: 'Master’s thesis', date: '2021' } },
];

test('Zotero items', () => {
  const { entries } = parseZotero(ZOTERO);
  assert.equal(entries.length, 4, 'attachments and notes aren’t sources');
  assert.equal(entries[0].id, 'garcia2020neural');
  assert.equal(entries[0].doi, '10.1/a');
  assert.equal(entries[1].id, 'mykey', 'a key from Better BibTeX is kept');
  assert.deepEqual(entries[1].editor, [{ literal: 'A Group' }]);
  assert.equal(entries[2].id, 'garcia2020neural2', 'two similar items get different keys');
  assert.equal(entries[2].type, 'chapter');
  assert.deepEqual([entries[3].school, entries[3].genre], ['UTSA', 'masters']);
});

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('asking Zotero: pages of items, and plain answers when it can’t help', async () => {
  const urls = [];
  const full = Array.from({ length: 100 }, (_, i) => ({ data: { itemType: 'book', title: `Book ${i}`, citationKey: `k${i}` } }));
  const { entries } = await fetchZotero(async (url, o) => {
    urls.push(url);
    assert.equal(o.headers['Zotero-Allowed-Request'], '1');
    return reply(url.includes('start=0') ? full : ZOTERO.slice(0, 1));
  }, 'http://127.0.0.1:1/x');
  assert.equal(entries.length, 101);
  assert.equal(urls.length, 2);
  await assert.rejects(fetchZotero(async () => { throw new Error('refused'); }), /isn’t running/);
  await assert.rejects(fetchZotero(async () => reply({}, 403)), /Allow other applications/);
  await assert.rejects(fetchZotero(async () => reply({}, 500)), /error \(500\)/);
});

test('which files count as sources', () => {
  assert.equal(isBibPath('refs.bib'), true);
  assert.equal(isBibPath('a/refs.JSON'), true);
  assert.equal(isBibPath('notes.txt'), false);
  assert.equal(isBibPath('secrets.env'), false);
  assert.equal(parseFile('x.bib', '@misc{a, title={T}}').entries.length, 1);
  assert.equal(parseFile('x.json', '[{"id":"a"}]').entries.length, 1);
});
