'use strict';
// Find & replace across a folder: finding the matches in one file's text and writing the new text with
// only the chosen matches replaced. Pure functions; replace-worker.js runs them off the main thread.

const MAX_PER_FILE = 500;

class PatternError extends Error {}

/**
 * The regular expression for a search.
 * @param {string} find
 * @param {{ regex?: boolean, matchCase?: boolean, wholeWord?: boolean }} opts
 */
function buildMatcher(find, { regex = false, matchCase = false, wholeWord = false } = {}) {
  const text = String(find ?? '');
  if (!text) throw new PatternError('Type what to find.');
  if (text.length > 1000) throw new PatternError('That search is too long.');
  let source = regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  let re;
  try { re = new RegExp(source, `gmu${matchCase ? '' : 'i'}`); } catch (err) {
    throw new PatternError(`That pattern isn’t valid: ${String(err.message).replace(/^Invalid regular expression: /, '')}`);
  }
  if (re.test('')) throw new PatternError('That pattern matches empty text, so it can’t be used to replace.');
  re.lastIndex = 0;
  return re;
}

/** The text a regular-expression replacement produces for one match ($1, $<name>, $& and $$). */
function expand(template, m, regex) {
  if (!regex) return template;
  return template.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, (all, tok, name) => {
    if (tok === '$') return '$';
    if (tok === '&') return m[0];
    if (name !== undefined) return m.groups?.[name] ?? '';
    const n = Number(tok);
    if (n > 0 && n < m.length) return m[n] ?? '';
    if (tok.length === 2 && Number(tok[0]) > 0 && Number(tok[0]) < m.length) return (m[Number(tok[0])] ?? '') + tok[1];
    return all;
  });
}

/** A short piece of a line around [start, end), so long lines stay readable. */
function clip(line, start, end, radius = 50) {
  const a = Math.max(0, start - radius);
  const b = Math.min(line.length, end + radius);
  return { prefix: (a > 0 ? '…' : '') + line.slice(a, start), suffix: line.slice(end, b) + (b < line.length ? '…' : '') };
}

/**
 * Every match in `text`.
 * @returns {{ matches: { i: number, start: number, end: number, line: number, found: string, replacement: string, prefix: string, suffix: string }[], truncated: boolean }}
 */
function findMatches(text, re, replacement, { regex = false, max = MAX_PER_FILE } = {}) {
  const out = [];
  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const lineOf = (pos) => { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  re.lastIndex = 0;
  let m;
  let truncated = false;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    if (out.length >= max) { truncated = true; break; }
    const start = m.index;
    const end = start + m[0].length;
    const line = lineOf(start);
    const lineText = text.slice(lineStarts[line], (lineStarts[line + 1] ?? text.length + 1) - 1);
    const { prefix, suffix } = clip(lineText, start - lineStarts[line], Math.min(end - lineStarts[line], lineText.length));
    out.push({ i: out.length, start, end, line, found: m[0], replacement: expand(String(replacement ?? ''), m, regex), prefix, suffix });
  }
  return { matches: out, truncated };
}

/** `text` with only the matches whose index is in `chosen` replaced. */
function applyChosen(text, matches, chosen) {
  const keep = new Set(chosen);
  let out = '';
  let pos = 0;
  for (const m of matches) {
    if (!keep.has(m.i)) continue;
    out += text.slice(pos, m.start) + m.replacement;
    pos = m.end;
  }
  return out + text.slice(pos);
}

module.exports = { buildMatcher, findMatches, applyChosen, expand, PatternError, MAX_PER_FILE };
