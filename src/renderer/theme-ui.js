// View > Customize Theme: accent, panel and background colours, fonts and an optional brand stylesheet.
import { ACCENTS, PANELS, BACKGROUNDS, FONT_CHOICES, appCss, brandCss } from './brand.js';

const $ = (id) => document.getElementById(id);

export function createThemeUi({ api, settings, toast }) {
  const dlg = $('theme-dlg');
  const sheetName = $('brand-sheet-name');
  const style = document.createElement('style');
  style.id = 'brand-style';
  const sheet = document.createElement('style');
  sheet.id = 'brand-sheet';
  const appStyle = document.createElement('style');
  appStyle.id = 'brand-app';
  document.head.append(style, appStyle, sheet);
  let sheetPath = null;
  let sheetCss = '';

  for (const [key, list] of Object.entries(FONT_CHOICES)) {
    const dl = $(`fonts-${key}`);
    for (const f of list) { const o = document.createElement('option'); o.value = f; dl.appendChild(o); }
  }
  // The colours you can pick: which setting each row saves, and where the custom picker starts.
  const pickers = [
    { key: 'accent', name: 'Accent', colors: ACCENTS, start: '#3b5bdb', swatches: $('accent-swatches'), custom: $('accent-custom') },
    { key: 'panel', name: 'Panel', colors: PANELS, start: '#12355b', swatches: $('panel-swatches'), custom: $('panel-custom') },
    { key: 'background', name: 'Background', colors: BACKGROUNDS, start: '#0f2a43', swatches: $('background-swatches'), custom: $('background-custom') },
  ];
  for (const p of pickers) {
    p.swatches.innerHTML = `<button class="sw-accent none" data-color="" title="Theme default" aria-label="Theme default"></button>`
      + p.colors.map((c) => `<button class="sw-accent" data-color="${c}" style="--c:${c}" title="${c}" aria-label="${p.name} ${c}"></button>`).join('');
  }

  const brand = () => ({ accent: '', panel: '', background: '', bodyFont: '', headingFont: '', codeFont: '', stylesheet: '', ...(settings().brand || {}) });
  const save = (patch) => api.setSettings({ brand: { ...brand(), ...patch } });

  /** Apply the saved custom theme to the page (called whenever settings change). */
  async function apply(b = brand()) {
    style.textContent = brandCss(b);
    appStyle.textContent = appCss(b);
    if (b.stylesheet !== sheetPath) {
      sheetPath = b.stylesheet;
      sheetCss = '';
      sheet.textContent = '';
      if (b.stylesheet) {
        const res = await api.readStylesheet();
        if (res.path !== sheetPath) return;
        if (res.error) toast(res.error);
        sheetCss = res.css || '';
        sheet.textContent = sheetCss;
      }
    }
    if (dlg.open) fill(b);
  }

  function fill(b) {
    for (const p of pickers) {
      for (const s of p.swatches.querySelectorAll('button')) s.classList.toggle('active', s.dataset.color === (b[p.key] || ''));
      p.custom.value = b[p.key] || p.start;
    }
    for (const k of ['bodyFont', 'headingFont', 'codeFont']) {
      const input = dlg.querySelector(`input[data-key="${k}"]`);
      if (document.activeElement !== input) input.value = b[k] || '';
    }
    sheetName.textContent = b.stylesheet ? b.stylesheet.split(/[\\/]/).pop() : 'None';
    sheetName.title = b.stylesheet || '';
    $('brand-sheet-remove').hidden = !b.stylesheet;
  }

  for (const p of pickers) {
    p.swatches.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (b) save({ [p.key]: b.dataset.color });
    });
    p.custom.addEventListener('input', () => save({ [p.key]: p.custom.value }));
  }
  let fontTimer = null;
  for (const input of dlg.querySelectorAll('input[data-key]')) {
    input.addEventListener('input', () => {
      clearTimeout(fontTimer);
      fontTimer = setTimeout(() => save({ [input.dataset.key]: input.value }), 250);
    });
  }
  $('brand-sheet-pick').addEventListener('click', async () => { await api.pickStylesheet(); });
  $('brand-sheet-remove').addEventListener('click', () => save({ stylesheet: '' }));
  $('brand-reset').addEventListener('click', () => api.setSettings({ brand: {} }));
  $('theme-dlg-close').addEventListener('click', () => dlg.close());

  function open() {
    fill(brand());
    if (!dlg.open) dlg.showModal();
  }

  /** CSS that exports carry so they match the page: the custom theme plus the brand stylesheet, not the app around it. */
  const exportCss = () => [style.textContent, sheetCss].filter(Boolean).join('\n');

  return { open, apply, exportCss };
}
