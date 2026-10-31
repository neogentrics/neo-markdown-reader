// The Markdown editor (CodeMirror 6). Built as its own script (dist/editor.js) and only loaded the
// first time a document is edited, so reading stays fast.
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, rectangularSelection, placeholder } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.35em', fontWeight: '700', color: 'var(--heading)' },
  { tag: t.heading2, fontSize: '1.2em', fontWeight: '700', color: 'var(--heading)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--heading)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--heading)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: [t.link, t.url], color: 'var(--link)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--inline-code-text)' },
  { tag: t.quote, color: 'var(--text-soft)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--accent)' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: [t.comment, t.angleBracket, t.tagName, t.attributeName], color: 'var(--muted)' },
  // YAML front matter
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--accent-2)' },
  { tag: [t.number, t.bool, t.null, t.keyword], color: 'var(--accent-2)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'calc(14.5px * var(--font-scale))', background: 'var(--page)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', padding: '28px 0 80px' },
  '.cm-content': { padding: '0 34px', caretColor: 'var(--accent)', maxWidth: '900px' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { background: 'var(--sel) !important' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--accent) 5%, transparent)' },
  '.cm-selectionMatch': { background: 'color-mix(in srgb, var(--accent-2) 22%, transparent)' },
  '.cm-panels': { background: 'var(--chrome)', color: 'var(--text)', borderColor: 'var(--chrome-border)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit' },
  '.cm-placeholder': { color: 'var(--muted)' },
});

// ---------------------------------------------------------------- formatting commands
function wrap(view, before, after = before, fallback = 'text') {
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    const outerFrom = range.from - before.length;
    const outerTo = range.to + after.length;
    // Toggle off if the selection is already wrapped.
    if (outerFrom >= 0 && view.state.sliceDoc(outerFrom, range.from) === before && view.state.sliceDoc(range.to, outerTo) === after) {
      return {
        changes: [{ from: outerFrom, to: range.from, insert: '' }, { from: range.to, to: outerTo, insert: '' }],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      };
    }
    const inner = text || fallback;
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    };
  }));
  view.focus();
  return true;
}

/** Toggle a prefix (heading, list, quote…) on every selected line. */
function linePrefix(view, prefix, { numbered = false } = {}) {
  const { state } = view;
  const lines = new Set();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n);
  }
  const strip = /^(\s*)(#{1,6}\s|>\s?|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)/;
  const all = [...lines].map((n) => state.doc.line(n));
  const allHave = all.every((l) => (numbered ? /^\s*\d+[.)]\s/.test(l.text) : l.text.startsWith(prefix)));
  const changes = all.map((l, i) => {
    const m = l.text.match(strip);
    const existing = m ? m[0].length - m[1].length : 0;
    const from = l.from + (m ? m[1].length : 0);
    if (allHave) return { from, to: from + existing, insert: '' };
    return { from, to: from + existing, insert: numbered ? `${i + 1}. ` : prefix };
  });
  view.dispatch({ changes });
  view.focus();
  return true;
}

function insertBlock(view, text, selectOffset = null, selectLength = 0) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const needsBreak = line.text.trim().length > 0 && from === line.to ? '\n\n' : (line.text.trim().length > 0 ? '\n' : '');
  const insert = needsBreak + text;
  const anchor = from + needsBreak.length + (selectOffset ?? text.length);
  view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.range(anchor, anchor + selectLength) });
  view.focus();
  return true;
}

function link(view, image = false) {
  const { from, to } = view.state.selection.main;
  const label = view.state.sliceDoc(from, to) || (image ? 'description' : 'link text');
  const url = image ? 'image.png' : 'https://';
  const text = `${image ? '!' : ''}[${label}](${url})`;
  const urlStart = from + label.length + (image ? 4 : 3);
  view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.range(urlStart, urlStart + url.length) });
  view.focus();
  return true;
}

const COMMANDS = {
  bold: (v) => wrap(v, '**', '**', 'bold text'),
  italic: (v) => wrap(v, '*', '*', 'italic text'),
  strike: (v) => wrap(v, '~~', '~~', 'text'),
  code: (v) => wrap(v, '`', '`', 'code'),
  h1: (v) => linePrefix(v, '# '),
  h2: (v) => linePrefix(v, '## '),
  h3: (v) => linePrefix(v, '### '),
  bullet: (v) => linePrefix(v, '- '),
  numbered: (v) => linePrefix(v, '', { numbered: true }),
  task: (v) => linePrefix(v, '- [ ] '),
  quote: (v) => linePrefix(v, '> '),
  link: (v) => link(v),
  image: (v) => link(v, true),
  codeblock: (v) => insertBlock(v, '```\ncode\n```\n', 4, 4),
  table: (v) => insertBlock(v, '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n', 2, 8),
  hr: (v) => insertBlock(v, '---\n'),
  undo: (v) => undo(v),
  redo: (v) => redo(v),
};

/**
 * Create an editor in `parent`.
 * @param {HTMLElement} parent
 * @param {{ doc: string, onChange: (text: string) => void, onTopLine: (line: number) => void }} opts
 */
function create(parent, { doc, onChange, onTopLine }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        // The --- YAML block at the top (title, author, tags…) is highlighted as YAML, not as a heading.
        yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
        syntaxHighlighting(highlight),
        theme,
        placeholder('Start writing in Markdown…'),
        EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Markdown editor' }),
        keymap.of([
          { key: 'Mod-b', run: COMMANDS.bold },
          { key: 'Mod-i', run: COMMANDS.italic },
          { key: 'Mod-k', run: COMMANDS.link },
          { key: 'Mod-Shift-x', run: COMMANDS.strike },
          { key: 'Mod-`', run: COMMANDS.code },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange?.(u.state.doc.toString()); }),
      ],
    }),
  });

  let raf = 0;
  view.scrollDOM.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentTop + view.scrollDOM.getBoundingClientRect().top);
      onTopLine?.(view.state.doc.lineAt(block.from).number - 1);
    });
  }, { passive: true });

  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(text) {
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } });
    },
    run(name) { const fn = COMMANDS[name]; return fn ? fn(view) : false; },
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    destroy: () => view.destroy(),
  };
}

window.__editorKit = { create, commands: Object.keys(COMMANDS) };
