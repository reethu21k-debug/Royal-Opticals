import { route } from '@/lib/http';
import { withActor } from '@/lib/db';
export const dynamic = 'force-dynamic';

// The whole group hierarchy in ONE request (categories, folders, workbooks, grids) plus every supplier link that sits on a group.
// The Suppliers page uses it to search and tick groups without drilling into folders level by level.
// `lenses` is the number of lenses in each group's whole subtree (same rule as /api/catalog).
export const GET = route(async (_req, actor) => withActor(actor, async c => {
  const nodes = (await c.query(`select id, parent_id, kind, source_name from catalog_nodes where is_active order by (kind = 'workbook'), source_name`)).rows as
    { id: string; parent_id: string | null; kind: string; source_name: string }[];
  const own = (await c.query(`select block_node_id as id, count(*)::int as n from lens_variants group by block_node_id`)).rows as { id: string; n: number }[];
  const links = (await c.query(`select ps.id, ps.node_id, ps.supplier_id, s.supplier_name, ps.is_preferred, ps.supplier_product_code
      from product_suppliers ps join suppliers s on s.id = ps.supplier_id where ps.node_id is not null order by s.supplier_name`)).rows;

  const parentOf = new Map(nodes.map(n => [n.id, n.parent_id] as const));
  const total = new Map<string, number>();
  for (const { id, n } of own) {
    let cur: string | null | undefined = id; let guard = 0;
    while (cur && parentOf.has(cur) && guard++ < 64) { total.set(cur, (total.get(cur) ?? 0) + n); cur = parentOf.get(cur); }
  }
  return { nodes: nodes.map(n => ({ id: n.id, parentId: n.parent_id, kind: n.kind, name: n.source_name, lenses: total.get(n.id) ?? 0 })), links };
}));