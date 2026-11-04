import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fmtPower } from './power-format';
import { lineAmount, money, round2 } from './billing';
import { billWhere } from './bill-filters';

// Builds the downloadable PDF / Excel files for one or many bills. No React; the only database access is loadBills().
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type Row = Record<string, any>;
export type Loaded = { bills: Row[]; items: Map<string, Row[]> };
const SHOP = 'Royal Opticals';
const STATUS: Record<string, string> = { draft: 'Draft', finalized: 'Finalized', void: 'Void' };

export async function loadBills(c: Q, o: { ids?: string[]; sp: URLSearchParams }): Promise<Loaded> {
  const f = o.ids?.length ? { where: 'where b.id = any($1::uuid[])', params: [o.ids] as unknown[] } : billWhere(o.sp);
  const bills = (await c.query(`select b.*, b.bill_date::text as bill_date from bills b ${f.where} order by b.bill_date, b.bill_number limit 2000`, f.params)).rows;
  const items = new Map<string, Row[]>();
  if (bills.length) {
    const rows = (await c.query(`select i.*, v.row_label_source as _row, v.col_label_source as _col, node_path(v.block_node_id) as _path
      from bill_items i left join v_inventory v on v.variant_id = i.variant_id
      where i.bill_id = any($1::uuid[]) order by i.line_no, i.side desc`, [bills.map(b => b.id)])).rows;
    for (const r of rows) { const a = items.get(r.bill_id) ?? []; a.push(r); items.set(r.bill_id, a); }
  }
  return { bills, items };
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const pw = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number.isFinite(Number(v)) ? Number(v).toFixed(2) : String(v));
export function lensText(i: Row) {
  if (i.source === 'inventory') {
    const lab = `${fmtPower(i._row)}${i._col ? '  x  ' + fmtPower(i._col) : ''}`.trim();
    return [lab, i.lens_type].filter(Boolean).join('  ·  ') || 'Inventory lens';
  }
  return i.lens_type || 'External order';
}
const amountOf = (i: Row) => lineAmount(Number(i.quantity), Number(i.rate));
const eyeOf = (i: Row) => (i.side === 'R' ? 'Right' : 'Left');

export function exportName(bills: Row[], sp: URLSearchParams) {
  if (bills.length === 1) return `Bill-${String(bills[0].bill_number).replace(/[^\w.-]+/g, '_')}`;
  const from = sp.get('from'), to = sp.get('to');
  return from || to ? `bills_${from || 'start'}_to_${to || 'today'}` : `bills_${new Date().toISOString().slice(0, 10)}`;
}

// ───────────────────────── Excel ─────────────────────────
export async function billsXlsx({ bills, items }: Loaded): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = SHOP; wb.created = new Date();
  const N2 = '#,##0.00'; const fill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE9ECF5' } };
  const head = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell(c => { c.fill = fill; }); };

  if (bills.length === 1) {
    const b = bills[0]; const its = items.get(b.id) ?? []; const ws = wb.addWorksheet('Bill');
    ws.columns = [6, 8, 52, 10, 10, 8, 10, 7, 12, 14].map(width => ({ width }));
    ws.addRow([SHOP]).font = { bold: true, size: 14 };
    ws.addRow([`Bill ${b.bill_number}`]).font = { bold: true, size: 12 };
    ws.addRow(['Date', b.bill_date]); ws.addRow(['Customer', b.customer_name ?? '']); ws.addRow(['Status', STATUS[b.status] ?? b.status]);
    if (b.void_reason) ws.addRow(['Void reason', b.void_reason]);
    ws.addRow([]);
    head(ws.addRow(['Line', 'Eye', 'Lens', 'SPH', 'CYL', 'AXIS', 'ADD', 'Qty', 'Rate', 'Amount']));
    for (const i of its) {
      const r = ws.addRow([i.line_no, eyeOf(i), lensText(i), num(i.sph), num(i.cyl), num(i.axis), num(i.add_power), Number(i.quantity), Number(i.rate), amountOf(i)]);
      for (const k of [4, 5, 7]) r.getCell(k).numFmt = '0.00'; r.getCell(9).numFmt = N2; r.getCell(10).numFmt = N2;
    }
    ws.addRow([]);
    const tot = (label: string, v: unknown, bold = false) => { const r = ws.addRow(['', '', '', '', '', '', '', '', label, Number(v ?? 0)]); r.getCell(10).numFmt = N2; if (bold) r.font = { bold: true }; };
    tot('Total', b.total_amount, true); tot('Old balance', b.old_balance); tot('Return', b.return_amount); tot('Advance', b.advance_amount); tot('Balance amount', b.balance_amount, true);
    if (b.notes) { ws.addRow([]); ws.addRow(['Notes', b.notes]); }
  } else {
    const ws = wb.addWorksheet('Bills');
    ws.columns = [14, 12, 28, 11, 10, 10, 14, 14, 12, 12, 14, 40].map(width => ({ width }));
    head(ws.addRow(['Bill', 'Date', 'Customer', 'Status', 'Inventory lines', 'External lines', 'Total', 'Old balance', 'Return', 'Advance', 'Balance', 'Notes']));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    let t = 0, bal = 0;
    for (const b of bills) {
      const its = items.get(b.id) ?? [];
      const r = ws.addRow([b.bill_number, b.bill_date, b.customer_name ?? '', STATUS[b.status] ?? b.status, its.filter(i => i.source === 'inventory').length, its.filter(i => i.source === 'external').length,
        num(b.total_amount), num(b.old_balance), num(b.return_amount), num(b.advance_amount), num(b.balance_amount), b.notes ?? '']);
      for (let k = 7; k <= 11; k++) r.getCell(k).numFmt = N2;
      if (b.status !== 'void') { t += Number(b.total_amount ?? 0); bal += Number(b.balance_amount ?? 0); }
    }
    const tr = ws.addRow(['Total (excl. void)', '', '', '', '', '', round2(t), '', '', '', round2(bal), '']); tr.font = { bold: true }; tr.getCell(7).numFmt = N2; tr.getCell(11).numFmt = N2;
    ws.autoFilter = { from: 'A1', to: 'L1' };

    const wl = wb.addWorksheet('Lines');
    wl.columns = [14, 12, 28, 7, 8, 11, 50, 10, 10, 8, 10, 7, 12, 14].map(width => ({ width }));
    head(wl.addRow(['Bill', 'Date', 'Customer', 'Line', 'Eye', 'Source', 'Lens', 'SPH', 'CYL', 'AXIS', 'ADD', 'Qty', 'Rate', 'Amount']));
    wl.views = [{ state: 'frozen', ySplit: 1 }];
    for (const b of bills) for (const i of items.get(b.id) ?? []) {
      const r = wl.addRow([b.bill_number, b.bill_date, b.customer_name ?? '', i.line_no, eyeOf(i), i.source === 'inventory' ? 'Inventory' : 'External', lensText(i),
        num(i.sph), num(i.cyl), num(i.axis), num(i.add_power), Number(i.quantity), Number(i.rate), amountOf(i)]);
      for (const k of [8, 9, 11]) r.getCell(k).numFmt = '0.00'; r.getCell(13).numFmt = N2; r.getCell(14).numFmt = N2;
    }
    wl.autoFilter = { from: 'A1', to: 'N1' };
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

// ───────────────────────── PDF ─────────────────────────
// The built-in PDF font (Helvetica) only covers Latin text; anything else (e.g. Telugu) prints as "?". Use the Excel file for such names.
const safe = (s: unknown) => String(s ?? '').replace(/\u2212/g, '-').replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u203A]/g, '?');
// Column layout (sums to the 515pt printable width): No. | Qty. | Lens Type | RIGHT: SPH CYL AXIS | LEFT: SPH CYL AXIS | ADD | Rate | Amount
const W = [22, 26, 127, 36, 36, 32, 36, 36, 32, 34, 48, 50];
const X = W.map((_, k) => 40 + W.slice(0, k).reduce((a, c) => a + c, 0));
const BLUE = '#1f5fa8';

// Shop logo (web/public/Logo.png, 1641x681; it already contains the shop name). Passed to pdfkit as a path so it is embedded once per PDF.
// If the file is missing the header falls back to the shop name in text.
const LOGO_H = 50, LOGO_W = Math.round((LOGO_H * 1641) / 681);
let logoPath: string | null | undefined;
function shopLogo(): string | null {
  if (logoPath !== undefined) return logoPath;
  const p = join(process.cwd(), 'public', 'Logo.png');
  logoPath = existsSync(p) ? p : null;
  return logoPath;
}

// Short, customer-friendly lens name: the product level of the catalog path (family / PRODUCT / folders… / workbook.xlsx / sheet / block), never a file name.
const FILE_EXT = /\.(xlsx|xlsm|xls|csv|pdf)\b/gi;
const tidyName = (v: unknown) => String(v ?? '').split('›')[0].replace(FILE_EXT, '').replace(/\s+/g, ' ').trim();
function pdfLensName(i: Row): string {
  if (i.source === 'inventory') {
    const parts = String(i._path ?? '').split(' / ').map(x => x.trim()).filter(Boolean);
    return tidyName(parts.length > 1 ? parts[1] : parts[0]) || 'Inventory lens';
  }
  return tidyName(i.lens_type) || 'External order';
}
// Right and left eye of one billing line share one PDF row.
type PdfLine = { no: number; R?: Row; L?: Row };
function pdfLines(its: Row[]): PdfLine[] {
  const m = new Map<number, PdfLine>();
  for (const i of its) { const l: PdfLine = m.get(i.line_no) ?? { no: i.line_no }; if (i.side === 'L') l.L = i; else l.R = i; m.set(i.line_no, l); }
  return Array.from(m.values()).sort((a, c) => a.no - c.no);
}

export async function billsPdf({ bills, items }: Loaded): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false, info: { Title: bills.length === 1 ? `Bill ${bills[0].bill_number}` : `Bills (${bills.length})` } });
  const chunks: Buffer[] = []; doc.on('data', (b: Buffer) => chunks.push(b)); const done = new Promise<void>(res => doc.on('end', () => res()));
  const logo = shopLogo();

  const HH = 15;   // height of each of the two header rows
  const tableHead = () => {
    const y = doc.y; doc.rect(40, y, 515, HH * 2).fill('#eef0f7'); doc.lineWidth(0.6).strokeColor(BLUE);
    const lab = (t: string, x: number, yy: number, w: number, h: number) => {
      doc.rect(x, yy, w, h).stroke(); doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8).text(t, x, yy + (h - 8) / 2 + 1, { width: w, align: 'center', lineBreak: false });
    };
    ([[0, 'No.'], [1, 'Qty.'], [2, 'Lens Type'], [9, 'ADD'], [10, 'Rate'], [11, 'Amount']] as [number, string][]).forEach(([k, t]) => lab(t, X[k], y, W[k], HH * 2));
    lab('RIGHT EYE', X[3], y, W[3] + W[4] + W[5], HH); lab('LEFT EYE', X[6], y, W[6] + W[7] + W[8], HH);
    ['SPH', 'CYL', 'AXIS', 'SPH', 'CYL', 'AXIS'].forEach((t, n) => lab(t, X[3 + n], y + HH, W[3 + n], HH));
    doc.fillColor('#000').font('Helvetica'); doc.x = 40; doc.y = y + HH * 2;
  };

  for (const b of bills) {
    const its = items.get(b.id) ?? [];
    doc.addPage();
    if (logo) doc.image(logo, 40, 30, { fit: [LOGO_W, LOGO_H] });
    else doc.fillColor('#000').font('Helvetica-Bold').fontSize(17).text(SHOP, 40, 40, { lineBreak: false });
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(`Bill ${safe(b.bill_number)}`, 300, 40, { width: 255, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${STATUS[b.status] ?? b.status}   ·   ${b.bill_date ?? ''}`, 300, 60, { width: 255, align: 'right', lineBreak: false });
    doc.fillColor('#000').fontSize(11).text(`Customer: ${safe(b.customer_name) || '—'}`, 40, 88, { width: 515 });
    if (b.status === 'void') doc.fillColor('#b42318').fontSize(9).text(`VOID${b.void_reason ? ': ' + safe(b.void_reason) : ''}`, 40, doc.y + 2, { width: 515 }).fillColor('#000');
    doc.moveTo(40, doc.y + 8).lineTo(555, doc.y + 8).strokeColor('#999').lineWidth(0.7).stroke(); doc.x = 40; doc.y += 18;
    tableHead();

    for (const l of pdfLines(its)) {
      const eyes = [l.R, l.L].filter((e): e is Row => !!e);
      const both = !!(l.R && l.L);
      const stack = (pick: (r: Row) => string): string[] => (l.R && l.L && pick(l.R) !== pick(l.L) ? [`R ${pick(l.R)}`, `L ${pick(l.L)}`] : [pick(eyes[0])]);
      const names: string[] = l.R && l.L && pdfLensName(l.R) !== pdfLensName(l.L) ? [`R: ${pdfLensName(l.R)}`, `L: ${pdfLensName(l.L)}`] : [pdfLensName(eyes[0])];
      const rates = stack(r => money(r.rate));
      const addVals = eyes.map(r => pw(r.add_power));
      const adds: string[] = both && addVals[0] && addVals[1] && addVals[0] !== addVals[1] ? [`R ${addVals[0]}`, `L ${addVals[1]}`] : addVals.filter(Boolean).slice(0, 1);
      const qty = eyes.reduce((t, r) => t + Number(r.quantity), 0);
      const amount = round2(eyes.reduce((t, r) => t + amountOf(r), 0));

      doc.font('Helvetica').fontSize(9);
      const lensTxt = names.map(safe).join('\n');
      const h = Math.max(20, doc.heightOfString(lensTxt, { width: W[2] - 6 }) + 8, Math.max(rates.length, adds.length) * 10 + 8);
      if (doc.y + h > 760) { doc.addPage(); tableHead(); }
      const y = doc.y; doc.lineWidth(0.6).strokeColor(BLUE); W.forEach((w, k) => doc.rect(X[k], y, w, h).stroke());
      const put = (k: number, v: string, align: 'left' | 'center' | 'right' = 'center', size = 8.5, wrap = false) => {
        if (v === '') return;
        doc.fillColor('#000').font('Helvetica').fontSize(size);
        const th = doc.heightOfString(v, { width: W[k] - 4 });
        doc.text(v, X[k] + 2, y + Math.max(0, (h - th) / 2), { width: W[k] - 4, align, lineBreak: wrap });
      };
      const sz = (a: string[]) => (a.length > 1 ? 7.5 : 8.5);
      put(0, String(l.no)); put(1, String(qty), 'center', 9);
      doc.fillColor('#000').font('Helvetica').fontSize(9); doc.text(lensTxt, X[2] + 3, y + Math.max(0, (h - doc.heightOfString(lensTxt, { width: W[2] - 6 })) / 2), { width: W[2] - 6 });
      put(3, pw(l.R?.sph)); put(4, pw(l.R?.cyl)); put(5, String(l.R?.axis ?? ''));
      put(6, pw(l.L?.sph)); put(7, pw(l.L?.cyl)); put(8, String(l.L?.axis ?? ''));
      put(9, adds.join('\n'), 'center', sz(adds), true); put(10, rates.join('\n'), 'right', sz(rates), true); put(11, money(amount), 'right', 9);
      doc.x = 40; doc.y = y + h;
    }
    if (!its.length) doc.fillColor('#666').fontSize(9).text('No lens lines on this bill.', 40, doc.y + 4).fillColor('#000');

    if (doc.y > 650) doc.addPage();
    doc.x = 40; doc.y += 10;
    const kv = (label: string, v: unknown, bold = false) => {
      const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#000');
      doc.text(label, 340, y, { width: 130, align: 'right', lineBreak: false }); doc.text(money((v ?? 0) as number), 475, y, { width: 80, align: 'right', lineBreak: false });
      doc.x = 40; doc.y = y + (bold ? 17 : 14);
    };
    kv('Total', b.total_amount, true); kv('Old balance (O.B.)', b.old_balance); kv('Return', b.return_amount); kv('Advance', b.advance_amount);
    doc.moveTo(340, doc.y).lineTo(555, doc.y).strokeColor('#999').lineWidth(0.7).stroke(); doc.y += 5; kv('Balance amount', b.balance_amount, true);
    if (b.notes) doc.font('Helvetica').fontSize(9).fillColor('#444').text(`Notes: ${safe(b.notes)}`, 40, doc.y + 10, { width: 300 }).fillColor('#000');
  }
  doc.end(); await done; return Buffer.concat(chunks);
}