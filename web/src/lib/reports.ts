// Report catalogue. All stock reports read v_inventory — the same definition the dashboard uses.
// $1/$2 are optional date bounds (from/to, inclusive) for time-based reports; they are always bound (null allowed).
const INV = `from v_inventory i join lens_variants lv on lv.id = i.variant_id join catalog_nodes bn on bn.id = i.block_node_id join catalog_nodes wn on wn.id = bn.parent_id`;
const INV_COLS = `node_path(bn.id) as "Path", wn.source_name as "Workbook", bn.source_name as "Block", i.row_label_source as "Row label", i.col_label_source as "Column label",
  i.target_quantity as "Target", i.available_quantity as "Available", i.available_state as "Available state", i.suggested_order as "Suggested order"`;
const INV_ORDER = `order by lv.ord, i.variant_id`;
const inv = (where: string) => `select ${INV_COLS} ${INV} where ($1::date is null or true) and ($2::date is null or true) and i.is_active and ${where} ${INV_ORDER}`;
export const REPORTS: Record<string, { title: string; note?: string; sql: string }> = {
  'current-stock': { title: 'Current stock', sql: inv('true'), note: 'Blank Available = not recorded in the source (not zero).' },
  'low-stock': { title: 'Low stock (below target)', sql: inv("i.stock_status = 'below_target'") },
  'out-of-stock': { title: 'Out of stock (recorded as 0)', sql: inv("i.stock_status = 'out_of_stock'"), note: 'Only positions whose verified, recorded stock is 0. Blank stock is in "Stock not recorded"; unverified figures are in "Unverified stock".' },
  'not-recorded': { title: 'Stock not recorded (needs count)', sql: inv("i.available_state = 'missing'") },
  'unverified': { title: 'Unverified stock (needs count)', sql: inv("i.available_state = 'unverified'") },
  'no-target': { title: 'No target set', sql: inv('i.target_quantity is null') },
  'movements': { title: 'Stock movements', sql: `select m.created_at as "When", m.movement_type::text as "Type", node_path(lv.block_node_id) as "Path", lv.row_label_source as "Row label", lv.col_label_source as "Column label",
      m.quantity_delta as "Change", m.quantity_before as "Before", m.quantity_after as "After", m.reason as "Reason", p.full_name as "User"
      from stock_movements m join lens_variants lv on lv.id = m.variant_id left join profiles p on p.id = m.created_by
      where ($1::date is null or m.created_at >= $1::date) and ($2::date is null or m.created_at < $2::date + 1) order by m.created_at desc, m.id` },
  'adjustments': { title: 'Stock adjustments and counts', sql: `select m.created_at as "When", m.movement_type::text as "Type", node_path(lv.block_node_id) as "Path", lv.row_label_source as "Row label", lv.col_label_source as "Column label",
      m.quantity_before as "Previous", m.quantity_after as "New", m.quantity_delta as "Difference", m.reason as "Reason", p.full_name as "User"
      from stock_movements m join lens_variants lv on lv.id = m.variant_id left join profiles p on p.id = m.created_by
      where m.movement_type in ('adjustment','opening_count') and ($1::date is null or m.created_at >= $1::date) and ($2::date is null or m.created_at < $2::date + 1) order by m.created_at desc, m.id` },
  'purchases': { title: 'Purchase orders', sql: `select po.po_number as "PO", s.supplier_name as "Supplier", po.status::text as "Status", po.order_date as "Order date", lv.row_label_source as "Row label", lv.col_label_source as "Column label",
      i.suggested_quantity as "Suggested", i.quantity_ordered as "Ordered", i.quantity_received as "Received", (i.quantity_ordered - i.quantity_received) as "Outstanding"
      from purchase_orders po join suppliers s on s.id = po.supplier_id join purchase_order_items i on i.purchase_order_id = po.id join lens_variants lv on lv.id = i.variant_id
      where ($1::date is null or po.order_date >= $1::date) and ($2::date is null or po.order_date <= $2::date) order by po.order_date desc, po.po_number` },
  'audit': { title: 'Inventory audit log', note: 'Managers and administrators only.', sql: `select a.created_at as "When", p.full_name as "User", a.action as "Action", a.entity_type as "Entity", a.entity_id::text as "Entity ID"
      from audit_logs a left join profiles p on p.id = a.user_id where ($1::date is null or a.created_at >= $1::date) and ($2::date is null or a.created_at < $2::date + 1) order by a.created_at desc, a.id` },
  'import-reconciliation': { title: 'Import reconciliation', sql: `select ib.label as "Batch", ib.status::text as "Batch status", r.source_file as "Source file", r.status as "Record status", count(*)::int as "Records",
      coalesce(max(r.hold_reason), '') as "Hold reason" from import_records r join import_batches ib on ib.id = r.import_batch_id
      where ($1::date is null or true) and ($2::date is null or true) group by 1,2,3,4 order by 3,4` },
};