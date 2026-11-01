// ▶ Run buttons on JavaScript and Python code blocks, and the output panel under them.
// The page never runs the code itself: it hands it to the main process, which asks first and
// then runs it in a sealed sandbox (src/main/sandbox.js).

const RUNNABLE = { js: 'javascript', javascript: 'javascript', mjs: 'javascript', node: 'javascript', py: 'python', python: 'python', python3: 'python' };
const NAMES = { javascript: 'JavaScript', python: 'Python' };

export const runnableLang = (label) => RUNNABLE[String(label || '').trim().toLowerCase()] || null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Build the output panel for a finished run (text only — output is never treated as HTML). */
export function outputPanel(res, lang) {
  const box = el('div', 'run-output');
  box.setAttribute('role', 'status');
  const head = el('div', 'run-head');
  let status;
  if (res.canceled) status = 'Not run';
  else if (res.timedOut) status = `Stopped — it ran longer than allowed`;
  else if (res.error && !res.output?.length && res.ms == null) status = 'Couldn’t run';
  else status = `${NAMES[lang] || 'Code'} · finished in ${res.ms < 1000 ? `${res.ms} ms` : `${(res.ms / 1000).toFixed(1)} s`}`;
  head.append(el('span', 'run-status', status));
  const close = el('button', 'run-close', '×');
  close.type = 'button';
  close.title = 'Close output';
  close.setAttribute('aria-label', 'Close output');
  close.onclick = () => box.remove();
  head.append(close);
  box.append(head);
  const body = el('pre', 'run-body');
  for (const o of res.output || []) body.append(el('span', o.stream === 'err' ? 'run-err' : 'run-out', o.text));
  if (res.result != null && res.result !== '') body.append(el('span', 'run-result', `→ ${res.result}\n`));
  if (res.error) body.append(el('span', 'run-err', `${res.error}\n`));
  if (!body.childNodes.length) body.append(el('span', 'run-empty', res.canceled ? 'Cancelled.' : '(no output)'));
  if (res.clipped) body.append(el('span', 'run-empty', '\n… output shortened'));
  box.append(body);
  return box;
}

export function addRunButtons(root, { api, docFor, toast }) {
  for (const pre of root.querySelectorAll('pre.code-block[data-lang]')) {
    const lang = runnableLang(pre.dataset.lang);
    if (!lang || pre.querySelector('.run-btn')) continue;
    const btn = el('button', 'copy-btn run-btn', '▶ Run');
    btn.type = 'button';
    btn.title = `Run this ${NAMES[lang]} in a sandbox (asks first)`;
    btn.addEventListener('mousedown', (e) => e.preventDefault());   // focusing it would scroll a wide code block sideways
    btn.onclick = async () => {
      const code = pre.querySelector('code')?.textContent ?? '';
      const doc = docFor(pre) || {};
      btn.disabled = true;
      btn.textContent = 'Running…';
      let res;
      try { res = await api.runCode({ lang, code, path: doc.path || '', name: doc.name || '' }); } catch (err) { res = { error: String(err?.message || err) }; }
      btn.disabled = false;
      btn.textContent = '▶ Run';
      if (res?.off) { toast(res.error); return; }
      if (res?.canceled) return;
      const next = pre.nextElementSibling;
      if (next?.classList.contains('run-output')) next.remove();
      pre.after(outputPanel(res || { error: 'No result' }, lang));
    };
    pre.appendChild(btn);
  }
}
