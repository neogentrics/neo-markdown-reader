// Help → About Neo Markdown Reader: what the app is, its version, where it lives on the web, and the
// details a bug report needs (copied in one click).

const $ = (id) => document.getElementById(id);
export const WEBSITE = 'https://recontowers.com/projects/neo-markdown-reader/';
const REPO = 'https://github.com/neogentrics/neo-markdown-reader';

export function createAboutUi({ api, toast }) {
  const dlg = $('about-dlg');
  let info = null;

  const links = {
    'about-website': () => WEBSITE,
    'about-notes': () => `${REPO}/releases/tag/v${info.version}`,
    'about-issue': () => `${REPO}/issues/new`,
    'about-source': () => REPO,
    'about-license': () => `${REPO}/blob/main/LICENSE`,
    'about-notices': () => `${REPO}/blob/main/THIRD_PARTY_NOTICES.md`,
  };
  for (const [id, url] of Object.entries(links)) {
    $(id).addEventListener('click', (e) => { e.preventDefault(); if (info) api.openExternal(url()); });
  }

  const details = () => [
    `Neo Markdown Reader ${info.version}${info.portable ? ' (portable)' : ''}`,
    `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    `${info.os}`,
  ].join('\n');

  $('about-copy').addEventListener('click', async () => {
    if (!info) return;
    await api.copyText(details());
    toast('Version details copied — paste them into a bug report');
  });
  $('about-close').addEventListener('click', () => dlg.close());
  $('about-done').addEventListener('click', () => dlg.close());

  async function open() {
    info = await api.appAbout();
    $('about-version').textContent = info.portable ? `Version ${info.version} (portable)` : `Version ${info.version}`;
    $('about-tech').textContent = details().split('\n').slice(1).join(' · ');
    $('about-copyright').textContent = `© ${info.year} Neo Gentrics. All rights reserved.`;
    if (!dlg.open) dlg.showModal();
    $('about-done').focus();
  }
  return { open };
}
