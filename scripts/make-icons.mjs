// Regenerates build/icon.png (512px) and build/icon.ico (16–256px) from build/icon.svg.
// Only needed when the logo changes; the generated files are committed.
// Requires Playwright (Chromium) to rasterise the SVG:  node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const big = await png(512);
writeFileSync(join(root, 'build/icon.png'), big);

// ICO container with embedded PNGs (supported since Windows Vista).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const s of sizes) images.push(await png(s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e); header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([header, ...images]));
await browser.close();
console.log('icons written: build/icon.png, build/icon.ico');
