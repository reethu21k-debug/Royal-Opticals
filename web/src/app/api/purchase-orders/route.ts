import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { PoCreateBody } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export const GET = route(async (_r, actor) => withActor(actor, async c => ({ items: (await c.query(`select p.*, s.supplier_name,
  (select coalesce(sum(quantity_ordered),0)::int from purchase_order_items i where i.purchase_order_id=p.id) ordered,
  (select coalesce(sum(quantity_received),0)::int from purchase_order_items i where i.purchase_order_id=p.id) received
  from purchase_orders p join suppliers s on s.id=p.supplier_id order by p.created_at desc limit 200`)).rows })));
// Creates a DRAFT only. A draft never affects stock. suggestedQuantity is stored separately from the quantity actually ordered.
export const POST = route(async (req, actor) => {
  const b = PoCreateBody.parse(await req.json());
  return withActor(actor, async c => {
    const po = (await c.query(`insert into purchase_orders(organization_id,po_number,supplier_id,expected_date,notes,created_by)
      values ((select app_org()),$1,$2,$3,$4,$5) returning *`, [b.poNumber, b.supplierId, b.expectedDate ?? null, b.notes ?? null, actor])).rows[0];
    for (const it of b.items) await c.query('insert into purchase_order_items(purchase_order_id,variant_id,suggested_quantity,quantity_ordered,unit_cost) values ($1,$2,$3,$4,$5)',
      [po.id, it.variantId, it.suggestedQuantity ?? null, it.quantity, it.unitCost ?? null]);
    return { purchaseOrder: po };
  });
});
