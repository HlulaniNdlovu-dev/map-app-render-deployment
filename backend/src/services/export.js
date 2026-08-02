// Shared CSV/PDF export used by all 4 admin/analyst reports
// (reports.routes.js). No new CSV dependency — RFC4180 escaping is a
// handful of lines. PDF uses pdfkit (lightweight, no headless-browser
// dependency like puppeteer would need).
//
// Every export carries a plain-language `description` explaining what the
// report shows and how to read it, plus a `filters` summary of whatever
// the caller narrowed the data by — a PDF or CSV handed to someone outside
// the live app should be understandable on its own, not just a bare data
// dump. Brand palette matches the frontend's Tailwind theme
// (frontend_v2/src/index.css --color-brand-*) so exports look like part
// of the same product.
import PDFDocument from 'pdfkit';

const BRAND = {
  ink: '#0d1526',
  muted: '#667085',
  blue: '#2f5fe0',
  blueDark: '#16266b',
  blueSoft: '#dce8fb',
  border: '#e7e2d6',
  bg: '#f6f4ee',
};

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Renders one labeled table as a CSV block: a "## label" heading line,
 * a header row, then data rows. Multiple blocks can be concatenated to
 * build a multi-section report (see the safety report's CSV export).
 */
function csvSection(label, columns, rows) {
  const lines = [];
  if (label) lines.push(`## ${label}`);
  lines.push(columns.map((c) => csvEscape(c.label)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c.key])).join(','));
  }
  return lines.join('\n');
}

/**
 * Builds a full CSV document from one or more sections, with a plain-text
 * comment header explaining what the report is and what it's filtered by
 * (so the file is still understandable once it's out of the app).
 * sections: [{ label, columns: [{key, label}], rows: [...] }]
 */
export function buildCsv(title, generatedAt, sections, { description, filters } = {}) {
  const parts = [`# ${title} — Mapper Safe Route Navigation System`, `# Generated: ${generatedAt}`];
  if (filters) parts.push(`# Filters applied: ${filters}`);
  if (description) {
    parts.push('#');
    for (const line of wrapPlainText(description, 100)) parts.push(`# ${line}`);
  }
  parts.push('');
  parts.push(sections.map((s) => csvSection(s.label, s.columns, s.rows)).join('\n\n'));
  return parts.join('\n') + '\n';
}

function wrapPlainText(text, maxLen) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLen) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/**
 * Streams a styled PDF report directly to the Express response: branded
 * header band, title, generated-at + applied-filters line, a plain-language
 * explanation of what the report shows and how to read it, then one or
 * more shaded/bordered tables. Column widths are proportional (via each
 * column's optional `width` weight, default 1) rather than fixed-equal, so
 * narrow ID columns don't waste space next to long text columns.
 */
export function streamPdf(res, title, generatedAt, sections, { description, filters } = {}) {
  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const MARGIN = 40;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - MARGIN * 2;
  const pageBottom = () => doc.page.height - 60; // reserve room for the footer

  function drawHeaderBand() {
    doc.rect(0, 0, pageWidth, 64).fill(BRAND.blueDark);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('MAPPER', MARGIN, 18);
    doc
      .fillColor('#c9d6f5')
      .font('Helvetica')
      .fontSize(9)
      .text('Safe Route Navigation System', MARGIN, 38);
    doc.fillColor(BRAND.ink);
  }

  function drawFooter(pageNumber) {
    const y = doc.page.height - 40;
    doc.moveTo(MARGIN, y).lineTo(pageWidth - MARGIN, y).strokeColor(BRAND.border).lineWidth(1).stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text('Mapper — Safe Route Navigation System · Internal report', MARGIN, y + 8, { continued: false })
      .text(`Page ${pageNumber}`, pageWidth - MARGIN - 60, y + 8, { width: 60, align: 'right' });
  }

  drawHeaderBand();
  doc.y = 84;

  doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND.ink).text(title, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(BRAND.muted).text(`Generated: ${generatedAt}`, MARGIN, doc.y, { width: contentWidth });
  if (filters) {
    doc.moveDown(0.15);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(BRAND.muted).text(`Filters applied: ${filters}`, MARGIN, doc.y, { width: contentWidth });
  }
  doc.moveDown(0.6);

  if (description) {
    const boxTop = doc.y;
    doc.font('Helvetica').fontSize(9.5);
    const textHeight = doc.heightOfString(description, { width: contentWidth - 24 });
    doc.rect(MARGIN, boxTop, contentWidth, textHeight + 20).fill(BRAND.blueSoft);
    doc
      .fillColor(BRAND.blueDark)
      .text(description, MARGIN + 12, boxTop + 10, { width: contentWidth - 24 });
    doc.y = boxTop + textHeight + 20 + 16;
    doc.fillColor(BRAND.ink);
  }

  for (const section of sections) {
    if (section.label) {
      if (doc.y > pageBottom() - 70) {
        doc.addPage();
        drawHeaderBand();
        doc.y = 84;
      }
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND.ink).text(section.label, MARGIN, doc.y);
      const underlineY = doc.y + 2;
      doc.moveTo(MARGIN, underlineY).lineTo(MARGIN + 40, underlineY).strokeColor(BRAND.blue).lineWidth(2).stroke();
      doc.moveDown(0.6);
    }

    const columns = section.columns;
    const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0);
    const colWidths = columns.map((c) => (contentWidth * (c.width || 1)) / totalWeight);
    const startX = MARGIN;
    const ROW_PAD_Y = 6;

    const drawTableHeader = () => {
      const headerY = doc.y;
      doc.rect(startX, headerY, contentWidth, 22).fill(BRAND.blueSoft);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRAND.blueDark);
      let x = startX;
      for (let i = 0; i < columns.length; i++) {
        doc.text(columns[i].label.toUpperCase(), x + 6, headerY + 7, { width: colWidths[i] - 10 });
        x += colWidths[i];
      }
      doc.y = headerY + 22;
      doc.fillColor(BRAND.ink);
    };

    drawTableHeader();

    if (section.rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(BRAND.muted).text('No data for this section.', startX + 6, doc.y + 8);
      doc.moveDown(1.2);
      doc.fillColor(BRAND.ink);
      continue;
    }

    section.rows.forEach((row, i) => {
      // Estimate row height from the tallest wrapped cell.
      doc.font('Helvetica').fontSize(8.5);
      const cellHeights = columns.map((col, ci) => {
        const value = row[col.key];
        const text = value === null || value === undefined ? '' : String(value);
        return doc.heightOfString(text, { width: colWidths[ci] - 10 });
      });
      const rowHeight = Math.max(...cellHeights) + ROW_PAD_Y * 2;

      if (doc.y + rowHeight > pageBottom()) {
        doc.addPage();
        drawHeaderBand();
        doc.y = 84;
        drawTableHeader();
      }

      const rowY = doc.y;
      if (i % 2 === 1) {
        doc.rect(startX, rowY, contentWidth, rowHeight).fill(BRAND.bg);
        doc.fillColor(BRAND.ink);
      }
      let x = startX;
      doc.font('Helvetica').fontSize(8.5).fillColor(BRAND.ink);
      for (let ci = 0; ci < columns.length; ci++) {
        const value = row[columns[ci].key];
        const text = value === null || value === undefined ? '' : String(value);
        doc.text(text, x + 6, rowY + ROW_PAD_Y, { width: colWidths[ci] - 10 });
        x += colWidths[ci];
      }
      doc.moveTo(startX, rowY + rowHeight).lineTo(startX + contentWidth, rowY + rowHeight).strokeColor(BRAND.border).lineWidth(0.5).stroke();
      doc.y = rowY + rowHeight;
    });

    doc.moveDown(1.1);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(i + 1);
  }

  doc.end();
}

/** Parses ?sortDir=asc|desc, defaulting to desc. */
export function parseSortDir(value, fallback = 'desc') {
  return value === 'asc' ? 'asc' : value === 'desc' ? 'desc' : fallback;
}

export function sortRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}
