'use strict';
// Connected notes (2.3): what a Markdown document links to, its headings, tags and tasks, and how a
// [[wiki link]] finds the document it names. Pure functions with no Node or browser APIs, shared by the
// page (rendering, the editor's suggestions) and the main process (backlinks, the link map, tags, tasks
// and the link checker), so a link means the same thing everywhere.

/** GitHub-style heading ids, the same as the page uses (markdown-it-anchor with renderer.slugify). */
function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Heading text as the page shows it: inline formatting, links and images reduced to their words. */
function plainHeading(s) {
  return String(s)
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, n, l) => l || n)
    .replace(/[*_~`]/g, '')
    .trim();
}

/**
 * The text with code (fenced blocks and `inline code`) blanked out, keeping every line and column, so
 * links, tags and tasks inside code are ignored.
 */
function blankCode(text) {
  const lines = String(text).split('\n');
  let fence = null;
  return lines.map((line) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return ' '.repeat(line.length);
    }
    if (m) { fence = m[1]; return ' '.repeat(line.length); }
    if (/^( {4}|\t)/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) return line;   // keep indented list content
    return line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (all) => ' '.repeat(all.length));
  }).join('\n');
}

/** The YAML front matter's line range and a few simple values (title, tags) without a YAML library. */
function frontMatter(text) {
  const lines = String(text).split('\n');
  if (lines[0]?.trim() !== '---') return { end: -1, title: '', tags: [] };
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 400); i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) { end = i; break; }
  if (end < 0) return { end: -1, title: '', tags: [] };
  const unq = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  let title = '';
  const tags = [];
  for (let i = 1; i < end; i++) {
    const m = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'title') title = unq(value);
    if (key === 'tags' || key === 'tag' || key === 'keywords') {
      if (value.startsWith('[')) tags.push(...value.replace(/^\[|\]$/g, '').split(',').map(unq));
      else if (value) tags.push(...value.split(',').map(unq));
      else for (let j = i + 1; j < end && /^\s*-\s+/.test(lines[j]); j++) tags.push(unq(lines[j].replace(/^\s*-\s+/, '')));
    }
  }
  return { end, title, tags: tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean) };
}

/** "Name#Heading|label" (inside [[ ]]) → { name, heading, label }. */
function parseWikiTarget(inner) {
  const raw = String(inner);
  const bar = raw.indexOf('|');
  const target = bar >= 0 ? raw.slice(0, bar) : raw;
  const label = bar >= 0 ? raw.slice(bar + 1).trim() : '';
  const hash = target.indexOf('#');
  return {
    name: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    heading: hash >= 0 ? target.slice(hash + 1).trim() : '',
    label,
  };
}

const WIKI_RE = /\[\[([^[\]\n]{1,300})\]\]/g;
const MD_LINK_RE = /(!?)\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)/g;
const TAG_RE = /(^|[\s(,;])#([\p{L}][\p{L}\p{N}_/-]{0,60})/gu;
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]\s+(.*)$/;
const DUE_RE = /(?:📅|🗓️?|\bdue[:=]\s*|@due\()\s*(\d{4}-\d{2}-\d{2})\)?/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Everything 2.3 needs to know about one document.
 * @returns {{ title: string, headings: {text,slug,line}[], wiki: {name,heading,label,line}[],
 *   links: {target,line,image}[], tags: {tag,line}[], tasks: {line,done,text,due}[] }}
 */
function extract(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = frontMatter(src);
  const lines = blankCode(src).split('\n');
  const raw = src.split('\n');
  const out = { title: fm.title, headings: [], wiki: [], links: [], tags: fm.tags.map((tag) => ({ tag, line: 0 })), tasks: [] };
  const seen = new Map();
  let fenceOpen = false;
  for (let i = fm.end + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,3}(`{3,}|~{3,})/.test(raw[i])) fenceOpen = !fenceOpen;
    if (fenceOpen || !line.trim()) continue;
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const text = plainHeading(raw[i].replace(/^\s{0,3}#{1,6}\s+/, ''));
      let slug = slugify(text);
      if (slug) {
        const n = seen.get(slug) || 0;
        seen.set(slug, n + 1);
        if (n) slug = `${slug}-${n}`;
        out.headings.push({ text, slug, line: i });
        if (!out.title && h[1].length === 1) out.title = text;
      }
    }
    for (const m of line.matchAll(WIKI_RE)) out.wiki.push({ ...parseWikiTarget(m[1]), line: i });
    for (const m of line.matchAll(MD_LINK_RE)) {
      const target = m[3];
      if (SCHEME.test(target) && !/^file:/i.test(target)) continue;
      out.links.push({ target, line: i, image: m[1] === '!' });
    }
    if (!h || h[2]) {
      // Tags: not headings' "#" markers (they need a space after), not inside links or URLs.
      const scrubbed = line.replace(MD_LINK_RE, ' ').replace(WIKI_RE, ' ').replace(/https?:\/\/\S+/g, ' ');
      for (const m of scrubbed.matchAll(TAG_RE)) out.tags.push({ tag: m[2].replace(/[/-]+$/, ''), line: i });
    }
    const t = TASK_RE.exec(raw[i]);
    if (t && t[3].trim()) {                 // an empty "- [ ]" (like a fresh daily note's) isn't a task yet
      const due = DUE_RE.exec(t[3])?.[1] || '';
      out.tasks.push({ line: i, done: t[2] !== ' ', text: t[3].trim(), due });
    }
  }
  return out;
}

/** Path helpers that work for both Windows and POSIX paths. */
const sepOf = (p) => (/\\/.test(p) && !/\//.test(p.replace(/^[a-z]:/i, '')) ? '\\' : '/');
const parts = (p) => String(p).split(/[\\/]+/).filter((x, i) => x || i === 0);
const dirOf = (p) => { const a = parts(p); a.pop(); return a.join(sepOf(p)); };
const baseOf = (p) => parts(p).pop() || '';
const stem = (p) => baseOf(p).replace(/\.(md|markdown|mdown|mkd|mkdn|mdwn|mdx|txt)$/i, '');

/** A file's path relative to a folder, with forward slashes. */
function relative(fromDir, to) {
  const a = parts(fromDir);
  const b = parts(to);
  const same = (x, y) => x.toLowerCase() === y.toLowerCase();
  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * The document a [[wiki link]] names, from the folder's files: by file name (without extension, any
 * case), or by a path ending ("projects/plan"). Prefers a file in the linking document's folder,
 * then the one nearest the folder's top.
 * @param {string} name  @param {{ path: string, rel: string }[]} files  @param {string} [fromPath]
 * @returns {string | null} the file's path
 */
function resolveWiki(name, files, fromPath = '') {
  const want = String(name || '').trim().replace(/\\/g, '/').replace(/\.(md|markdown|mdown|mkd|mkdn|mdwn|mdx|txt)$/i, '').toLowerCase();
  if (!want) return fromPath || null;
  const hasPath = want.includes('/');
  const matches = files.filter((f) => {
    const relStem = f.rel.replace(/\\/g, '/').replace(/\.(md|markdown|mdown|mkd|mkdn|mdwn|mdx|txt)$/i, '').toLowerCase();
    return hasPath ? relStem === want || relStem.endsWith(`/${want}`) : stem(f.path).toLowerCase() === want;
  });
  if (!matches.length) return null;
  const here = fromPath ? dirOf(fromPath).toLowerCase() : null;
  matches.sort((x, y) => (dirOf(y.path).toLowerCase() === here) - (dirOf(x.path).toLowerCase() === here)
    || parts(x.rel).length - parts(y.rel).length || x.rel.localeCompare(y.rel));
  return matches[0].path;
}

/** Where a Markdown link's target points: { path, hash } (path null for "#heading" in the same document). */
function resolveMdLink(target, fromPath) {
  let t = String(target || '').trim();
  if (/^file:/i.test(t)) {
    try { t = decodeURIComponent(new URL(t).pathname).replace(/^\/([a-z]:)/i, '$1'); } catch { return null; }
  }
  const hashAt = t.indexOf('#');
  const hash = hashAt >= 0 ? t.slice(hashAt + 1) : '';
  let file = (hashAt >= 0 ? t.slice(0, hashAt) : t).replace(/\?.*$/, '');
  try { file = decodeURIComponent(file); } catch { /* keep as written */ }
  if (!file) return { path: null, hash };
  if (/^([a-z]:[\\/]|[\\/])/i.test(file)) return { path: file, hash };
  const sep = sepOf(fromPath);
  const out = parts(dirOf(fromPath));
  for (const seg of file.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return { path: out.join(sep), hash };
}

const isMarkdownName = (p) => /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdx)$/i.test(p);
const key = (p) => String(p).replace(/\\/g, '/').toLowerCase();

/**
 * Every link between the folder's documents.
 * @param {Map<string, ReturnType<typeof extract>>} docs  path → extract()
 * @param {{ path: string, rel: string }[]} files
 * @returns {{ from: string, to: string | null, line: number, kind: 'wiki' | 'md', name: string, heading: string }[]}
 */
function allLinks(docs, files) {
  const byKey = new Map(files.map((f) => [key(f.path), f.path]));
  const out = [];
  for (const [from, d] of docs) {
    for (const w of d.wiki) out.push({ from, to: w.name ? resolveWiki(w.name, files, from) : from, line: w.line, kind: 'wiki', name: w.name, heading: w.heading });
    for (const l of d.links) {
      if (l.image) continue;
      const r = resolveMdLink(l.target, from);
      if (!r) continue;
      if (!r.path) { out.push({ from, to: from, line: l.line, kind: 'md', name: '', heading: r.hash }); continue; }
      if (!isMarkdownName(r.path)) continue;
      out.push({ from, to: byKey.get(key(r.path)) || null, line: l.line, kind: 'md', name: l.target, heading: r.hash });
    }
  }
  return out;
}

/** The documents that link to `path`, each with the line around the link. */
function backlinks(links, path, lineText) {
  const k = key(path);
  return links.filter((l) => l.to && key(l.to) === k && key(l.from) !== k)
    .map((l) => ({ from: l.from, line: l.line, context: lineText(l.from, l.line) }));
}

/** Documents and the links between them, for the link map. */
function graph(links, files) {
  const nodes = files.map((f) => ({ path: f.path, rel: f.rel, name: stem(f.path), degree: 0 }));
  const index = new Map(nodes.map((n, i) => [key(n.path), i]));
  const edges = new Map();
  for (const l of links) {
    if (!l.to) continue;
    const a = index.get(key(l.from));
    const b = index.get(key(l.to));
    if (a == null || b == null || a === b) continue;
    const id = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!edges.has(id)) { edges.set(id, [a, b]); nodes[a].degree++; nodes[b].degree++; }
  }
  return { nodes, edges: [...edges.values()] };
}

/** Tags across the folder, most used first: [{ tag, count, files: [path] }]. */
function tagSummary(docs) {
  const map = new Map();
  for (const [path, d] of docs) {
    for (const { tag } of d.tags) {
      const k = tag.toLowerCase();
      if (!map.has(k)) map.set(k, { tag, count: 0, files: new Set() });
      const e = map.get(k);
      e.count++;
      e.files.add(path);
    }
  }
  return [...map.values()].map((e) => ({ tag: e.tag, count: e.count, files: [...e.files] }))
    .sort((a, b) => b.files.length - a.files.length || a.tag.localeCompare(b.tag));
}

/**
 * Tasks across the folder, in the order to do them: overdue, today, upcoming (by date), then undated;
 * finished tasks last.
 */
function taskList(docs, today) {
  const out = [];
  for (const [path, d] of docs) for (const t of d.tasks) out.push({ path, ...t });
  const rank = (t) => (t.done ? 4 : !t.due ? 3 : t.due < today ? 0 : t.due === today ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.due || '9999').localeCompare(b.due || '9999') || a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * Links that go nowhere: missing documents, missing pictures, and headings that no longer exist.
 * @param {(path: string) => boolean} exists  whether a file exists (pictures and other files)
 */
function checkLinks(docs, files, exists) {
  const byKey = new Map(files.map((f) => [key(f.path), f.path]));
  const slugsOf = (p) => new Set((docs.get(byKey.get(key(p))) || { headings: [] }).headings.map((h) => h.slug));
  const problems = [];
  for (const [from, d] of docs) {
    for (const w of d.wiki) {
      const to = w.name ? resolveWiki(w.name, files, from) : from;
      if (!to) problems.push({ path: from, line: w.line, kind: 'document', target: `[[${w.name}]]`, message: `No document named “${w.name}” in this folder` });
      else if (w.heading && !slugsOf(to).has(slugify(w.heading))) problems.push({ path: from, line: w.line, kind: 'heading', target: `[[${w.name}#${w.heading}]]`, message: `“${stem(to)}” has no heading “${w.heading}”` });
    }
    for (const l of d.links) {
      const r = resolveMdLink(l.target, from);
      if (!r) continue;
      if (!r.path) {
        if (r.hash && !d.headings.some((h) => h.slug === r.hash) && !/^(fn|fnref)/.test(r.hash)) problems.push({ path: from, line: l.line, kind: 'heading', target: l.target, message: `No heading “#${r.hash}” in this document` });
        continue;
      }
      const known = byKey.get(key(r.path));
      if (!known && !exists(r.path)) {
        problems.push({ path: from, line: l.line, kind: l.image ? 'image' : 'file', target: l.target, message: l.image ? 'Picture not found' : 'File not found' });
      } else if (known && r.hash && !slugsOf(known).has(r.hash)) {
        problems.push({ path: from, line: l.line, kind: 'heading', target: l.target, message: `“${stem(known)}” has no heading “#${r.hash}”` });
      }
    }
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/** Replace links to a renamed document in one document's text. Returns { text, count }. */
function retargetLinks(text, fromPath, oldPath, newPath, files) {
  let count = 0;
  const oldStem = stem(oldPath);
  const newStem = stem(newPath);
  const lines = String(text).split('\n');
  const code = blankCode(text).split('\n');
  // Matches are found in the text with code blanked out (same columns), then replaced in the real line,
  // so a [[link]] written inside `code` is left alone.
  const swap = (line, scan, re, fn) => {
    let res = '';
    let at = 0;
    for (const m of scan.matchAll(new RegExp(re.source, 'gd'))) {
      const orig = line.slice(m.index, m.index + m[0].length);
      const groups = m.indices.slice(1).map((r) => (r ? line.slice(r[0], r[1]) : undefined));
      const rep = fn(orig, ...groups);
      res += line.slice(at, m.index) + rep;
      at = m.index + m[0].length;
    }
    return res + line.slice(at);
  };
  const out = lines.map((line, i) => {
    let scan = code[i];
    if (scan !== line && !scan.trim()) return line;                // inside a code block
    let next = swap(line, scan, WIKI_RE, (all, inner) => {
      const w = parseWikiTarget(inner);
      if (!w.name || resolveWiki(w.name, files, fromPath) !== oldPath) return all;
      count++;
      const name = w.name.includes('/') ? w.name.replace(/[^/]+$/, newStem) : newStem;
      return `[[${name}${w.heading ? `#${w.heading}` : ''}${w.label ? `|${w.label}` : ''}]]`;
    });
    scan = blankCode(next).split('\n')[0];
    next = swap(next, scan, MD_LINK_RE, (all, bang, label, target) => {
      const r = resolveMdLink(target, fromPath);
      if (!r?.path || key(r.path) !== key(oldPath)) return all;
      count++;
      const rel = relative(dirOf(fromPath), newPath).split('/').map(encodeURIComponent).join('/');
      return all.replace(target, rel + (r.hash ? `#${r.hash}` : ''));
    });
    return next;
  });
  return { text: out.join('\n'), count, oldStem };
}

module.exports = {
  slugify, plainHeading, blankCode, frontMatter, parseWikiTarget, extract, resolveWiki, resolveMdLink, relative,
  allLinks, backlinks, graph, tagSummary, taskList, checkLinks, retargetLinks, stem, dirOf, baseOf, WIKI_RE,
};
