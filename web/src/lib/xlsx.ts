import ExcelJS from 'exceljs';
import { ApiError } from './http';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export async function sheetResponse(name: string, headers: string[], rows: unknown[][], info: string[][] = []) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = headers.map(h => ({ header: h, width: Math.max(14, Math.min(60, h.length + 6)) }));
  for (const r of rows) ws.addRow(r);       // string values are written as plain strings, never formulas
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (info.length) wb.addWorksheet('Info').addRows(info);
  return new Response((await wb.xlsx.writeBuffer()) as ArrayBuffer, { headers: { 'content-type': XLSX_MIME, 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '_')}.xlsx"` } });
}
/** Reads an uploaded .xlsx (first sheet) into header-keyed rows. Validates size and file signature. */
export async function readUpload(form: FormData, maxBytes = 5 * 1024 * 1024) {
  const f = form.get('file');
  if (!(f instanceof File)) throw new ApiError(400, 'file is required');
  if (f.size === 0 || f.size > maxBytes) throw new ApiError(400, `file must be between 1 byte and ${maxBytes / 1048576} MB`);
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ApiError(400, 'not an .xlsx file');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new ApiError(400, 'unreadable .xlsx file'); }
  const ws = wb.worksheets[0]; if (!ws) throw new ApiError(400, 'workbook has no sheets');
  const header: string[] = []; ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { header[i] = String(c.value ?? '').trim(); });
  const rows: { rowNumber: number; v: Record<string, unknown> }[] = [];
  ws.eachRow((row, n) => { if (n === 1) return; const v: Record<string, unknown> = {};
    header.forEach((h, i) => { if (!h) return; const c = row.getCell(i).value; v[h] = c && typeof c === 'object' && 'result' in (c as object) ? (c as any).result : c; });
    if (Object.values(v).some(x => x !== null && x !== undefined && x !== '')) rows.push({ rowNumber: n, v }); });
  if (rows.length > 50000) throw new ApiError(400, 'too many rows (max 50,000)');
  return { header, rows };
}
/** Strict non-negative integer from a cell: blank => null (NOT zero); anything else invalid => throws message. */
export function parseQty(x: unknown): number | null {
  if (x === null || x === undefined || (typeof x === 'string' && x.trim() === '')) return null;
  const n = typeof x === 'number' ? x : Number(String(x).trim());
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new Error(`'${String(x)}' is not a whole number between 0 and 1,000,000`);
  return n;
}
