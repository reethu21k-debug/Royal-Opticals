import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
// name: rename the node (folder / file / grid at any level). It is changed in one place (catalog_nodes.source_name) that every screen, export and
// report reads live, so it shows up app-wide. The original imported name is kept in original_name; { restoreOriginal: true } puts it back.
// displayLabel / isActive behave as before.
const Body = z.object({
  name: z.string().max(200).optional(), restoreOriginal: z.boolean().optional(),
  displayLabel: z.string().max(200).nullable().optional(), isActive: z.boolean().optional(),
}).refine(b => b.name !== undefined || b.restoreOriginal || b.displayLabel !== undefined || b.isActive !== undefined, 'nothing to change');
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  return withActor(actor, async c => {
    if (b.restoreOriginal || b.name !== undefined) {
      const target = b.restoreOriginal ? (await c.query('select original_name from catalog_nodes where id = $1', [id])).rows[0]?.original_name : b.name;
      if (target === undefined || target === null) throw new ApiError(404, 'not found or not permitted');
      await c.query('select rename_catalog_node($1, $2)', [id, target]);
    }
    const r = await c.query(`update catalog_nodes set display_label = case when $2::boolean then $3 else display_label end, is_active = coalesce($4, is_active) where id = $1 returning id, kind, source_name, original_name, display_label, is_active`,
      [id, b.displayLabel !== undefined, b.displayLabel ?? null, b.isActive ?? null]);
    if (!r.rows[0]) throw new ApiError(404, 'not found or not permitted'); return { node: r.rows[0] };
  });
});