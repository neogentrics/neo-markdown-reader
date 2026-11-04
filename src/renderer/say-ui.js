// The pronunciation list (3.5): teach read aloud how to say names and invented words.
const $ = (id) => document.getElementById(id);

export function createSayUi({ api, activeTab, reading }) {
  const dlg = $('say-dlg');
  const rows = $('say-rows');
  const scope = $('say-scope');
  let lists = null;

  const current = () => (scope.value === 'folder' ? lists.folder.list : lists.all);

  function addRow(row = { word: '', say: '' }) {
    const line = document.createElement('div');
    line.className = 'say-row';
    const word = Object.assign(document.createElement('input'), { value: row.word, placeholder: 'Word or name', spellcheck: false, maxLength: 100 });
    const say = Object.assign(document.createElement('input'), { value: row.say, placeholder: 'Say it as', spellcheck: false, maxLength: 200 });
    word.setAttribute('aria-label', 'Word or name');
    say.setAttribute('aria-label', 'Say it as');
    const test = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: 'Listen' });
    test.onclick = () => reading().sayAloud(say.value || word.value);
    const drop = Object.assign(document.createElement('button'), { type: 'button', className: 'link-btn', textContent: 'Remove' });
    drop.onclick = () => { line.remove(); save(); };
    word.onchange = say.onchange = save;
    line.append(word, say, test, drop);
    rows.append(line);
    return word;
  }

  function show() {
    rows.replaceChildren();
    for (const row of current()) addRow(row);
    if (!current().length) addRow();
  }

  async function save() {
    const list = [...rows.querySelectorAll('.say-row')].map((r) => { const [word, say] = r.querySelectorAll('input'); return { word: word.value, say: say.value }; });
    const folder = scope.value === 'folder' ? lists.folder.path : null;
    await api.saySet({ folder, list });
    if (folder) lists.folder.list = list; else lists.all = list;
    reading().sayChanged();
  }

  async function open() {
    lists = await api.sayGet(activeTab()?.doc.path || null);
    const here = $('say-scope-folder');
    here.hidden = here.disabled = !lists.folder;
    if (lists.folder) here.textContent = `Documents in “${lists.folder.name}”`;
    scope.value = lists.folder?.list.length ? 'folder' : 'all';
    show();
    dlg.showModal();
  }

  scope.onchange = show;
  $('say-add').onclick = () => addRow().focus();
  $('say-done').onclick = async () => { await save(); dlg.close(); };

  return { open };
}
