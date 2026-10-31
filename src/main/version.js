'use strict';
/** Compare two version strings like "1.2.0" / "v1.10.3". Returns 1, 0 or -1. Pre-release tags are ignored. */
function compareVersions(a, b) {
  const parse = (v) => String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
module.exports = { compareVersions };
