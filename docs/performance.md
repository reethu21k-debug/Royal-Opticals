# Performance (measured; synthetic data, NOT client data)
`python3 db/tests/perf_test.py` loads 150,000 variants (~20× the real 7,706) and ~75k movements into a throwaway PostgreSQL 16 and times the app's real queries **under RLS as an end user**. Best of 3, single connection, local machine — indicative, not a production SLA.

| Query | Before fixes | After (migration 0008 + query restructure) |
|---|---:|---:|
| Inventory page 1, no filter | 1,942 ms | 370 ms |
| Inventory deep page (offset 25,000) | 4,697 ms | 684 ms |
| Count, no filter | 1,683 ms | 204 ms |
| Status filter page | 1,164 ms | 353 ms |
| Search `+0.25` page | 802 ms | 264 ms |
| One workbook subtree | 26 ms | 80 ms |
| SPH range filter page | 1,268 ms | 400 ms |
| Dashboard aggregate | 1,087 ms | 111 ms |
| Report: not-recorded count | 1,668 ms | 151 ms |
| Movements page (latest 50) | 240 ms | 0.3 ms |

Fixes: (1) RLS helper calls wrapped in `(SELECT …)` so they run once per query, not per row (`0008_rls_perf.sql`); (2) `node_path()` and last-movement computed only for the returned page; (3) index on `stock_movements(organization_id, created_at desc, id)`.
At the real size (~7.7k variants) these are tens of milliseconds. Not measured: concurrent load, network latency, Supabase pooler behaviour, Excel export of 50k rows, xlsx import of large files.
Known remaining cost: unfiltered `count(*)` and sorted pages scan all rows (O(n)); switch to keyset pagination if the inventory grows beyond ~500k rows.


## Update — stored display order, materialised filters, HTTP load test
After adding `lens_variants.ord` (migration 0011: stored rank in display order + index; refreshed after every import) the 150k-variant timings are:
page 1 **11 ms** (was 1,942), status filter **12 ms** (1,164), deep page 151 ms (4,697), search 267 ms (802), folder 72 ms, SPH range 492 ms, dashboard 105 ms (1,087), count 192 ms (1,683); slowest 0.49 s. Selective filters (search, folder, power range) are materialised first because walking the order index looking for rare matches is slower.

`ops/load_test.py` (25 concurrent users, 40 s, real server + imported data, **single shared CPU core**): 38 req/s (was 20), p50 0.46–0.72 s, 0 unexpected errors; **correctness under load: 0 lost updates on 8 contended items, ledger = balances**. Single user (no queueing): dashboard 15 ms, inventory page 40 ms, stock write 5 ms. In this sandbox PostgreSQL, Node and the load generator share one core (PostgreSQL ≈ 80% of it), so these figures are a lower bound for a real deployment, not a capacity claim. Lesson: after bulk rewrites, planner statistics matter (≈2× slower until `ANALYZE`); `refresh_variant_order` now runs `ANALYZE`.
