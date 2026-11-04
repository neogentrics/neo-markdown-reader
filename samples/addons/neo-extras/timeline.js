// Draws a ```timeline code block: one event per line, "date: what happened".
//   2026-01: Kick-off
//   2026-03: Beta
// Runs in RT Markdown Reader's sealed sandbox: it gets the block's text and returns SVG.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main({ code }) {
  const events = code.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? { when: l.slice(0, i).trim(), what: l.slice(i + 1).trim() } : { when: '', what: l };
  }).slice(0, 40);
  if (!events.length) return '<p><em>This timeline is empty.</em></p>';
  const rowH = 46;
  const w = 640;
  const h = events.length * rowH + 20;
  const parts = [`<line x1="140" x2="140" y1="10" y2="${h - 10}" style="stroke:var(--accent, #3b5bdb);stroke-width:3;stroke-linecap:round"/>`];
  events.forEach((e, k) => {
    const y = 30 + k * rowH;
    parts.push(`<text x="122" y="${y + 5}" text-anchor="end" font-size="13" font-weight="600" style="fill:var(--muted, #5f687b)">${esc(e.when)}</text>`);
    parts.push(`<circle cx="140" cy="${y}" r="8" style="fill:var(--page, #fff);stroke:var(--accent, #3b5bdb);stroke-width:3"/>`);
    parts.push(`<text x="162" y="${y + 5}" font-size="15" style="fill:var(--text, #1d2330)">${esc(e.what)}</text>`);
  });
  const label = events.map((e) => `${e.when} ${e.what}`).join('; ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Timeline: ${esc(label)}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
