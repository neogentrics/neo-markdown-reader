// The app's own words in the page, in the chosen language (3.0). The page is written in English;
// this watches it and translates text and labels (title, aria-label, placeholder) as they appear,
// using the same dictionaries as the menus (src/locales). Documents, the editor and names that come
// from your files (tabs, file lists, headings in the outline…) are never translated.
import { createTranslator } from '../main/i18n.js';

const ATTRS = ['title', 'aria-label', 'placeholder'];
// Your content, never translated: documents, the editor, and names taken from files and documents.
const SKIP = [
  '.markdown-body', '.cm-editor', '.cm-tooltip', '[translate="no"]', 'script', 'style', 'kbd', 'code', 'pre', 'textarea',
  '.tab-label', '.file-name', '.file-sub', '.toc', '.hit-text', '.search-file-head', '.backlink', '.task-text', '.tag-chip',
  '.r-name', '.r-path', '.tb-title-name', '.tb-title-meta', '.palette-item', '.hl-item', '.map-svg', '.ask-file', '.check-hit code',
].join(', ');

export function createUiTranslator(root = document.body) {
  let t = createTranslator('en');
  const texts = new WeakMap();          // text node -> { en, shown }
  const attrs = new WeakMap();          // element -> { [attr]: { en, shown } }
  const skip = (el) => !el || !!el.closest(SKIP);

  function text(node) {
    if (skip(node.parentElement)) return;
    const now = node.nodeValue;
    const rec = texts.get(node);
    const en = rec && rec.shown === now ? rec.en : now;          // changed by the app → new English text
    if (!en.trim() || !/[A-Za-z]/.test(en)) return;
    const shown = t(en);
    texts.set(node, { en, shown });
    if (shown !== now) node.nodeValue = shown;
  }

  function attr(el, name) {
    const now = el.getAttribute(name);
    if (now == null) return;
    const all = attrs.get(el) || {};
    const rec = all[name];
    const en = rec && rec.shown === now ? rec.en : now;
    const shown = t(en);
    all[name] = { en, shown };
    attrs.set(el, all);
    if (shown !== now) el.setAttribute(name, shown);
  }

  function walk(node) {
    if (node.nodeType === 3) { text(node); return; }
    if (node.nodeType !== 1 || skip(node)) return;
    for (const a of ATTRS) if (node.hasAttribute(a)) attr(node, a);
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) text(n);
      else for (const a of ATTRS) if (n.hasAttribute(a)) attr(n, a);
    }
  }

  const observer = new MutationObserver((list) => {
    if (t.lang === 'en') return;
    for (const m of list) {
      if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes') { if (!skip(m.target)) attr(m.target, m.attributeName); }
      else for (const n of m.addedNodes) walk(n);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  return {
    /** Switch language; everything shown is translated (or put back into English) at once. */
    setLanguage(code) {
      if (t.lang === code) return;
      t = createTranslator(code);
      document.documentElement.lang = code;
      walk(root);
    },
    t: (s) => t(s),
    get lang() { return t.lang; },
  };
}
