# User guide
Roles: **administrator** (everything, incl. users and settings) · **inventory manager** (catalog, targets, counts approval, purchase orders, imports, review decisions) · **inventory staff** (receive, issue, enter counts, receive deliveries) · **read-only**.

**Reading the numbers.** “—” means the original files had **no value** there; it is never shown as 0. *Available* = what is in stock now, *Target* = the quantity you want to keep, *Suggested order* = MAX(0, target − available) and is blank when either number is unknown. A suggestion is not an order.

## Find a lens
**Inventory** → expand the original folders on the left (names are exactly as in the old Excel files), or search (label, workbook, power). Filters: stock status, SPH / CYL / ADD ranges, active / archived. Zero-stock items are never hidden. Click a **block name** to see it as a **power matrix** (same layout and order as the old sheet): each cell shows `available/target`; ✕ out of stock, ▼ below target, ? stock not recorded, ! unverified.

## Change stock
- **One item:** open it (or **Receive / Issue / Adjust**), enter the quantity and a reason. Items whose stock is *not recorded* or *unverified* need a **physical count** first.
- **Many items — Stock counts:** pick a folder / workbook / block → fill the grid, or download the **Excel count sheet**, fill “Counted” (leave empty if not counted) and upload → **Submit** → a manager **approves**. Nothing changes before approval; items whose stock moved meanwhile are flagged, not overwritten.
- A blank stock cell is **not** zero (client decision). Items you have not physically counted stay “Stock not recorded / Needs physical count” — type the real counted number for each one, including a real `0` if you counted none on the shelf.
- **Targets:** per item, per folder (Inventory → select a folder → “Set target for everything in…”), or by Excel (export targets → fill “New target” → upload: first a dry run, then apply with a reason).

## Buy
**Suggested orders** → tick lines, choose the quantity you really want to order, supplier (pre-selected when a preferred supplier is linked to the folder/lens), PO number → **draft purchase order** → **Confirm** → post a **receipt** as each delivery arrives (partial deliveries are fine; stock rises only by what was received). **Cancel** (nothing received) or **Close short** (after a partial delivery) with a reason. **Print** or **Download PDF** from the order page. Suppliers and preferred-supplier links: **Suppliers**.

## Bring in an Excel workbook
**Import Excel** → upload an inventory workbook (sheets `LENS QUANTITY`, `STOCK LENS`, `ORDER LENS`) → review the preview and the findings → choose the destination folder → **Approve & import**. The same file cannot be imported twice; existing items are never overwritten; the import can be rolled back until something else touches those items.

## Review, reports, administration
**Data review**: record decisions on every anomaly found in the original files (one by one or all of one type). **Reports**: current, low, out-of-stock (recorded 0 only), *not recorded*, unverified, no target, movements, adjustments, purchases, audit, import reconciliation — all with date filters and Excel export. **Folders**: add folders, optional display labels, archive. **Settings** (admin): allowed stock-issue reasons; optional “net of open orders” view. **Users** (admin): create accounts, roles, deactivate. **Sign out** is in the top bar.