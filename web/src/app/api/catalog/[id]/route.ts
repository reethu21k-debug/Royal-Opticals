import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
import { decodeJwt } from 'jose';
// name: rename the node (folder / file / grid at any level). It is changed in one place (catalog_nodes.source_name) that every screen, export and
// report reads live, so it shows up app-wide. The original imported name is kept in original_name; { restoreOriginal: true } puts it back.
// displayLabel / isActive behave as before.
const Body = z.object({
  name: z.string().max(200).optional(), restoreOriginal: z.boolean().optional(),
  displayLabel: z.string().max(200).nullable().optional(), isActive: z.boolean().optional(),
  confirmEmail: z.string().max(254).optional(), confirmEmail2: z.string().max(254).optional(),   // required when archiving (isActive: false)
}).refine(b => b.name !== undefined || b.restoreOriginal || b.displayLabel !== undefined || b.isActive !== undefined, 'nothing to change');
export const PATCH = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const b = Body.parse(await req.json());
  // Archiving a folder must be authorised by typing the signed-in user's own email address twice. The session token was already verified by route();
  // its email claim is what the typed address is compared with (case-insensitive). Re-activating a folder needs nothing.
  if (b.isActive === false) {
    const tok = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || req.cookies.get('ro_session')?.value || '';
    let me = ''; try { me = String(decodeJwt(tok).email ?? '').trim().toLowerCase(); } catch { /* handled below */ }
    const a = (b.confirmEmail ?? '').trim().toLowerCase(), a2 = (b.confirmEmail2 ?? '').trim().toLowerCase();
    if (!a || !a2) throw new ApiError(400, 'enter your email address in both boxes to confirm');
    if (a !== a2) throw new ApiError(400, 'the two email addresses do not match');
    if (!me || a !== me) throw new ApiError(403, 'that is not the email address of the account you are signed in with');
  }
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