'use strict';
// The pronunciation list (3.5): how read aloud should say names and invented words. One list for every
// document, and one for any folder, which also covers the folders inside it. The lists are kept in the app's
// data folder, so nothing is added to your folders. The words are replaced in applyPronunciation (voice-text.js).
const fs = require('node:fs');
const path = require('node:path');

const MAX_WORDS = 2000;

/** Only complete rows, each word once. */
function cleanList(list) {
  const out = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    const word = typeof row?.word === 'string' ? row.word.trim().slice(0, 100) : '';
    const say = typeof row?.say === 'string' ? row.say.trim().slice(0, 200) : '';
    if (word && say) out.set(word.toLowerCase(), { word, say });
  }
  return [...out.values()].slice(0, MAX_WORDS);
}

class PronunciationStore {
  constructor(file) {
    this.file = file;
    this.data = { all: [], folders: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data.all = cleanList(saved.all);
      for (const [dir, list] of Object.entries(saved.folders || {})) this.data.folders[dir] = cleanList(list);
    } catch { /* no list yet */ }
  }

  /** The two lists a document's dialog shows. */
  lists(docPath) {
    const dir = docPath ? path.dirname(docPath) : null;
    return { all: this.data.all, folder: dir ? { path: dir, name: path.basename(dir) || dir, list: this.data.folders[dir] || [] } : null };
  }

  /** @param {string|null} folder the folder's list, or null for the list for every document */
  set(folder, list) {
    const clean = cleanList(list);
    if (!folder) this.data.all = clean;
    else if (clean.length) this.data.folders[folder] = clean;
    else delete this.data.folders[folder];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Everything that applies to a document. A folder nearer the document wins over one further out. */
  rules(docPath) {
    const chain = [];
    for (let dir = docPath ? path.dirname(docPath) : null; dir; dir = path.dirname(dir) === dir ? null : path.dirname(dir)) chain.unshift(dir);
    return cleanList([...this.data.all, ...chain.flatMap((dir) => this.data.folders[dir] || [])]);
  }
}

module.exports = { PronunciationStore, cleanList };
