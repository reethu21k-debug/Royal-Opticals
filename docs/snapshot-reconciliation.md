# Snapshot & PDF reconciliation (report only — nothing imported)

Compares every PDF and every `ORDER LENS SHEET` / `STOCK LENS SHEET` worksheet with the live inventory workbooks of the same product folder, by the multiset of positive whole numbers shown (order quantities). See `migration/reconcile_snapshots.py`.

| Source type | Name-matched? | Result | Count |
|---|---|---|---:|
| PDF | - | blank (no quantities — an empty template/printout) | 4 |
| PDF | content | content-only guess (weak evidence): differs (< 50%) | 5 |
| PDF | content | content-only guess (weak evidence): matches ≥ 90% | 5 |
| PDF | content | content-only guess (weak evidence): partial match 50–90% | 8 |
| PDF | name | differs (< 50%) | 3 |
| PDF | name | matches ≥ 90% | 4 |
| PDF | name | partial match 50–90% | 8 |
| PDF | none | no comparable inventory order values | 6 |
| SHEET | - | blank (no quantities — an empty template/printout) | 52 |
| SHEET | content | content-only guess (weak evidence): differs (< 50%) | 7 |
| SHEET | content | content-only guess (weak evidence): matches ≥ 90% | 6 |
| SHEET | content | content-only guess (weak evidence): partial match 50–90% | 15 |
| SHEET | name | differs (< 50%) | 6 |
| SHEET | name | matches ≥ 90% | 2 |
| SHEET | name | partial match 50–90% | 6 |
| SHEET | none | no comparable inventory order values | 5 |

**Interpretation limits:** a high similarity **for a name-matched pair** means the printout/snapshot shows the same order quantities as the live workbook (consistent with being a print/copy of it); a low similarity means it differs (older/newer data, hand edits, or a different grid) and the client must say which is authoritative (Q-SNAP-1). Similarity is by quantity multiset, not cell-by-cell, so it does not prove position-level equality. None of this data has been imported as stock.

Full per-file results: `docs/registers/snapshot_reconciliation.csv`.