// A document as HTML for a blog post (3.10). The reader's page leans on its own styles and scripts, which a blog doesn't
// have, so this keeps what means something and drops the rest: plain code, plain maths, and nothing that points to a file here.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function asCode(doc, el, text, block) {
  const code = doc.createElement('code');
  code.textContent = block ? text.trim() : text;
  if (!block) { el.replaceWith(code); return; }
  const pre = doc.createElement('pre');
  pre.appendChild(code);
  el.replaceWith(pre);
}

const unwrap = (el) => el.replaceWith(...el.childNodes);

/**
 * @param {(text: string) => { html: string }} render the reader's Markdown renderer
 * @returns {{ html: string, diagrams: number }} `diagrams` counts what went as its source text instead of a drawing
 */
export function postHtml(render, body, doc = document) {
  const box = doc.createElement('template');
  box.innerHTML = render(body).html;
  const root = box.content;
  let diagrams = 0;

  root.querySelectorAll('.doc-meta, .header-anchor').forEach((el) => el.remove());
  root.querySelectorAll('.katex-display, .katex').forEach((el) => {
    if (!el.isConnected && !root.contains(el)) return;
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.textContent;
    asCode(doc, el, tex, el.classList.contains('katex-display'));
  });
  root.querySelectorAll('pre.mermaid-src').forEach((el) => { diagrams += 1; asCode(doc, el, el.textContent, true); });
  root.querySelectorAll('figure.chart').forEach((el) => { diagrams += 1; el.remove(); });
  root.querySelectorAll('pre code').forEach((el) => { el.textContent = el.textContent; });
  root.querySelectorAll('.markdown-alert').forEach((el) => {
    const title = el.querySelector('.markdown-alert-title');
    if (title) {
      const strong = doc.createElement('strong');
      strong.textContent = title.textContent.trim();
      title.replaceChildren(strong);
    }
    const quote = doc.createElement('blockquote');
    quote.append(...el.childNodes);
    el.replaceWith(quote);
  });
  root.querySelectorAll('.markdown-alert-title svg, svg').forEach((el) => el.remove());
  root.querySelectorAll('.table-wrap, section').forEach(unwrap);
  root.querySelectorAll('input[type=checkbox]').forEach((el) => {
    const after = el.nextSibling;
    if (after?.nodeType === 3) after.nodeValue = after.nodeValue.trimStart();
    el.replaceWith(doc.createTextNode(el.hasAttribute('checked') ? '☑ ' : '☐ '));
  });
  root.querySelectorAll('li > label').forEach(unwrap);
  root.querySelectorAll('a[href]').forEach((el) => {
    const href = el.getAttribute('href');
    if (!SCHEME.test(href) && !href.startsWith('#')) unwrap(el);        // a link to a file on this computer goes nowhere on a blog
  });
  root.querySelectorAll('*').forEach((el) => {
    for (const { name } of [...el.attributes]) {
      const language = name === 'class' && el.nodeName === 'CODE' && /\blanguage-[\w+#.-]+/.exec(el.getAttribute('class'));
      if (language) el.setAttribute('class', language[0]);        // blogs use this to colour code
      else if (name === 'class' || name === 'style' || name === 'decoding' || name.startsWith('data-')) el.removeAttribute(name);
      else if (name === 'dir' && el.getAttribute('dir') === 'auto') el.removeAttribute(name);
    }
  });
  const out = doc.createElement('div');
  out.appendChild(root);
  return { html: out.innerHTML.trim(), diagrams };
}
