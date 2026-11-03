'use strict';
// HTML → Markdown, for pasting from web pages and Word, and for importing Word documents.
// Used by the editor (bundled into dist/editor.js) and by the main process (dist/export-tools.cjs).
const TurndownService = require('turndown');
const { gfm } = require('@joplin/turndown-plugin-gfm');

const DROP = ['script', 'style', 'meta', 'title', 'head', 'noscript', 'iframe', 'object', 'embed', 'form', 'button', 'select', 'textarea', 'template', 'svg', 'canvas', 'video', 'audio', 'link'];

/**
 * Convert HTML to clean Markdown.
 * @param {string} html
 * @param {{ image?: (src: string, alt: string) => string | null }} [opts]
 *   `image` decides what each picture becomes: return a URL/path to keep it, or null to drop it.
 *   By default web (http/https) pictures are kept and embedded data (data: URLs) is dropped.
 */
function htmlToMarkdown(html, opts = {}) {
  let src = String(html || '');
  const fromWord = /mso-|urn:schemas-microsoft-com:office/i.test(src);
  src = src
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')     // Word's conditional comments
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?o:p>/gi, '')
    .replace(/<\/?(?:w|m|v):[^>]*>/gi, '');
  const td = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**',
    hr: '---', linkStyle: 'inlined',
  });
  td.use(gfm);
  td.remove(DROP);
  const pickImage = opts.image || ((s) => (/^https?:/i.test(s) ? s : null));
  td.addRule('image', {
    filter: 'img',
    replacement(_content, node) {
      const alt = (node.getAttribute('alt') || '').replace(/[[\]\n]/g, ' ').trim();
      const target = pickImage(node.getAttribute('src') || '', alt);
      if (!target) return alt ? `*[${alt}]*` : '';
      const title = node.getAttribute('title');
      return `![${alt}](${encodeURI(target).replace(/\(/g, '%28').replace(/\)/g, '%29')}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    },
  });
  // Links to nowhere (anchors Word adds for bookmarks, javascript: links) keep only their text.
  td.addRule('safeLinks', {
    filter: (node) => node.nodeName === 'A' && !/^(https?:|mailto:|#.|\.{0,2}\/|[\w%-]+\.(md|markdown|html?|pdf|png|jpe?g|gif|svg)(#|$))/i.test(node.getAttribute('href') || ''),
    replacement: (content) => content,
  });
  // Word's "Normal" spans and font tags carry no meaning.
  td.addRule('plainSpans', { filter: ['span', 'font'], replacement: (content) => content });

  let md = td.turndown(src);
  if (fromWord) {
    // Word writes bulleted lists as paragraphs starting with a symbol character.
    md = md.replace(/^[ \t]*[·•▪◦§o][ \t\u00a0]+/gm, '- ').replace(/^[ \t]*(\d+)[.)][ \t\u00a0]+/gm, '$1. ');
  }
  return tidy(md);
}

/** Final touches: one space after list markers, header rows for tables that had none, blank-line runs. */
function tidy(md) {
  const lines = md.split('\n');
  for (let i = 0; i + 2 < lines.length; i++) {
    // A table copied from a spreadsheet has no header row: Turndown leaves an empty one, so use the first row.
    if (/^\|(\s*\|)+\s*$/.test(lines[i]) && /^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1]) && /^\|.*\|\s*$/.test(lines[i + 2])) {
      lines[i] = lines[i + 2];
      lines.splice(i + 2, 1);
    }
  }
  return lines.join('\n')
    .replace(/^(\s*)([-*+]|\d+\.)[ \t]{2,}(?=\S)/gm, '$1$2 ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Is this clipboard HTML worth converting (it has structure or formatting, not just plain text)? */
function isRichHtml(html) {
  return /<(h[1-6]|p|ul|ol|li|table|blockquote|pre|strong|b|em|i|a|img|code|br|div)[\s>]/i.test(String(html || ''));
}

module.exports = { htmlToMarkdown, isRichHtml, tidy };
