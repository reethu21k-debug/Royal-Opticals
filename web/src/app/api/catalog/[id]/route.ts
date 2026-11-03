import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
// Only the optional DISPLAY label and active flag can change; the verbatim source name is immutable.
const Body = z.object({ displayLabel: z.string().max(200).nullable().optional(), isActive: z.boolean().optional() }).refine(b => b.displayLabel !== undefined || b.isActive !== undefined, 'nothing to change');
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    const r = await c.query(`update catalog_nodes set display_label = case when $2::boolean then $3 else display_label end, is_active = coalesce($4, is_active) where id = $1 returning id, source_name, display_label, is_active`,
      [id, b.displayLabel !== undefined, b.displayLabel ?? null, b.isActive ?? null]);
    if (!r.rows[0]) throw new ApiError(404, 'not found or not permitted'); return { node: r.rows[0] };
  });
});
