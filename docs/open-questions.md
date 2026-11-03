# Client decisions on the 17 questions (register)

The client answered all 17 questions. This page records each decision and how the application implements it. Migration `0014_client_decisions.sql` and the tests named `client_decision_*` (db) cover the changes made for these answers.

**Guiding principle (client):** preserve the client's original inventory structure, source terminology, product labels, specifications and quantities. Improve the application, storage, usability, security and reporting without changing the established business logic. Any missing, duplicated, conflicting or unverified data is flagged for review, never silently modified. The application is **not** the authoritative stock system until the client approves the production migration and reconciliation.

## Part 1 — questions that needed clarification

| # | ID | Client decision | How the app implements it | Still needed from the client |
|---|---|---|---|---|
| 1 | Q-BLANK-1 | Blank stock = **Not Counted / Unknown**, not zero. Show "Stock Not Recorded" / "Needs Physical Count". No normal suggested order until stock is verified. | Quantity state `missing`; status "Stock not recorded"; suggested-order cell shows **Needs physical count**; suggested order is NULL. The old "Fill blank stock with 0" helper was **removed** (0014). Legacy blank-as-0 figure is shown separately, informational only. | Physical counts |
| 2 | Q-HIER-1 | Preserve the complete original folder hierarchy; do not force category / subcategory / product. | Full verbatim tree in `catalog_nodes`; no semantic mapping. | Preferred grouping, later |
| 3 | Q-DUP-1 | Keep `CR HMC +POWER.xlsx` **on hold**; do not merge, delete or import its 225 positions as approved stock. | Held (`held_duplicate`), review item stays open. | Is it a mis-named duplicate, or is a +POWER workbook missing? |
| 4 | Q-COPY-1 | Mark the three COMP workbooks as **Unverified Stock**; require a physical count and approval before normal movements. | State `unverified`: movements blocked; status **Unverified stock**; **no suggested order** and not counted as below target / out of stock (0014); reported under Reports → Unverified stock. A count session approval (or a manager's count) makes it verified. | Physical counts |
| 5 | Q-ROLE-1 | Client must provide real names and emails; four roles; no fictional accounts. | Nothing is seeded. First administrator is created once with real details (`docs/deployment.md`), the rest in Users. Roles: Administrator, Inventory Manager, Inventory Staff, Read Only. | Real user list |
| 6 | Q-SUP-1 | No supplier/manufacturer details invented. | Supplier tables empty until the client supplies verified details. | Supplier details |

## Part 2 — recommended defaults, approved

| # | ID | Client decision | How the app implements it |
|---|---|---|---|
| 7 | Q-BLANK-2 | Blank target = **not set**, stored as missing (not zero); no suggestion. | Target state `missing`; no suggested order; "No target" shown. |
| 8 | Q-FORM-1 | Suggested Order = `MAX(0, Target − Available)` (20/12→8, 20/20→0, 20/25→0). | SQL `suggested_order()`, unit and DB tests. |
| 9 | Q-LINK-1 | Keep old formula values for audit only; never depend on external workbook links. | Legacy value/formula kept in `variant_source_values`, never used in calculations. |
| 10 | Q-ERR-1 | Preserve raw values of `#REF!`/`#VALUE!`/`v` cells and mark affected records **Invalid**; no zero, no guessing. | State `invalid`, raw text kept; "invalid" shown on the variant; no suggestion; review item. |
| 11 | Q-AXIS-1 | Preserve both filename and worksheet axis labels; flag for review. | Both kept verbatim; review item open. |
| 12 | Q-ROW-1 | Duplicate row labels stay separate positions and are flagged. | `row_occurrence`; "dup #n" badge; review item open. |
| 13 | Q-LIST-1 | SPH-only / CYL-only entries in +POWER workbooks are separate stockable variants. | One variant per list entry. |
| 14 | Q-SNAP-1 | Order-sheet workbooks and PDFs are reference / reconciliation evidence only. | Staged and compared (`docs/snapshot-reconciliation.md`), never imported as stock. |
| 15 | Q-UNIT-1 | Non-negative whole-number quantities for now. | Integer ≥ 0 enforced by the database. |
| 16 | Q-LOC-1 | One implicit stock location. | No location dimension. |
| 17 | Q-NET-1 | Net replenishment disabled by default; optional, separately labelled view only; never replaces the standard calculation. | Setting `net_replenishment_enabled` (off). Separate column `net_suggested_order`, labelled "enhanced calculation". |

## Follow-ups to request from the client

1. Real user names, email addresses and roles (Q-ROLE-1).
2. Verified supplier and manufacturer details, if wanted in the system (Q-SUP-1).
3. Whether `CR HMC +POWER.xlsx` is a mis-named duplicate or a missing workbook (Q-DUP-1).
4. A physical count (count session + approval) for blank-stock and unverified positions (Q-BLANK-1, Q-COPY-1).
5. The correct values for invalid cells, axis conflicts and duplicate labels (Q-ERR-1, Q-AXIS-1, Q-ROW-1).
6. Confirmation of the unit convention: pairs vs individual lenses (Q-UNIT-1).
7. Preferred category / subcategory / product grouping (Q-HIER-1), if wanted.
8. Approval of the production migration and the reconciliation report.