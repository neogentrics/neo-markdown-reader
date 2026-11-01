// Runs one program inside a Web Worker of the sandbox page. Output from console.log / print is
// sent back line by line. Network functions are removed before any user code runs (the sandbox
// session also refuses every request, so this is a second lock on the same door).

const post = (msg) => self.postMessage(msg);
const show = (v) => {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try { return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x), 2) ?? String(v); } catch { return String(v); }
};

function sealNetwork() {
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'WebTransport', 'BroadcastChannel', 'Worker', 'SharedWorker']) {
    try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch { /* already gone */ }
  }
  try { Object.defineProperty(self, 'navigator', { value: undefined, configurable: false }); } catch { /* ignore */ }
}

function captureConsole() {
  const mk = (stream) => (...args) => post({ type: 'out', stream, text: args.map(show).join(' ') + '\n' });
  self.console = { log: mk('out'), info: mk('out'), debug: mk('out'), warn: mk('err'), error: mk('err'),
    table: (x) => mk('out')(x), dir: (x) => mk('out')(x), trace: mk('err'), assert: (c, ...a) => { if (!c) mk('err')('Assertion failed:', ...a); },
    time() {}, timeEnd() {}, group() {}, groupEnd() {}, clear() {}, count() {} };
}

let pyodide = null;
async function loadPython() {
  if (pyodide) return pyodide;
  const { loadPyodide } = await import('./pyodide/pyodide.mjs');
  pyodide = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href, fullStdLib: false });
  pyodide.setStdout({ batched: (s) => post({ type: 'out', stream: 'out', text: s + '\n' }) });
  pyodide.setStderr({ batched: (s) => post({ type: 'out', stream: 'err', text: s + '\n' }) });
  sealNetwork();                       // Python's own files are loaded; nothing else may be fetched
  return pyodide;
}

self.onmessage = async ({ data }) => {
  const { lang, code } = data;
  try {
    if (lang === 'python') {
      const py = await loadPython();
      post({ type: 'ready' });
      const globals = py.globals.get('dict')();
      try {
        const value = await py.runPythonAsync(code, { globals });
        const result = value === undefined || value === null ? null : String(value?.toString?.() ?? value);
        value?.destroy?.();
        post({ type: 'done', result });
      } finally { globals.destroy(); }
    } else {
      sealNetwork();
      captureConsole();
      post({ type: 'ready' });
      // Like a console, show the value of the last line. Code that uses `await` runs as an async
      // function instead (top-level await isn't allowed in plain evaluation); `return` a value there.
      let value;
      if (/\bawait\b/.test(code)) {
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        value = await new AsyncFunction(code)();
      } else {
        value = await (0, eval)(code);
      }
      post({ type: 'done', result: value === undefined ? null : show(value) });
    }
  } catch (err) {
    const msg = err && err.message ? (lang === 'python' ? String(err.message).trim().split('\n').slice(-6).join('\n') : `${err.name || 'Error'}: ${err.message}`) : String(err);
    post({ type: 'done', error: msg });
  }
};
