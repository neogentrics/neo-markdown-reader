// The Help Center (3.4): guides written in Markdown (the help folder) and shown with the app's own
// renderer, with a home page of quick links, common questions and the tutorial. Guides link to each
// other with #help=name, and can take you straight to a setting with #do=command.

const $ = (id) => document.getElementById(id);

export function createHelpUi({ api, render, openPrefs, startTutorial }) {
  const dlg = $('help-dlg');
  const nav = $('help-nav');
  const home = $('help-home');
  const article = $('help-article');
  const search = $('help-search');
  let articles = [];

  const bySlug = (slug) => articles.find((a) => a.slug === slug);
  const listed = () => articles.filter((a) => a.slug !== 'faq');

  function paintNav(list) {
    const items = list.map((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.title;
      b.dataset.slug = a.slug;
      b.setAttribute('translate', 'no');
      b.onclick = () => show(a.slug);
      return b;
    });
    nav.replaceChildren(...items);
    $('help-none').hidden = list.length > 0;
  }

  function mark(slug) {
    $('help-go-home').classList.toggle('on', !slug);
    for (const b of nav.children) b.classList.toggle('on', b.dataset.slug === slug);
  }

  function show(slug) {
    const a = bySlug(slug);
    if (!a) { showHome(); return; }
    home.hidden = true;
    article.hidden = false;
    article.innerHTML = render(a.text).html;
    article.scrollTop = 0;
    mark(slug);
  }

  function showHome() {
    home.hidden = false;
    article.hidden = true;
    $('help-faq').innerHTML = render((bySlug('faq')?.text || '').replace(/^# .+\n/, '')).html;
    mark('');
  }

  async function open(slug = '') {
    if (!articles.length) articles = await api.helpArticles();
    search.value = '';
    paintNav(listed());
    if (slug) show(slug); else showHome();
    if (!dlg.open) dlg.showModal();
    search.focus();
  }

  function act(what) {
    if (what === 'tutorial') { dlg.close(); startTutorial(); return; }
    if (what.startsWith('preferences')) { openPrefs(what.split(':')[1]); return; }
    api.runCommand(what);
  }

  // Links inside guides, and the quick links on the home page.
  dlg.addEventListener('click', (e) => {
    const quick = e.target.closest('[data-help]');
    if (quick) { show(quick.dataset.help); return; }
    const doing = e.target.closest('[data-do]');
    if (doing) { act(doing.dataset.do); return; }
    const link = e.target.closest('a[href]');
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href.startsWith('#help=')) show(href.slice(6));
    else if (href.startsWith('#do=')) act(href.slice(4));
    else if (/^https:/.test(href)) api.openExternal(href);
  });

  search.addEventListener('input', () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    paintNav(words.length ? articles.filter((a) => words.every((w) => a.text.toLowerCase().includes(w))) : listed());
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && nav.firstChild) { e.preventDefault(); nav.firstChild.click(); }
  });
  $('help-go-home').onclick = showHome;
  $('help-close').onclick = () => dlg.close();

  return { open };
}
