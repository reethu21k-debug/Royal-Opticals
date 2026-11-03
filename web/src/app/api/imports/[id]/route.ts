import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { clampPage } from '@/lib/rules';
export const dynamic = 'force-dynamic';
export const GET = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const sp = req.nextUrl.searchParams; const { page, size, offset } = clampPage(sp.get('page'), sp.get('pageSize'));
  return withActor(actor, async c => {
    const b = (await c.query('select id, filename, status, total_source_records, imported_records, held_records, created_at, approved_at, rolled_back_at, destination_node_id, summary, file_sha256 from import_batches where id = $1', [id])).rows[0];
    if (!b) throw new ApiError(404, 'not found');
    const rows = (await c.query(`select source_cell, status, hold_reason, source_payload->>'rowLabelRaw' as row_label, source_payload->>'colLabelRaw' as col_label,
        source_payload->>'targetRaw' as target_raw, source_payload->>'stockRaw' as stock_raw, source_payload->'flags' as flags
      from import_records where import_batch_id = $1 order by id limit $2 offset $3`, [id, size, offset])).rows;
    const byStatus = (await c.query('select status, count(*)::int n from import_records where import_batch_id = $1 group by 1', [id])).rows;
    return { batch: b, page, pageSize: size, byStatus, records: rows };
  });
});
