'use strict';
// Runs a folder-wide find & replace in a worker thread with a time limit, so a slow pattern can never
// freeze the app. The worker only reads files and works out the new text; the main process (main.js)
// asks first, keeps the old versions in History, backs files up and does every write.
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');

const LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxTotal: 5000, timeoutMs: 15000 });

// The worker is started from source text (the app's files can sit inside an archive a worker can't read).
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const R = (() => { const module = { exports: {} }; (function (module, exports) { ${fs.readFileSync(require.resolve('./replace.js'), 'utf8')} })(module, module.exports); return module.exports; })();
const BOM = '\\ufeff';
function load(p) {
  const st = fs.statSync(p);
  if (!st.isFile() || st.size > workerData.limits.maxBytes) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  const crlf = (body.match(/\\r\\n/g) || []).length;
  const lf = (body.match(/\\n/g) || []).length - crlf;
  return { text: body.replace(/\\r\\n/g, '\\n'), bom, eol: crlf > lf ? '\\r\\n' : '\\n', mtime: st.mtimeMs };
}
try {
  const { mode, files, find, replacement, opts, chosen, limits } = workerData;
  const re = R.buildMatcher(find, opts);
  if (mode === 'preview') {
    const results = [];
    let total = 0;
    let truncated = false;
    for (const f of files) {
      if (total >= limits.maxTotal) { truncated = true; break; }
      let doc;
      try { doc = load(f.path); } catch { continue; }
      if (!doc) continue;
      const found = R.findMatches(doc.text, re, replacement, { regex: !!opts.regex, max: Math.min(R.MAX_PER_FILE, limits.maxTotal - total) });
      if (!found.matches.length) continue;
      if (found.truncated) truncated = true;
      total += found.matches.length;
      results.push({ path: f.path, rel: f.rel, mtime: doc.mtime, truncated: found.truncated,
        matches: found.matches.map(({ i, line, found: text, replacement: rep, prefix, suffix }) => ({ i, line, found: text, replacement: rep, prefix, suffix })) });
    }
    parentPort.postMessage({ ok: true, results, total, truncated });
  } else {
    const out = [];
    for (const [p, list] of Object.entries(chosen)) {
      let doc;
      try { doc = load(p); } catch (err) { out.push({ path: p, error: 'unreadable' }); continue; }
      if (!doc) { out.push({ path: p, error: 'too-large' }); continue; }
      const found = R.findMatches(doc.text, re, replacement, { regex: !!opts.regex });
      const valid = list.filter((i) => Number.isInteger(i) && i >= 0 && i < found.matches.length);
      out.push({ path: p, mtime: doc.mtime, eol: doc.eol, bom: doc.bom, count: valid.length, content: R.applyChosen(doc.text, found.matches, valid) });
    }
    parentPort.postMessage({ ok: true, files: out });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: err instanceof R.PatternError ? err.message : String(err && err.message || err) });
}
`;

/**
 * @param {{ mode: 'preview' | 'apply', files?: { path: string, rel: string }[], chosen?: Record<string, number[]>,
 *           find: string, replacement: string, opts: { regex?: boolean, matchCase?: boolean, wholeWord?: boolean } }} job
 */
function runJob(job, limits = LIMITS) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { ...job, files: job.files || [], chosen: job.chosen || {}, limits } });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: 'That search took too long and was stopped. Try a simpler pattern.' });
    }, limits.timeoutMs);
    worker.once('message', (msg) => { clearTimeout(timer); worker.terminate(); resolve(msg); });
    worker.once('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: String(err?.message || err) }); });
  });
}

module.exports = { runJob, LIMITS };
