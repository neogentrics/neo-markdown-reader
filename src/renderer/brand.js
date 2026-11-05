// Custom theme: the reader's own colours and fonts, turned into CSS overrides.
// brandCss is for the page on screen and every export, so a PDF looks like what you read.
// appCss is for the app around the page: its panels and background, which exports don't have.

const HEX = /^#[0-9a-f]{6}$/i;
const fontName = (v) => String(v || '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
const family = (name, fallback) => (fontName(name) ? `"${fontName(name)}", ${fallback}` : '');

/** Accent colours people often pick, shown as swatches. */
export const ACCENTS = ['#3b5bdb', '#0b7285', '#2b8a3e', '#e8590c', '#c2255c', '#7048e8', '#1d2330'];

/** Panel and background colours people often pick. */
export const PANELS = ['#1d2330', '#12355b', '#14432f', '#3d1f5c', '#6b1d2a', '#e6dcc8', '#dbe4f0'];
export const BACKGROUNDS = ['#14161c', '#0f2a43', '#123a2c', '#2d1a47', '#4d1518', '#efe6d4', '#e1e8f1'];

/** Every colour each theme's panels run through. test/colors.test.mjs checks these against theme.css. */
export const THEME_PANELS = {
  light: ['#dde5ff', '#e2ebf7', '#cdeee4', '#dde5ff', '#e9eeff', '#dcf1ea'],
  sepia: ['#3f2411', '#6a3f18', '#56601f', '#3f2411', '#4a2c14', '#33200f'],
  mist: ['#cdd9e8', '#d6e0ea', '#c3e6de', '#cdd9e8', '#dbe4ee', '#cfe9e2'],
  dark: ['#12172c', '#1b2550', '#0f4444', '#12172c', '#171e3a', '#11162a'],
  forest: ['#0f2a1c', '#174a30', '#3f5018', '#0f2a1c', '#14301f', '#0e2116'],
  dusk: ['#201739', '#43246b', '#7a2a5e', '#201739', '#2a1f4f', '#1c1533'],
  blue: ['#0e2c57', '#16528f', '#0f6e72', '#0e2c57', '#123a6b', '#0e2c57'],
  red: ['#4a0c18', '#8c1a1f', '#a63e16', '#4a0c18', '#5c0f1e', '#3f0a14'],
  yellow: ['#ffd23f', '#ffc02e', '#ffa53c', '#ffd23f', '#fff0b3', '#ffe27a'],
};

const WHITE = '#ffffff';
const BLACK = '#000000';
const PANEL_SCOPE = ':is(.toolbar, .tabstrip, .sidebar)';
// High Contrast keeps its own panels and background, because plain contrast is the point of it.
const NOT_CONTRAST = ':root[data-theme]:not([data-theme="contrast"])';

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const blend = (a, b, t) => {
  const to = channels(b);
  return `#${channels(a).map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** How well a colour reads on the worst of several. */
const worst = (color, stops) => Math.min(...stops.map((s) => contrast(color, s)));
/** Black or white, whichever reads better. One of them always reaches 4.5. */
const inkFor = (stops) => (worst(WHITE, stops) >= worst(BLACK, stops) ? WHITE : BLACK);
/** The colour itself if it reads on all of these, otherwise as little of the ink as it takes. */
const readable = (color, stops, ink) => {
  for (let step = 0; step < 20; step++) {
    const c = blend(color, ink, step / 20);
    if (worst(c, stops) >= 4.5) return c;
  }
  return ink;
};
/** The ink faded towards the panel, as far as it can go and still be read. */
const faded = (ink, stops, amount) => {
  for (let step = amount; step > 0; step -= 0.05) {
    const c = blend(ink, stops[0], step);
    if (worst(c, stops) >= 4.5) return c;
  }
  return ink;
};

/** A panel with a little of a colour in it, leaving the ink readable there. */
const tinted = (panel, color, ink) => {
  for (let step = 4; step > 0; step--) {
    const c = blend(panel, color, step / 25);
    if (contrast(ink, c) >= 4.5) return c;
  }
  return panel;
};

/** Your colour as words and marks on a panel, changed only as much as it takes to be read there. */
export function panelAccent(accent, stops) {
  const ink = inkFor(stops);
  const soft = tinted(stops[0], accent || ink, ink);
  const color = readable(accent || ink, [...stops, soft], ink);
  return { accent: color, link: color, 'on-accent': inkFor([color]), 'accent-soft': soft };
}

/** Everything a panel of this colour needs, the same set a theme gives its panels. */
export function panelTokens(panel, accent = '') {
  const ink = inkFor([panel]);
  const shade = blend(panel, ink === WHITE ? BLACK : WHITE, 0.14);
  const stops = [panel, shade];
  const line = blend(panel, ink, 0.24);
  const picked = panelAccent(accent, stops);
  return {
    chrome: panel, page: panel, 'chrome-border': line, rule: line, 'rule-strong': blend(panel, ink, 0.34),
    text: faded(ink, stops, 0.06), 'text-soft': faded(ink, stops, 0.16), muted: faded(ink, stops, 0.26), heading: ink,
    ...picked, 'code-bg': shade, 'code-border': line, sel: blend(panel, picked.accent, 0.3),
    'btn-hover': ink === WHITE ? 'rgba(255, 255, 255, .12)' : 'rgba(0, 0, 0, .08)',
    'toolbar-fill': `linear-gradient(100deg, ${panel}, ${shade})`, 'tabstrip-fill': shade, 'sidebar-fill': `linear-gradient(180deg, ${panel}, ${shade})`,
  };
}

const declare = (tokens) => Object.entries(tokens).map(([k, v]) => `--${k}: ${v}`).join('; ');

/** CSS for the app around the page: your panels and background, and your button colour on the panels. */
export function appCss(brand = {}) {
  const rules = [];
  const accent = HEX.test(brand.accent || '') ? brand.accent : '';
  // Filled buttons are your colour exactly, in every theme: they carry their own text, so only words need adjusting.
  if (accent) rules.push(`${NOT_CONTRAST} { ${declare({ 'accent-fill': accent, 'on-fill': inkFor([accent]) })}; }`);
  if (HEX.test(brand.panel || '')) {
    const scheme = inkFor([brand.panel]) === WHITE ? 'dark' : 'light';
    rules.push(`${NOT_CONTRAST} ${PANEL_SCOPE} { color-scheme: ${scheme}; ${declare(panelTokens(brand.panel, accent))}; }`);
  } else if (accent) {
    for (const [theme, stops] of Object.entries(THEME_PANELS)) rules.push(`:root[data-theme="${theme}"] ${PANEL_SCOPE} { ${declare(panelAccent(accent, stops))}; }`);
  }
  if (HEX.test(brand.background || '')) {
    const c = brand.background;
    const fill = `linear-gradient(135deg, ${c}, ${blend(c, inkFor([c]) === WHITE ? BLACK : WHITE, 0.14)})`;
    rules.push(`${NOT_CONTRAST} { ${declare({ desk: c, 'desk-fill': fill, 'glass-desk': fill })}; }`);
  }
  // Frosted panels take on what's behind them, which could leave their text unreadable over a colour you chose.
  if (HEX.test(brand.panel || '') || HEX.test(brand.background || '')) {
    for (const part of ['toolbar', 'tabstrip', 'sidebar']) rules.push(`${NOT_CONTRAST}[data-surface="glass"] .${part} { background: var(--${part}-fill); backdrop-filter: none; border-color: var(--chrome-border); }`);
  }
  return rules.join('\n');
}

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
    const lifted = blend(a, WHITE, 0.3);
    vars.push(`--accent: ${a}`, `--on-accent: ${inkFor([a])}`, `--link: ${a}`, `--accent-soft: color-mix(in srgb, ${a} 12%, var(--page))`,
      `--quote-bar: color-mix(in srgb, ${a} 45%, var(--page))`, `--sel: color-mix(in srgb, ${a} 22%, var(--page))`);
    // On the dark theme, lift the colour so links stay readable.
    rules.push(`:root[data-tone="dark"] { --link: color-mix(in srgb, ${a} 60%, white); --accent: ${lifted}; --on-accent: ${inkFor([lifted])}; }`);
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
  return !!(HEX.test(brand.accent || '') || HEX.test(brand.panel || '') || HEX.test(brand.background || '') || fontName(brand.bodyFont) || fontName(brand.headingFont) || fontName(brand.codeFont) || brand.stylesheet);
}
