// Markdown tables: reading one into rows and columns, writing it back neatly aligned, and turning
// cells copied from a spreadsheet (Excel, Google Sheets, Numbers, Word tables) into a table.

const SEP_CELL = /^\s*:?-{1,}:?\s*$/;

/** Split one table row into its cells, honouring escaped pipes (\|) and pipes inside `code`. */
export function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isRow = (line) => /\|/.test(line) && String(line).trim().length > 0;
const isSeparator = (line) => isRow(line) && splitRow(line).every((c) => SEP_CELL.test(c));

/**
 * The table around line `lineNo` (0-based) in `lines`, or null.
 * @returns {{ start: number, end: number } | null} first and last line (inclusive)
 */
export function findTable(lines, lineNo) {
  if (!isRow(lines[lineNo] ?? '')) return null;
  let start = lineNo;
  while (start > 0 && isRow(lines[start - 1])) start--;
  let end = lineNo;
  while (end < lines.length - 1 && isRow(lines[end + 1])) end++;
  // A real table has a header row followed by a separator row (| --- | :-: |).
  if (end - start < 1 || !isSeparator(lines[start + 1])) return null;
  return { start, end };
}

/**
 * Read a Markdown table.
 * @returns {{ header: string[], align: ('left'|'center'|'right'|null)[], rows: string[][] }}
 */
export function parseTable(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2 || !isSeparator(lines[1])) throw new Error('Not a Markdown table');
  const header = splitRow(lines[0]);
  const align = splitRow(lines[1]).map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return null;
  });
  const rows = lines.slice(2).map(splitRow);
  const width = Math.max(header.length, align.length, ...rows.map((r) => r.length));
  const pad = (arr, fill) => [...arr, ...Array(Math.max(0, width - arr.length)).fill(fill)].slice(0, width);
  return { header: pad(header, ''), align: pad(align, null), rows: rows.map((r) => pad(r, '')) };
}

// Characters that are visually wide (CJK, emoji) count double when lining up columns.
const cellWidth = (s) => [...String(s)].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);

/** A cell's text made safe for a table: no line breaks, pipes escaped. */
export function cleanCell(v) {
  return String(v ?? '').replace(/\r?\n+/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|').trim();
}

/** Write a table back as Markdown, with the columns lined up. */
export function formatTable({ header, align = [], rows = [] }) {
  const cols = Math.max(1, header.length);
  const all = [header, ...rows].map((r) => Array.from({ length: cols }, (_, i) => cleanCell(r[i])));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...all.map((r) => cellWidth(r[i]))));
  const padCell = (text, i) => {
    const gap = widths[i] - cellWidth(text);
    if (align[i] === 'right') return ' '.repeat(gap) + text;
    if (align[i] === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
    return text + ' '.repeat(gap);
  };
  const line = (r) => `| ${r.map(padCell).join(' | ')} |`;
  const sep = widths.map((w, i) => {
    const a = align[i];
    if (a === 'center') return ':' + '-'.repeat(w - 2) + ':';
    if (a === 'right') return '-'.repeat(w - 1) + ':';
    if (a === 'left') return ':' + '-'.repeat(w - 1);
    return '-'.repeat(w);
  });
  return [line(all[0]), `| ${sep.join(' | ')} |`, ...all.slice(1).map(line)].join('\n');
}

/** An empty table to start from. */
export function blankTable(cols = 3, rows = 2) {
  return { header: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`), align: Array(cols).fill(null), rows: Array.from({ length: rows }, () => Array(cols).fill('')) };
}

/** Split tab-separated text (what spreadsheets put on the clipboard), honouring "quoted" cells. */
export function parseTsv(text) {
  const src = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * Is this clipboard text a block of spreadsheet cells? At least two columns, and either several rows
 * that all have the same number of columns or a single row of three or more cells.
 */
export function looksLikeCells(text) {
  const s = String(text || '');
  if (!s.includes('\t') || s.length > 500_000) return false;
  const rows = parseTsv(s);
  const counts = new Set(rows.map((r) => r.length));
  if (counts.size !== 1) return false;
  const cols = rows[0].length;
  return cols >= 2 && (rows.length >= 2 || cols >= 3);
}

/** Spreadsheet cells → a Markdown table (the first row becomes the header). Numbers are right-aligned. */
export function cellsToTable(text) {
  const rows = parseTsv(text);
  const header = rows[0];
  const body = rows.slice(1);
  const numeric = (v) => /^[-+(]?[$€£¥]?\s?\d[\d,.\s]*%?\)?$/.test(String(v).trim());
  const align = header.map((_, i) => (body.length && body.every((r) => !r[i]?.trim() || numeric(r[i])) && body.some((r) => r[i]?.trim()) ? 'right' : null));
  return formatTable({ header, align, rows: body });
}
