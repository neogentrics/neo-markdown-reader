// Split view: a second tab shown beside the active one, with optional linked scrolling.
export function createSplit(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = { pane: $('desk2'), pages: $('pages2'), select: $('split-select'), link: $('split-link'), swap: $('split-swap'), close: $('split-close') };
  let rightId = null;
  let linked = false;

  const rightTab = () => ctx.tabs().find((t) => t.id === rightId) || null;

  function placeRight(tab) {
    els.pages.appendChild(tab.el);
    tab.el.hidden = false;
    tab.btn.classList.add('split');
  }
  function returnLeft(tab) {
    tab.btn.classList.remove('split');
    ctx.pages.appendChild(tab.el);
    tab.el.hidden = tab.id !== ctx.activeId();
  }

  function fillSelect() {
    els.select.replaceChildren();
    for (const t of ctx.tabs()) {
      if (t.id === ctx.activeId()) continue;
      const o = document.createElement('option');
      o.value = String(t.id);
      o.textContent = t.doc.name;
      o.selected = t.id === rightId;
      els.select.appendChild(o);
    }
  }

  /** Show `tab` on the right of the active tab. */
  function open(tab) {
    if (!tab || tab.id === ctx.activeId()) return;
    if (ctx.activeTab()?.editing) { ctx.toast('Finish editing (click Done) to use split view'); return; }
    const old = rightTab();
    if (old && old !== tab) returnLeft(old);
    rightId = tab.id;
    placeRight(tab);
    document.body.classList.add('split');
    els.pane.hidden = false;
    els.pane.scrollTop = tab.scroll * Math.max(0, els.pane.scrollHeight - els.pane.clientHeight);
    els.link.classList.toggle('active', linked);
    fillSelect();
  }

  function close() {
    const t = rightTab();
    if (t) { t.scroll = ratio(els.pane); returnLeft(t); }
    rightId = null;
    document.body.classList.remove('split');
    els.pane.hidden = true;
  }

  function toggle() {
    if (rightId) { close(); return; }
    const tabs = ctx.tabs();
    if (tabs.length < 2) { ctx.toast('Open a second document to see two side by side'); return; }
    const i = tabs.findIndex((t) => t.id === ctx.activeId());
    open(tabs[(i + 1) % tabs.length]);
  }

  /** Called when the active (left) tab changes. If the right tab became active, the old one moves right. */
  function afterActivate(prev, next) {
    if (!rightId) return;
    if (next.id === rightId) {
      returnLeft(next);
      next.el.hidden = false;
      if (prev && prev !== next) { rightId = prev.id; placeRight(prev); } else close();
    }
    if (next.editing) close();
    fillSelect();
  }

  function onClose(tab) { if (tab.id === rightId) { rightId = null; document.body.classList.remove('split'); els.pane.hidden = true; } fillSelect(); }

  // ---- linked scrolling (by position in the document)
  const ratio = (el) => { const max = el.scrollHeight - el.clientHeight; return max > 0 ? el.scrollTop / max : 0; };
  const setRatio = (el, r) => { el.scrollTop = r * Math.max(0, el.scrollHeight - el.clientHeight); };
  // Moving one pane makes the other fire its own scroll event; recognise that echo by its position
  // (not by timing, which breaks when the window isn't being painted) so it isn't sent back.
  let echo = null;              // { el, top } — the scroll we just caused
  function mirror(from, to) {
    if (!linked || !rightId) return;
    if (echo && echo.el === from && Math.abs(from.scrollTop - echo.top) < 2) { echo = null; return; }
    setRatio(to, ratio(from));
    echo = { el: to, top: to.scrollTop };
  }
  ctx.desk.addEventListener('scroll', () => mirror(ctx.desk, els.pane), { passive: true });
  els.pane.addEventListener('scroll', () => { mirror(els.pane, ctx.desk); const t = rightTab(); if (t) t.scroll = ratio(els.pane); }, { passive: true });

  function setLinked(v) { linked = v; els.link.classList.toggle('active', linked); if (linked) mirror(ctx.desk, els.pane); ctx.toast(linked ? 'Scrolling is linked' : 'Scrolling is independent'); }

  els.select.onchange = () => { const t = ctx.tabs().find((x) => String(x.id) === els.select.value); if (t) open(t); };
  els.link.onclick = () => setLinked(!linked);
  els.swap.onclick = () => { const r = rightTab(); if (r) ctx.activate(r.id); };
  els.close.onclick = close;

  return { open, close, toggle, afterActivate, onClose, rightTab, isOpen: () => !!rightId, toggleLink: () => setLinked(!linked), pane: els.pane };
}
