// The tutorial (3.4): a hands-on tour with a practice document. It's offered when the app starts until
// it's finished or declined, so people updating from an older version get it too. Each step points at
// part of the window and moves on when you've done what it says; Next skips a step at any time.
// AI isn't tried live, because it needs a key or a server: the guide explains how to connect a service.

const $ = (id) => document.getElementById(id);
const PAGE = '.page:not([hidden])';

// click: the step is done when the target is clicked. done: when this says so (polled).
const STEPS = [
  { title: 'Your practice document', target: '.tab.active', text: 'This is a copy made for the tutorial, so you can try anything without touching your own files. Click Next when you’re ready.' },
  { title: 'The outline', target: '#btn-toc', click: true, text: 'Click this button to show or hide the outline, a list of the document’s headings that you can jump to.' },
  { title: 'Themes', target: '#btn-theme', click: true, text: 'Click here to choose a theme and page width. Try a few, then click Next.' },
  { title: 'Text size', target: '#btn-larger', click: true, text: 'Click this button to make the text larger. The button beside it makes it smaller.' },
  { title: 'Find', target: '#btn-find', click: true, text: 'Click here to look for words in the document.' },
  { title: 'Highlights', target: PAGE, done: () => !!document.querySelector(`${PAGE} mark`), text: 'Select a sentence in the document, then press Ctrl+Shift+H (Cmd+Shift+H on a Mac). Highlights and notes are private: they’re never written into the file.' },
  { title: 'Editing', target: '#btn-edit', done: (t) => !!t?.editing, text: 'Documents open read-only, so nothing changes by accident. Click Edit. The app asks first: choose Just This Time.' },
  { title: 'Write and save', target: '#btn-save', saved: true, text: 'Type something in the document, then press Ctrl+S (Cmd+S on a Mac) or click Save.' },
  { title: 'Back to reading', target: '#btn-edit', done: (t) => !t?.editing, text: 'Click this button again to go back to reading.' },
  { title: 'Go anywhere', target: '#btn-quick', text: 'This button, or Ctrl+K (Cmd+K on a Mac), jumps to any file or heading. Type > there to run any menu command by name.' },
  { title: 'Folders', text: 'File → Open Folder shows a whole folder in the Files panel, where you can search every document and use links, tags and tasks between them.' },
  { title: 'Side by side', target: '#btn-split', text: 'Split view shows two documents at once. To compare versions of one document, use Edit → Compare and History.' },
  { title: 'Listen', text: 'View → Read Aloud reads the document to you. Choose the voice and speed in Preferences → Reading Aloud, where natural voices that work offline are a free download.' },
  { title: 'Export and share', target: '#btn-pdf', text: 'This button makes a PDF, a Word document or a web page, with choices for paper, cover and contents.' },
  { title: 'Your settings', target: '#btn-prefs', text: 'Every setting is here in Preferences: themes, voices, AI, sync and more. Press Ctrl+, (Cmd+, on a Mac) to open it from anywhere.' },
  { title: 'AI assist', guide: true, text: 'AI assist can summarize, explain and rewrite with the service you choose. It needs a key or a model on your computer, so there’s nothing to try here. The guide shows how to connect one.' },
  { title: 'That’s the tour', text: 'Press F1 at any time for the Help Center, with guides, common questions and this tutorial. Enjoy your reading.' },
];

export function createTourUi({ api, activeTab, openGuide }) {
  const card = $('tour-card');
  const ring = $('tour-ring');
  const welcome = $('tour-welcome');
  let index = -1;
  let poll = 0;
  let savedAtStart = null;

  const visible = (el) => !!el && el.getClientRects().length > 0;

  function placeRing() {
    const step = STEPS[index];
    const el = step?.target ? document.querySelector(step.target) : null;
    ring.hidden = !visible(el);
    if (ring.hidden) return;
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
  }

  function stepDone(step) {
    const tab = activeTab();
    if (step.saved) return !!tab && !tab.dirty && tab.savedText !== savedAtStart;
    return !!step.done?.(tab);
  }

  function show(i) {
    index = i;
    savedAtStart = activeTab()?.savedText;
    const step = STEPS[i];
    $('tour-title').textContent = step.title;
    $('tour-text').textContent = step.text;
    $('tour-count').textContent = `Step ${i + 1} of ${STEPS.length}`;
    $('tour-back').hidden = i === 0;
    $('tour-guide').hidden = !step.guide;
    $('tour-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    card.hidden = false;
    placeRing();
    api.tutorialSet({ state: 'todo', step: i });
  }

  function stop() {
    clearInterval(poll);
    document.removeEventListener('click', clicked, true);
    window.removeEventListener('resize', placeRing);
    card.hidden = true;
    ring.hidden = true;
    index = -1;
  }

  const next = () => { if (index >= STEPS.length - 1) finish(); else show(index + 1); };

  function finish() {
    stop();
    api.tutorialSet({ state: 'done', step: 0 });
  }

  function clicked(e) {
    const step = STEPS[index];
    if (!step?.click || !e.target.closest?.(step.target)) return;
    const at = index;
    setTimeout(() => { if (index === at) next(); }, 400);
  }

  async function start(step = 0) {
    await api.tutorialPractice(step === 0);
    for (let i = 0; i < 50 && !/[\\/]Practice\.md$/.test(activeTab()?.doc.path || ''); i++) await new Promise((r) => setTimeout(r, 100));
    clearInterval(poll);
    poll = setInterval(() => {
      placeRing();
      const s = STEPS[index];
      if (s && (s.done || s.saved) && stepDone(s)) next();
    }, 250);
    document.addEventListener('click', clicked, true);
    window.addEventListener('resize', placeRing);
    show(Math.min(step, STEPS.length - 1));
  }

  $('tour-next').onclick = next;
  $('tour-back').onclick = () => show(index - 1);
  $('tour-later').onclick = stop;
  $('tour-guide').onclick = () => openGuide();

  let resumeAt = 0;
  $('tour-start').onclick = () => { welcome.close(); start(resumeAt); };
  $('tour-not-now').onclick = () => welcome.close();
  $('tour-never').onclick = () => { welcome.close(); api.tutorialSet({ state: 'done', step: 0 }); };

  /** When the app starts: offer the tutorial unless it's been finished or declined. */
  async function offer() {
    const t = await api.tutorialGet();
    if (t.state === 'done' || !t.offer) return;
    resumeAt = t.step;
    $('tour-start').textContent = t.step ? 'Pick up where I left off' : 'Start the tutorial';
    welcome.showModal();
  }

  return { offer, start: () => start(0) };
}
