// Parity: the TypeScript extractor must reproduce the Python reference (docs/registers/variant_records.csv) record-for-record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractWorkbook } from '../../src/lib/xlsx-extract.ts';

const ROOT = process.env.SRC_ROOT ?? '/home/claude/src/Excel';
const CSV = path.resolve(process.cwd(), '../docs/registers/variant_records.csv');
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (ch !== '\r') f += ch; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows;
}
const NUM = /^\s*[+-]?\d+(\.\d+)?\s*$/;
const same = (a: string | null, b: string | null) => (a ?? '') === (b ?? '') || (NUM.test(a ?? 'x') && NUM.test(b ?? 'x') && Number(a) === Number(b));
function walk(d: string, out: string[] = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.xlsx')) out.push(p); } return out; }

test('TypeScript extractor reproduces the Python reference for every inventory workbook', async () => {
  const [hdr, ...rows] = parseCsv(fs.readFileSync(CSV, 'utf8')).filter(r => r.length > 1);
  const ix = Object.fromEntries(hdr.map((h, i) => [h, i])); const ref = new Map<string, Map<string, string[]>>();
  for (const r of rows) { const m = ref.get(r[ix.rel_path]) ?? new Map(); ref.set(r[ix.rel_path], m); m.set(`${r[ix.block_index]}|${r[ix.target_cell]}|${r[ix.stock_cell]}|${r[ix.order_cell]}|${r[ix.row_occurrence]}|${r[ix.row_label_raw]}|${r[ix.col_label_raw]}`, r); }
  let files = 0, records = 0; const problems: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/'); const ex = await extractWorkbook(fs.readFileSync(file));
    const exp = ref.get(rel);
    if (!ex.isTriad) { if (exp) problems.push(`${rel}: python has records but TS says not a triad`); continue; }
    files++; if (!exp) { problems.push(`${rel}: no python records`); continue; }
    if (ex.records.length !== exp.size) problems.push(`${rel}: record count TS=${ex.records.length} py=${exp.size}`);
    const seen = new Set<string>();
    for (const r of ex.records) {
      records++; const key = `${r.blockIndex}|${r.targetCell ?? ''}|${r.stockCell ?? ''}|${r.orderCell ?? ''}|${r.rowOccurrence}|${r.rowLabelRaw ?? ''}|${r.colLabelRaw ?? ''}`;
      let p = exp.get(key); let usedKey = key;
      if (!p) { // labels may differ only in number formatting (1 vs 1.0): match on structural part
        for (const [k, v] of exp) if (!seen.has(k) && k.startsWith(`${r.blockIndex}|${r.targetCell ?? ''}|${r.stockCell ?? ''}|${r.orderCell ?? ''}|${r.rowOccurrence}|`)) { p = v; usedKey = k; break; } }
      if (!p) { problems.push(`${rel}: TS record without python match ${key}`); continue; } seen.add(usedKey);
      const checks: [string, string | null, string][] = [['label', r.rowLabelRaw, p[ix.row_label_raw]], ['collabel', r.colLabelRaw, p[ix.col_label_raw]], ['target', r.targetRaw, p[ix.target_raw]], ['stock', r.stockRaw, p[ix.stock_raw]],
        ['orderF', r.orderFormula, p[ix.order_formula]], ['orderCached', r.orderCached, p[ix.order_cached]]];
      for (const [n, a, b] of checks) if (!same(a, b)) problems.push(`${rel} ${key}: ${n} TS=${JSON.stringify(a)} py=${JSON.stringify(b)}`);
      const fa = [...r.flags].sort().join(','), fb = (p[ix.flags] || '').split(',').filter(Boolean).sort().join(',');
      if (fa !== fb) problems.push(`${rel} ${key}: flags TS=${fa} py=${fb}`);
    }
  }
  console.log(`parity: ${files} inventory workbooks, ${records} records compared, ${problems.length} differences`); if (problems.length) console.log(problems.slice(0, 25).join('\n'));
  assert.equal(files, 58); assert.equal(records, 7931); assert.equal(problems.length, 0);
});

test('TypeScript findings equal the Python anomaly register, per workbook and per code', async () => {
  const [hdr, ...rows] = parseCsv(fs.readFileSync(path.resolve(process.cwd(), '../docs/registers/anomalies.csv'), 'utf8')).filter(r => r.length > 1);
  const ix = Object.fromEntries(hdr.map((h, i) => [h, i])); const CODES = new Set(['VALUE_WITHOUT_TARGET_POSITION', 'SHEET_TITLE_MISMATCH', 'DUPLICATE_ROW_LABEL_IN_BLOCK', 'FORMULA_ERROR_VALUE',
    'AXIS_ANGLE_CONFLICT', 'STOCK_SHEET_IDENTICAL_TO_TARGET', 'NO_STOCK_QUANTITIES_RECORDED', 'STOCK_MOSTLY_BLANK', 'EXTERNAL_WORKBOOK_LINK', 'TRIAD_BLOCK_COUNT_MISMATCH']);
  const py = new Map<string, number>(); for (const r of rows) if (CODES.has(r[ix.code])) py.set(`${r[ix.file_rel]}|${r[ix.code]}`, (py.get(`${r[ix.file_rel]}|${r[ix.code]}`) ?? 0) + 1);
  const ts = new Map<string, number>(); const triadFiles = new Set<string>(); let total = 0;
  for (const file of walk(ROOT)) { const rel = path.relative(ROOT, file).split(path.sep).join('/'); const ex = await extractWorkbook(fs.readFileSync(file), path.basename(file));
    if (!ex.isTriad) continue; triadFiles.add(rel); for (const f of ex.findings) { ts.set(`${rel}|${f.code}`, (ts.get(`${rel}|${f.code}`) ?? 0) + 1); total++; } }
  const problems: string[] = [];
  for (const [k, n] of py) { const rel = k.split('|')[0]; if (!triadFiles.has(rel)) continue; if ((ts.get(k) ?? 0) !== n) problems.push(`${k}: python=${n} ts=${ts.get(k) ?? 0}`); }
  for (const [k, n] of ts) if (!py.has(k)) problems.push(`${k}: ts=${n} python=0`);
  console.log(`findings parity: ${total} TS findings over ${triadFiles.size} inventory workbooks, ${problems.length} differences`); if (problems.length) console.log(problems.slice(0, 20).join('\n'));
  assert.equal(problems.length, 0);
});
