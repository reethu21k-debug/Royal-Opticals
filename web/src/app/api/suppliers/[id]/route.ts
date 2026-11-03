import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid, SupplierBody } from '@/lib/validation';
const Patch = SupplierBody.partial().extend({ isActive: z.boolean().optional() });
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Patch.parse(await req.json());
  return withActor(actor, async c => {
    const r = await c.query(`update suppliers set supplier_name=coalesce($2,supplier_name), supplier_code=coalesce($3,supplier_code), contact_person=coalesce($4,contact_person),
      phone=coalesce($5,phone), email=coalesce($6,email), address=coalesce($7,address), notes=coalesce($8,notes), is_active=coalesce($9,is_active) where id=$1 returning *`,
      [id, b.supplierName, b.supplierCode, b.contactPerson, b.phone, b.email, b.address, b.notes, b.isActive]);
    if (!r.rows[0]) throw new ApiError(404, 'not found or not permitted'); return { supplier: r.rows[0] };
  });
});
