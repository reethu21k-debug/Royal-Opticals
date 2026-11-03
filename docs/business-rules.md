# Business rules (implemented in SQL; tested)
- **Target** = client's `LENS QUANTITY`; **Available** = `STOCK LENS`; **Suggested order** = `MAX(0, target − available)`. It is calculated only when BOTH quantities are verified (state `recorded`); it is NULL (shown as “Needs physical count” / “No target”) when either is blank, invalid or unverified. Open purchase orders never reduce it.
- A suggestion is not a purchase order. `purchase_order_items` stores `suggested_quantity` and `quantity_ordered` separately.
- **Blank ≠ 0 (client decision, Q-BLANK-1).** There is no bulk “fill blank with 0” — blank stock only gets a value through a real physical count.
- **Blank ≠ 0.** Quantity states: `recorded | missing | invalid | not_applicable | unverified`. Receipts/issues are refused while available is `missing` or `unverified`; a physical count (or an approved count session) sets the first value (`opening_count` movement).
- Receipt +qty, issue −qty (rejected if it would go below 0), count/adjustment sets the absolute quantity and records the difference. Quantities are whole numbers ≥ 0.
- Every stock change: row lock, idempotency key, append-only movement (before/after), audit entry, single transaction.
- Target changes never change available stock; history in `target_changes`.
- **Count sessions**: snapshot of recorded quantities → counts entered (blank = not counted) → submitted → approved by a manager/admin. Approval posts only lines whose balance still equals the snapshot; changed lines are marked `stale` and not posted; uncounted lines are untouched.
- **Purchase orders**: draft → confirmed → partially_received → received; cancel (nothing received) → `cancelled`; cancel/close after partial receipt → `closed_short` (received stock kept). Draft/confirmed orders never change stock; only posted receipts do; over-receipt is rejected.
- Roles: administrator (everything incl. users), inventory_manager (catalog, targets, counts approval, POs, review decisions), inventory_staff (receive, issue, enter counts, receive POs), read_only. Enforced in SQL.
- The legacy Excel formula `target − stock` (negatives, blank = 0) is preserved only as informational `legacy_suggested_order_blank_as_zero`.

- **Unverified stock** (stock grid identical to target grid, client decision Q-COPY-1) is not confirmed stock: it has its own status `unverified`, is excluded from suggested orders, “below target”, “out of stock” and low-stock reports, and cannot be received/issued until a physical count is approved.
- **Out of stock** = a verified `recorded` quantity of 0. A zero that is unverified is reported under “Unverified stock”, never hidden.
- **Invalid source values** (`#REF!`, `#VALUE!`, the letter `v`): raw text kept in `variant_source_values`, quantity state `invalid`, never replaced by 0 or guessed.
- **Net replenishment** (`MAX(0, target − available − open PO outstanding)`) is a separate column/view, off by default, and never replaces the standard suggested order.
- **Client decisions** are recorded in `docs/open-questions.md`; any missing, duplicated, conflicting or unverified data is flagged for review (`review_items`), never silently changed.