import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { z } from 'zod';
import { uuid } from '@/lib/validation';
const FN: Record<string, string> = { submit: 'submit_count_session', approve: 'approve_count_session', cancel: 'cancel_count_session', reopen: 'reopen_count_session' };
export const POST = route(async (req, actor, { params }) => {
  const id = uuid.parse(params.id); const { action } = z.object({ action: z.enum(['submit', 'approve', 'cancel', 'reopen']) }).parse(await req.json());
  const fn = FN[action]; if (!fn) throw new ApiError(400, 'bad action');
  return withActor(actor, async c => ({ session: (await c.query(`select * from ${fn}($1)`, [id])).rows[0] }));
});
