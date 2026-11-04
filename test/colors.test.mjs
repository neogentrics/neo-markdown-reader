// Tests for 3.5's colour-safe colours: the real values from the style sheets, as they look with each of the
// three main kinds of colour blindness (Machado, Oliveira & Fernandes 2009, at full severity).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = (name) => fs.readFileSync(new URL(`../src/renderer/styles/${name}.css`, import.meta.url), 'utf8');
const KINDS = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => rgb(a).map((v, i) => v * t + rgb(b)[i] * (1 - t));

function seen(color, kind) {
  const l = color.map(toLinear);
  return kind.map((row) => fromLinear(Math.min(1, Math.max(0, row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))));
}

function lab(color) {
  const [r, g, b] = color.map(toLinear);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const difference = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** The smallest difference between any two colours, for each kind. */
function closest(colors) {
  const out = {};
  for (const [name, kind] of Object.entries(KINDS)) {
    out[name] = Infinity;
    for (const [i, a] of colors.entries()) for (const b of colors.slice(i + 1)) out[name] = Math.min(out[name], difference(seen(a, kind), seen(b, kind)));
  }
  return out;
}

function assertApart(colors, least, what) {
  for (const [name, gap] of Object.entries(closest(colors))) assert.ok(gap >= least, `${what} with ${name}: ${gap.toFixed(1)}`);
}

const tokens = (text, selector) => {
  const start = text.indexOf(`${selector} {`);
  assert.ok(start >= 0, selector);
  return Object.fromEntries([...text.slice(start, text.indexOf('}', start)).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
};

test('colour-safe: changes in Compare stay far apart on the lightest and darkest pages', () => {
  const safe = tokens(css('theme'), ':root[data-colors="safe"]');
  for (const page of ['#ffffff', '#171a21']) {
    const add = mix(safe['add-fill'], page, 0.35);
    const del = mix(safe['del-fill'], page, 0.32);
    for (const [name, kind] of Object.entries(KINDS)) {
      const gap = difference(seen(add, kind), seen(del, kind));
      assert.ok(gap >= 25, `Compare on ${page} with ${name}: ${gap.toFixed(1)}`);
    }
  }
});

test('colour-safe: charts and highlights stay apart, light and dark', () => {
  const charts = css('blocks');
  const list = (t) => Object.entries(t).filter(([k]) => k.startsWith('chart-')).map(([, v]) => rgb(v));
  assertApart(list(tokens(charts, ':root[data-colors="safe"]')), 10, 'chart colours');
  assertApart(list(tokens(charts, ':root[data-colors="safe"][data-tone="dark"]')), 10, 'dark chart colours');

  const styles = css('organize');
  const pick = (re) => [...styles.matchAll(re)].map((m) => m[1]);
  const light = pick(/data-colors="safe"\] :is\(mark\.nmr-hl\.hl-\w+, \.sw\.hl-\w+\) \{ background: (#[0-9a-f]{6})/g);
  const dark = pick(/data-colors="safe"\]\[data-tone="dark"\] mark\.nmr-hl\.hl-\w+ \{ background: (#[0-9a-f]{6})/g);
  assert.equal(light.length, 4);
  assert.equal(dark.length, 4);
  assertApart(light.map(rgb), 10, 'highlights');
  assertApart(dark.map(rgb), 10, 'dark highlights');
});

test('colour-safe: what it replaces really was a problem', () => {
  const add = mix('#2f9e44', '#ffffff', 0.35);
  const del = mix('#e03131', '#ffffff', 0.32);
  assert.ok(difference(seen(add, KINDS.deuteranopia), seen(del, KINDS.deuteranopia)) < 3);
});

const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Every colour a theme's panels run through. */
function stops(text, theme) {
  const start = text.indexOf(`:root[data-theme="${theme}"] {`);
  const block = text.slice(start, text.indexOf('\n}', start));
  return [...block.matchAll(/--(?:toolbar|tabstrip|sidebar)-fill:[^;]*/g)].flatMap((m) => m[0].match(/#[0-9a-f]{6}/g));
}

for (const theme of ['light', 'sepia', 'mist', 'dark', 'forest', 'dusk', 'blue', 'red', 'yellow']) {
  test(`${theme}: what's on the panels can be read everywhere the colour runs`, () => {
    const text = css('theme');
    const panel = { ...tokens(text, `:root[data-theme="${theme}"]`), ...tokens(text, `:root[data-theme="${theme}"] :is(.toolbar, .tabstrip, .sidebar)`) };
    const colors = stops(text, theme);
    assert.ok(colors.length >= 4, 'the panels run from one colour to another');
    for (const color of colors) {
      for (const name of ['text', 'text-soft', 'muted', 'link', 'heading']) {
        assert.ok(contrast(panel[name], color) >= 4.5, `${name} on ${color}: ${contrast(panel[name], color).toFixed(2)}`);
      }
      assert.ok(contrast(panel.accent, color) >= 3, `buttons on ${color}: ${contrast(panel.accent, color).toFixed(2)}`);
    }
    assert.ok(contrast(panel['on-accent'], panel.accent) >= 4.5, 'text on a button');
  });
}
