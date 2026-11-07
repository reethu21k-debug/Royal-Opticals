import PDFDocument from 'pdfkit';

// Order report as printed grids — one grid per block, laid out like the client's printed "ORDER LENS" sheets:
//   title (block name, underlined)  →  corner cells with the axis names  →  column labels across the top  →  an "ORDER LENS" band
//   →  one row per row label, the suggested order quantity in each cell. Positions with nothing to order are left blank.
// Labels are printed exactly as stored. This module is pure (no database) so it can be tested on its own.

export type GridBlock = {
  title: string;                 // block name (e.g. "CR HC SV -6-2")
  rowAxis: string;               // e.g. "(-) SPH"
  colAxis: string;               // e.g. "(-) CYL" — empty for single-column ("list") blocks
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  qty: Map<string, number>;      // `${rowKey}\u0001${colKey}` → quantity to order (> 0 only)
};

export const cellKey = (rowKey: string, colKey: string) => `${rowKey}\u0001${colKey}`;

type Meta = { stamp: string; filters: string[]; netNote: boolean };

const MARGIN = 40;
const PORTRAIT = { w: 595.28, h: 841.89 };
const ROW_H = 21;
const HEAD_H = 22;
const MIN_COL_W = 38;
const MAX_COL_W = 64;
const LINE = '#222';
const HEAD_FILL = '#e4e4e4';
const BAND_FILL = '#f3f3f3';

// Helvetica (the built-in PDF font) has no U+2212 minus sign; the app stores ASCII '-', but be safe.
const clean = (s: string) => String(s ?? '').replace(/\u2212/g, '-');

export async function renderOrderGridPdf(blocks: GridBlock[], meta: Meta): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: false, bufferPages: true, info: { Title: 'Order report' } });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<void>(res => doc.on('end', () => res()));

  let totalLenses = 0, totalUnits = 0;

  if (blocks.length === 0) {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: MARGIN });
    doc.font('Helvetica-Bold').fontSize(16).text('ORDER REPORT', MARGIN, 80, { width: PORTRAIT.w - MARGIN * 2, align: 'center', underline: true });
    doc.font('Helvetica').fontSize(10).fillColor('#444').moveDown(1.5)
      .text('Nothing to order: every lens with a recorded stock and target is at or above its target.', { align: 'center' }).fillColor('#000');
  }

  for (const b of blocks) {
    const hasCols = b.cols.some(c => c.label !== '');
    const cols = hasCols ? b.cols : [{ key: '', label: '' }];
    doc.font('Helvetica-Bold').fontSize(10);
    const labelW = Math.min(120, Math.max(58, ...b.rows.map(r => doc.widthOfString(clean(r.label)) + 16), doc.widthOfString(clean(b.rowAxis)) + 16));
    const blockUnits = [...b.qty.values()].reduce((s, v) => s + v, 0);
    totalLenses += b.qty.size; totalUnits += blockUnits;

    // Orientation and column chunking: keep every grid readable instead of squeezing it.
    const portraitW = PORTRAIT.w - MARGIN * 2, landscapeW = PORTRAIT.h - MARGIN * 2;
    let layout: 'portrait' | 'landscape' = 'portrait'; let perChunk = cols.length;
    if (labelW + cols.length * MIN_COL_W > portraitW) {
      layout = 'landscape';
      if (labelW + cols.length * MIN_COL_W > landscapeW) perChunk = Math.max(1, Math.floor((landscapeW - labelW) / (MIN_COL_W + 4)));
    }
    const pageW = layout === 'portrait' ? PORTRAIT.w : PORTRAIT.h, pageH = layout === 'portrait' ? PORTRAIT.h : PORTRAIT.w;
    const usableW = pageW - MARGIN * 2;
    const nChunks = Math.ceil(cols.length / perChunk);

    for (let ci = 0; ci < nChunks; ci++) {
      const chunk = cols.slice(ci * perChunk, (ci + 1) * perChunk);
      const colW = Math.max(Math.min(MAX_COL_W, (usableW - labelW) / chunk.length), 92 / chunk.length);   // band text "ORDER LENS" needs ~92pt in total
      const gridW = labelW + colW * chunk.length;
      const x0 = MARGIN + (usableW - gridW) / 2;
      let rowIdx = 0; let first = true;

      while (first || rowIdx < b.rows.length) {
        doc.addPage({ size: 'A4', layout, margin: MARGIN });
        let y = MARGIN;
        // title (block name), underlined like the printed sheet
        const sub = [nChunks > 1 ? `columns ${ci * perChunk + 1}-${ci * perChunk + chunk.length} of ${cols.length}` : '', !first ? 'continued' : ''].filter(Boolean).join(', ');
        doc.font('Helvetica-Bold').fontSize(17).fillColor('#000').text(clean(b.title), MARGIN, y, { width: usableW, align: 'center', underline: true, lineBreak: false, ellipsis: true });
        y += 24;
        // Only print a small note when the grid is split across pages/columns; the hierarchy path is no longer printed.
        if (sub) doc.font('Helvetica').fontSize(7.5).fillColor('#666').text(`(${sub})`, MARGIN, y, { width: usableW, align: 'center', lineBreak: false, ellipsis: true });
        doc.fillColor('#000'); y += sub ? 16 : 10;

        const top = y;
        const avail = pageH - MARGIN - 34 - top - HEAD_H * 2;          // leave room for the totals line + page footer
        const maxRows = Math.max(1, Math.floor(avail / ROW_H));
        const slice = b.rows.slice(rowIdx, rowIdx + maxRows);

        const rect = (x: number, yy: number, w: number, h: number, fill?: string) => {
          if (fill) doc.rect(x, yy, w, h).fill(fill);
          doc.lineWidth(0.8).strokeColor(LINE).rect(x, yy, w, h).stroke();
        };
        const txt = (s: string, x: number, yy: number, w: number, h: number, size: number, bold: boolean, color = '#000') => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
          doc.text(clean(s), x + 2, yy + (h - size) / 2 + 0.5, { width: w - 4, align: 'center', lineBreak: false, ellipsis: true });
          doc.fillColor('#000');
        };

        // header row 1: corner (column axis) + column labels
        rect(x0, top, labelW, HEAD_H, HEAD_FILL); txt(hasCols ? b.colAxis : '', x0, top, labelW, HEAD_H, 9.5, true);
        chunk.forEach((c, i) => { const x = x0 + labelW + i * colW; rect(x, top, colW, HEAD_H, HEAD_FILL); txt(c.label, x, top, colW, HEAD_H, 10, true); });
        // header row 2: corner (row axis) + "ORDER LENS" band across all columns
        const y2 = top + HEAD_H;
        rect(x0, y2, labelW, HEAD_H, HEAD_FILL); txt(b.rowAxis, x0, y2, labelW, HEAD_H, 9.5, true);
        rect(x0 + labelW, y2, colW * chunk.length, HEAD_H, BAND_FILL); txt('ORDER LENS', x0 + labelW, y2, colW * chunk.length, HEAD_H, 10, true, '#8a8a8a');

        // body
        slice.forEach((r, ri) => {
          const yy = y2 + HEAD_H + ri * ROW_H;
          rect(x0, yy, labelW, ROW_H, HEAD_FILL); txt(r.label, x0, yy, labelW, ROW_H, 10, true);
          chunk.forEach((c, i) => {
            const x = x0 + labelW + i * colW; rect(x, yy, colW, ROW_H);
            const q = b.qty.get(cellKey(r.key, c.key));
            if (q !== undefined && q > 0) txt(String(q), x, yy, colW, ROW_H, 10.5, true);
          });
        });

        rowIdx += slice.length; first = false;
        const endY = y2 + HEAD_H + slice.length * ROW_H;
        // totals for the block, printed once under its last page of the last column chunk
        if (rowIdx >= b.rows.length && ci === nChunks - 1) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#444')
            .text(`${b.qty.size} ${b.qty.size === 1 ? 'lens' : 'lenses'} to order  ·  ${blockUnits} units`, x0, endY + 6, { width: gridW, align: 'right', lineBreak: false }).fillColor('#000');
        }
        if (b.rows.length === 0) break;
      }
    }
  }

  // footer on every page: generated stamp, filters, page numbers (+ grand total on the last page)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const w = doc.page.width, h = doc.page.height; doc.page.margins.bottom = 0;
    const last = i === range.count - 1;
    if (last && blocks.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
        .text(`TOTAL ORDERS:  ${totalLenses.toLocaleString('en-IN')} ${totalLenses === 1 ? 'lens' : 'lenses'}  ·  ${totalUnits.toLocaleString('en-IN')} units`, MARGIN, h - 46, { width: w - MARGIN * 2, align: 'right', lineBreak: false });
    }
    const f = meta.filters.length ? `  ·  ${meta.filters.join('; ')}` : '';
    doc.font('Helvetica').fontSize(7.5).fillColor('#777')
      .text(`Royal Opticals  ·  Order report  ·  ${meta.stamp}${meta.netNote ? '  ·  net of open purchase orders' : ''}${f}`, MARGIN, h - 30, { width: w - MARGIN * 2 - 70, align: 'left', lineBreak: false, ellipsis: true })
      .text(`Page ${i + 1} of ${range.count}`, w - MARGIN - 70, h - 30, { width: 70, align: 'right', lineBreak: false }).fillColor('#000');
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}