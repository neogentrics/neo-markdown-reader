// Exports the document's headings as an OPML outline (opens in outliners and mind-map apps).
// Runs in RT Markdown Reader's sealed sandbox: it gets the document and returns the file's text.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main({ title, headings }) {
  let xml = '';
  const open = [];
  for (const h of headings) {
    while (open.length && open[open.length - 1] >= h.level) { xml += '</outline>'; open.pop(); }
    xml += `<outline text="${esc(h.text)}">`;
    open.push(h.level);
  }
  while (open.pop() !== undefined) xml += '</outline>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${esc(title)}</title></head><body>${xml}</body></opml>\n`;
}
