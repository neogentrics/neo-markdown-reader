// The code sandbox page. It runs in a hidden window on its own in-memory session, where every
// network request is refused, and it has no access to Node.js, the file system or the app.
// Each run happens in a Web Worker so a runaway program can simply be stopped.

const LIMIT_OUTPUT = 100_000;      // characters of output kept per run
let pyWorker = null;               // Python takes a moment to start, so its worker is reused

function makeWorker() {
  return new Worker(new URL('./runner.js', import.meta.url), { type: 'module', name: 'runner' });
}

function runIn(worker, { lang, code, timeoutMs }, { keep = false } = {}) {
  return new Promise((resolve) => {
    const output = [];
    let size = 0;
    let clipped = false;
    const started = performance.now();
    let timer = null;
    const finish = (extra) => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      if (!keep || extra.timedOut || extra.crashed) worker.terminate();
      resolve({ output, clipped, ms: Math.round(performance.now() - started), ...extra });
    };
    const onMessage = ({ data }) => {
      if (data.type === 'out') {
        if (size >= LIMIT_OUTPUT) { clipped = true; return; }
        const text = String(data.text).slice(0, LIMIT_OUTPUT - size);
        size += text.length;
        output.push({ stream: data.stream, text });
      } else if (data.type === 'ready') {
        timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
      } else if (data.type === 'done') {
        finish({ error: data.error || null, result: data.result ?? null });
      }
    };
    worker.addEventListener('message', onMessage);
    worker.onerror = (e) => { e.preventDefault?.(); finish({ error: String(e.message || 'The program crashed'), crashed: true }); };
    // The start-up of Python is not counted against the program's time; a stuck start-up is.
    timer = setTimeout(() => finish({ timedOut: true, error: 'The code runner didn’t start in time.' }), 60_000);
    worker.postMessage({ lang, code });
  });
}

window.__run = async function run(req) {
  const lang = req.lang === 'python' ? 'python' : 'javascript';
  const timeoutMs = Math.max(1000, Math.min(120_000, Number(req.timeoutMs) || 10_000));
  const code = String(req.code || '');
  if (lang === 'python') {
    pyWorker ??= makeWorker();
    const res = await runIn(pyWorker, { lang, code, timeoutMs }, { keep: true });
    if (res.timedOut || res.crashed) pyWorker = null;
    return res;
  }
  return runIn(makeWorker(), { lang, code, timeoutMs });
};
