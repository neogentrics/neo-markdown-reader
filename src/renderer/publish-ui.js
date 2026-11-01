// The PDF designer dialog and the File > Export commands. The page hands its rendered content to
// the main process, which builds the file (see src/main/publish.js).
import { buildModel, toPlainText } from './export-model.js';

const $ = (id) => document.getElementById(id);
const PAPER_RATIO = { letter: 11 / 8.5, a4: 11.69 / 8.27, legal: 14 / 8.5, a5: 8.27 / 5.83 };
const MARGIN_PX = { narrow: 5, normal: 8, wide: 11 };
const LABEL = { pdf: 'PDF', docx: 'Word document', html: 'web page', txt: 'plain text' };

export function createPublish({ api, activeTab, settings, toast, themeCss }) {
  const dlg = $('publish');
  const form = $('publish-form');
  const goBtn = $('publish-go');
  let busy = false;

  /** The active tab's page, cleaned of reader-only bits (copy buttons, private highlights). */
  function payloadFor(tab) {
    const clone = tab.el.cloneNode(true);
    clone.querySelectorAll('.copy-btn, .run-output').forEach((n) => n.remove());
    clone.querySelectorAll('mark[data-hl]').forEach((m) => m.replaceWith(...m.childNodes));
    clone.querySelectorAll('[data-line]').forEach((n) => n.removeAttribute('data-line'));
    const root = document.documentElement;
    return {
      content: clone.innerHTML,
      meta: { name: tab.doc.name, title: tab.result?.title || '', frontMatter: tab.result?.frontMatter || null, toc: tab.result?.toc || [], baseUrl: tab.doc.baseUrl || '' },
      css: themeCss(),
      theme: root.dataset.theme || 'light',
      font: root.dataset.font || 'sans',
    };
  }

  function exportable() {
    const tab = activeTab();
    if (!tab) { toast('Open a document first'); return null; }
    if (tab.doc.compare) { toast('A comparison can’t be exported — export one of the documents instead'); return null; }
    return tab;
  }

  async function run(format, options) {
    const tab = exportable();
    if (!tab || busy) return null;
    busy = true;
    document.body.classList.add('exporting');
    try {
      const payload = { format, ...payloadFor(tab), options };
      if (format === 'docx') payload.model = buildModel(tab.el);
      if (format === 'txt') payload.text = toPlainText(buildModel(tab.el));
      if (format === 'docx' || format === 'txt') delete payload.content;
      toast(`Exporting ${LABEL[format]}…`);
      const res = await api.exportDoc(payload);
      window.__lastExport = res;            // read by the end-to-end tests
      if (res?.ok) toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
      else if (res?.error) toast(res.error);
      else toast('Export cancelled');
      return res;
    } finally {
      busy = false;
      document.body.classList.remove('exporting');
    }
  }

  // ---------------------------------------------------------------- designer
  const current = () => {
    const o = { ...(settings().exportOptions || {}) };
    for (const seg of form.querySelectorAll('.seg[data-opt]')) {
      const on = seg.querySelector('button.active');
      if (on) o[seg.dataset.opt] = on.dataset.value;
    }
    for (const box of form.querySelectorAll('input[type=checkbox][data-opt]')) o[box.dataset.opt] = box.checked;
    return o;
  };

  function fill(o) {
    for (const seg of form.querySelectorAll('.seg[data-opt]')) {
      for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', o[seg.dataset.opt] === b.dataset.value);
    }
    for (const box of form.querySelectorAll('input[type=checkbox][data-opt]')) box.checked = !!o[box.dataset.opt];
  }

  function preview() {
    const o = current();
    const tab = activeTab();
    const paper = o.paper === 'auto' ? (settings().paperAuto || 'letter') : o.paper;
    const box = $('publish-preview');
    box.style.setProperty('--ratio', PAPER_RATIO[paper] || PAPER_RATIO.letter);
    box.style.setProperty('--m', `${MARGIN_PX[o.margins] || 8}px`);
    box.dataset.colors = o.colors;
    box.classList.toggle('dark', o.colors === 'theme' && document.documentElement.dataset.tone === 'dark');
    const fm = tab?.result?.frontMatter || {};
    const title = String(fm.title || tab?.result?.title || tab?.doc.name || 'Untitled');
    const headings = (tab?.result?.toc || []).length;
    $('pv-cover').hidden = !o.cover;
    $('pv-contents').hidden = !o.contents || headings < 1;
    $('pv-cover-title').textContent = title;
    $('pv-cover-sub').textContent = String(fm.subtitle || fm.description || '');
    $('pv-cover-by').textContent = [fm.author, fm.date].filter(Boolean).join(' · ');
    for (const el of box.querySelectorAll('.pv-head')) { el.hidden = !o.header; el.textContent = title; }
    for (const el of box.querySelectorAll('.pv-foot')) el.hidden = !o.pageNumbers;
    $('publish-contents-note').hidden = headings > 0;
    $('publish-paper-auto').textContent = settings().paperAuto === 'a4' ? 'A4' : 'Letter';
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('.seg[data-opt] button');
    if (!b) return;
    e.preventDefault();
    for (const x of b.parentElement.querySelectorAll('button')) x.classList.toggle('active', x === b);
    preview();
  });
  form.addEventListener('change', preview);
  form.addEventListener('submit', (e) => e.preventDefault());

  function openDesigner() {
    const tab = exportable();
    if (!tab) return;
    fill(settings().exportOptions || {});
    $('publish-doc').textContent = tab.doc.name;
    preview();
    if (!dlg.open) dlg.showModal();
    goBtn.focus();
  }

  goBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const options = current();
    goBtn.disabled = true;
    goBtn.textContent = 'Exporting…';
    try {
      const res = await run('pdf', options);
      if (res && !res.canceled) dlg.close();
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = 'Export PDF…';
    }
  });
  $('publish-cancel').addEventListener('click', (e) => { e.preventDefault(); dlg.close(); });
  for (const a of dlg.querySelectorAll('[data-format]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); dlg.close(); run(a.dataset.format); });
  }

  return { openDesigner, exportAs: (format) => (format === 'pdf' ? openDesigner() : run(format)), run, payloadFor };
}
