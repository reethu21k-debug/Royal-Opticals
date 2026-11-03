// Faithful TypeScript port of migration/extract.py (parse_blocks + INVENTORY_TRIAD variant builder).
// Parity with the Python reference is enforced by tests/unit/parity.test.ts over all 58 inventory workbooks.
// Self-contained on purpose (only exceljs) so it runs in Next.js routes and under `node --test`.
import ExcelJS from 'exceljs';

const NUM_RE = /^\s*[+-]?\d+(\.\d+)?\s*$/;
const COMP_RE = /^\s*([+-]?\d+(?:\.\d+)?)\s*([+-]\d+(?:\.\d+)?)\s*$/;
const AX = /^\s*(ADD|\(\s*[+-]?\d*\s*\)\s*(CYL|SPH)|CYL\s*\(?[+-]\d+\)?|CYL[+-]\d+|\(\s*[+-]\s*\)\s*(CYL|SPH))\s*$/i;
const TRIAD = ['STOCK LENS', 'ORDER LENS', 'LENS QUANTITY'] as const;

export type Raw = string | number | null;
type Cell = { f: string | null; cached: Raw; raw: Raw };
type Grid = Map<string, Cell>;
const K = (r: number, c: number) => `${r},${c}`;

export function colLetter(n: number): string { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function colIndex(letters: string): number { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
const isNum = (v: Raw | undefined): boolean => v !== null && v !== undefined && (typeof v === 'number' ? Number.isFinite(v) : NUM_RE.test(v));
const toNum = (v: Raw | undefined): number | null => (v === null || v === undefined ? null : typeof v === 'number' ? v : NUM_RE.test(v) ? Number(v.trim()) : null);
const fmt2 = (x: number, plus = false) => { const s = x.toFixed(2); return plus && x >= 0 && !Object.is(x, -0) ? '+' + s : (Object.is(x, -0) ? (plus ? '-0.00' : '-0.00') : s); };
export function normLabel(v: Raw | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return fmt2(v);
  const s = v.trim().replace(/ /g, '');
  const m = COMP_RE.exec(String(v));
  if (m) return `${fmt2(Number(m[1]), true)}|${fmt2(Number(m[2]), true)}`;
  if (NUM_RE.test(s)) return fmt2(Number(s));
  return s;
}
const str = (v: Raw | undefined) => (v === null || v === undefined ? null : String(v));

export interface BlockInfo {
  kind: 'matrix' | 'list'; headerRow: number; headerCell: string; labelCol: number; colAxis: string | null; rowAxis: string | null;
  titleCell: string | null; titleText: string | null; colHeaders: [number, Raw][]; rows: { r: number; lab: Raw; qcol?: number }[]; headerNotes: string[];
}

export function parseBlocks(grid: Grid, maxRow: number, maxCol: number): { layout: string; blocks: BlockInfo[] } {
  const val = (r: number, c: number): Raw => grid.get(K(r, c))?.raw ?? null;
  const consumed = new Set<string>();
  type Head = { kind: 'matrix' | 'list'; r: number; c: number; colHeaders: [number, Raw][] };
  const heads: Head[] = [];
  for (let r = 1; r <= maxRow; r++) for (let c = 1; c <= maxCol; c++) {
    const v = val(r, c);
    if (consumed.has(K(r, c)) || !(typeof v === 'string' && AX.test(v))) continue;
    const nums: [number, Raw][] = [];
    for (let cc = c + 1; cc <= maxCol; cc++) { const x = val(r, cc); if (x === null) continue; if (isNum(x)) nums.push([cc, x]); else break; }
    const below = val(r + 1, c);
    const belowIsAxis = typeof below === 'string' && /(SPH|CYL|COMP)/i.test(below) && !isNum(below);
    if (nums.length >= 3 || (nums.length >= 1 && belowIsAxis)) { heads.push({ kind: 'matrix', r, c, colHeaders: nums }); consumed.add(K(r + 1, c)); }
    else if (/\(\s*[+-]\s*\)\s*(SPH|CYL)/i.test(v)) { const nxt = val(r + 1, c); if (nxt !== null && isNum(nxt)) heads.push({ kind: 'list', r, c, colHeaders: [] }); }
  }
  const span = (h: Head): [number, number] => h.kind === 'matrix' ? [h.c, Math.max(...h.colHeaders.map(x => x[0]))] : [h.c, h.c + 1];
  const blocks: BlockInfo[] = [];
  for (const h of heads) {
    const r0 = h.r, c = h.c; const [a0, a1] = span(h);
    const later = heads.filter(x => x !== h && x.r > r0 && span(x)[0] <= a1 && span(x)[1] >= a0).map(x => x.r);
    const end = later.length ? Math.min(...later) - 1 : maxRow;
    if (h.kind === 'matrix') {
      const rowAxis = val(r0 + 1, c); let titleCell: string | null = null, titleText: string | null = null;
      for (let cc = c + 1; cc <= maxCol; cc++) { const x = val(r0 + 1, cc); if (typeof x === 'string' && x.trim() && !isNum(x)) { titleCell = `${colLetter(cc)}${r0 + 1}`; titleText = x; break; } }
      const dataCols = h.colHeaders.map(x => x[0]);
      const notes: string[] = [];
      for (let cc = c + 1; cc <= maxCol; cc++) { const x = val(r0, cc); if (typeof x === 'string' && x.trim() && !isNum(x) && !heads.some(y => y.r === r0 && y.c === cc)) notes.push(`${colLetter(cc)}${r0}`); }
      const rows: BlockInfo['rows'] = [];
      for (let r = r0 + 2; r <= end; r++) {
        const lab = val(r, c); const hasData = dataCols.some(cc => grid.has(K(r, cc)));
        if (lab === null && !hasData) continue;
        if (typeof lab === 'string' && AX.test(lab)) continue;
        rows.push({ r, lab });
      }
      blocks.push({ kind: 'matrix', headerRow: r0, headerCell: `${colLetter(c)}${r0}`, labelCol: c, colAxis: String(val(r0, c)).trim(), rowAxis: rowAxis !== null ? String(rowAxis).trim() : null, titleCell, titleText, colHeaders: h.colHeaders, rows, headerNotes: notes });
    } else {
      const qcol = c + 1; const rows: BlockInfo['rows'] = [];
      for (let r = r0 + 1; r <= end; r++) {
        const lab = val(r, c); if (lab === null && val(r, qcol) === null) continue;
        if (typeof lab === 'string' && AX.test(lab)) continue;
        rows.push({ r, lab, qcol });
      }
      blocks.push({ kind: 'list', headerRow: r0, headerCell: `${colLetter(c)}${r0}`, labelCol: c, colAxis: null, rowAxis: String(val(r0, c)).trim(), titleCell: null, titleText: null, colHeaders: [], rows, headerNotes: [] });
    }
  }
  blocks.sort((a, b) => a.labelCol - b.labelCol || a.headerRow - b.headerRow);
  let layout = blocks.some(b => b.kind === 'matrix') ? 'MATRIX' : blocks.length ? 'LIST' : 'NONE';
  if (blocks.length > 1 && new Set(blocks.map(b => b.labelCol)).size > 1) layout += '_MULTIPANEL';
  return { layout, blocks };
}

export interface VariantRecord {
  blockIndex: number; layout: 'matrix' | 'list'; colAxis: string | null; rowAxis: string | null; rowLabelRaw: string | null; colLabelRaw: string | null;
  rowKey: string; colKey: string; rowOccurrence: number; targetCell: string | null; targetRaw: string | null; stockCell: string | null; stockRaw: string | null;
  orderCell: string | null; orderFormula: string | null; orderCached: string | null; targetNum: number | null; stockNum: number | null; orderCachedNum: number | null;
  appRule: number | null; appRuleIfBlankIsZero: number | null; sourceRow: number | null; sourceCol: number | null; flags: string[];
}
export interface SheetInfo { name: string; state: string; cells: number; formulas: number; errors: number; layout: string; blocks: number; externalLinks: number }
export interface Extraction {
  sheets: SheetInfo[]; isTriad: boolean; records: VariantRecord[]; blocks: { index: number; name: string; headerCell: string; colAxis: string | null; rowAxis: string | null; kind: string; positions: number }[];
  findings: { severity: 'HIGH' | 'MEDIUM' | 'INFO'; code: string; detail: string }[];
}

function readGrid(ws: ExcelJS.Worksheet): { grid: Grid; maxRow: number; maxCol: number; formulas: number; errors: number; external: number; errorCells: { cell: string; value: string; formula: string | null }[] } {
  const grid: Grid = new Map(); let maxRow = 0, maxCol = 0, formulas = 0, errors = 0, external = 0; const errorCells: { cell: string; value: string; formula: string | null }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
    if (cell.type === ExcelJS.ValueType.Merge) return;                      // merged non-anchor cells are empty (as in the Python reference)
    let f: string | null = null, cached: Raw = null, raw: Raw = null;
    const v: any = cell.value;
    if (v === null || v === undefined) return;
    if (cell.type === ExcelJS.ValueType.Formula) {
      f = '=' + (cell.formula ?? (v.formula ?? '')); const res: any = cell.result;
      cached = res === undefined || res === null ? null : typeof res === 'object' ? (res.error ?? String(res)) : res; raw = cached; formulas++;
      if (f.includes('[')) external++;
    } else if (cell.type === ExcelJS.ValueType.Error) { raw = v.error ?? '#ERROR'; cached = raw; }
    else if (cell.type === ExcelJS.ValueType.RichText) raw = (v.richText as { text: string }[]).map(t => t.text).join('');
    else if (cell.type === ExcelJS.ValueType.Hyperlink) raw = v.text ?? String(v.hyperlink);
    else if (cell.type === ExcelJS.ValueType.Date) raw = (v as Date).toISOString();
    else if (typeof v === 'object') raw = String(v); else raw = v;
    if (typeof raw === 'string' && raw.startsWith('#')) { errors++; errorCells.push({ cell: `${colLetter(c)}${r}`, value: raw, formula: f }); }
    grid.set(K(r, c), { f, cached, raw }); maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c);
  }));
  return { grid, maxRow, maxCol, formulas, errors, external, errorCells };
}

export async function extractWorkbook(data: ArrayBuffer | Buffer, filename?: string): Promise<Extraction> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(data as ArrayBuffer);
  const sheets: SheetInfo[] = []; const by = new Map<string, { grid: Grid; blocks: BlockInfo[]; name: string; errorCells: { cell: string; value: string; formula: string | null }[]; external: number }>();
  for (const ws of wb.worksheets) {
    const g = readGrid(ws); const { layout, blocks } = parseBlocks(g.grid, g.maxRow, g.maxCol);
    sheets.push({ name: ws.name, state: ws.state ?? 'visible', cells: g.grid.size, formulas: g.formulas, errors: g.errors, layout, blocks: blocks.length, externalLinks: g.external });
    by.set(ws.name.trim().toUpperCase(), { grid: g.grid, blocks, name: ws.name, errorCells: g.errorCells, external: g.external });
  }
  const isTriad = TRIAD.every(t => by.has(t));
  const out: Extraction = { sheets, isTriad, records: [], blocks: [], findings: [] };
  if (!isTriad) return out;
  const Q = by.get('LENS QUANTITY')!, S = by.get('STOCK LENS')!, O = by.get('ORDER LENS')!;
  if (!(Q.blocks.length === S.blocks.length && S.blocks.length === O.blocks.length))
    out.findings.push({ severity: 'HIGH', code: 'TRIAD_BLOCK_COUNT_MISMATCH', detail: `LENS QUANTITY=${Q.blocks.length} STOCK LENS=${S.blocks.length} ORDER LENS=${O.blocks.length} blocks` });
  type Pos = { r: number; c: number; cell: Cell | undefined; lab: Raw; hv: Raw };
  type Key = { lk: string; n: number; ck: string | null; id: string };
  const idx = (b: BlockInfo | undefined, grid: Grid): Map<string, { key: Key; p: Pos }> => {
    const d = new Map<string, { key: Key; p: Pos }>(); if (!b) return d; const occ = new Map<string, number>();
    for (const row of b.rows) {
      const lk = normLabel(row.lab) ?? 'null'; const n = occ.get(lk) ?? 0; occ.set(lk, n + 1);
      if (b.kind === 'matrix') for (const [c, hv] of b.colHeaders) { const ck = normLabel(hv); const id = `${lk}\u0001${n}\u0001${ck}`; d.set(id, { key: { lk, n, ck, id }, p: { r: row.r, c, cell: grid.get(K(row.r, c)), lab: row.lab, hv } }); }
      else { const id = `${lk}\u0001${n}\u0001`; d.set(id, { key: { lk, n, ck: null, id }, p: { r: row.r, c: row.qcol!, cell: grid.get(K(row.r, row.qcol!)), lab: row.lab, hv: null } }); }
    }
    return d;
  };
  Q.blocks.forEach((qb, bi) => {
    const sb = S.blocks[bi], ob = O.blocks[bi];
    const qi = idx(qb, Q.grid), si = idx(sb, S.grid), oi = idx(ob, O.grid);
    const keys = [...qi.keys(), ...[...si.keys(), ...oi.keys()].filter(k => !qi.has(k))]; const seen = new Set<string>(); let positions = 0;
    for (const id of keys) {
      if (seen.has(id)) continue; seen.add(id);
      const q = qi.get(id), s = si.get(id), o = oi.get(id); const key = (q ?? s ?? o)!.key; const base = (q ?? s ?? o)!.p;
      const flags: string[] = [];
      const lab = q ? q.p.lab : base.lab, hv = q ? q.p.hv : base.hv; const coord = q ? `${colLetter(q.p.c)}${q.p.r}` : null;
      if (key.n > 0) flags.push('DUPLICATE_ROW_LABEL_IN_BLOCK');
      else if ([...qi.values()].some(x => x.key.lk === key.lk && x.key.ck === key.ck && x.key.n > 0)) flags.push('DUPLICATE_ROW_LABEL_IN_BLOCK');
      if (!q) flags.push('TARGET_POSITION_ABSENT'); if (!s) flags.push('NO_MATCHING_STOCK_CELL'); if (!o) flags.push('NO_MATCHING_ORDER_CELL');
      const t = q?.p.cell, stkT = s?.p.cell, ordT = o?.p.cell;
      const tgtRaw = t ? t.raw : null, stkRaw = stkT ? stkT.raw : null;
      let ordF: string | null = null, ordCached: Raw = null;
      if (ordT) { ordF = ordT.f && ordT.f.startsWith('=') ? ordT.f : null; ordCached = ordF ? ordT.cached : ordT.raw; }
      const tn = toNum(tgtRaw), sn = toNum(stkRaw), on = toNum(ordCached);
      // Python: "nothing recorded in any of the 3 sheets" => skip. `ord_t is not None` there means the raw cell value exists.
      const ordRawExists = ordT ? ordT.raw !== null || ordT.f !== null : false;
      const tExists = t ? t.raw !== null : false;           // (cells are only created when a value exists; a formula with no cache has raw null)
      const sExists = stkT ? stkT.raw !== null : false;
      if (!q?.p.cell && !s?.p.cell && !o?.p.cell) continue;
      if (!t) flags.push('TARGET_BLANK'); else if (tn === null) flags.push('TARGET_NOT_NUMERIC');
      if (!stkT) flags.push('STOCK_BLANK'); else if (sn === null) flags.push('STOCK_NOT_NUMERIC');
      if (tn !== null && tn < 0) flags.push('TARGET_NEGATIVE'); if (sn !== null && sn < 0) flags.push('STOCK_NEGATIVE');
      if (!ordT) flags.push('ORDER_CELL_BLANK'); else if (ordF === null) flags.push('ORDER_NOT_A_FORMULA');
      if (typeof ordCached === 'string' && ordCached.startsWith('#')) flags.push('ORDER_ERROR_VALUE');
      const excel = tn !== null ? tn - (sn ?? 0) : null;
      const app = tn !== null && sn !== null ? Math.max(0, tn - sn) : null; const appB0 = tn !== null ? Math.max(0, tn - (sn ?? 0)) : null;
      if (on !== null && excel !== null && Math.abs(on - excel) > 1e-9) flags.push('ORDER_CACHED_DIFFERS_FROM_TARGET_MINUS_STOCK');
      if (on !== null && on < 0) flags.push('ORDER_NEGATIVE_IN_SOURCE');
      if (tn !== null && sn !== null && tn === sn) flags.push('STOCK_EQUALS_TARGET');
      void ordRawExists; void tExists; void sExists;
      const first = coord ?? (s ? `${colLetter(s.p.c)}${s.p.r}` : o ? `${colLetter(o.p.c)}${o.p.r}` : null);
      const src = q?.p ?? s?.p ?? o?.p;
      out.records.push({ blockIndex: bi, layout: qb.kind, colAxis: qb.colAxis, rowAxis: qb.rowAxis, rowLabelRaw: str(lab), colLabelRaw: str(hv), rowKey: key.lk === 'null' ? '' : key.lk, colKey: key.ck ?? '', rowOccurrence: key.n,
        targetCell: coord, targetRaw: str(tgtRaw), stockCell: s ? `${colLetter(s.p.c)}${s.p.r}` : null, stockRaw: str(stkRaw), orderCell: o ? `${colLetter(o.p.c)}${o.p.r}` : null,
        orderFormula: ordF, orderCached: str(ordCached), targetNum: tn, stockNum: sn, orderCachedNum: on, appRule: app, appRuleIfBlankIsZero: appB0,
        sourceRow: src?.r ?? null, sourceCol: src?.c ?? null, flags });
      void first; positions++;
    }
    for (const [nm, ix] of [['STOCK LENS', si], ['ORDER LENS', oi]] as const) for (const [id, { p }] of ix) if (!qi.has(id) && p.cell)
      out.findings.push({ severity: 'MEDIUM', code: 'VALUE_WITHOUT_TARGET_POSITION', detail: `${nm} ${colLetter(p.c)}${p.r}: position absent from LENS QUANTITY sheet` });
    out.blocks.push({ index: bi, name: `${qb.headerCell} | ${qb.colAxis ?? '(list)'} x ${qb.rowAxis}`, headerCell: qb.headerCell, colAxis: qb.colAxis, rowAxis: qb.rowAxis, kind: qb.kind, positions });
  });
  // ---- workbook-level findings (same rules as derive_findings.py) ----
  const nt = out.records.filter(r => r.targetNum !== null).length, ns = out.records.filter(r => r.stockNum !== null).length;
  const neq = out.records.filter(r => r.stockNum !== null && r.targetNum !== null && r.stockNum === r.targetNum).length;
  const blank = out.records.filter(r => r.stockNum === null && r.targetNum !== null).length;
  if (ns >= 10 && neq === ns && ns >= 0.95 * nt) out.findings.push({ severity: 'HIGH', code: 'STOCK_SHEET_IDENTICAL_TO_TARGET', detail: `all ${ns} numeric STOCK LENS cells equal LENS QUANTITY; likely a copy of the target grid, not a physical count` });
  else if (nt > 0 && ns === 0) out.findings.push({ severity: 'HIGH', code: 'NO_STOCK_QUANTITIES_RECORDED', detail: `${nt} target cells but 0 stock cells` });
  else if (nt > 0 && blank / nt >= 0.5) out.findings.push({ severity: 'MEDIUM', code: 'STOCK_MOSTLY_BLANK', detail: `${blank}/${nt} target positions have a blank stock cell` });
  // Same finding set as migration/extract.py + derive_findings.py (no finding type is dropped in the wizard).
  for (const [, sh] of by) {
    if (sh.external) out.findings.push({ severity: 'HIGH', code: 'EXTERNAL_WORKBOOK_LINK', detail: `${sheets.find(x => x.name === sh.name)?.name}: ${sh.external} formulas reference an external workbook '[1]' (cached values come from a file that is not available)` });
    for (const e of sh.errorCells) out.findings.push({ severity: 'HIGH', code: 'FORMULA_ERROR_VALUE', detail: `${sh.name} ${e.cell}: formula=${JSON.stringify(e.formula)} cached=${JSON.stringify(e.value)}` });
  }
  const sp = (x: string) => x.trim().toUpperCase().replace(/\s+/g, ' ');
  for (const [, sh] of by) for (const b of sh.blocks) {
    if (b.titleText !== null && sp(b.titleText) !== sp(sh.name)) out.findings.push({ severity: 'MEDIUM', code: 'SHEET_TITLE_MISMATCH', detail: `${sh.name} ${b.titleCell}: sheet is named '${sh.name}' but its title cell says '${b.titleText}'` });
    for (const n of b.headerNotes) { const m = /^([A-Z]+)(\d+)$/.exec(n)!; const txt = String(sh.grid.get(K(Number(m[2]), colIndex(m[1])))?.raw ?? '');
      if (sp(txt) !== sp(sh.name)) out.findings.push({ severity: 'MEDIUM', code: 'SHEET_TITLE_MISMATCH', detail: `${sh.name} ${n}: sheet is named '${sh.name}' but header note says '${txt}'` }); }
  }
  const dupGroups = new Set<string>(); for (const r of out.records) if (r.rowOccurrence > 0) dupGroups.add(`${r.blockIndex}\u0001${r.rowLabelRaw}`);
  for (const g of dupGroups) { const [bi, lab] = g.split('\u0001'); out.findings.push({ severity: 'MEDIUM', code: 'DUPLICATE_ROW_LABEL_IN_BLOCK', detail: `block ${bi}: row label '${lab}' occurs more than once in the same grid (kept as separate positions; one may be a typo)` }); }
  if (filename) {
    const m = /'\s*(\d{2,3})\s*\.xlsx$/i.exec(filename);
    if (m) { const found = new Set<string>(); for (const [, sh] of by) for (const b of sh.blocks) { const d = b.rowAxis ? /(\d{2,3})/.exec(b.rowAxis) : null; if (d) found.add(d[1]); }
      if (found.size && !found.has(m[1])) out.findings.push({ severity: 'MEDIUM', code: 'AXIS_ANGLE_CONFLICT', detail: `filename says axis ${m[1]} but sheet axis labels say [${[...found].sort().join(', ')}]` }); }
  }
  return out;
}
