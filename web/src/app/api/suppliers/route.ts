import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { SupplierBody } from '@/lib/validation';
export const dynamic = 'force-dynamic';
export const GET = route(async (_r, actor) => withActor(actor, async c => ({ items: (await c.query('select * from suppliers order by supplier_name')).rows })));
export const POST = route(async (req, actor) => {
  const b = SupplierBody.parse(await req.json());
  return withActor(actor, async c => ({ supplier: (await c.query(`insert into suppliers(organization_id,supplier_name,supplier_code,contact_person,phone,email,address,notes)
    values ((select app_org()),$1,$2,$3,$4,$5,$6,$7) returning *`, [b.supplierName, b.supplierCode, b.contactPerson, b.phone, b.email, b.address, b.notes])).rows[0] }));
});
