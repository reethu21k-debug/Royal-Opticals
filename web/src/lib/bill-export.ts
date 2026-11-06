import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fmtPower } from './power-format';
import { lineAmount, money, round2, summarizeBills } from './billing';
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
const W = [22, 26, 151, 33, 33, 29, 33, 33, 29, 32, 46, 48];
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

// Bill header details (printed under the centred logo on every bill PDF).
const SHOP_ADDRESS = ['Police Complex, Shop No. 09, Near Syndicate Bank, Arts College Road,', 'Clock Tower, Anantapur \u2013 515001, Andhra Pradesh'];
const SHOP_EMAIL = 'contact@royalopticalsatp.com';
const BILL_LOGO_H = 62, BILL_LOGO_W = Math.round((BILL_LOGO_H * 1641) / 681);
// Neutral palette for the bill (print-friendly, no accent colours).
const INK = '#1f2937', MUTED = '#6b7280', GRID = '#8b93a1', HEADFILL = '#f1f3f6', SOFTLINE = '#d1d5db';

// Lens name for the bill = main lens name + the deepest (leaf) folder name, separated by one space. Parent / intermediate folders are left out.
// Inventory path from node_path(): family / MAIN LENS / folder / ... / leaf. (Fallback when the path is missing: saved lens_type "main \u203A leaf".)
// File extensions are removed; if the leaf is the same text as the main name it is shown once; with no deeper folder only the main name is shown.
// The power values are NOT part of the name - they print in the SPH / CYL / AXIS / ADD columns.
const FILE_EXT = /\.(xlsx|xlsm|xls|csv|pdf)\b/gi;
const tidyPart = (v: unknown) => String(v ?? '').replace(FILE_EXT, '').replace(/\s+/g, ' ').trim();
function pdfLensName(i: Row): string {
  if (i.source !== 'inventory') return tidyPart(String(i.lens_type ?? '').split('\u203A')[0]) || 'External order';
  const hasPath = !!i._path;
  const parts = (hasPath ? String(i._path).split(' / ') : String(i.lens_type ?? '').split('\u203A')).map(tidyPart).filter(Boolean);
  const mainIdx = hasPath && parts.length > 1 ? 1 : 0;   // the level after the family is the main lens
  const main = parts[mainIdx];
  if (!main) return 'Inventory lens';
  const leaf = parts.length - 1 > mainIdx ? parts[parts.length - 1] : '';
  return leaf && leaf.toLowerCase() !== main.toLowerCase() ? `${main} ${leaf}` : main;
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
    const y = doc.y; doc.rect(40, y, 515, HH * 2).fill(HEADFILL); doc.lineWidth(0.6).strokeColor(GRID);
    const lab = (t: string, x: number, yy: number, w: number, h: number) => {
      doc.rect(x, yy, w, h).stroke(); doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(t, x, yy + (h - 8) / 2 + 1, { width: w, align: 'center', lineBreak: false });
    };
    ([[0, 'No.'], [1, 'Qty.'], [2, 'Lens Type'], [9, 'ADD'], [10, 'Rate'], [11, 'Amount']] as [number, string][]).forEach(([k, t]) => lab(t, X[k], y, W[k], HH * 2));
    lab('RIGHT EYE', X[3], y, W[3] + W[4] + W[5], HH); lab('LEFT EYE', X[6], y, W[6] + W[7] + W[8], HH);
    ['SPH', 'CYL', 'AXIS', 'SPH', 'CYL', 'AXIS'].forEach((t, n) => lab(t, X[3 + n], y + HH, W[3 + n], HH));
    doc.fillColor('#000').font('Helvetica'); doc.x = 40; doc.y = y + HH * 2;
  };

  for (const b of bills) {
    const its = items.get(b.id) ?? [];
    doc.addPage();
    // Centred logo, then business address and email, then a hairline rule.
    let hy = 34;
    if (logo) { doc.image(logo, (595 - BILL_LOGO_W) / 2, hy, { fit: [BILL_LOGO_W, BILL_LOGO_H] }); hy += BILL_LOGO_H + 10; }
    else { doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(SHOP, 40, hy, { width: 515, align: 'center', lineBreak: false }); hy += 30; }
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    for (const ln of SHOP_ADDRESS) { doc.text(ln, 40, hy, { width: 515, align: 'center', lineBreak: false }); hy += 12; }
    doc.fillColor(INK).text(SHOP_EMAIL, 40, hy + 1, { width: 515, align: 'center', lineBreak: false }); hy += 15;
    doc.moveTo(40, hy + 8).lineTo(555, hy + 8).strokeColor(SOFTLINE).lineWidth(0.8).stroke(); hy += 22;
    // Bill details: customer on the left, bill number / date / status on the right.
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(`Bill ${safe(b.bill_number)}`, 300, hy, { width: 255, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${STATUS[b.status] ?? b.status}   \u00B7   ${b.bill_date ?? ''}`, 300, hy + 19, { width: 255, align: 'right', lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('BILLED TO', 40, hy, { width: 250, lineBreak: false, characterSpacing: 0.8 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(safe(b.customer_name) || '\u2014', 40, hy + 12, { width: 250 });
    let my = Math.max(doc.y, hy + 34);
    if (b.status === 'void') { doc.fillColor('#b42318').font('Helvetica').fontSize(9).text(`VOID${b.void_reason ? ': ' + safe(b.void_reason) : ''}`, 40, my + 2, { width: 515 }); my = doc.y; }
    doc.fillColor('#000'); doc.x = 40; doc.y = my + 14;
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

      doc.font('Helvetica').fontSize(8.5);
      const lensTxt = names.map(safe).join('\n');
      const h = Math.max(20, doc.heightOfString(lensTxt, { width: W[2] - 6 }) + 8, Math.max(rates.length, adds.length) * 10 + 8);
      if (doc.y + h > 760) { doc.addPage(); tableHead(); }
      const y = doc.y; doc.lineWidth(0.6).strokeColor(GRID); W.forEach((w, k) => doc.rect(X[k], y, w, h).stroke());
      const put = (k: number, v: string, align: 'left' | 'center' | 'right' = 'center', size = 8.5, wrap = false) => {
        if (v === '') return;
        doc.fillColor('#000').font('Helvetica').fontSize(size);
        const th = doc.heightOfString(v, { width: W[k] - 4 });
        doc.text(v, X[k] + 2, y + Math.max(0, (h - th) / 2), { width: W[k] - 4, align, lineBreak: wrap });
      };
      const sz = (a: string[]) => (a.length > 1 ? 7.5 : 8.5);
      put(0, String(l.no)); put(1, String(qty), 'center', 9);
      doc.fillColor('#000').font('Helvetica').fontSize(8.5); doc.text(lensTxt, X[2] + 3, y + Math.max(0, (h - doc.heightOfString(lensTxt, { width: W[2] - 6 })) / 2), { width: W[2] - 6 });
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
    doc.moveTo(340, doc.y).lineTo(555, doc.y).strokeColor(SOFTLINE).lineWidth(0.8).stroke(); doc.y += 8;
    doc.rect(340, doc.y - 5, 215, 24).fill(HEADFILL); kv('Balance amount', b.balance_amount, true);
    if (b.notes) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Notes: ${safe(b.notes)}`, 40, doc.y + 10, { width: 300 }).fillColor('#000');
  }
  doc.end(); await done; return Buffer.concat(chunks);
}

// ───────────────────────── Customer billing history (statement) ─────────────────────────
export function statementName(customer: string) { return `Customer-${customer.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'history'}-bills`; }

export async function statementXlsx(customer: string, { bills, items }: Loaded): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = SHOP; wb.created = new Date();
  const N2 = '#,##0.00'; const fill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE9ECF5' } };
  const head = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell(c => { c.fill = fill; }); };
  const sm = summarizeBills(bills);

  const ws = wb.addWorksheet('Summary'); ws.columns = [30, 22].map(width => ({ width }));
  ws.addRow([SHOP]).font = { bold: true, size: 14 }; ws.addRow([`Billing history: ${customer}`]).font = { bold: true, size: 12 };
  ws.addRow(['Generated', new Date().toISOString().slice(0, 10)]); ws.addRow([]);
  for (const [k, v, fmt] of [['Total bills', sm.total], ['Finalized', sm.finalized], ['Drafts', sm.draft], ['Void', sm.void], ['Total billed (excl. void)', sm.billed, N2], ['Balance on latest bill', sm.latestBalance, N2]] as [string, number, string?][]) {
    const r = ws.addRow([k, v]); if (fmt) r.getCell(2).numFmt = fmt; if (k === 'Total bills') r.font = { bold: true };
  }

  const wsb = wb.addWorksheet('Bills'); wsb.columns = [14, 12, 11, 15, 15, 14, 14, 12, 12, 14, 40].map(width => ({ width }));
  head(wsb.addRow(['Bill', 'Date', 'Status', 'Inventory lines', 'External lines', 'Total', 'Old balance', 'Return', 'Advance', 'Balance', 'Notes'])); wsb.views = [{ state: 'frozen', ySplit: 1 }];
  for (const b of bills) {
    const its = items.get(b.id) ?? [];
    const r = wsb.addRow([b.bill_number, b.bill_date, STATUS[b.status] ?? b.status, its.filter(i => i.source === 'inventory').length, its.filter(i => i.source === 'external').length,
      num(b.total_amount), num(b.old_balance), num(b.return_amount), num(b.advance_amount), num(b.balance_amount), b.notes ?? '']);
    for (let k = 6; k <= 10; k++) r.getCell(k).numFmt = N2;
  }
  const tr = wsb.addRow([`${bills.length} bill${bills.length === 1 ? '' : 's'}`, '', '', '', '', sm.billed, '', '', '', sm.latestBalance, '']); tr.font = { bold: true }; tr.getCell(6).numFmt = N2; tr.getCell(10).numFmt = N2;
  wsb.addRow(['Total excludes void bills. Balance is the latest non-void bill (it already includes the old balance).']).font = { italic: true, color: { argb: 'FF666666' } };
  wsb.autoFilter = { from: 'A1', to: 'K1' };

  const wl = wb.addWorksheet('Lines'); wl.columns = [14, 12, 11, 7, 8, 11, 50, 10, 10, 8, 10, 7, 12, 14].map(width => ({ width }));
  head(wl.addRow(['Bill', 'Date', 'Status', 'Line', 'Eye', 'Source', 'Lens', 'SPH', 'CYL', 'AXIS', 'ADD', 'Qty', 'Rate', 'Amount'])); wl.views = [{ state: 'frozen', ySplit: 1 }];
  for (const b of bills) for (const i of items.get(b.id) ?? []) {
    const r = wl.addRow([b.bill_number, b.bill_date, STATUS[b.status] ?? b.status, i.line_no, eyeOf(i), i.source === 'inventory' ? 'Inventory' : 'External', lensText(i), num(i.sph), num(i.cyl), num(i.axis), num(i.add_power), Number(i.quantity), Number(i.rate), amountOf(i)]);
    for (const k of [8, 9, 11]) r.getCell(k).numFmt = '0.00'; r.getCell(13).numFmt = N2; r.getCell(14).numFmt = N2;
  }
  wl.autoFilter = { from: 'A1', to: 'N1' };
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

export async function statementPdf(customer: string, { bills, items }: Loaded): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: false, info: { Title: `Billing history - ${safe(customer)}` } });
  const chunks: Buffer[] = []; doc.on('data', (b: Buffer) => chunks.push(b)); const done = new Promise<void>(res => doc.on('end', () => res()));
  const logo = shopLogo(); const sm = summarizeBills(bills);
  const C = [100, 72, 72, 50, 110, 111]; const CX = C.map((_, k) => 40 + C.slice(0, k).reduce((a, c) => a + c, 0)); const RH = 20;   // Bill | Date | Status | Lines | Total | Balance (515pt)
  const cell = (k: number, t: string, y: number, align: 'left' | 'right' | 'center' = 'left') => doc.text(t, CX[k] + 4, y + 6, { width: C[k] - 8, align, lineBreak: false });
  const header = () => {
    const y = doc.y; doc.rect(40, y, 515, RH).fill('#eef0f7'); doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(8.5);
    ['Bill', 'Date', 'Status', 'Lines', 'Total', 'Balance'].forEach((t, k) => cell(k, t, y, k >= 4 ? 'right' : k === 3 ? 'center' : 'left'));
    doc.fillColor('#000').font('Helvetica'); doc.x = 40; doc.y = y + RH;
  };

  doc.addPage();
  if (logo) doc.image(logo, 40, 30, { fit: [LOGO_W, LOGO_H] }); else doc.fillColor('#000').font('Helvetica-Bold').fontSize(17).text(SHOP, 40, 40, { lineBreak: false });
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text('Billing history', 300, 40, { width: 255, align: 'right', lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString().slice(0, 10)}`, 300, 60, { width: 255, align: 'right', lineBreak: false });
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text(`Customer: ${safe(customer)}`, 40, 92, { width: 515 });
  doc.font('Helvetica').fontSize(10).text(`Total bills: ${sm.total}   (${sm.finalized} finalized, ${sm.draft} draft, ${sm.void} void)`, 40, doc.y + 4, { width: 515 });
  doc.text(`Total billed (excl. void): ${money(sm.billed)}      Balance on latest bill: ${money(sm.latestBalance)}`, 40, doc.y + 2, { width: 515 });
  doc.x = 40; doc.y += 12; header();

  for (const b of bills) {
    if (doc.y + RH > 770) { doc.addPage(); header(); }
    const y = doc.y; const void_ = b.status === 'void'; doc.lineWidth(0.5).strokeColor('#c9cfe0').moveTo(40, y + RH).lineTo(555, y + RH).stroke();
    doc.fillColor(void_ ? '#999' : '#000').font('Helvetica').fontSize(9);
    cell(0, safe(b.bill_number), y); cell(1, String(b.bill_date ?? ''), y); cell(2, STATUS[b.status] ?? b.status, y); cell(3, String((items.get(b.id) ?? []).length ? new Set((items.get(b.id) ?? []).map(i => i.line_no)).size : 0), y, 'center');
    cell(4, money(b.total_amount), y, 'right'); cell(5, money(b.balance_amount), y, 'right'); doc.x = 40; doc.y = y + RH;
  }
  if (doc.y + 50 > 770) doc.addPage();
  doc.x = 40; doc.y += 8; doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text(`${bills.length} bill${bills.length === 1 ? '' : 's'}`, 40, doc.y, { continued: false });
  doc.font('Helvetica').fontSize(8).fillColor('#666').text('Void bills are listed but not counted in the total billed. Balance is the latest non-void bill (it already includes the old balance).', 40, doc.y + 2, { width: 515 }).fillColor('#000');
  doc.end(); await done; return Buffer.concat(chunks);
}