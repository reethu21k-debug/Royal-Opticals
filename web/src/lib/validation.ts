import { z } from 'zod';
export const uuid = z.string().uuid();
export const qty = z.number().int().positive().max(1_000_000);
export const MovementBody = z.object({ variantId: uuid, quantity: qty, reason: z.string().trim().max(500).optional(), idempotencyKey: uuid });
export const CountBody = z.object({ variantId: uuid, count: z.number().int().min(0).max(1_000_000), reason: z.string().trim().min(1).max(500), idempotencyKey: uuid });
export const TargetBody = z.object({ variantId: uuid, target: z.number().int().min(0).max(1_000_000), reason: z.string().trim().max(500).optional() });
export const InventoryQuery = z.object({
  nodeId: uuid.optional(), q: z.string().trim().max(100).optional(),
  status: z.enum(['stock_unknown', 'unverified', 'out_of_stock', 'below_target', 'ok']).optional(),
  page: z.coerce.number().optional(), pageSize: z.coerce.number().optional(),
  sphMin: z.coerce.number().min(-60).max(60).optional(), sphMax: z.coerce.number().min(-60).max(60).optional(),
  cylMin: z.coerce.number().min(-60).max(60).optional(), cylMax: z.coerce.number().min(-60).max(60).optional(),
  addMin: z.coerce.number().min(-60).max(60).optional(), addMax: z.coerce.number().min(-60).max(60).optional(),
  active: z.enum(['active', 'archived', 'all']).optional(), net: z.enum(['0', '1']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),   // list order: asc (default, catalogue order) or desc (reversed)
  order: z.enum(['sph']).optional(),         // 'sph' = Inventory page only: SPH-first order inside KRIPTOK LENS / PROGRESSIVE LENS. Absent = unchanged.
});
export const PoCreateBody = z.object({
  supplierId: uuid, poNumber: z.string().trim().min(1).max(40), expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(1000).optional(),
  items: z.array(z.object({ variantId: uuid, quantity: qty, suggestedQuantity: z.number().int().min(0).optional(), unitCost: z.number().min(0).optional() })).min(1).max(500),
});
export const PoReceiveBody = z.object({ receiptNumber: z.string().trim().min(1).max(40), idempotencyKey: uuid,
  items: z.array(z.object({ itemId: uuid, quantity: qty })).min(1) });
export const ReviewDecision = z.object({ status: z.enum(['approved', 'rejected', 'needs_info']), note: z.string().trim().min(1).max(1000) });
export const SupplierBody = z.object({ supplierName: z.string().trim().min(1).max(120), supplierCode: z.string().max(40).optional(), contactPerson: z.string().max(120).optional(),
  phone: z.string().max(40).optional(), email: z.string().email().optional(), address: z.string().max(500).optional(), notes: z.string().max(1000).optional() });
// ───────── billing ─────────
const power = z.number().min(-60).max(60).nullish();
export const BillItemBody = z.object({
  lineNo: z.number().int().min(1).max(200), side: z.enum(['R', 'L']), source: z.enum(['inventory', 'external']),
  variantId: uuid.nullish(), lensType: z.string().trim().max(200).optional(),
  sph: power, cyl: power, add: power, axis: z.number().int().min(0).max(180).nullish(),
  quantity: z.number().int().positive().max(1000), rate: z.number().min(0).max(10_000_000),
});
export const BillBody = z.object({
  customerName: z.string().trim().max(200).optional(), billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  oldBalance: z.number().min(-100_000_000).max(100_000_000).optional(), returnAmount: z.number().min(0).max(100_000_000).optional(),
  advanceAmount: z.number().min(0).max(100_000_000).optional(), notes: z.string().trim().max(1000).optional(),
  items: z.array(BillItemBody).max(400), finalize: z.boolean().optional(), idempotencyKey: uuid.optional(),
});
export const BillAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('finalize') }),
  z.object({ action: z.literal('void'), reason: z.string().trim().min(1).max(500) }),
]);
export const BillLensQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sph: z.coerce.number().min(-60).max(60).optional(), cyl: z.coerce.number().min(-60).max(60).optional(), add: z.coerce.number().min(-60).max(60).optional(),
  dir: z.enum(['asc', 'desc']).optional(),   // result order: asc (default) or desc
});
export const BillRename = z.object({ customerName: z.string().trim().max(200) });
export const CustomerRename = z.object({ from: z.string().trim().min(1).max(200), to: z.string().trim().min(1).max(200) });
export const BillDelete = z.object({ ids: z.array(uuid).min(1).max(200) });