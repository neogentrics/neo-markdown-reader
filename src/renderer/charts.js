// Charts from data (2.4): a ```chart block, or a table with <!-- chart: bar --> just before it, becomes
// a bar, line or pie chart drawn as SVG in the theme's colours. Pure functions: no DOM, used by the
// renderer and the tests. The SVG is part of the page, so PDF, web page and Word exports include it.

const TYPES = new Set(['bar', 'line', 'pie']);
const ALIASES = { column: 'bar', columns: 'bar', bars: 'bar', lines: 'line', area: 'line', donut: 'pie', doughnut: 'pie' };
const KEYS = new Set(['type', 'title', 'x', 'y', 'stacked', 'unit', 'height']);
const COLORS = ['var(--chart-1, #3b5bdb)', 'var(--chart-2, #0ca678)', 'var(--chart-3, #f08c00)', 'var(--chart-4, #e64980)',
  'var(--chart-5, #7048e8)', 'var(--chart-6, #1098ad)', 'var(--chart-7, #d9480f)', 'var(--chart-8, #5c940d)'];
const INK = 'var(--chart-ink, #495057)';
const GRID = 'var(--chart-grid, #dee2e6)';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "1,234.5", "$1 200", "12%", "(30)" → a number, or null. */
export function toNumber(v) {
  let s = String(v ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$€£¥%\s]/g, '').replace(/^\+/, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function splitRow(line) {
  if (line.includes('|')) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
    return cells;
  }
  const sep = line.includes('\t') ? '\t' : (line.split(';').length > line.split(',').length ? ';' : ',');
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"' && !cell.trim()) { quoted = true; cell = ''; }
    else if (c === sep) { out.push(cell.trim()); cell = ''; }
    else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/**
 * Read a chart block: optional "key: value" lines (type, title, x, y, stacked, unit), then the data as a
 * Markdown table or CSV with a header row. Throws an Error with a plain explanation when it can't.
 * @returns {{ type: string, title: string, unit: string, stacked: boolean, labels: string[], series: { name: string, values: (number|null)[] }[] }}
 */
export function parseChart(text) {
  const opts = {};
  const rows = [];
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || /^---+$/.test(line)) continue;
    const kv = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!rows.length && kv && KEYS.has(kv[1].toLowerCase()) && !line.includes('|')) { opts[kv[1].toLowerCase()] = kv[2].trim(); continue; }
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) continue;      // the |---|---| row of a Markdown table
    rows.push(splitRow(line));
  }
  return fromRows(rows, opts);
}

/** Build a chart from rows of cells (first row = header) and options (as parseChart). */
export function fromRows(rows, opts = {}) {
  let type = String(opts.type || 'bar').toLowerCase();
  type = ALIASES[type] || type;
  if (!TYPES.has(type)) throw new Error(`“${opts.type}” isn’t a chart type — use bar, line or pie.`);
  if (rows.length < 2) throw new Error('A chart needs a header row and at least one row of data.');
  const head = rows[0].map((h, i) => h || `Column ${i + 1}`);
  const body = rows.slice(1).filter((r) => r.some((c) => c !== ''));
  const find = (name) => {
    const i = head.findIndex((h) => h.toLowerCase() === String(name).trim().toLowerCase());
    if (i < 0) throw new Error(`There’s no column called “${String(name).trim()}”.`);
    return i;
  };
  const xi = opts.x ? find(opts.x) : 0;
  let yi = opts.y ? String(opts.y).split(',').map(find) : head.map((_, i) => i).filter((i) => i !== xi && body.some((r) => toNumber(r[i]) !== null));
  if (!yi.length) throw new Error('No column of numbers to draw.');
  if (type === 'pie') yi = yi.slice(0, 1);
  const series = yi.slice(0, 8).map((i) => ({ name: head[i], values: body.slice(0, 200).map((r) => toNumber(r[i])) }));
  return {
    type, title: opts.title || '', unit: opts.unit || '', stacked: /^(yes|true|on|1)$/i.test(opts.stacked || ''),
    height: Number(opts.height) > 0 ? Math.min(720, Math.max(200, Number(opts.height))) : 0,
    labels: body.slice(0, 200).map((r) => r[xi] ?? ''), series,
  };
}

/** Round numbers for an axis: 0 … max in about 5 steps of 1, 2, 2.5 or 5 × 10ⁿ. */
export function niceScale(min, max, steps = 5) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return { lo: 0, hi: 1, step: 0.2 };
  const raw = (hi - lo) / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

function fmt(n, unit = '') {
  const abs = Math.abs(n);
  const s = abs >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${+(n / 1e3).toFixed(1)}k`
    : `${+n.toFixed(Math.abs(n) < 1 && n !== 0 ? 2 : 1)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return unit === '%' ? `${s}%` : unit ? `${unit}${s}` : s;
}
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** The chart as an SVG string (scales to the page width). */
export function chartSvg(chart) {
  const W = 640;
  const H = chart.height || (chart.type === 'pie' ? 320 : 340);
  const top = chart.title ? 44 : 16;
  const legend = chart.series.length > 1 || chart.type === 'pie';
  const parts = [];
  const summary = chart.type === 'pie'
    ? chart.labels.map((l, i) => `${l}: ${fmt(chart.series[0].values[i] ?? 0, chart.unit)}`).join(', ')
    : chart.series.map((s) => `${s.name}: ${s.values.map((v, i) => `${chart.labels[i]} ${v == null ? 'none' : fmt(v, chart.unit)}`).join(', ')}`).join('; ');
  const label = `${chart.title ? `${chart.title}. ` : ''}${chart.type === 'pie' ? 'Pie' : chart.type === 'line' ? 'Line' : 'Bar'} chart. ${summary}`;
  if (chart.title) parts.push(`<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" style="fill:var(--chart-title, #212529)">${esc(chart.title)}</text>`);

  if (chart.type === 'pie') {
    const vals = chart.series[0].values.map((v) => Math.max(0, v || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min((H - top - 16) / 2, 130);
    const cx = 200;
    const cy = top + (H - top) / 2 - 4;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return;
      const b = a + (v / total) * Math.PI * 2;
      const color = COLORS[i % COLORS.length];
      if (v === total) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${color}"/>`);
      else {
        const large = b - a > Math.PI ? 1 : 0;
        const p = (t) => `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
        parts.push(`<path d="M${cx} ${cy} L${p(a)} A${r} ${r} 0 ${large} 1 ${p(b)} Z" style="fill:${color};stroke:var(--page, #fff);stroke-width:2"><title>${esc(chart.labels[i])}: ${esc(fmt(v, chart.unit))} (${Math.round((v / total) * 100)}%)</title></path>`);
      }
      a = b;
    });
    chart.labels.slice(0, 12).forEach((l, i) => {
      const y = top + 12 + i * 22;
      const pct = Math.round(((vals[i] || 0) / total) * 100);
      parts.push(`<rect x="370" y="${y - 10}" width="12" height="12" rx="2" style="fill:${COLORS[i % COLORS.length]}"/><text x="390" y="${y}" font-size="13" style="fill:${INK}">${esc(clip(l, 24))} · ${pct}%</text>`);
    });
  } else {
    const left = 58;
    const right = 16;
    const bottom = legend ? 70 : 44;
    const plotW = W - left - right;
    const plotH = H - top - bottom;
    const n = chart.labels.length;
    const sums = chart.labels.map((_, i) => chart.series.reduce((acc, s) => acc + Math.max(0, s.values[i] || 0), 0));
    const all = chart.stacked && chart.type === 'bar' ? sums : chart.series.flatMap((s) => s.values.filter((v) => v != null));
    const { lo, hi, step } = niceScale(Math.min(...all, 0), Math.max(...all, 0));
    const y = (v) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
    for (let t = lo; t <= hi + step / 2; t += step) {
      const ty = y(t).toFixed(1);
      parts.push(`<line x1="${left}" x2="${W - right}" y1="${ty}" y2="${ty}" style="stroke:${GRID};stroke-width:1"/><text x="${left - 8}" y="${+ty + 4}" text-anchor="end" font-size="11" style="fill:${INK}">${esc(fmt(t, chart.unit))}</text>`);
    }
    const band = plotW / Math.max(1, n);
    const every = Math.ceil(n / Math.floor(plotW / 54));
    const rotate = n > 8 && every === 1;
    chart.labels.forEach((l, i) => {
      if (i % every) return;
      const lx = left + band * i + band / 2;
      const ly = top + plotH + 16;
      parts.push(rotate
        ? `<text x="${lx}" y="${ly}" text-anchor="end" font-size="11" transform="rotate(-35 ${lx} ${ly})" style="fill:${INK}">${esc(clip(l, 14))}</text>`
        : `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" style="fill:${INK}">${esc(clip(l, Math.max(4, Math.floor(band / 7))))}</text>`);
    });
    if (chart.type === 'bar') {
      const groups = chart.stacked ? 1 : chart.series.length;
      const bw = Math.max(2, Math.min(48, (band * 0.72) / groups));
      chart.labels.forEach((l, i) => {
        let base = 0;
        chart.series.forEach((s, k) => {
          const v = s.values[i];
          if (v == null) return;
          const x = left + band * i + (band - bw * groups) / 2 + (chart.stacked ? 0 : k * bw);
          const from = chart.stacked ? base : 0;
          const to = chart.stacked ? base + Math.max(0, v) : v;
          if (chart.stacked) base = to;
          const y1 = y(Math.max(from, to));
          const h = Math.abs(y(from) - y(to));
          parts.push(`<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw - (groups > 1 ? 2 : 0)).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" rx="2" style="fill:${COLORS[k % COLORS.length]}"><title>${esc(l)} · ${esc(s.name)}: ${esc(fmt(v, chart.unit))}</title></rect>`);
        });
      });
    } else {
      chart.series.forEach((s, k) => {
        const pts = s.values.map((v, i) => (v == null ? null : [left + band * i + band / 2, y(v)]));
        const color = COLORS[k % COLORS.length];
        let d = '';
        pts.forEach((p, i) => { if (p) d += `${d && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `; });
        parts.push(`<path d="${d.trim()}" style="fill:none;stroke:${color};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>`);
        pts.forEach((p, i) => { if (p && n <= 60) parts.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" style="fill:${color};stroke:var(--page, #fff);stroke-width:1.5"><title>${esc(chart.labels[i])} · ${esc(s.name)}: ${esc(fmt(s.values[i], chart.unit))}</title></circle>`); });
      });
    }
    parts.push(`<line x1="${left}" x2="${W - right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" style="stroke:${INK};stroke-width:1"/>`);
    if (legend) {
      let lx = left;
      const ly = H - 14;
      chart.series.forEach((s, k) => {
        parts.push(`<rect x="${lx}" y="${ly - 10}" width="12" height="12" rx="2" style="fill:${COLORS[k % COLORS.length]}"/><text x="${lx + 18}" y="${ly}" font-size="12" style="fill:${INK}">${esc(clip(s.name, 22))}</text>`);
        lx += 30 + Math.min(22, s.name.length) * 7;
      });
    }
  }
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}" font-family="inherit" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** A chart block's source as the HTML to show: the chart, or a plain explanation of what's wrong. */
export function renderChart(text) {
  try {
    return `<figure class="chart">${chartSvg(parseChart(text))}</figure>`;
  } catch (err) {
    return `<div class="chart-error"><b>This chart can’t be drawn:</b> ${esc(err.message)}<pre>${esc(text)}</pre></div>`;
  }
}
