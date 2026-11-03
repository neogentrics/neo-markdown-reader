// What pasting into the editor inserts: spreadsheet cells become a Markdown table, formatted text from
// a web page or Word becomes Markdown, and anything else is left to the editor's plain-text paste.
import { htmlToMarkdown, isRichHtml } from '../main/html-to-md.js';
import { looksLikeCells, cellsToTable } from './tables.js';

/** Clipboard HTML that is really code from a code editor (VS Code, IDEs): paste it as plain text. */
export const isCodeEditorHtml = (html) => /white-space:\s*pre/i.test(html) && !/<(p|h[1-6]|li|table|blockquote)[\s>]/i.test(html);

/**
 * @param {{ text?: string, html?: string }} clip  the clipboard's text/plain and text/html
 * @returns {{ text: string, block: boolean, kind: 'table' | 'markdown' } | null}  null: paste the plain text
 */
export function convertPaste({ text = '', html = '' }) {
  if (looksLikeCells(text)) return { text: cellsToTable(text), block: true, kind: 'table' };
  if (html && isRichHtml(html) && !isCodeEditorHtml(html)) {
    const md = htmlToMarkdown(html);
    if (md && md !== text.trim()) return { text: md, block: /\n/.test(md), kind: 'markdown' };
  }
  return null;
}
