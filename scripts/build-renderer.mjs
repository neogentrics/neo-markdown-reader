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

if (watch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
} else {
  await build(options);
}
