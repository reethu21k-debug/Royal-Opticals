'use client';
import { useMemo, useRef, useState } from 'react';
import { fmtPower } from '@/lib/power-format';

/**
 * Count entry as a GRID, like the original Excel sheets: one table per block, rows × columns of powers.
 * Blocks with a single column (plain lists) are shown as compact tiles so many lenses fit on screen.
 * • type a number, Enter (or Tab / arrows) moves on; every entry saves by itself
 * • paste a block of numbers copied from Excel or a list: it fills the grid from the selected cell
 * • click the small system number under a cell to use it ("the shelf matches")
 * • per-block tools: match system stock, set blanks to 0, clear
 * Blank is never zero: an empty cell stays "not counted".
 *
 * TARGETS GRID: beside every count grid there is a second grid with the same rows and columns where the target (minimum stock) of each lens is set.
 * It works the same way (type, Enter/arrows, paste from Excel, every entry saves by itself) and never changes stock. A blank target cell means "leave as it is".
 */

export type GLine = {
  variant_id: string; workbook: string; block: string; row_label_source: string; col_label_source: string | null;
  row_key?: string; col_key?: string | null; row_occurrence?: number; source_col?: number | null;
  recorded_quantity: number | null; recorded_state: string; counted_quantity: number | null; result: string | null;
  target_quantity?: number | null; target_state?: string | null;
};
export type Change = { l: GLine; value: number | null };
type Cell = GLine | null;
type Blk = { key: string; workbook: string; block: string; cols: { id: string; label: string }[]; rows: { id: string; label: string; cells: Cell[] }[]; lines: GLine[] };
type RowState = 'saving' | 'saved' | string;

const MAX = 1_000_000;
const css: Record<string, string> = Object.fromEntries(["tools", "toolGroup", "label", "legend", "key", "kSame", "kDiff", "kNew", "block", "blockHead", "title", "wb", "bn", "right", "prog", "progBar", "actions", "scroll", "grid", "cell", "ro", "sys", "sysBtn", "cSame", "cDiff", "cNew", "cVoid", "cErr", "cSaved", "cSaving", "tiles", "tile", "tileLabel", "split", "pane", "paneLabel", "tgt"].map(n => [n, 'cg-' + n]));
const STYLES = `
.cg-tools{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
.cg-toolGroup{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cg-label{font-size:12.5px;color:var(--mut)}
.cg-legend{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--mut);margin:0 0 12px}
.cg-key{display:inline-flex;align-items:center;gap:6px}
.cg-key i{width:14px;height:14px;border-radius:4px;border:1px solid var(--line-strong);display:inline-block}
.cg-kSame{background:var(--ok-soft)}.cg-kDiff{background:var(--warn-soft)}.cg-kNew{background:var(--info-soft)}

.cg-block{margin:0 0 16px;padding:0;overflow:hidden}
.cg-blockHead{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--soft)}
.cg-title{display:grid;gap:1px;min-width:0}
.cg-wb{font-size:12px;color:var(--mut);overflow-wrap:anywhere}
.cg-bn{font-weight:650;overflow-wrap:anywhere}
.cg-right{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center}
.cg-prog{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--mut);white-space:nowrap}
.cg-progBar{width:90px;height:6px;border-radius:99px;background:var(--soft-2);overflow:hidden}
.cg-progBar i{display:block;height:100%;background:var(--ok);border-radius:99px}
.cg-actions{display:flex;gap:6px;flex-wrap:wrap}

.cg-scroll{overflow:auto;max-width:100%;max-height:min(75vh,900px)}
.cg-grid{border-collapse:separate;border-spacing:0;font-variant-numeric:tabular-nums;width:max-content;min-width:100%}
.cg-grid th,.cg-grid td{padding:4px;text-align:center;border-bottom:1px solid var(--line);border-right:1px solid var(--line);background:#fff}
.cg-grid thead th{position:sticky;top:0;z-index:2;background:#f3f4fa;font-size:12.5px;font-weight:650;color:var(--mut);padding:8px 6px;white-space:nowrap}
.cg-grid thead th:first-child{left:0;z-index:3;border-right:2px solid var(--line-strong)}
.cg-grid tbody th{position:sticky;left:0;z-index:1;background:#f3f4fa;font-size:13px;font-weight:650;padding:4px 12px;text-align:right;white-space:nowrap;border-right:2px solid var(--line-strong)}
.cg-cell{min-width:78px}
.cg-cell input{width:64px;height:38px;padding:0 4px;text-align:center;font-size:16px;font-weight:650;border-radius:8px;font-variant-numeric:tabular-nums}
.cg-cell .cg-ro{display:inline-block;min-width:44px;height:38px;line-height:38px;font-size:16px;font-weight:650}
.cg-cell .cg-sys{display:block;margin-top:2px;font-size:11px;line-height:1.3;color:var(--mut)}
button.cg-sysBtn{display:block;margin:2px auto 0;height:auto;padding:0 4px;border:0;background:none;box-shadow:none;font-size:11px;line-height:1.3;color:var(--mut);text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer;border-radius:4px}
button.cg-sysBtn:hover:not(:disabled){background:none;border:0;box-shadow:none;color:var(--ok)}
.cg-cSame,.cg-grid td.cg-cSame{background:var(--ok-soft)}
.cg-cDiff,.cg-grid td.cg-cDiff{background:var(--warn-soft)}
.cg-cNew,.cg-grid td.cg-cNew{background:var(--info-soft)}
.cg-cVoid,.cg-grid td.cg-cVoid{background:repeating-linear-gradient(45deg,transparent 0 6px,var(--soft) 6px 12px)}
.cg-cErr input{border-color:var(--bad)}
.cg-cSaved input{border-color:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.cg-cSaving input{opacity:.6}
.cg-cErr .cg-sys{color:var(--bad)}
.cg-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;padding:14px}
.cg-tile{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fff;font-variant-numeric:tabular-nums}
.cg-tileLabel{font-weight:700;font-size:15px;overflow-wrap:anywhere}
.cg-tile input{width:100%;height:46px;padding:0 6px;text-align:center;font-size:20px;font-weight:700;border-radius:10px}
.cg-tile .cg-ro{display:block;height:46px;line-height:46px;text-align:center;font-size:20px;font-weight:700}
.cg-tile .cg-sys{display:block;font-size:11.5px;color:var(--mut);text-align:center}
.cg-tile button.cg-sysBtn{margin:0 auto}
.cg-cErr.cg-tile .cg-sys{color:var(--bad)}

.cg-split{display:flex;align-items:flex-start}
.cg-pane{flex:1 1 0;min-width:0}
.cg-pane+.cg-pane{border-left:3px solid var(--line-strong)}
.cg-paneLabel{height:30px;display:flex;align-items:center;padding:0 14px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);background:#fff;border-bottom:1px solid var(--line)}
.cg-tgt .cg-paneLabel{color:var(--info,#2f5bd8)}
.cg-fillIn{width:76px;height:32px;padding:0 6px;text-align:center;font-weight:650;border-radius:8px}
@media (max-width:900px){.cg-split .cg-tgt{display:none}}
@media (max-width:700px){.cg-cell{min-width:70px}.cg-cell input{width:58px;height:44px;font-size:18px}.cg-blockHead{padding:10px}}
`;

function build(items: GLine[]): Blk[] {
  // Rows and columns come from the lens labels themselves (works with or without the extra key fields).
  // If the same power appears twice in one block, the second one gets its own row (same as in the Excel sheet).
  const blocks: Blk[] = []; const index = new Map<string, number>();
  type Tmp = { cols: Map<string, { label: string; order: number }>; rows: { label: string; cells: Map<string, GLine> }[]; byLabel: Map<string, number[]> };
  const tmp: Tmp[] = [];
  for (const l of items) {
    const k = l.workbook + '\u0000' + l.block;
    let i = index.get(k);
    if (i === undefined) { i = blocks.length; index.set(k, i); blocks.push({ key: k, workbook: l.workbook, block: l.block, cols: [], rows: [], lines: [] }); tmp.push({ cols: new Map(), rows: [], byLabel: new Map() }); }
    const t = tmp[i]; blocks[i].lines.push(l);
    const cid = l.col_key ?? l.col_label_source ?? '';
    if (!t.cols.has(cid)) t.cols.set(cid, { label: l.col_label_source ?? '', order: l.source_col ?? 1e9 + t.cols.size });
    const label = l.row_label_source ?? '';
    const ids = t.byLabel.get(label) ?? [];
    let ri = ids.find(x => !t.rows[x].cells.has(cid));
    if (ri === undefined) { ri = t.rows.length; t.rows.push({ label, cells: new Map() }); ids.push(ri); t.byLabel.set(label, ids); }
    t.rows[ri].cells.set(cid, l);
  }
  blocks.forEach((b, i) => {
    const t = tmp[i];
    b.cols = [...t.cols.entries()].sort((a, c) => a[1].order - c[1].order).map(([id, v]) => ({ id, label: v.label }));
    b.rows = t.rows.map((r, n) => ({ id: String(n), label: r.label, cells: b.cols.map(c => r.cells.get(c.id) ?? null) }));
  });
  return blocks;
}

export default function CountGrid({ items, open, rowState, onSave, onBulk, onNotice, canSetTargets = false, targetRowState = {}, onSaveTarget, onBulkTargets, only, additive = false }: {
  items: GLine[]; open: boolean; rowState: Record<string, RowState>;
  onSave: (l: GLine, raw: string) => void; onBulk: (changes: Change[]) => void; onNotice: (message: string) => void;
  canSetTargets?: boolean; targetRowState?: Record<string, RowState>;
  onSaveTarget?: (l: GLine, raw: string) => void; onBulkTargets?: (changes: Change[]) => void;
  only?: 'targets';   // 'targets' = the separate Targets tab: only the targets grid, full width
  additive?: boolean; // true = the "Add to stock" tab: a typed number is ADDED to the system stock (sys 17 + 5 = 22). false = the normal Grid (typed number replaces).
}) {
  const blocks = useMemo(() => build(items), [items]);
  const [enter, setEnter] = useState<'right' | 'down'>('right');
  const [showT, setShowT] = useState(false);   // optional: the targets grid beside the count grid (the Targets tab shows it on its own)
  const targetsOnly = only === 'targets';
  const split = showT && !targetsOnly;
  const [fillN, setFillN] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  /* ── keyboard movement ── */
  const inputs = () => Array.from(wrap.current?.querySelectorAll<HTMLInputElement>('input[data-grid]') ?? []);
  const go = (el?: HTMLInputElement | null) => { if (el) { el.focus(); el.select(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } };
  const at = (b: number, r: number, c: number) => wrap.current?.querySelector<HTMLInputElement>(`input[data-b="${b}"][data-r="${r}"][data-c="${c}"]`) ?? null;
  const dom = (from: HTMLInputElement, delta: number) => { const all = inputs(); return all[all.indexOf(from) + delta] ?? null; };
  const isTiles = (b: number) => { const k = blocks[b]; return !!k && k.cols.length === 1 && k.rows.length > 1; };
  function step(from: HTMLInputElement, dr: number, dc: number) {
    const b = +from.dataset.b!, r = +from.dataset.r!, c = +from.dataset.c!; const blk = blocks[b];
    if (isTiles(b)) {   // tiles: left/right = neighbour, up/down = the tile visually above/below
      const mine = inputs().filter(x => x.dataset.b === from.dataset.b); const i = mine.indexOf(from);
      if (dc !== 0) return mine[i + dc] ?? null;
      const fr = from.getBoundingClientRect(); let best: HTMLInputElement | null = null, bestScore = Infinity;
      for (const x of mine) { if (x === from) continue; const xr = x.getBoundingClientRect(); const dy = (xr.top - fr.top) * dr; if (dy <= 4) continue; const score = dy * 1000 + Math.abs(xr.left - fr.left); if (score < bestScore) { best = x; bestScore = score; } }
      return best ?? (fr.top === 0 && fr.bottom === 0 ? mine[i + dr] ?? null : null);
    }
    let rr = r + dr, cc = c + dc;
    while (blk && rr >= 0 && rr < blk.rows.length && cc >= 0 && cc < blk.cols.length) { const el = at(b, rr, cc); if (el) return el; rr += dr; cc += dc; }
    return null;
  }
  function nextColumnTop(from: HTMLInputElement) {   // "Enter moves down": at the bottom of a column, continue at the top of the next column
    const b = +from.dataset.b!, c = +from.dataset.c!; const blk = blocks[b];
    for (let cc = c + 1; blk && cc < blk.cols.length; cc++) for (let rr = 0; rr < blk.rows.length; rr++) { const el = at(b, rr, cc); if (el) return el; }
    return dom(from, 1);
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? (enter === 'right' ? dom(el, -1) : step(el, -1, 0) ?? dom(el, -1)) : (enter === 'right' ? dom(el, 1) : step(el, 1, 0) ?? nextColumnTop(el))); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(step(el, 1, 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(step(el, -1, 0)); }
    else if (e.key === 'ArrowRight' && el.selectionEnd === el.value.length) { e.preventDefault(); go(step(el, 0, 1)); }
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) { e.preventDefault(); go(step(el, 0, -1)); }
  }
  function jumpNextEmpty() {
    const el = wrap.current?.querySelector<HTMLInputElement>(targetsOnly ? 'input[data-tgrid][data-empty="1"]' : 'input[data-grid][data-empty="1"]');
    if (el) { go(el); el.scrollIntoView({ block: 'center' }); } else onNotice(targetsOnly ? 'Every target shown is set.' : 'Every cell shown has a number.');
  }

  /* ── paste a block of numbers (from Excel / a list) ── */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, blk: Blk, ri: number, ci: number, commit: (changes: Change[]) => void = onBulk, add = false) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n\r]/.test(text.trim())) return;   // a single value pastes normally
    e.preventDefault();
    const grid = text.replace(/\r/g, '').split('\n').filter((row, i, a) => !(i === a.length - 1 && row === '')).map(row => row.split('\t'));
    const changes: Change[] = []; let bad = 0, outside = 0;
    grid.forEach((cells, dr) => cells.forEach((raw, dc) => {
      const t = raw.trim(); if (t === '') return;   // blank pasted cells are skipped, never cleared
      const target = blk.rows[ri + dr]?.cells[ci + dc];
      if (!target) { outside++; return; }
      const v = Number(t);
      if (!Number.isInteger(v) || v < 0 || v > MAX) { bad++; return; }
      changes.push({ l: target, value: add ? systemBase(target) + v : v });
    }));
    if (changes.length) commit(changes);
    if (bad || outside) onNotice(`${changes.length ? `Pasted ${changes.length}. ` : ''}${bad ? `${bad} value${bad === 1 ? ' was' : 's were'} not a whole number. ` : ''}${outside ? `${outside} fell outside the grid.` : ''}`.trim());
  }

  /* ── targets grid: keyboard movement (same behaviour as the count grid) ── */
  const tInputs = () => Array.from(wrap.current?.querySelectorAll<HTMLInputElement>('input[data-tgrid]') ?? []);
  const tAt = (b: number, r: number, c: number) => wrap.current?.querySelector<HTMLInputElement>(`input[data-tb="${b}"][data-tr="${r}"][data-tc="${c}"]`) ?? null;
  const tDom = (from: HTMLInputElement, delta: number) => { const all = tInputs(); return all[all.indexOf(from) + delta] ?? null; };
  function tStep(from: HTMLInputElement, dr: number, dc: number) {
    const b = +from.dataset.tb!, r = +from.dataset.tr!, c = +from.dataset.tc!; const blk = blocks[b];
    if (isTiles(b)) { const mine = tInputs().filter(x => x.dataset.tb === from.dataset.tb); return mine[mine.indexOf(from) + (dc !== 0 ? dc : dr)] ?? null; }
    let rr = r + dr, cc = c + dc;
    while (blk && rr >= 0 && rr < blk.rows.length && cc >= 0 && cc < blk.cols.length) { const el = tAt(b, rr, cc); if (el) return el; rr += dr; cc += dc; }
    return null;
  }
  function tNextColumnTop(from: HTMLInputElement) {
    const b = +from.dataset.tb!, c = +from.dataset.tc!; const blk = blocks[b];
    for (let cc = c + 1; blk && cc < blk.cols.length; cc++) for (let rr = 0; rr < blk.rows.length; rr++) { const el = tAt(b, rr, cc); if (el) return el; }
    return tDom(from, 1);
  }
  function onTKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? (enter === 'right' ? tDom(el, -1) : tStep(el, -1, 0) ?? tDom(el, -1)) : (enter === 'right' ? tDom(el, 1) : tStep(el, 1, 0) ?? tNextColumnTop(el))); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(tStep(el, 1, 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(tStep(el, -1, 0)); }
    else if (e.key === 'ArrowRight' && el.selectionEnd === el.value.length) { e.preventDefault(); go(tStep(el, 0, 1)); }
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) { e.preventDefault(); go(tStep(el, 0, -1)); }
  }
  // the count grid and the targets grid of one block scroll together, so rows always stay side by side
  function syncScroll(e: React.UIEvent<HTMLDivElement>) {
    const t = e.currentTarget; const key = t.dataset.sync; if (key === undefined) return;
    wrap.current?.querySelectorAll<HTMLDivElement>(`[data-sync="${key}"]`).forEach(x => { if (x !== t && x.scrollTop !== t.scrollTop) x.scrollTop = t.scrollTop; });
  }
  const fillTargets = (blk: Blk, all: boolean) => {
    const v = Number(fillN.trim());
    if (fillN.trim() === '' || !Number.isInteger(v) || v < 0 || v > MAX) { onNotice('Type a whole number (0 or more) to use as the target.'); return; }
    const ls = blk.lines.filter(l => all || l.target_quantity === null || l.target_quantity === undefined).filter(l => l.target_quantity !== v);
    if (!ls.length) { onNotice(all ? `Every target in this block is already ${v}.` : 'Every target in this block is already set.'); return; }
    if (confirm(`${all ? 'Set' : 'Fill'} ${ls.length} ${all ? '' : 'empty '}target${ls.length === 1 ? '' : 's'} in this block to ${v}?\n\nTargets never change the stock itself. Each change is saved in the target history.`)) onBulkTargets?.(ls.map(l => ({ l, value: v })));
  };

  /* ── block tools ── */
  const matchSystem = (blk: Blk) => {
    const ls = blk.lines.filter(l => l.counted_quantity === null && l.recorded_state === 'recorded' && l.recorded_quantity !== null);
    if (ls.length && confirm(`Mark ${ls.length} uncounted line${ls.length === 1 ? '' : 's'} as matching the system stock?\n\nOnly do this if you checked the shelf and it agrees.`)) onBulk(ls.map(l => ({ l, value: l.recorded_quantity })));
  };
  const blanksToZero = (blk: Blk) => {
    const ls = blk.lines.filter(l => l.counted_quantity === null);
    if (ls.length && confirm(`Record ${ls.length} uncounted line${ls.length === 1 ? '' : 's'} as 0?\n\nOnly do this if you checked and there are none on the shelf. Blank normally means “not counted”.`)) onBulk(ls.map(l => ({ l, value: 0 })));
  };
  const clearBlock = (blk: Blk) => {
    const ls = blk.lines.filter(l => l.counted_quantity !== null);
    if (ls.length && confirm(`Clear ${ls.length} counted line${ls.length === 1 ? '' : 's'} in this block? They go back to “not counted”.`)) onBulk(ls.map(l => ({ l, value: null })));
  };

  // Counting is ADDITIVE: what is typed in a count cell is added to the system stock shown under it (sys 17 + typed 5 = 22).
  // The saved count is the final total, so differences, approval and stock updates keep working exactly as before.
  const systemBase = (l: GLine) => (l.recorded_state === 'missing' || l.recorded_quantity === null ? 0 : l.recorded_quantity);
  const addToSystem = (l: GLine, raw: string) => {
    const text = raw.trim(); const n = Number(text);
    if (text === '' || !Number.isInteger(n) || n < 0) return raw;   // blank clears; invalid input still shows the normal error
    return String(systemBase(l) + n);
  };

  const sysText = (l: GLine) => l.recorded_quantity === null || l.recorded_state === 'missing' ? '—' : l.recorded_state === 'unverified' ? `${l.recorded_quantity}?` : String(l.recorded_quantity);

  const cellInfo = (l: GLine) => {
    const st = rowState[l.variant_id]; const err = typeof st === 'string' && st !== 'saving' && st !== 'saved' ? st : '';
    const c = l.counted_quantity, rec = l.recorded_quantity;
    return { st, err, c, rec, tone: c === null ? '' : rec === null ? css.cNew : c === rec ? css.cSame : css.cDiff,
      canUseSystem: open && l.recorded_state === 'recorded' && rec !== null && c !== rec };
  };
  const cellInner = (l: GLine, rowLabel: string, blk: Blk, bi: number, ri: number, ci: number) => {
    const x = cellInfo(l); const label = `${fmtPower(rowLabel)}${l.col_label_source ? ' by ' + fmtPower(l.col_label_source) : ''}`;
    return (<>
      {open
        ? <input data-grid data-b={bi} data-r={ri} data-c={ci} data-empty={x.c === null ? '1' : '0'} aria-label={`Counted quantity for ${label}`} aria-invalid={!!x.err}
            inputMode="numeric" pattern="[0-9]*" placeholder="–" autoComplete="off"
            defaultValue={x.c ?? ''} key={`${l.variant_id}-${x.c}`}
            onFocus={e => e.target.select()} onInput={e => { e.currentTarget.dataset.dirty = '1'; }}
            onBlur={e => onSave(l, additive && e.target.dataset.dirty === '1' ? addToSystem(l, e.target.value) : e.target.value)} onKeyDown={onKey} onPaste={e => onPaste(e, blk, ri, ci, onBulk, additive)} />
        : <span className={css.ro}>{x.c ?? '—'}</span>}
      {x.canUseSystem
        ? <button type="button" className={css.sysBtn} tabIndex={-1} title="Click to count the same as system stock" onClick={() => onSave(l, String(x.rec))}>sys {sysText(l)}</button>
        : <span className={css.sys}>{x.err ? x.err : `sys ${sysText(l)}`}</span>}
    </>);
  };

  const tInfo = (l: GLine) => {
    const st = targetRowState[l.variant_id]; const err = typeof st === 'string' && st !== 'saving' && st !== 'saved' ? st : '';
    const t = l.target_quantity ?? null; const rec = l.recorded_quantity;
    return { st, err, t, tone: t !== null && rec !== null && l.recorded_state !== 'missing' && rec < t ? css.cDiff : '' };
  };
  const targetInner = (l: GLine, rowLabel: string, blk: Blk, bi: number, ri: number, ci: number) => {
    const x = tInfo(l); const label = `${fmtPower(rowLabel)}${l.col_label_source ? ' by ' + fmtPower(l.col_label_source) : ''}`;
    return (<>
      {canSetTargets
        ? <input data-tgrid data-empty={x.t === null ? '1' : '0'} data-tb={bi} data-tr={ri} data-tc={ci} aria-label={`Target for ${label}`} aria-invalid={!!x.err}
            inputMode="numeric" pattern="[0-9]*" placeholder="–" autoComplete="off"
            defaultValue={x.t ?? ''} key={`t-${l.variant_id}-${x.t}`}
            onFocus={e => e.target.select()}
            onBlur={e => { const v = e.target.value.trim(); if (v === '') { e.target.value = x.t === null ? '' : String(x.t); return; } onSaveTarget?.(l, v); }}
            onKeyDown={onTKey} onPaste={e => onPaste(e, blk, ri, ci, onBulkTargets ?? onBulk, false)} />
        : <span className={css.ro}>{x.t ?? '—'}</span>}
      <span className={css.sys}>{x.err ? x.err : `stock ${sysText(l)}`}</span>
    </>);
  };

  if (blocks.length === 0) return <div className="card mut" style={{ padding: 18, textAlign: 'center' }}>No lines match this view.</div>;

  return (
    <div ref={wrap}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className={css.tools}>
        {(open || (targetsOnly && canSetTargets)) && <>
          <div className={css.toolGroup}><span className={css.label}>Enter moves</span>
            <div className="pills" role="group" aria-label="Where Enter moves to">
              <button type="button" aria-pressed={enter === 'right'} onClick={() => setEnter('right')}>Across →</button>
              <button type="button" aria-pressed={enter === 'down'} onClick={() => setEnter('down')}>Down ↓</button>
            </div></div>
          <button type="button" className="sm" onClick={jumpNextEmpty}>{targetsOnly ? 'Jump to next empty target' : 'Jump to next empty cell'}</button>
        </>}
        {!targetsOnly && <div className={css.toolGroup}><span className={css.label}>Targets grid</span>
          <div className="pills" role="group" aria-label="Show the targets grid beside the counts (wide screens)">
            <button type="button" aria-pressed={showT} onClick={() => setShowT(true)}>Beside counts</button>
            <button type="button" aria-pressed={!showT} onClick={() => setShowT(false)}>Hidden</button>
          </div></div>}
        <span className={css.label}>{targetsOnly
          ? (canSetTargets ? 'Tip: copy numbers from Excel and paste them into the first cell. Targets never change stock.' : 'You can see the targets here, but only managers can change them.')
          : open ? (additive ? 'Add to stock: the number you type is ADDED to the system stock under the cell (sys 17 + 5 = 22).' : 'Tip: copy numbers from Excel and paste them into the first cell.') : 'Counting is closed, so numbers are read-only.'}</span>
      </div>
      <div className={css.legend} aria-label="Colour key">
        {targetsOnly
          ? <><span className={css.key}><i className={css.kDiff} />stock is below the target</span><span>The small number under each cell is the system stock. A blank cell has no target yet.</span></>
          : <>
            <span className={css.key}><i className={css.kSame} />matches system</span>
            <span className={css.key}><i className={css.kDiff} />different from system</span>
            <span className={css.key}><i className={css.kNew} />no system stock yet</span>
            <span>The small number under each cell is the system stock.</span>
            {split && <span className={css.key}><i className={css.kDiff} />targets grid: stock is below the target</span>}
          </>}
      </div>

      {blocks.map((blk, bi) => {
        const counted = blk.lines.filter(l => l.counted_quantity !== null).length; const total = blk.lines.length;
        const pct = total ? Math.round((counted / total) * 100) : 0;
        const nMatch = blk.lines.filter(l => l.counted_quantity === null && l.recorded_state === 'recorded' && l.recorded_quantity !== null).length;
        const nBlank = total - counted;
        const withT = blk.lines.filter(l => l.target_quantity !== null && l.target_quantity !== undefined).length;
        const countBody = isTiles(bi)
              ? <div className={css.tiles} role="group" aria-label={`${blk.block} count`}>
                {blk.rows.map((r, ri) => { const l = r.cells[0]; if (!l) return null; const x = cellInfo(l); return (
                  <div key={r.id} className={`${css.tile} ${x.tone} ${x.err ? css.cErr : ''} ${x.st === 'saved' ? css.cSaved : ''} ${x.st === 'saving' ? css.cSaving : ''}`} title={x.err || undefined}>
                    <span className={css.tileLabel}>{fmtPower(r.label)}</span>
                    {cellInner(l, r.label, blk, bi, ri, 0)}
                  </div>); })}
              </div>
              : <div className={css.scroll} data-sync={bi} onScroll={syncScroll} tabIndex={0} role="region" aria-label={`${blk.block} count grid`}>
                <table className={css.grid}>
                  <thead><tr><th scope="col" aria-label="Power" />{blk.cols.map(c => <th key={c.id} scope="col">{fmtPower(c.label) || 'Count'}</th>)}</tr></thead>
                  <tbody>
                    {blk.rows.map((r, ri) => (
                      <tr key={r.id}>
                        <th scope="row">{fmtPower(r.label)}</th>
                        {r.cells.map((l, ci) => {
                          if (!l) return <td key={ci} className={css.cVoid} aria-hidden="true" />;
                          const x = cellInfo(l);
                          return (
                            <td key={ci} className={`${css.cell} ${x.tone} ${x.err ? css.cErr : ''} ${x.st === 'saved' ? css.cSaved : ''} ${x.st === 'saving' ? css.cSaving : ''}`} title={x.err || undefined}>
                              {cellInner(l, r.label, blk, bi, ri, ci)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>;
        const targetBody = isTiles(bi)
      ? <div className={css.tiles} role="group" aria-label={`${blk.block} targets`}>
        {blk.rows.map((r, ri) => { const l = r.cells[0]; if (!l) return null; const x = tInfo(l); return (
          <div key={r.id} className={`${css.tile} ${x.tone} ${x.err ? css.cErr : ''} ${x.st === 'saved' ? css.cSaved : ''} ${x.st === 'saving' ? css.cSaving : ''}`} title={x.err || undefined}>
            <span className={css.tileLabel}>{fmtPower(r.label)}</span>
            {targetInner(l, r.label, blk, bi, ri, 0)}
          </div>); })}
      </div>
      : <div className={css.scroll} data-sync={bi} onScroll={syncScroll} tabIndex={0} role="region" aria-label={`${blk.block} targets grid`}>
        <table className={css.grid}>
          <thead><tr><th scope="col" aria-label="Power" />{blk.cols.map(c => <th key={c.id} scope="col">{fmtPower(c.label) || 'Target'}</th>)}</tr></thead>
          <tbody>
            {blk.rows.map((r, ri) => (
              <tr key={r.id}>
                <th scope="row">{fmtPower(r.label)}</th>
                {r.cells.map((l, ci) => {
                  if (!l) return <td key={ci} className={css.cVoid} aria-hidden="true" />;
                  const x = tInfo(l);
                  return (
                    <td key={ci} className={`${css.cell} ${x.tone} ${x.err ? css.cErr : ''} ${x.st === 'saved' ? css.cSaved : ''} ${x.st === 'saving' ? css.cSaving : ''}`} title={x.err || undefined}>
                      {targetInner(l, r.label, blk, bi, ri, ci)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>;
        return (
          <section key={blk.key} className={`card ${css.block}`} aria-label={`${blk.workbook} ${blk.block}`}>
            <div className={css.blockHead}>
              <div className={css.title}><span className={css.wb}>{blk.workbook}</span><span className={css.bn}>{blk.block}</span></div>
              <div className={css.right}>
                {targetsOnly
                  ? <span className={css.prog}><span className={css.progBar} aria-hidden="true"><i style={{ width: (total ? Math.round((withT / total) * 100) : 0) + '%' }} /></span>{withT} of {total} have a target</span>
                  : <span className={css.prog}><span className={css.progBar} aria-hidden="true"><i style={{ width: pct + '%' }} /></span>{counted} of {total} counted</span>}
                {open && !targetsOnly && <div className={css.actions}>
                  <button type="button" className="sm" disabled={nMatch === 0} onClick={() => matchSystem(blk)} title="Fill uncounted cells that have system stock with that number">Match system stock{nMatch ? ` (${nMatch})` : ''}</button>
                  <button type="button" className="sm" disabled={nBlank === 0} onClick={() => blanksToZero(blk)} title="Record every uncounted cell as 0">Set blanks to 0</button>
                  <button type="button" className="sm danger" disabled={counted === 0} onClick={() => clearBlock(blk)}>Clear</button>
                </div>}
                {(split || targetsOnly) && canSetTargets && <div className={css.actions} role="group" aria-label="Set targets for this block">
                  <input className="cg-fillIn" inputMode="numeric" pattern="[0-9]*" placeholder="Target" aria-label="Target value for every lens in this block" value={fillN} onChange={e => setFillN(e.target.value)} />
                  <button type="button" className="sm" onClick={() => fillTargets(blk, false)} title="Give every lens in this block that has no target yet this target">Fill empty targets</button>
                  <button type="button" className="sm" onClick={() => fillTargets(blk, true)} title="Give every lens in this block this target">Set all targets</button>
                </div>}
              </div>
            </div>
            {targetsOnly
              ? <div className={css.tgt}><div className={css.paneLabel}>Targets{canSetTargets ? '' : ' (view only)'}</div>{targetBody}</div>
              : split
              ? <div className={css.split}>
                <div className={css.pane}><div className={css.paneLabel}>Count</div>{countBody}</div>
                <div className={`${css.pane} ${css.tgt}`}><div className={css.paneLabel}>Targets{canSetTargets ? '' : ' (view only)'}</div>{targetBody}</div>
              </div>
              : countBody}
          </section>
        );
      })}
    </div>
  );
}