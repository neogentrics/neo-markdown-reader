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
          const children = runsToChildren(b.runs);
          out.push(new Paragraph({ heading: HEADINGS[Math.min(5, Math.max(0, b.level - 1))],
            children: b.id ? [new Bookmark({ id: bookmarkName(b.id), children })] : children }));
          break;
        }
        case 'p':
          out.push(new Paragraph({ alignment: ALIGN[b.align], indent, border: quoteBorder, children: runsToChildren(b.runs, ctx.quote ? { italics: false } : {}) }));
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

// The Anthropic SDK rides in the same bundle (used by AI assist).
const Anthropic = require('@anthropic-ai/sdk');

module.exports = { Anthropic: Anthropic.default || Anthropic, docxToMarkdown, readOutline, pagesForEntries, finishPdf, collectAssets, buildDocx, bookmarkName, PAPER_IN, MARGIN_IN };
