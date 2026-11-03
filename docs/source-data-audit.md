# Source data audit

Source: `Excel.zip` (178 archive entries: 119 files + 59 directory entries incl. root). Everything below was computed by script from the files; nothing was inferred from file names alone.

## 1. Inventory of sources

- Workbooks: **76**, worksheets: **273**, PDFs: **43** (45 pages, all with a text layer).
- Non-empty cells staged losslessly: **31433**; formulas: **7225**; hidden sheets: **0**.
- These counts reproduce the earlier provisional figures (76 / 43 / 273 / 5 duplicate groups).

| File role | Files |
|---|---:|
| INVENTORY_TRIAD | 58 |
| ORDER_SNAPSHOT | 9 |
| PDF_REFERENCE | 43 |
| STOCK_TEMPLATE_OR_SNAPSHOT | 9 |

- `INVENTORY_TRIAD`: workbook with three sheets — `LENS QUANTITY` (target), `STOCK LENS` (available), `ORDER LENS` (formula `target − stock`). These are the only live stock records.
- `ORDER_SNAPSHOT`: values-only, hand-pasted order sheets (signed text such as `+0.25`), one sheet per product. Not reconciled to the triads (see Q-SNAP-1).
- `STOCK_TEMPLATE_OR_SNAPSHOT`: stock-count sheets, mostly blank grids.

## 2. Sheet layouts discovered

There are **78 distinct (row 1, row 2) header patterns**, and the layout is not one grid per sheet:
- **MATRIX**: column-axis header row (`ADD`, `(-) CYL`, `(+180) CYL`, `CYL+90` …) over numeric column headers; row-axis label (`(+) SPH`, `COMP (+180)`, …) below it; row labels in the first column. Variant = row label × column label.
- **COMP blocks**: several matrices stacked vertically in one sheet; row labels are two-part cross values such as ` +0.25+0.50` (SPH then CYL, with a leading space).
- **LIST**: side-by-side label/quantity column pairs (`(+) SPH` list and `(+) CYL` list) with no second axis (`+POWER` workbooks).
- **MULTI-PANEL**: matrices and lists placed side by side and stacked in different column bands (`SV -6-4`, `SV -14-2`).
- 425 blocks were detected in 273 sheets; **0 of 31433 cells are unexplained** (`verify_staging.py`).

## 3. Verification performed (all scripts in `migration/`)

| Gate | Result |
|---|---|
| Staged cell count vs independent openpyxl profile | 31433 = 31433 |
| Cells not explained as header / axis / title / label / data (`verify_staging.py`) | 0 |
| Variant records re-read from original files: target, stock, order value, order formula (`verify_against_source.py`) | 7931 records, 0 mismatches |
| Non-blank data cells without a variant record (`verify_coverage.py`) | 0 |

Parser defects found and fixed by these gates during the audit: multi-panel sheets (718 cells missed), list blocks swallowing a neighbouring matrix header (166 mis-read cells), single-column matrices, positions present only in STOCK/ORDER sheets (222 would have been dropped), duplicate row labels inside one grid (36 positions would have collided).

## 4. Findings

| Severity | Code | Count |
|---|---|---:|
| HIGH | FORMULA_ERROR_VALUE | 37 |
| HIGH | NO_STOCK_QUANTITIES_RECORDED | 13 |
| HIGH | STOCK_SHEET_IDENTICAL_TO_TARGET | 3 |
| HIGH | EXTERNAL_WORKBOOK_LINK | 2 |
| MEDIUM | VALUE_WITHOUT_TARGET_POSITION | 361 |
| MEDIUM | SHEET_TITLE_MISMATCH | 51 |
| MEDIUM | STOCK_MOSTLY_BLANK | 5 |
| MEDIUM | DUPLICATE_ROW_LABEL_IN_BLOCK | 4 |
| MEDIUM | AXIS_ANGLE_CONFLICT | 4 |
| INFO | EXACT_DUPLICATE_FILE | 5 |

Per-record flags (7,931 grid positions):

| Flag | Positions |
|---|---:|
| STOCK_BLANK | 3783 |
| STOCK_EQUALS_TARGET | 1542 |
| TARGET_BLANK | 1428 |
| ORDER_NEGATIVE_IN_SOURCE | 770 |
| ORDER_NOT_A_FORMULA | 562 |
| ORDER_CACHED_DIFFERS_FROM_TARGET_MINUS_STOCK | 287 |
| TARGET_POSITION_ABSENT | 222 |
| ORDER_CELL_BLANK | 151 |
| NO_MATCHING_STOCK_CELL | 150 |
| NO_MATCHING_ORDER_CELL | 150 |
| DUPLICATE_ROW_LABEL_IN_BLOCK | 72 |
| ORDER_ERROR_VALUE | 37 |
| TARGET_NOT_NUMERIC | 1 |

Highlights:
1. **Legacy `ORDER LENS` is `target − stock` with no `MAX(0,…)`** — it produces negative orders. The confirmed rule differs; the application implements `MAX(0, …)`.
2. **Excel treats a blank stock cell as 0**, so a blank stock yields an order equal to the full target. About half of all positions have a blank stock cell, and 13 workbooks have *no* stock quantities at all. The application keeps blank = unknown (never 0) pending Q-BLANK-1.
3. **3 workbooks have a `STOCK LENS` grid identical to `LENS QUANTITY`** (`KT HC COMP +0.50'90`, `+1.00'90`, `-1.00'180`): imported as `unverified`, movements blocked until counted.
4. **232 formulas link to an external workbook** (`'[1]LENS QUANTITY'`) in `Poly HMC -6-2.xlsx` and `CR HC SV ORDER LENS SHEET.xlsx`; **37 cells are `#REF!`/`#VALUE!`**; one target cell contains the letter `v` (`Magnus Click -6-2`, row −2, col −1.75).
5. **`CR HMC +POWER.xlsx` is byte-identical to `CR HMC -6-2.xlsx`** although its name says +POWER. Only one copy may carry stock (Q-DUP-1).
6. **Filename vs content conflicts**: 4 COMP workbooks whose file name axis (90/180) contradicts the axis printed in the sheet; 51 sheets whose internal title does not match the sheet name (e.g. a `LENS QUANTITY` sheet titled `STOCK LENS`).
7. **Duplicate row labels inside one grid** (e.g. `+2.00+2.00` twice) — kept as separate positions, flagged.
8. Source typos preserved verbatim: `STRIGHT`, `STCK`, `0RDER LENS`, `LENS QANTITY`, `MAGNUS CLIK`, `Sheet1…Sheet6` default sheet names.

## 5. Distinct sheet names (verbatim, count of workbooks)

```
'STOCK LENS': 58
'ORDER LENS': 58
'LENS QUANTITY': 58
'BLUE CUT KT SPH +3': 1
'BLUE CUT KT SPH -3': 1
"BLUE CUT KT CYL +2'180": 1
"BLUE CUT KT CYL -2'90": 1
'Sheet1': 4
'Sheet2': 2
'KT HC SPH +6': 3
'KT HC SPH -6': 3
"KT HC CYL +3'180": 3
"KT HC CYL -4'90": 3
"KT HC COMP +0.50'180": 3
"KT HC COMP +1.00'180": 3
"KT HC COMP +3'180": 3
"KT HC COMP -0.50'90": 3
"KT HC COMP -1.00'90": 3
"KT HC COMP -3'90": 3
"KT HC COMP +2.00-4.00'90": 1
"PG KT HC CYL-3.00'180": 1
"PG KT HC CYL +3.00'90": 1
'PG KT HC SPH +4': 2
'PG KT HC SPH -5': 2
"PG KT HC CYL +3'180": 2
"PG KT HC CYL -3'90": 2
"PG KT HC CMP +3.00+0.50'180": 1
"PG KT HC CMP +1.00+2.00'180": 1
"PG KT HC COMP -3.00-0.50'90": 1
"PG KT HC COMP -1.00-2.00'90": 1
"PG KT HC COMP +0.50'180": 1
"PG KT HC COMP +1.00'180": 1
"PG KT HC COMP +3'180": 1
"PG KT HC COMP -0.50'90": 1
"PG KT HC COMP -1.00'90": 1
"PG KT HC COMP -3'90": 1
'HC PROG': 1
'HMC PROG': 1
'PG HC PROG': 1
'VISTA GEN 2.0 PG PROG': 1
'BLUE CUT PROG': 1
'VISTA GEN 2.0 PROG': 1
'CR HC SV -6-2': 2
'CR HMC SV -6-2 ': 2
'BLUE CUT GREEN SV -6-2': 2
'BLUE LIGHT BLUE SV -6-2': 2
'MAGNUS CLIK SV -6-2': 2
'POLY BLUE LIGHT SV -6-2': 2
'PG BLUE LIGHT SV -6-2': 2
'PG HC SV -6-2': 2
'CR HC SV-6-2': 2
'CR HMC SV-6-2': 2
'BLUE CUT HMC GREEN SV-6-2': 2
'BLUE CUT HMC BLUE SV-6-2': 2
'Sheet5': 2
'Sheet6': 2
'HC SV -14-2': 1
'HC SV -6-4': 1
'PG HC SV -6-4': 1
'BLUE LIGHT SV -6-4': 1
```

## 6. Limitations (what this audit does NOT establish)

- PDFs were classified (all are Excel *Print to PDF* output of order/stock grids) but their numbers were **not** extracted or reconciled against workbooks.
- `ORDER_SNAPSHOT` / `STOCK_TEMPLATE` workbooks are staged losslessly but not mapped to inventory positions.
- The *meaning* of the `+POWER` list blocks (SPH-only vs SPH×plano-CYL) and of the `COMP`/`CROSS COMP` axes is inferred from layout, not confirmed.
- Whether stored quantities are accurate or current cannot be determined from the files.

Registers: `docs/registers/*.csv`. Hierarchy: `docs/category-hierarchy.md`.