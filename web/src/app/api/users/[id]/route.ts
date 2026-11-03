import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
const Body = z.object({ role: z.enum(['administrator', 'inventory_manager', 'inventory_staff', 'read_only']).optional(), isActive: z.boolean().optional() }).refine(b => b.role !== undefined || b.isActive !== undefined, 'nothing to change');
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    let p;
    if (b.role !== undefined) p = (await c.query('select id, full_name, role, is_active from set_user_role($1,$2::app_role)', [id, b.role])).rows[0];
    if (b.isActive !== undefined) p = (await c.query('select id, full_name, role, is_active from set_user_active($1,$2)', [id, b.isActive])).rows[0];
    return { user: p };
  });
});
