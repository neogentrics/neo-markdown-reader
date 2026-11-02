'use strict';
// PDF finishing (pdf-lib) and Word documents (docx). Bundled into dist/export-tools.cjs at build
// time so the packaged app doesn't carry these libraries' full source trees.
const { PDFDocument, PDFName, PDFArray } = require('pdf-lib');
const docx = require('docx');

// ---------------------------------------------------------------- PDF
/** The PDF's outline (bookmarks) as a flat list in document order: [{ title, level, page }] (page is 1-based). */
async function readOutline(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages().map((p) => p.ref.toString());
  const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
  const out = [];
  if (!outlines) return { pages: pages.length, items: out };
  const walk = (ref, level, guard) => {
    let item = ref && doc.context.lookup(ref);
    while (item && guard.size < 5000) {
      if (guard.has(item)) break;
      guard.add(item);
      const title = item.lookup(PDFName.of('Title'));
      let dest = item.lookup(PDFName.of('Dest'));
      const action = item.lookup(PDFName.of('A'));
      if (!dest && action) dest = action.lookup(PDFName.of('D'));
      const page = dest instanceof PDFArray ? pages.indexOf(dest.get(0).toString()) + 1 : 0;
      out.push({ title: title ? title.decodeText() : '', level, page });
      const first = item.get(PDFName.of('First'));
      if (first) walk(first, level + 1, guard);
      const next = item.get(PDFName.of('Next'));
      item = next && doc.context.lookup(next);
    }
  };
  walk(outlines.get(PDFName.of('First')), 1, new Set());
  return { pages: pages.length, items: out };
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Match contents entries (in document order) to outline items by title, in order. */
function pagesForEntries(entries, outline) {
  const result = [];
  let from = 0;
  for (const e of entries) {
    const want = norm(e.text);
    let hit = -1;
    for (let i = from; i < outline.length; i++) if (norm(outline[i].title) === want) { hit = i; break; }
    if (hit >= 0) { result.push(outline[hit].page); from = hit + 1; } else result.push(0);
  }
  return result;
}

/** Put the cover in front of the body and set the document information. */
async function finishPdf(bodyBytes, coverBytes, info = {}) {
  const doc = await PDFDocument.load(bodyBytes);
  if (coverBytes) {
    const cover = await PDFDocument.load(coverBytes);
    const copied = await doc.copyPages(cover, cover.getPageIndices());
    copied.forEach((p, i) => doc.insertPage(i, p));
  }
  if (info.title) doc.setTitle(String(info.title), { showInWindowTitleBar: true });
  if (info.author) doc.setAuthor(String(info.author));
  if (info.subject) doc.setSubject(String(info.subject));
  if (Array.isArray(info.keywords) && info.keywords.length) doc.setKeywords(info.keywords.map(String));
  doc.setCreator('Neo Markdown Reader');
  doc.setProducer('Neo Markdown Reader');
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------- Word
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, InternalHyperlink, Bookmark, ImageRun,
  Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, LevelFormat, BorderStyle, Footer, PageNumber,
} = docx;

const TWIP = 1440;                       // per inch
const PAPER_IN = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14], a5: [5.83, 8.27] };
const MARGIN_IN = { narrow: 0.6, normal: 0.9, wide: 1.2 };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

/** Word bookmark names: start with a letter, letters/digits/underscore, at most 40 characters. */
function bookmarkName(id) {
  return ('h_' + String(id).replace(/[^A-Za-z0-9_]/g, '_')).slice(0, 40);
}

/** Walk the model, giving every graphic an index and listing the image sources it needs. */
function collectAssets(model) {
  const images = new Set();
  const graphics = [];
  const runs = (list) => { for (const r of list || []) if (r.img != null && r.img) images.add(r.img); };
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (b.t === 'graphic') { b.gid = graphics.length; graphics.push(b); }
      runs(b.runs);
      if (b.t === 'list') b.items.forEach((it) => walk(it.blocks));
      if (b.t === 'quote') walk(b.blocks);
      if (b.t === 'table') b.rows.forEach((r) => r.cells.forEach((c) => runs(c.runs)));
      if (b.t === 'deflist') b.items.forEach((it) => { runs(it.term); walk(it.defs); });
    }
  };
  walk(model);
  return { images: [...images], graphics };
}

function hexColor(c, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  return m ? m[1].toUpperCase() : fallback;
}

/**
 * Build a .docx from the document model.
 * assets: { images: { [src]: { data, type, width, height } }, graphics: [{ data, width, height } | null] }
 * options: { paper, margins, pageNumbers, title, author, subject, accent, bodyFont, headingFont, codeFont }
 */
async function buildDocx(model, assets = {}, options = {}) {
  const images = assets.images || {};
  const graphics = assets.graphics || [];
  const accent = hexColor(options.accent, '2F54C9');
  const bodyFont = options.bodyFont || 'Calibri';
  const headingFont = options.headingFont || bodyFont;
  const codeFont = options.codeFont || 'Consolas';
  const [pw, ph] = PAPER_IN[options.paper] || PAPER_IN.letter;
  const margin = MARGIN_IN[options.margins] ?? MARGIN_IN.normal;
  const contentPx = Math.round((pw - margin * 2) * 96);
  let listInstance = 0;

  const fit = (w, h, max = contentPx) => {
    w = w || 400; h = h || 300;
    if (w > max) { h = Math.round(h * max / w); w = max; }
    return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
  };

  const textRun = (r, extra = {}) => new TextRun({
    text: r.text,
    bold: r.b || extra.bold,
    italics: r.i || extra.italics,
    strike: r.s,
    underline: r.u ? {} : undefined,
    superScript: r.sup,
    subScript: r.sub,
    highlight: r.mark ? 'yellow' : undefined,
    font: r.code ? codeFont : (r.math ? 'Cambria Math' : undefined),
    shading: r.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F7' } : undefined,
    color: extra.color,
    style: extra.style,
  });

  const runsToChildren = (runs, extra = {}) => {
    const out = [];
    for (const r of runs || []) {
      if (r.br) { out.push(new TextRun({ break: 1 })); continue; }
      if (r.img != null) {
        const img = images[r.img];
        if (img?.data) {
          out.push(new ImageRun({ type: img.type, data: img.data, transformation: fit(img.width || r.naturalWidth || r.width, img.height || r.naturalHeight || r.height),
            altText: { name: r.alt || 'Image', description: r.alt || '', title: r.alt || '' } }));
        } else out.push(new TextRun({ text: r.alt ? `[${r.alt}]` : '[Image]', italics: true, color: '7A8396' }));
        continue;
      }
      if (!r.text) continue;
      if (r.href && r.href.startsWith('#') && r.href.length > 1) {
        out.push(new InternalHyperlink({ anchor: bookmarkName(decodeURIComponent(r.href.slice(1))), children: [textRun(r, { ...extra, style: 'Hyperlink' })] }));
      } else if (r.href && /^(https?|mailto):/i.test(r.href)) {
        out.push(new ExternalHyperlink({ link: r.href, children: [textRun(r, { ...extra, style: 'Hyperlink' })] }));
      } else out.push(textRun(r, extra));
    }
    return out;
  };

  const blocksToChildren = (blocks, ctx = { indent: 0, quote: false }) => {
    const out = [];
    const indent = ctx.indent ? { left: ctx.indent } : undefined;
    const quoteBorder = ctx.quote ? { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 10 } } : undefined;
    for (const b of blocks || []) {
      switch (b.t) {
        case 'meta':
          if (b.title) out.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.title })] }));
          if (b.sub) out.push(new Paragraph({ style: 'Subtitle', children: [new TextRun({ text: b.sub })] }));
          if (b.line) out.push(new Paragraph({ children: [new TextRun({ text: b.line, color: '7A8396' })] }));
          if (b.tags?.length) out.push(new Paragraph({ children: [new TextRun({ text: b.tags.join(' · '), color: accent, size: 18 })] }));
          break;
        case 'h': {
          const children = runsToChildren(b.runs, b.rtl ? { rightToLeft: true } : {});
          out.push(new Paragraph({ heading: HEADINGS[Math.min(5, Math.max(0, b.level - 1))], bidirectional: !!b.rtl,
            children: b.id ? [new Bookmark({ id: bookmarkName(b.id), children })] : children }));
          break;
        }
        case 'p':
          // Right-to-left paragraphs (Arabic, Hebrew…) are marked so Word lays them out from the right.
          out.push(new Paragraph({ alignment: ALIGN[b.align], indent, border: quoteBorder, bidirectional: !!b.rtl,
            children: runsToChildren(b.runs, { ...(ctx.quote ? { italics: false } : {}), ...(b.rtl ? { rightToLeft: true } : {}) }) }));
          break;
        case 'code': {
          const lines = b.text.split('\n');
          out.push(new Paragraph({ style: 'CodeBlock', indent,
            children: lines.flatMap((l, i) => [...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: l.replace(/\t/g, '    ') || ' ' })]) }));
          break;
        }
        case 'quote':
          if (b.alert) out.push(new Paragraph({ indent, border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 10 } }, children: [new TextRun({ text: b.alert, bold: true, color: accent })] }));
          out.push(...blocksToChildren(b.blocks, { ...ctx, quote: true }));
          break;
        case 'hr':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CFD6E2', space: 1 } }, children: [] }));
          break;
        case 'graphic': {
          const g = graphics[b.gid];
          if (g?.data) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: g.data, transformation: fit(g.width, g.height), altText: { name: b.kind === 'math' ? 'Equation' : 'Diagram', description: b.alt || '', title: b.alt || '' } })] }));
          else out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.alt || '[Diagram]', italics: true, font: b.kind === 'math' ? 'Cambria Math' : undefined })] }));
          break;
        }
        case 'list': {
          const instance = ++listInstance;
          const level = Math.min(8, ctx.level ?? 0);
          b.items.forEach((item) => {
            let first = true;
            for (const child of item.blocks) {
              if (child.t === 'p' && first) {
                const glyph = item.checked == null ? [] : [new TextRun({ text: item.checked ? '☑ ' : '☐ ' })];
                out.push(new Paragraph({
                  ...(b.ordered ? { numbering: { reference: 'ordered', level, instance } } : { bullet: { level } }),
                  border: quoteBorder,
                  children: [...glyph, ...runsToChildren(child.runs)],
                }));
                first = false;
              } else if (child.t === 'list') {
                out.push(...blocksToChildren([child], { ...ctx, level: level + 1, indent: 0 }));
              } else {
                out.push(...blocksToChildren([child], { ...ctx, indent: 720 * (level + 1) }));
                first = false;
              }
            }
          });
          break;
        }
        case 'table': {
          const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
          out.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map((r) => new TableRow({
              tableHeader: r.header,
              children: Array.from({ length: cols }, (_, i) => {
                const c = r.cells[i] || { runs: [] };
                return new TableCell({
                  shading: r.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F6FB' } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  children: [new Paragraph({ alignment: ALIGN[c.align], children: runsToChildren(c.runs, r.header ? { bold: true } : {}) })],
                });
              }),
            })),
          }));
          out.push(new Paragraph({ children: [] }));
          break;
        }
        case 'deflist':
          for (const it of b.items) {
            out.push(new Paragraph({ indent, children: runsToChildren(it.term, { bold: true }) }));
            out.push(...blocksToChildren(it.defs, { ...ctx, indent: (ctx.indent || 0) + 560 }));
          }
          break;
        default: break;
      }
    }
    return out;
  };

  const levels = (format) => Array.from({ length: 9 }, (_, level) => ({
    level, format, text: format === LevelFormat.DECIMAL ? `%${level + 1}.` : '•', alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  const doc = new Document({
    creator: 'Neo Markdown Reader',
    title: options.title || undefined,
    subject: options.subject || undefined,
    description: options.subject || undefined,
    lastModifiedBy: options.author || undefined,
    styles: {
      default: {
        document: { run: { font: bodyFont, size: 22 }, paragraph: { spacing: { after: 140, line: 300, lineRule: docx.LineRuleType.AUTO } } },
        title: { run: { font: headingFont, size: 52, bold: true, color: '111827' } },
        heading1: { run: { font: headingFont, size: 36, bold: true, color: '111827' }, paragraph: { spacing: { before: 360, after: 160 } } },
        heading2: { run: { font: headingFont, size: 30, bold: true, color: accent }, paragraph: { spacing: { before: 300, after: 120 } } },
        heading3: { run: { font: headingFont, size: 26, bold: true, color: '1D2330' }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading4: { run: { font: headingFont, size: 23, bold: true, color: '1D2330' } },
        heading5: { run: { font: headingFont, size: 22, bold: true, color: '4B5466' } },
        heading6: { run: { font: headingFont, size: 22, bold: true, italics: true, color: '4B5466' } },
        hyperlink: { run: { color: accent, underline: { type: 'single', color: accent } } },
      },
      paragraphStyles: [
        { id: 'CodeBlock', name: 'Code Block', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: codeFont, size: 19 },
          paragraph: { spacing: { before: 60, after: 200, line: 260, lineRule: docx.LineRuleType.AUTO }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F7FB' },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E3E8F0', space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E3E8F0', space: 4 },
              left: { style: BorderStyle.SINGLE, size: 4, color: 'E3E8F0', space: 4 }, right: { style: BorderStyle.SINGLE, size: 4, color: 'E3E8F0', space: 4 } } } },
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', run: { size: 28, color: '4B5466' } },
      ],
    },
    numbering: { config: [{ reference: 'ordered', levels: levels(LevelFormat.DECIMAL) }] },
    sections: [{
      properties: { page: { size: { width: Math.round(pw * TWIP), height: Math.round(ph * TWIP) },
        margin: { top: Math.round(margin * TWIP), bottom: Math.round(margin * TWIP), left: Math.round(margin * TWIP), right: Math.round(margin * TWIP) } } },
      footers: options.pageNumbers === false ? undefined : {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: '7A8396' })] })] }),
      },
      children: blocksToChildren(model),
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------- importing Word documents
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/tiff': 'tif', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf' };

/**
 * A Word document (.docx) as Markdown. Pictures come back separately, to be saved next to the
 * Markdown file; the Markdown links to them as `${imageDir}/${name}`.
 * @returns {Promise<{ markdown: string, images: { name: string, data: Buffer }[], warnings: string[] }>}
 */
async function docxToMarkdown(buffer, { imageDir = 'images', imagePrefix = 'image' } = {}) {
  const mammoth = require('mammoth');
  const { htmlToMarkdown } = require('./html-to-md.js');
  const images = [];
  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const ext = IMAGE_EXT[image.contentType] || 'png';
      const name = `${imagePrefix}-${images.length + 1}.${ext}`;
      images.push({ name, data: Buffer.from(await image.read()) });
      return { src: `${imageDir}/${name}` };
    }),
  });
  const markdown = htmlToMarkdown(result.value, { image: (src) => (src.startsWith(`${imageDir}/`) ? src : null) });
  const warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
  return { markdown, images, warnings };
}

// ---------------------------------------------------------------- EPUB (2.4)
const xmlEsc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build an EPUB 3 e-book (with an EPUB 2 table of contents for older readers).
 * book: { title, author, lang, id, chapters: [{ file, title, xhtml }], toc: [{ file, id, text, level }],
 *         css, images: [{ name, data, mime }], props: { [file]: 'svg mathml' } }
 */
function buildEpub(book) {
  const { zipSync, strToU8 } = require('fflate');
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const lang = book.lang || 'en';
  const page = (title, body, file) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEsc(lang)}" lang="${xmlEsc(lang)}">
<head><meta charset="utf-8"/><title>${xmlEsc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="${file === 'nav.xhtml' ? 'nav' : 'chapter'}">${body}</body>
</html>`;
  const toc = book.toc.length ? book.toc : book.chapters.map((c) => ({ file: c.file, id: '', text: c.title, level: 1 }));
  // Nested <ol> for the reader's table of contents.
  const navList = () => {
    let html = '<ol>';
    let depth = 1;
    toc.forEach((e, i) => {
      const lvl = Math.max(1, Math.min(e.level, depth + 1));
      if (i > 0) {
        if (lvl > depth) html += '<ol>';
        else { html += '</li>'; for (let d = depth; d > lvl; d--) html += '</ol></li>'; }
      }
      depth = lvl;
      html += `<li><a href="${xmlEsc(e.file)}${e.id ? `#${xmlEsc(e.id)}` : ''}">${xmlEsc(e.text)}</a>`;
    });
    html += '</li>';
    for (let d = depth; d > 1; d--) html += '</ol></li>';
    return `${html}</ol>`;
  };
  const nav = page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1>${navList()}</nav>`, 'nav.xhtml');
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${xmlEsc(book.id)}"/></head>
<docTitle><text>${xmlEsc(book.title)}</text></docTitle><navMap>${toc.map((e, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xmlEsc(e.text)}</text></navLabel><content src="${xmlEsc(e.file)}${e.id ? `#${xmlEsc(e.id)}` : ''}"/></navPoint>`).join('')}</navMap></ncx>`;
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...book.chapters.map((c, i) => `<item id="c${i + 1}" href="${xmlEsc(c.file)}" media-type="application/xhtml+xml"${book.props?.[c.file] ? ` properties="${book.props[c.file]}"` : ''}/>`),
    ...book.images.map((im, i) => `<item id="img${i + 1}" href="images/${xmlEsc(im.name)}" media-type="${xmlEsc(im.mime)}"/>`),
  ];
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xmlEsc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${xmlEsc(book.id)}</dc:identifier>
<dc:title>${xmlEsc(book.title)}</dc:title>
<dc:language>${xmlEsc(lang)}</dc:language>
${book.author ? `<dc:creator>${xmlEsc(book.author)}</dc:creator>` : ''}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>${manifest.join('\n')}</manifest>
<spine toc="ncx">${book.chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine>
</package>`;
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],                       // must come first, uncompressed
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/toc.ncx': strToU8(ncx),
    'OEBPS/style.css': strToU8(book.css || ''),
  };
  for (const c of book.chapters) files[`OEBPS/${c.file}`] = strToU8(page(c.title, c.xhtml, c.file));
  for (const im of book.images) files[`OEBPS/images/${im.name}`] = [new Uint8Array(im.data), { level: 0 }];
  return Buffer.from(zipSync(files, { level: 6 }));
}

// ---------------------------------------------------------------- PowerPoint (2.4)
/**
 * Build a .pptx from slides of the document model (one model per slide, split as in presentation mode).
 * Text stays editable; pictures, diagrams, charts and equations are placed as images.
 * assets: { images: { [src]: { data, type, width, height } }, graphics: [{ data, width, height } | null] }
 */
async function buildPptx(slides, assets, opts = {}) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';                       // 13.333 × 7.5 in, 16:9
  pptx.title = opts.title || '';
  if (opts.author) pptx.author = opts.author;
  const accent = hexColor(opts.accent, '3B5BDB');
  const font = opts.bodyFont || 'Calibri';
  const mono = opts.codeFont || 'Consolas';
  const W = 13.333;
  const H = 7.5;
  const M = 0.6;
  const runText = (runs, base = {}) => (runs || []).filter((r) => r.text || r.br).map((r) => (r.br ? { text: '', options: { breakLine: true } } : {
    text: r.text,
    options: { ...base, bold: base.bold || !!r.b, italic: base.italic || !!r.i, strike: r.s ? 'sngStrike' : undefined, fontFace: r.code ? mono : base.fontFace,
      underline: r.u ? { style: 'sng' } : undefined, hyperlink: r.href && /^https?:|^mailto:/i.test(r.href) ? { url: r.href } : undefined,
      superscript: !!r.sup, subscript: !!r.sub, highlight: r.mark ? 'FFF3BF' : undefined },
  }));
  const picOf = (src) => assets.images?.[src];
  for (const blocks of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const list = blocks.filter((b, i) => b.t !== 'hr' || i > 0);
    const meta = list.find((b) => b.t === 'meta');
    if (meta && list.length <= 2) {
      slide.addShape(pptx.ShapeType.rect, { x: M, y: 3.05, w: 0.12, h: 1.3, fill: { color: accent }, line: { color: accent } });
      slide.addText(meta.title || opts.title || '', { x: M + 0.35, y: 2.2, w: W - 2 * M - 0.35, h: 1.6, fontFace: opts.headingFont || font, fontSize: 44, bold: true, color: '1D2330', valign: 'bottom', fit: 'shrink' });
      const sub = [meta.sub, meta.line].filter(Boolean).join('\n');
      if (sub) slide.addText(sub, { x: M + 0.35, y: 3.9, w: W - 2 * M - 0.35, h: 1.2, fontFace: font, fontSize: 22, color: '5C6370', valign: 'top' });
      continue;
    }
    let y = M;
    if (list[0]?.t === 'h') {
      const h = list.shift();
      slide.addText(runText(h.runs, { fontFace: opts.headingFont || font }), { x: M, y, w: W - 2 * M, h: 0.95, fontSize: h.level <= 1 ? 36 : 30, bold: true, color: '1D2330', valign: 'middle', fit: 'shrink' });
      slide.addShape(pptx.ShapeType.rect, { x: M, y: y + 1.0, w: 1.1, h: 0.06, fill: { color: accent }, line: { color: accent } });
      y += 1.3;
    }
    // Text goes in one box; pictures, tables and graphics go beside it (or fill the slide on their own).
    const text = [];
    const media = [];
    // Paragraph settings (bullet, numbering, indent) go on the first piece only. pptxgenjs writes paragraph
    // settings for every piece, so no other piece may carry any, or it would override the bullet.
    const addPara = (runs, options = {}) => {
      const r = runText(runs, { fontFace: font, ...options.base });
      if (!r.length) return;
      r[0].options = { ...r[0].options, ...options.first };
      r[r.length - 1].options = { ...r[r.length - 1].options, breakLine: true };
      text.push(...r);
    };
    let notes = false;                                 // after the footnotes' rule: footnotes, set small
    const walk = (bs, depth = 0) => {
      for (const b of bs) {
        if (b.t === 'hr') { notes = true; continue; }
        if (notes && b.t === 'list') {
          b.items.forEach((it, k) => {
            const first = it.blocks.find((x) => x.t === 'p');
            if (first) addPara([{ text: `[${b.start + k}] ` }, ...first.runs.filter((r) => !r.img)], { base: { fontSize: 13, color: '5C6370' } });
          });
          continue;
        }
        if (b.t === 'p') {
          const imgs = b.runs.filter((r) => r.img);
          for (const r of imgs) if (picOf(r.img)) media.push({ kind: 'img', ...picOf(r.img) });
          addPara(b.runs.filter((r) => !r.img), { first: depth ? { indentLevel: depth } : {} });
        } else if (b.t === 'h') addPara(b.runs, { base: { bold: true, fontSize: 24 } });
        else if (b.t === 'list') {
          b.items.forEach((it, k) => {
            const [first, ...rest] = it.blocks;
            const mark = it.checked == null ? {} : { text: it.checked ? '☑ ' : '☐ ' };
            if (first?.t === 'p') {
              const runs = mark.text ? [{ text: mark.text }, ...first.runs] : first.runs;
              addPara(runs.filter((r) => !r.img), { first: { bullet: b.ordered ? { type: 'number', startAt: b.start } : true, indentLevel: depth } });
              walk(rest, depth + 1);
            } else walk(it.blocks, depth + 1);
          });
        } else if (b.t === 'quote') walk(b.blocks.map((q) => (q.t === 'p' ? { ...q, runs: q.runs.map((r) => ({ ...r, i: true })) } : q)), depth + 1);
        else if (b.t === 'code') { text.push({ text: b.text, options: { fontFace: mono, fontSize: 14, color: '343A40', breakLine: true } }); }
        else if (b.t === 'deflist') b.items.forEach((it) => { addPara(it.term, { base: { bold: true } }); walk(it.defs, depth + 1); });
        else if (b.t === 'meta') { if (b.title) addPara([{ text: b.title, b: true }]); if (b.sub) addPara([{ text: b.sub }]); }
        else if (b.t === 'table') media.push({ kind: 'table', rows: b.rows });
        else if (b.t === 'graphic') { const g = assets.graphics?.[b.gid]; if (g) media.push({ kind: 'img', ...g, type: 'png' }); }
      }
    };
    walk(list);
    const bodyH = H - y - M;
    const hasText = text.length > 0;
    const mediaX = hasText && media.length ? W * 0.52 : M;
    const mediaW = hasText && media.length ? W - mediaX - M : W - 2 * M;
    if (hasText) slide.addText(text, { x: M, y, w: (media.length ? W * 0.52 - M - 0.25 : W - 2 * M), h: bodyH, fontSize: 22, color: '1D2330', valign: 'top', fit: 'shrink' });
    const each = media.length ? (bodyH - 0.15 * (media.length - 1)) / media.length : 0;
    media.slice(0, 4).forEach((m, k) => {
      const my = y + k * (each + 0.15);
      if (m.kind === 'table') {
        const rows = m.rows.slice(0, 14).map((r) => r.cells.map((c) => ({ text: c.runs.map((x) => x.text || '').join(''), options: { bold: c.header, fill: { color: c.header ? 'EEF1F6' : 'FFFFFF' }, align: c.align || 'left' } })));
        slide.addTable(rows, { x: mediaX, y: my, w: mediaW, fontSize: Math.max(10, 18 - m.rows[0].cells.length), fontFace: font, color: '1D2330', border: { type: 'solid', pt: 0.75, color: 'CED4DA' }, autoPage: false });
      } else if (m.data) {
        const ratio = (m.width || 4) / (m.height || 3);
        let w = mediaW;
        let h = w / ratio;
        if (h > each) { h = each; w = h * ratio; }
        const type = m.type === 'jpg' ? 'jpeg' : (m.type || 'png');
        slide.addImage({ data: `image/${type};base64,${Buffer.from(m.data).toString('base64')}`, x: mediaX + (mediaW - w) / 2, y: my, w, h });
      }
    });
  }
  return fixParagraphs(await pptx.write({ outputType: 'nodebuffer' }));
}

/**
 * pptxgenjs writes paragraph settings (<a:pPr>) before every piece of text, but a paragraph may only have
 * one, at its start: with more, the bullet of a paragraph with bold words in it is lost and PowerPoint may
 * offer to repair the file. Keep the first in each paragraph.
 */
function fixParagraphs(buf) {
  const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
  const files = unzipSync(new Uint8Array(buf));
  for (const name of Object.keys(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = strFromU8(files[name]).replace(/<a:p>([\s\S]*?)<\/a:p>/g, (all, inner) => {
      let seen = false;
      return `<a:p>${inner.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pPr) => (seen ? '' : ((seen = true), pPr)))}</a:p>`;
    });
    files[name] = strToU8(xml);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

// The Anthropic SDK rides in the same bundle (used by AI assist).
const Anthropic = require('@anthropic-ai/sdk');

module.exports = { Anthropic: Anthropic.default || Anthropic, buildEpub, buildPptx, docxToMarkdown, readOutline, pagesForEntries, finishPdf, collectAssets, buildDocx, bookmarkName, PAPER_IN, MARGIN_IN };
