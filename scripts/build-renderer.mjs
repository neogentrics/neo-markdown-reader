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

// PDF finishing and Word export run in the main process; bundle them so the packaged app
// ships one small file instead of the libraries' full source trees.
const mainTools = {
  entryPoints: { 'export-tools': join(root, 'src/main/export-tools.js') },
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
