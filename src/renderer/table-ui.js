// Edit Table: a grid for editing a Markdown table without counting pipes. Opens on the table the
// cursor is in (or a new one); rows and columns can be added, moved and deleted, columns aligned, and a
// block of cells pasted from a spreadsheet fills the grid from the cell you paste into.
import { looksLikeCells, parseTsv } from './tables.js';

const ALIGN = [[null, 'Default'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];

export function createTableUi() {
  const $ = (id) => document.getElementById(id);
  const dlg = $('table-dlg');
  const grid = $('table-grid');
  const title = $('table-dlg-title');
  const ok = $('table-ok');
  let model = null;
  let resolve = null;

  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICONS = { left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', del: 'M6 6l12 12M18 6L6 18' };

  function button(label, iconName, onClick, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn sm';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(ICONS[iconName]);
    b.disabled = disabled;
    b.onclick = onClick;
    return b;
  }

  function cellInput(r, c, value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.spellcheck = true;
    input.dataset.r = r;
    input.dataset.c = c;
    input.setAttribute('aria-label', r < 0 ? `Heading of column ${c + 1}` : `Row ${r + 1}, column ${c + 1}`);
    input.oninput = () => { if (r < 0) model.header[c] = input.value; else model.rows[r][c] = input.value; };
    input.onpaste = (e) => {
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!looksLikeCells(text) && !/\n./.test(text.replace(/\n$/, ''))) return;
      e.preventDefault();
      fill(r, c, parseTsv(text));
    };
    return input;
  }

  /** Paste a block of cells with its top-left corner at (r, c), growing the table if needed. */
  function fill(r, c, block) {
    const cols = model.header.length;
    const needCols = c + Math.max(...block.map((row) => row.length));
    for (let i = cols; i < needCols; i++) { model.header.push(''); model.align.push(null); model.rows.forEach((row) => row.push('')); }
    block.forEach((row, i) => {
      const target = r + i;
      if (target < 0) { row.forEach((v, j) => { model.header[c + j] = v; }); return; }
      while (model.rows.length <= target) model.rows.push(Array(model.header.length).fill(''));
      row.forEach((v, j) => { model.rows[target][c + j] = v; });
    });
    render();
  }

  function render(focus = null) {
    const cols = model.header.length;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    // Column controls: alignment, move, delete.
    const ctl = document.createElement('tr');
    ctl.className = 'col-controls';
    ctl.appendChild(document.createElement('td'));
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Alignment of column ${c + 1}`);
      for (const [v, label] of ALIGN) { const o = new Option(label, v ?? ''); o.selected = (model.align[c] ?? null) === v; sel.appendChild(o); }
      sel.onchange = () => { model.align[c] = sel.value || null; };
      td.append(sel,
        button(`Move column ${c + 1} left`, 'left', () => moveCol(c, -1), c === 0),
        button(`Move column ${c + 1} right`, 'right', () => moveCol(c, 1), c === cols - 1),
        button(`Delete column ${c + 1}`, 'del', () => deleteCol(c), cols === 1));
      ctl.appendChild(td);
    }
    head.appendChild(ctl);
    const hr = document.createElement('tr');
    hr.className = 'header-row';
    const th0 = document.createElement('th');
    th0.textContent = 'Heading';
    hr.appendChild(th0);
    for (let c = 0; c < cols; c++) { const th = document.createElement('th'); th.appendChild(cellInput(-1, c, model.header[c])); hr.appendChild(th); }
    head.appendChild(hr);
    table.appendChild(head);
    const body = document.createElement('tbody');
    model.rows.forEach((row, r) => {
      const tr = document.createElement('tr');
      const lead = document.createElement('td');
      lead.className = 'row-controls';
      lead.append(
        button(`Move row ${r + 1} up`, 'up', () => moveRow(r, -1), r === 0),
        button(`Move row ${r + 1} down`, 'down', () => moveRow(r, 1), r === model.rows.length - 1),
        button(`Delete row ${r + 1}`, 'del', () => deleteRow(r)));
      tr.appendChild(lead);
      for (let c = 0; c < cols; c++) { const td = document.createElement('td'); td.appendChild(cellInput(r, c, row[c] ?? '')); tr.appendChild(td); }
      body.appendChild(tr);
    });
    table.appendChild(body);
    grid.replaceChildren(table);
    if (focus) grid.querySelector(`input[data-r="${focus.r}"][data-c="${focus.c}"]`)?.focus();
  }

  const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
  function moveCol(c, d) { swap(model.header, c, c + d); swap(model.align, c, c + d); model.rows.forEach((r) => swap(r, c, c + d)); render(); }
  function deleteCol(c) { model.header.splice(c, 1); model.align.splice(c, 1); model.rows.forEach((r) => r.splice(c, 1)); render(); }
  function moveRow(r, d) { swap(model.rows, r, r + d); render(); }
  function deleteRow(r) { model.rows.splice(r, 1); render(); }

  $('table-add-row').onclick = () => { model.rows.push(Array(model.header.length).fill('')); render({ r: model.rows.length - 1, c: 0 }); };
  $('table-add-col').onclick = () => { model.header.push(`Column ${model.header.length + 1}`); model.align.push(null); model.rows.forEach((r) => r.push('')); render({ r: -1, c: model.header.length - 1 }); };
  $('table-cancel').onclick = () => dlg.close();
  ok.onclick = () => { const done = resolve; resolve = null; dlg.close(); done?.({ header: [...model.header], align: [...model.align], rows: model.rows.map((r) => [...r]) }); };
  dlg.addEventListener('close', () => { const done = resolve; resolve = null; done?.(null); });
  // Enter in a cell moves down a row (adding one at the bottom), like a spreadsheet.
  grid.addEventListener('keydown', (e) => {
    const input = e.target.closest('input[data-r]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const r = Number(input.dataset.r) + 1;
    const c = Number(input.dataset.c);
    if (r >= model.rows.length) model.rows.push(Array(model.header.length).fill(''));
    render({ r, c });
  });

  /** Edit `table` ({ header, align, rows }). Resolves to the edited table, or null if cancelled. */
  function open(table, { isNew = false } = {}) {
    model = { header: [...table.header], align: [...table.align], rows: table.rows.map((r) => [...r]) };
    if (!model.rows.length) model.rows.push(Array(model.header.length).fill(''));
    title.textContent = isNew ? 'Insert Table' : 'Edit Table';
    ok.textContent = isNew ? 'Insert' : 'Update Table';
    render();
    dlg.showModal();
    grid.querySelector('input')?.focus();
    return new Promise((r) => { resolve = r; });
  }

  return { open };
}
