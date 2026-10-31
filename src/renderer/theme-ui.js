// View > Customize Theme: accent colour, fonts and an optional brand stylesheet.
import { ACCENTS, FONT_CHOICES, brandCss } from './brand.js';

const $ = (id) => document.getElementById(id);

export function createThemeUi({ api, settings, toast }) {
  const dlg = $('theme-dlg');
  const swatches = $('accent-swatches');
  const custom = $('accent-custom');
  const sheetName = $('brand-sheet-name');
  const style = document.createElement('style');
  style.id = 'brand-style';
  const sheet = document.createElement('style');
  sheet.id = 'brand-sheet';
  document.head.append(style, sheet);
  let sheetPath = null;
  let sheetCss = '';

  for (const [key, list] of Object.entries(FONT_CHOICES)) {
    const dl = $(`fonts-${key}`);
    for (const f of list) { const o = document.createElement('option'); o.value = f; dl.appendChild(o); }
  }
  swatches.innerHTML = `<button class="sw-accent none" data-accent="" title="Theme default" aria-label="Theme default"></button>`
    + ACCENTS.map((c) => `<button class="sw-accent" data-accent="${c}" style="--c:${c}" title="${c}" aria-label="Accent ${c}"></button>`).join('');

  const brand = () => ({ accent: '', bodyFont: '', headingFont: '', codeFont: '', stylesheet: '', ...(settings().brand || {}) });
  const save = (patch) => api.setSettings({ brand: { ...brand(), ...patch } });

  /** Apply the saved custom theme to the page (called whenever settings change). */
  async function apply(b = brand()) {
    style.textContent = brandCss(b);
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
    for (const s of swatches.querySelectorAll('button')) s.classList.toggle('active', s.dataset.accent === (b.accent || ''));
    custom.value = b.accent || '#3b5bdb';
    for (const k of ['bodyFont', 'headingFont', 'codeFont']) {
      const input = dlg.querySelector(`input[data-key="${k}"]`);
      if (document.activeElement !== input) input.value = b[k] || '';
    }
    sheetName.textContent = b.stylesheet ? b.stylesheet.split(/[\\/]/).pop() : 'None';
    sheetName.title = b.stylesheet || '';
    $('brand-sheet-remove').hidden = !b.stylesheet;
  }

  swatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accent]');
    if (b) save({ accent: b.dataset.accent });
  });
  custom.addEventListener('input', () => save({ accent: custom.value }));
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

  /** CSS that exports carry so they match the page: the custom theme plus the brand stylesheet. */
  const exportCss = () => [style.textContent, sheetCss].filter(Boolean).join('\n');

  return { open, apply, exportCss };
}
