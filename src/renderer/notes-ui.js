// Connected notes (2.3) in the page: Backlinks under the outline, tag chips in the Files panel, the Tasks
// panel, the link map, the link checker and Rename. The folder's links, tags and tasks are worked out by
// the main process (src/main/folder-index.js); ticking a task off or renaming asks permission there.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const baseName = (p) => String(p).split(/[\\/]/).pop();
const pad2 = (n) => String(n).padStart(2, '0');
/** A line of Markdown as readable text: [[Name|label]] → label, [[Name#Heading]] → Name › Heading, [text](url) → text. */
const plainLine = (t) => String(t)
  .replace(/\[\[([^[\]\n]+)\]\]/g, (_m, inner) => { const [target, label] = inner.split('|'); return label?.trim() || target.replace(/#/, ' › ').trim(); })
  .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');
const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * @param {{ api: any, activeTab: () => any, openAtLine: (path: string, line: number, query?: string) => Promise<void>,
 *   openPath: (path: string) => Promise<void>, folder: () => any, setTagFilter: (f: any) => void, toast: (m: string) => void,
 *   retargetTab: (tab: any, doc: any) => Promise<void> }} ctx
 */
export function createNotesUi(ctx) {
  const { api, toast } = ctx;

  // ---------------------------------------------------------------- backlinks
  const bl = { box: $('backlinks'), list: $('backlinks-list'), count: $('backlinks-count') };
  let blSeq = 0;
  async function renderBacklinks(tab = ctx.activeTab()) {
    const mine = ++blSeq;
    if (!ctx.folder() || !tab?.doc.path || tab.doc.compare) { bl.box.hidden = true; return; }
    const list = await api.backlinks(tab.doc.path);
    if (mine !== blSeq) return;
    bl.box.hidden = false;
    bl.count.textContent = String(list.length);
    bl.list.replaceChildren();
    if (!list.length) { bl.list.innerHTML = '<div class="side-empty">No other document in this folder links here yet. Link to it with <code dir="auto">[[' + esc(baseName(tab.doc.path).replace(/\.[^.]+$/, '')) + ']]</code>.</div>'; return; }
    for (const b of list) {
      const btn = document.createElement('button');
      btn.className = 'backlink';
      btn.title = b.rel;
      btn.innerHTML = `<b>${esc(b.title || baseName(b.from).replace(/\.[^.]+$/, ''))}</b><span>${esc(plainLine(b.context) || b.rel)}</span>`;
      btn.onclick = () => ctx.openAtLine(b.from, b.line);
      bl.list.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------- related documents (3.6)
  const rel = { box: $('related'), list: $('related-list') };
  let relSeq = 0;
  async function renderRelated(tab = ctx.activeTab()) {
    const mine = ++relSeq;
    if (!ctx.folder() || !tab?.doc.path || tab.doc.compare) { rel.box.hidden = true; return; }
    const list = await api.smartRelated(tab.doc.path);
    if (mine !== relSeq) return;
    rel.box.hidden = !list.length;
    rel.list.replaceChildren();
    for (const r of list) {
      const btn = document.createElement('button');
      btn.className = 'backlink';
      btn.title = r.rel;
      const name = document.createElement('b');
      name.textContent = baseName(r.path).replace(/\.[^.]+$/, '');
      const where = document.createElement('span');
      where.textContent = r.rel;
      btn.append(name, where);
      btn.onclick = () => ctx.openPath(r.path);
      rel.list.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------- tags
  const chips = $('tag-chips');
  let activeTag = null;
  async function renderTags() {
    if (!ctx.folder()) { chips.hidden = true; return; }
    const tags = await api.tags();
    chips.hidden = !tags.length;
    chips.replaceChildren();
    const MAX = 24;
    const show = (list) => {
      for (const t of list) {
        const b = document.createElement('button');
        b.className = `tag-chip${activeTag?.tag.toLowerCase() === t.tag.toLowerCase() ? ' active' : ''}`;
        b.setAttribute('aria-pressed', String(activeTag?.tag.toLowerCase() === t.tag.toLowerCase()));
        b.innerHTML = `#${esc(t.tag)} <span>${t.files.length}</span>`;
        b.title = `${t.files.length} document${t.files.length === 1 ? '' : 's'} tagged #${t.tag}`;
        b.onclick = () => {
          activeTag = activeTag?.tag.toLowerCase() === t.tag.toLowerCase() ? null : t;
          ctx.setTagFilter(activeTag);
          renderTags();
        };
        chips.insertBefore(b, more.isConnected ? more : null);
      }
    };
    const more = document.createElement('button');
    more.className = 'link-btn tag-more';
    more.textContent = `+${tags.length - MAX} more`;
    more.onclick = () => { more.remove(); show(tags.slice(MAX)); };
    show(tags.slice(0, MAX));
    if (tags.length > MAX) chips.appendChild(more);
    if (activeTag) { activeTag = tags.find((t) => t.tag.toLowerCase() === activeTag.tag.toLowerCase()) || null; ctx.setTagFilter(activeTag); }
  }

  // ---------------------------------------------------------------- tasks
  const tasks = { list: $('tasks-list'), done: $('tasks-done') };
  const dueLabel = (due, today) => {
    if (!due) return '';
    if (due === today) return 'Today';
    const d = new Date(`${due}T00:00:00`);
    const label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: due.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
    return due < today ? `Overdue · ${label}` : label;
  };
  async function renderTasks() {
    if (!ctx.folder()) {
      tasks.list.innerHTML = '<div class="side-empty">Open a folder to see every task (<code>- [ ]</code>) in it, sorted by due date.</div>';
      return;
    }
    const today = isoDay();
    const all = await api.tasks(today);
    const shown = all.filter((t) => tasks.done.checked || !t.done);
    tasks.list.replaceChildren();
    if (!shown.length) {
      tasks.list.innerHTML = `<div class="side-empty">${all.length ? 'Everything’s done.' : 'No tasks in this folder. Write one as <code>- [ ] Call Sam 📅 ' + today + '</code>.'}</div>`;
      return;
    }
    const groupOf = (t) => (t.done ? 'Done' : !t.due ? 'No date' : t.due < today ? 'Overdue' : t.due === today ? 'Today' : 'Upcoming');
    let group = '';
    let box = null;
    for (const t of shown) {
      const g = groupOf(t);
      if (g !== group) {
        group = g;
        box = document.createElement('div');
        box.className = `task-group group-${g.toLowerCase().replace(' ', '-')}`;
        box.innerHTML = `<div class="group-head">${g}</div>`;
        tasks.list.appendChild(box);
      }
      const row = document.createElement('div');
      row.className = `task${t.done ? ' done' : ''}`;
      const box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.checked = t.done;
      box2.setAttribute('aria-label', `${t.done ? 'Mark not done' : 'Mark done'}: ${t.text}`);
      box2.onchange = async () => {
        box2.disabled = true;
        const res = await api.toggleTask({ path: t.path, line: t.line, done: box2.checked, text: t.text });
        if (!res.ok) {
          box2.checked = !box2.checked;
          toast(res.reason === 'changed' ? 'That task changed in its file — refreshed the list' : res.reason === 'cancelled' ? 'Not changed — editing wasn’t allowed' : res.reason === 'readonly' ? 'That file is read-only' : 'Couldn’t change that task');
        }
        renderTasks();
      };
      const open = document.createElement('button');
      open.className = 'task-text';
      open.title = `${t.rel}, line ${t.line + 1}`;
      open.innerHTML = `<span>${esc(plainLine(t.text).replace(/\s*(?:📅|🗓️?|\bdue[:=]\s*|@due\()\s*\d{4}-\d{2}-\d{2}\)?/i, ''))}</span><small>${esc(baseName(t.path).replace(/\.[^.]+$/, ''))}${t.due ? ` · <em class="${t.due < today && !t.done ? 'late' : ''}">${esc(dueLabel(t.due, today))}</em>` : ''}</small>`;
      open.onclick = () => ctx.openAtLine(t.path, t.line);
      row.append(box2, open);
      box.appendChild(row);
    }
  }
  tasks.done.onchange = renderTasks;
  $('tasks-daily').onclick = () => api.runCommand('daily-note');

  // ---------------------------------------------------------------- link map
  const map = { dlg: $('map-dlg'), svg: $('map-svg'), note: $('map-note') };
  const NS = 'http://www.w3.org/2000/svg';
  /** A small force-directed layout: linked documents pull together, all documents push apart. */
  function layout(nodes, edges, w, h) {
    const n = nodes.length;
    const pos = nodes.map((_, i) => ({ x: w / 2 + Math.cos((i / n) * 2 * Math.PI) * w * 0.35, y: h / 2 + Math.sin((i / n) * 2 * Math.PI) * h * 0.35, vx: 0, vy: 0 }));
    const k = Math.sqrt((w * h) / Math.max(1, n)) * 0.6;
    for (let iter = 0; iter < 260; iter++) {
      const t = 1 - iter / 260;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d2 = Math.max(dx * dx + dy * dy, 25);
          const f = (k * k) / d2;
          pos[i].vx += dx * f * 0.05; pos[i].vy += dy * f * 0.05;
          pos[j].vx -= dx * f * 0.05; pos[j].vy -= dy * f * 0.05;
        }
      }
      for (const [a, b] of edges) {
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const f = (d - k) / d * 0.08;
        pos[a].vx -= dx * f; pos[a].vy -= dy * f;
        pos[b].vx += dx * f; pos[b].vy += dy * f;
      }
      for (const p of pos) {
        p.vx += (w / 2 - p.x) * 0.004; p.vy += (h / 2 - p.y) * 0.004;
        const v = Math.hypot(p.vx, p.vy);
        const max = 30 * t + 1;
        if (v > max) { p.vx *= max / v; p.vy *= max / v; }
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.6; p.vy *= 0.6;
      }
    }
    // Fit to the drawing area.
    const xs = pos.map((p) => p.x);
    const ys = pos.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((w - 120) / Math.max(1, x1 - x0), (h - 80) / Math.max(1, y1 - y0), 2);
    return pos.map((p) => ({ x: 60 + (p.x - x0) * s + ((w - 120) - (x1 - x0) * s) / 2, y: 40 + (p.y - y0) * s + ((h - 80) - (y1 - y0) * s) / 2 }));
  }
  async function openMap() {
    if (!ctx.folder()) { toast('Open a folder to see how its documents link together'); return; }
    const g = await api.linkGraph();
    if (!g?.nodes.length) { toast('No documents in this folder'); return; }
    const nodes = g.nodes.slice(0, 400);
    const edges = g.edges.filter(([a, b]) => a < nodes.length && b < nodes.length);
    const W = 1000;
    const H = 640;
    const pos = layout(nodes, edges, W, H);
    const current = ctx.activeTab()?.doc.path?.toLowerCase();
    map.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    map.svg.replaceChildren();
    const lines = document.createElementNS(NS, 'g');
    lines.setAttribute('class', 'map-edges');
    for (const [a, b] of edges) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', pos[a].x); l.setAttribute('y1', pos[a].y); l.setAttribute('x2', pos[b].x); l.setAttribute('y2', pos[b].y);
      lines.appendChild(l);
    }
    map.svg.appendChild(lines);
    const showLabels = nodes.length <= 80;
    const top = new Set([...nodes].sort((x, y) => y.degree - x.degree).slice(0, 25).map((x) => x.path));
    nodes.forEach((node, i) => {
      const g2 = document.createElementNS(NS, 'g');
      g2.setAttribute('class', `map-node${node.path.toLowerCase() === current ? ' current' : ''}${node.degree ? '' : ' orphan'}`);
      g2.setAttribute('transform', `translate(${pos[i].x} ${pos[i].y})`);
      g2.setAttribute('tabindex', '0');
      g2.setAttribute('role', 'link');
      g2.setAttribute('aria-label', `${node.name}, ${node.degree} link${node.degree === 1 ? '' : 's'}`);
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', String(5 + Math.min(12, Math.sqrt(node.degree) * 3)));
      const title = document.createElementNS(NS, 'title');
      title.textContent = node.rel;
      g2.append(c, title);
      if (showLabels || top.has(node.path) || node.path.toLowerCase() === current) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('y', String(-(9 + Math.min(12, Math.sqrt(node.degree) * 3))));
        t.textContent = node.name.length > 28 ? `${node.name.slice(0, 26)}…` : node.name;
        g2.appendChild(t);
      }
      const go = () => { map.dlg.close(); ctx.openPath(node.path); };
      g2.addEventListener('click', go);
      g2.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      map.svg.appendChild(g2);
    });
    const orphans = nodes.filter((x) => !x.degree).length;
    map.note.textContent = `${nodes.length} document${nodes.length === 1 ? '' : 's'} · ${edges.length} link${edges.length === 1 ? '' : 's'}${orphans ? ` · ${orphans} not linked yet` : ''}${g.nodes.length > nodes.length ? ` · showing the first ${nodes.length}` : ''}`;
    if (!map.dlg.open) map.dlg.showModal();
  }
  $('map-close').onclick = () => map.dlg.close();
  $('folder-map').onclick = openMap;

  // ---------------------------------------------------------------- link checker
  const chk = { dlg: $('check-dlg'), list: $('check-list'), summary: $('check-summary') };
  const KIND = { document: 'Missing document', file: 'Missing file', image: 'Missing picture', heading: 'Missing heading' };
  async function checkLinks() {
    if (!ctx.folder()) { toast('Open a folder to check the links in it'); return; }
    chk.summary.textContent = 'Checking…';
    chk.list.replaceChildren();
    if (!chk.dlg.open) chk.dlg.showModal();
    const problems = await api.checkLinks();
    if (!problems) { chk.summary.textContent = 'Open a folder to check its links.'; return; }
    const files = new Set(problems.map((p) => p.path)).size;
    chk.summary.textContent = problems.length
      ? `${problems.length} link${problems.length === 1 ? '' : 's'} in ${files} document${files === 1 ? '' : 's'} go nowhere. Click one to open it at that line.`
      : 'Every link, picture and heading link in this folder works.';
    let current = '';
    let group = null;
    for (const p of problems) {
      if (p.path !== current) {
        current = p.path;
        group = document.createElement('div');
        group.className = 'check-file';
        group.innerHTML = `<div class="search-file-head">${esc(baseName(p.path))}<span class="file-sub">${esc(p.rel.split(/[\\/]/).slice(0, -1).join('/'))}</span></div>`;
        chk.list.appendChild(group);
      }
      const b = document.createElement('button');
      b.className = 'search-hit check-hit';
      b.innerHTML = `<span class="hit-line">${p.line + 1}</span><span class="hit-text"><b class="check-kind kind-${p.kind}">${esc(KIND[p.kind] || 'Problem')}</b> <code>${esc(p.target)}</code><br><small>${esc(p.message)}</small></span>`;
      b.onclick = () => { chk.dlg.close(); ctx.openAtLine(p.path, p.line); };
      group.appendChild(b);
    }
  }
  $('check-again').onclick = checkLinks;
  $('check-close').onclick = () => chk.dlg.close();
  $('folder-check').onclick = checkLinks;

  // ---------------------------------------------------------------- rename
  const ren = { dlg: $('rename-dlg'), input: $('rename-input'), msg: $('rename-msg') };
  let renaming = null;
  function rename(tab = ctx.activeTab()) {
    if (!tab?.doc.path || tab.doc.compare) { toast('Save the document first'); return; }
    if (tab.doc.locked) { toast('Locked documents can’t be renamed here — use your file manager'); return; }
    if (tab.editing && tab.dirty) { toast('Save your changes first, then rename'); return; }
    renaming = tab;
    ren.input.value = baseName(tab.doc.path);
    ren.msg.textContent = '';
    ren.dlg.showModal();
    ren.input.focus();
    ren.input.setSelectionRange(0, ren.input.value.replace(/\.[^.]+$/, '').length);
  }
  $('rename-cancel').onclick = () => ren.dlg.close();
  $('rename-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tab = renaming;
    if (!tab) return;
    const res = await api.renameDoc(tab.doc.path, ren.input.value);
    if (res.canceled && !res.error) { ren.dlg.close(); return; }
    if (res.error) { ren.msg.textContent = res.error; return; }
    ren.dlg.close();
    await ctx.retargetTab(tab, res.doc);
    if (res.missed) toast(`Renamed — links in ${res.missed} document${res.missed === 1 ? '' : 's'} couldn’t be updated`);
    else toast(res.updated ? `Renamed — ${res.updated} link${res.updated === 1 ? '' : 's'} updated` : 'Renamed');
  });

  return { renderBacklinks, renderRelated, renderTags, renderTasks, openMap, checkLinks, rename, clearTag() { activeTag = null; } };
}
