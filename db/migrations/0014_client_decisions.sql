-- 0014: implement the client's answers to the 17 open questions (see docs/open-questions.md).
--
-- (1) Q-BLANK-1 — a blank stock cell is NOT zero. The "fill blank stock with 0" helper added in 0013 assumed the opposite
--     (it even labelled its lines "client decision"). The client decided the contrary, so the helper is removed. Blank-stock
--     positions only get a value through a real physical count (count session + approval, or a manager's count).
-- (2) Q-COPY-1 — "Unverified Stock" must not be treated as confirmed stock. Until now an unverified quantity still produced a
--     suggested order and a "below target / ok" status. Both now require the quantity to be VERIFIED (state = 'recorded').
--     Unverified positions get their own status 'unverified' and no suggested order until they are counted and approved.
-- (3) Q-BLANK-2 / Q-ERR-1 — a missing or invalid target never produces a suggestion (the target must be state = 'recorded').
--
-- The pure function suggested_order(target, available) is unchanged: MAX(0, target - available), NULL when either is NULL.
-- Net replenishment stays a separate, off-by-default column (net_suggested_order) and never replaces suggested_order.

drop function if exists fill_blank_stock_with_zero(uuid);

create or replace view v_inventory with (security_invoker = true) as
select
  v.id as variant_id, v.organization_id, v.block_node_id, v.row_axis_name, v.col_axis_name,
  v.row_label_source, v.col_label_source, v.row_occurrence,
  b.target_quantity, b.target_state, b.available_quantity, b.available_state,
  case when b.target_state = 'recorded' and b.available_state = 'recorded'
       then suggested_order(b.target_quantity, b.available_quantity) end as suggested_order,
  suggested_order_legacy_blank_as_zero(b.target_quantity, b.available_quantity) as legacy_suggested_order_blank_as_zero,
  case
    when b.available_state = 'unverified' then 'unverified'
    when b.available_quantity is null then 'stock_unknown'
    when b.available_quantity = 0 then 'out_of_stock'
    when b.target_state = 'recorded' and b.available_quantity < b.target_quantity then 'below_target'
    else 'ok' end as stock_status,
  v.is_active,
  coalesce(o.outstanding, 0)::integer as on_order_quantity,
  case when b.target_state = 'recorded' and b.available_state = 'recorded'
       then greatest(0, b.target_quantity - b.available_quantity - coalesce(o.outstanding, 0)) end as net_suggested_order
from lens_variants v join stock_balances b on b.variant_id = v.id
left join (select poi.variant_id, sum(poi.quantity_ordered - poi.quantity_received) as outstanding
           from purchase_order_items poi join purchase_orders po on po.id = poi.purchase_order_id
           where po.status in ('confirmed','partially_received') group by poi.variant_id) o on o.variant_id = v.id;