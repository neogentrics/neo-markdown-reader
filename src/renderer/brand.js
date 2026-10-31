// Custom theme: the reader's own accent colour and fonts, turned into CSS overrides.
// Used for the page on screen and for every export, so a PDF looks like what you read.

const HEX = /^#[0-9a-f]{6}$/i;
const fontName = (v) => String(v || '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
const family = (name, fallback) => (fontName(name) ? `"${fontName(name)}", ${fallback}` : '');

/** Accent colours people often pick, shown as swatches. */
export const ACCENTS = ['#3b5bdb', '#0b7285', '#2b8a3e', '#e8590c', '#c2255c', '#7048e8', '#1d2330'];

/** Font suggestions; any installed font name can be typed instead. */
export const FONT_CHOICES = {
  body: ['Segoe UI', 'Calibri', 'Aptos', 'Georgia', 'Cambria', 'Charter', 'Garamond', 'Helvetica Neue', 'Arial', 'Verdana', 'Inter', 'Source Serif Pro'],
  heading: ['Segoe UI Semibold', 'Montserrat', 'Georgia', 'Cambria', 'Bahnschrift', 'Helvetica Neue', 'Arial', 'Inter', 'Playfair Display'],
  code: ['Cascadia Code', 'Consolas', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Courier New'],
};

/** CSS for the custom theme (empty when nothing is customised). */
export function brandCss(brand = {}) {
  const rules = [];
  const vars = [];
  if (HEX.test(brand.accent || '')) {
    const a = brand.accent;
    vars.push(`--accent: ${a}`, `--link: ${a}`, `--accent-soft: color-mix(in srgb, ${a} 12%, var(--page))`,
      `--quote-bar: color-mix(in srgb, ${a} 45%, var(--page))`, `--sel: color-mix(in srgb, ${a} 22%, var(--page))`);
    // On the dark theme, lift the colour so links stay readable.
    rules.push(`:root[data-theme="dark"] { --link: color-mix(in srgb, ${a} 60%, white); --accent: color-mix(in srgb, ${a} 70%, white); }`);
  }
  const heading = family(brand.headingFont, 'var(--font-sans)');
  const code = family(brand.codeFont, 'monospace');
  if (heading) vars.push(`--font-display: ${heading}`);
  if (code) vars.push(`--font-mono: ${code}`);
  if (vars.length) rules.unshift(`:root[data-theme], :root { ${vars.join("; ")}; }`);
  const body = family(brand.bodyFont, 'var(--font-sans)');
  if (body) rules.push(`.markdown-body, :root[data-font] .markdown-body { font-family: ${body}; }`);
  return rules.join('\n');
}

/** True when any part of the custom theme is set. */
export function hasBrand(brand = {}) {
  return !!(HEX.test(brand.accent || '') || fontName(brand.bodyFont) || fontName(brand.headingFont) || fontName(brand.codeFont) || brand.stylesheet);
}
