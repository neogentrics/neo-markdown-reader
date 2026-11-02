'use strict';
// Other file types shown read-only (2.4): CSV / TSV as a table, JSON and YAML formatted, and Jupyter
// notebooks with their outputs. Each becomes Markdown, so the page, Find, exports and printing all work
// on it as on any document. Nothing here runs code: notebook outputs are what was saved in the file.

const DATA_KINDS = { '.csv': 'csv', '.tsv': 'tsv', '.tab': 'tsv', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.ipynb': 'ipynb' };
const MAX_ROWS = 5000;
const MAX_HIGHLIGHT = 1024 * 1024;           // longer JSON / YAML is shown without colours (it would be slow)

/**
 * Split CSV / TSV text into rows of cells (RFC 4180: quoted cells may hold the separator, "" and new lines).
 * @param {string} text  @param {string} sep  ',' ';' or '\t'
 */
function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
  return rows;
}

/** Comma or semicolon (as in much of Europe): whichever splits the first lines more evenly. */
function guessSeparator(text) {
  const head = String(text).split(/\r?\n/).slice(0, 10).filter(Boolean);
  const score = (sep) => {
    const counts = head.map((l) => l.split(sep).length - 1);
    return counts.length && counts.every((n) => n > 0 && n === counts[0]) ? counts[0] + 100 : Math.min(...counts, 0);
  };
  return score(';') > score(',') ? ';' : ',';
}

const NUM_RE = /^[-+]?(?:[$€£¥]\s?)?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)?(?:[.,]\d+)?\s?%?$/;
const isNumber = (v) => v.trim() !== '' && /\d/.test(v) && NUM_RE.test(v.trim());
const mdCell = (v) => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/\r?\n/g, '<br>').trim() || ' ';

/** Rows as a Markdown table: the first row is the header, number columns are right-aligned. */
function rowsToTable(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows.map(pad);
  const numeric = head.map((_, c) => {
    const vals = body.map((r) => r[c]).filter((v) => v.trim() !== '');
    return vals.length > 0 && vals.every(isNumber);
  });
  const line = (r) => `| ${r.map(mdCell).join(' | ')} |`;
  return [line(head.map((h, i) => h.trim() || `Column ${i + 1}`)), `|${numeric.map((n) => (n ? ' ---: ' : ' --- ')).join('|')}|`, ...body.map(line)].join('\n');
}

function delimitedToMarkdown(text, name, kind) {
  const sep = kind === 'tsv' ? '\t' : guessSeparator(text);
  const rows = parseDelimited(text, sep);
  if (!rows.length) return { markdown: `# ${name}\n\n*This file is empty.*\n`, rows: 0, columns: 0 };
  const shown = rows.slice(0, MAX_ROWS + 1);
  const columns = Math.max(...rows.map((r) => r.length));
  const more = rows.length - shown.length;
  const note = `${(rows.length - 1).toLocaleString('en-US')} row${rows.length === 2 ? '' : 's'} · ${columns} column${columns === 1 ? '' : 's'}${more > 0 ? ` · showing the first ${MAX_ROWS.toLocaleString('en-US')}` : ''} · click a column heading to sort`;
  return { markdown: `# ${name}\n\n<p class="data-note">${note}</p>\n\n${rowsToTable(shown)}\n`, rows: rows.length - 1, columns };
}

const fence = (body, lang) => {
  const ticks = '`'.repeat(Math.max(3, ...[...String(body).matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${ticks}${lang}\n${String(body).replace(/\n$/, '')}\n${ticks}`;
};

function jsonToMarkdown(text, name) {
  const clean = String(text).replace(/^﻿/, '');
  let pretty;
  let error = '';
  try { pretty = JSON.stringify(JSON.parse(clean), null, 2); } catch (err) { error = err.message; pretty = clean; }
  const lang = pretty.length > MAX_HIGHLIGHT ? 'text' : 'json';
  const intro = error ? `> [!WARNING]\n> This isn't valid JSON (${error.replace(/\n/g, ' ')}), so it's shown as it is.\n\n` : '';
  return `# ${name}\n\n${intro}${fence(pretty, lang)}\n`;
}

function yamlToMarkdown(text, name) {
  const clean = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return `# ${name}\n\n${fence(clean, clean.length > MAX_HIGHLIGHT ? 'text' : 'yaml')}\n`;
}

const join = (v) => (Array.isArray(v) ? v.join('') : String(v ?? ''));
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** One output of a code cell, as Markdown (saved results only: nothing is run). */
function outputToMarkdown(out) {
  if (out.output_type === 'stream') return fence(stripAnsi(join(out.text)), 'text');
  if (out.output_type === 'error') return fence(stripAnsi((out.traceback || [`${out.ename}: ${out.evalue}`]).join('\n')), 'text');
  const data = out.data || {};
  for (const t of IMAGE_TYPES) {
    if (data[t]) return `![Output](data:${t};base64,${join(data[t]).replace(/\s+/g, '')})`;
  }
  if (data['image/svg+xml']) return `![Output](data:image/svg+xml;base64,${Buffer.from(join(data['image/svg+xml'])).toString('base64')})`;
  if (data['text/markdown']) return join(data['text/markdown']);
  if (data['text/html']) return `<div class="nb-html">\n\n${join(data['text/html'])}\n\n</div>`;      // sanitized like any HTML in a document
  if (data['text/latex']) return join(data['text/latex']);
  if (data['application/json']) return fence(JSON.stringify(data['application/json'], null, 2), 'json');
  if (data['text/plain']) return fence(stripAnsi(join(data['text/plain'])), 'text');
  return '';
}

function notebookToMarkdown(text, name) {
  let nb;
  try { nb = JSON.parse(String(text).replace(/^﻿/, '')); } catch (err) {
    return { markdown: `# ${name}\n\n> [!WARNING]\n> This notebook couldn't be read (${err.message}).\n`, cells: 0 };
  }
  const cells = Array.isArray(nb.cells) ? nb.cells : (nb.worksheets?.[0]?.cells || []);
  const lang = String(nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || 'python').toLowerCase();
  const kernel = nb.metadata?.kernelspec?.display_name || '';
  const parts = [];
  const first = cells[0];
  const titled = first?.cell_type === 'markdown' && /^\s*#\s/.test(join(first.source));
  parts.push(titled ? join(first.source) : `# ${name}`);
  parts.push(`<p class="data-note">Jupyter notebook${kernel ? ` · ${kernel.replace(/</g, '&lt;')}` : ''} · ${cells.length} cell${cells.length === 1 ? '' : 's'} · read-only; outputs are as saved</p>`);
  for (const cell of titled ? cells.slice(1) : cells) {
    const src = join(cell.source ?? cell.input);
    if (cell.cell_type === 'markdown') { parts.push(src); continue; }
    if (cell.cell_type === 'raw') { parts.push(fence(src, 'text')); continue; }
    if (cell.cell_type !== 'code') continue;
    const n = cell.execution_count ?? cell.prompt_number;
    parts.push(`<div class="nb-in">In [${Number.isInteger(n) ? n : ' '}]</div>\n\n${fence(src, lang)}`);
    const outs = (cell.outputs || []).map(outputToMarkdown).filter(Boolean);
    if (outs.length) parts.push(`<div class="nb-out">Out</div>\n\n${outs.join('\n\n')}`);
  }
  return { markdown: `${parts.join('\n\n')}\n`, cells: cells.length };
}

/** The Markdown to show for a data file of `kind`. */
function dataToMarkdown(text, name, kind) {
  if (kind === 'csv' || kind === 'tsv') return delimitedToMarkdown(text, name, kind).markdown;
  if (kind === 'json') return jsonToMarkdown(text, name);
  if (kind === 'yaml') return yamlToMarkdown(text, name);
  if (kind === 'ipynb') return notebookToMarkdown(text, name).markdown;
  throw new Error('Not a data file');
}

module.exports = { DATA_KINDS, MAX_ROWS, parseDelimited, guessSeparator, rowsToTable, delimitedToMarkdown, jsonToMarkdown, yamlToMarkdown, notebookToMarkdown, outputToMarkdown, dataToMarkdown, isNumber };
