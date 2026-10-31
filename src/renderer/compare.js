// Compare two versions of a document: a line-by-line diff of the Markdown source, with the changed
// words inside modified lines highlighted. Pure (string in, HTML string out) so it's easy to test.
import { diffLines, diffWordsWithSpace } from 'diff';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const splitLines = (v) => { const l = v.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };

/** Word-level highlight of a removed/added line pair. */
function wordDiff(oldLine, newLine) {
  let a = '';
  let b = '';
  for (const part of diffWordsWithSpace(oldLine, newLine)) {
    if (part.added) b += `<ins>${esc(part.value)}</ins>`;
    else if (part.removed) a += `<del>${esc(part.value)}</del>`;
    else { a += esc(part.value); b += esc(part.value); }
  }
  return [a, b];
}

/**
 * Build the comparison.
 * @returns {{ html: string, added: number, removed: number, same: boolean }}
 */
export function compareDocs(leftText, rightText, { leftName = 'Before', rightName = 'After' } = {}) {
  const left = String(leftText ?? '').replace(/\r\n/g, '\n');
  const right = String(rightText ?? '').replace(/\r\n/g, '\n');
  const parts = diffLines(left, right);
  const rows = [];
  let ln = 1;
  let rn = 1;
  let added = 0;
  let removed = 0;
  const CONTEXT = 3;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lines = splitLines(part.value);
    if (part.removed && parts[i + 1]?.added) {
      // A changed block: pair lines up so the changed words inside them stand out.
      const addLines = splitLines(parts[i + 1].value);
      const n = Math.max(lines.length, addLines.length);
      for (let k = 0; k < n; k++) {
        const o = lines[k];
        const nw = addLines[k];
        if (o !== undefined && nw !== undefined) {
          const [a, b] = wordDiff(o, nw);
          rows.push({ kind: 'del', l: ln++, r: '', html: a });
          rows.push({ kind: 'add', l: '', r: rn++, html: b });
          removed++; added++;
        } else if (o !== undefined) { rows.push({ kind: 'del', l: ln++, r: '', html: esc(o) }); removed++; }
        else { rows.push({ kind: 'add', l: '', r: rn++, html: esc(nw) }); added++; }
      }
      i++;
    } else if (part.removed) {
      for (const o of lines) { rows.push({ kind: 'del', l: ln++, r: '', html: esc(o) }); removed++; }
    } else if (part.added) {
      for (const nw of lines) { rows.push({ kind: 'add', l: '', r: rn++, html: esc(nw) }); added++; }
    } else {
      // Unchanged: keep a few lines of context around changes, fold the rest.
      const first = i === 0;
      const last = i === parts.length - 1;
      const keepHead = first ? 0 : CONTEXT;
      const keepTail = last ? 0 : CONTEXT;
      if (lines.length > keepHead + keepTail + 1) {
        for (let k = 0; k < keepHead; k++) rows.push({ kind: 'same', l: ln + k, r: rn + k, html: esc(lines[k]) });
        const hidden = lines.length - keepHead - keepTail;
        rows.push({ kind: 'fold', html: `${hidden} unchanged line${hidden === 1 ? '' : 's'}` });
        for (let k = lines.length - keepTail; k < lines.length; k++) rows.push({ kind: 'same', l: ln + k, r: rn + k, html: esc(lines[k]) });
      } else {
        lines.forEach((t, k) => rows.push({ kind: 'same', l: ln + k, r: rn + k, html: esc(t) }));
      }
      ln += lines.length;
      rn += lines.length;
    }
  }

  const same = added === 0 && removed === 0;
  const body = rows.map((row) => (row.kind === 'fold'
    ? `<tr class="diff-fold"><td colspan="3">⋯ ${row.html}</td></tr>`
    : `<tr class="diff-${row.kind}"><td class="diff-ln">${row.l}</td><td class="diff-ln">${row.r}</td><td class="diff-code"><span class="diff-sign">${row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>${row.html || ' '}</td></tr>`)).join('');

  const html = `<header class="diff-head">
  <div class="diff-files"><span class="diff-left">− ${esc(leftName)}</span><span class="diff-arrow">→</span><span class="diff-right">+ ${esc(rightName)}</span></div>
  <div class="diff-summary">${same ? 'No differences — the two versions are identical.' : `<b class="diff-n-add">${added} line${added === 1 ? '' : 's'} added</b> · <b class="diff-n-del">${removed} removed</b>`}</div>
</header>${same ? '' : `<div class="diff-wrap"><table class="diff"><tbody>${body}</tbody></table></div>`}`;
  return { html, added, removed, same };
}
