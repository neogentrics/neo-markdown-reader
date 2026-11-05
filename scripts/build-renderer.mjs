// Bundles the renderer (UI + Markdown engine + styles + fonts) into dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const options = {
  entryPoints: {
    app: join(root, 'src/renderer/app.js'),
    mermaid: join(root, 'src/renderer/mermaid-entry.js'),   // loaded only for documents with diagrams
    editor: join(root, 'src/renderer/editor-entry.js'),     // loaded only when editing
    export: join(root, 'src/renderer/styles/export.css'),   // stylesheet for exported PDFs and web pages
  },
  outdir: out,
  bundle: true,
  format: 'iife',          // file:// pages can't load ES modules, so ship one classic script
  platform: 'browser',
  target: ['chrome120'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'linked',
  logLevel: 'info',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'dataurl' },
  assetNames: 'fonts/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
};

cpSync(join(root, 'src/renderer/index.html'), join(out, 'index.html'));
cpSync(join(root, 'build/icon.png'), join(out, 'icon.png'));
cpSync(join(root, 'docs/screenshots/ai-services.png'), join(out, 'guide/ai-services.png'));
// The code sandbox's pages, plus Python (Pyodide) for running Python code blocks.
cpSync(join(root, 'src/sandbox'), join(out, 'sandbox'), { recursive: true });
for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  cpSync(join(root, 'node_modules/pyodide', f), join(out, 'sandbox/pyodide', f));
}

// PDF finishing and Word export run in the main process; bundle them so the packaged app
// ships one small file instead of the libraries' full source trees.
// Natural voices (3.2): ONNX Runtime's WebAssembly engine, loaded by dist/voice-worker.cjs from dist/voice.
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  cpSync(join(root, 'node_modules/onnxruntime-web/dist', f), join(out, 'voice', f));
}

// Export as audio (3.5): LAME's MP3 encoder stays one unmodified file, so it can be replaced (LGPL).
cpSync(join(root, 'node_modules/lamejs/lame.min.js'), join(out, 'lame.min.js'));

const mainTools = {
  entryPoints: { 'export-tools': join(root, 'src/main/export-tools.js'), 'voice-worker': join(root, 'src/main/voice-worker.js'), 'dictate-worker': join(root, 'src/main/dictate-worker.js'), 'smart-worker': join(root, 'src/main/smart-worker.js') },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  minify: !watch,
  legalComments: 'linked',
  logLevel: 'info',
};

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await build(mainTools);
  await ctx.watch();
} else {
  await build(options);
  await build(mainTools);
}
