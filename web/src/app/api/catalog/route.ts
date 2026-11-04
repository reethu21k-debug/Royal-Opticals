import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
// Children of a node (or the roots) with the number of variants in each child's whole subtree. Names are verbatim source names.
export const GET = route(async (req, actor) => {
  const parentId = req.nextUrl.searchParams.get('parentId');
  const pid = parentId ? uuid.parse(parentId) : null;
  return withActor(actor, async c => {
    const r = await c.query(`
      with recursive kids as (select id, id as root from catalog_nodes where parent_id is not distinct from $1::uuid
        union all select c.id, k.root from catalog_nodes c join kids k on c.parent_id = k.id)
      select n.id, n.kind, n.source_name, n.original_name, n.display_label, n.sort_order,
        (select count(*)::int from catalog_nodes x where x.parent_id = n.id and x.is_active) as child_count,
        (select count(*)::int from kids k join lens_variants lv on lv.block_node_id = k.id where k.root = n.id) as variant_count
      from catalog_nodes n where n.parent_id is not distinct from $1::uuid and n.is_active
      order by n.kind = 'workbook', n.source_name`, [pid]);
    return { items: r.rows };
  });
});

// Create a folder / family / workbook node (names are stored verbatim). Used for editing the hierarchy and for the production import.
const Create = z.object({ parentId: uuid.nullable(), name: z.string().min(1).max(200).refine(n => n.trim().length > 0, 'name required'), kind: z.enum(['family', 'folder', 'workbook']) });
export const POST = route(async (req, actor) => {
  const b = Create.parse(await req.json());
  return withActor(actor, async c => {
    const kind = b.parentId === null && b.kind === 'folder' ? 'family' : b.kind;
    const r = await c.query(`insert into catalog_nodes(organization_id,parent_id,kind,source_name,source_path)
      select (select app_org()), $1::uuid, $2::node_kind, $3, coalesce((select source_path from catalog_nodes where id = $1::uuid) || '/', '') || $3
      where $1::uuid is null or exists (select 1 from catalog_nodes where id = $1::uuid and kind in ('family','folder')) returning id, kind, source_name, source_path`, [b.parentId, kind, b.name]);
    if (!r.rows[0]) return Response.json({ error: 'parent must be an existing folder' }, { status: 400 });
    return { node: r.rows[0] };
  });
});