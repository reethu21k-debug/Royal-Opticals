import PDFDocument from 'pdfkit';
import { route, ApiError } from '@/lib/http';
import { withActor } from '@/lib/db';
import { uuid } from '@/lib/validation';
import { fmtPower } from '@/lib/power-format';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Purchase order as a PDF file. Lens labels are printed exactly as stored (including leading spaces / signs).
export const GET = route(async (_r, actor, { params }) => {
  const id = uuid.parse(params.id);
  const { po, items } = await withActor(actor, async c => {
    const po = (await c.query(`select p.po_number, p.status::text, p.order_date, p.expected_date, p.notes, s.supplier_name, s.contact_person, s.phone, s.email, s.address
      from purchase_orders p join suppliers s on s.id = p.supplier_id where p.id = $1`, [id])).rows[0];
    if (!po) throw new ApiError(404, 'not found');
    const items = (await c.query(`select lv.row_label_source, lv.col_label_source, node_path(lv.block_node_id) as path, i.quantity_ordered, i.quantity_received from purchase_order_items i
      join lens_variants lv on lv.id = i.variant_id where i.purchase_order_id = $1 order by lv.ord, lv.id`, [id])).rows;
    return { po, items };
  });
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Purchase order ${po.po_number}` } }); const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b)); const done = new Promise<void>(res => doc.on('end', () => res()));
  doc.fontSize(18).text(`Purchase order ${po.po_number}`).moveDown(0.3).fontSize(10).fillColor('#444')
    .text(`Status: ${po.status}    Order date: ${String(po.order_date).slice(0, 10)}${po.expected_date ? '    Expected: ' + String(po.expected_date).slice(0, 10) : ''}`).fillColor('#000').moveDown(0.6);
  doc.fontSize(11).text(`Supplier: ${po.supplier_name}`); for (const l of [po.contact_person, po.phone, po.email, po.address]) if (l) doc.fontSize(9).text(String(l)); doc.moveDown(0.8);
  const x = [40, 330, 400, 470, 540]; const head = () => { const y = doc.y; doc.fontSize(9).font('Helvetica-Bold').text('Item (as in the source files)', x[0], y, { width: 285 }).text('Ordered', x[1], y, { width: 60, align: 'right' }).text('Received', x[2], y, { width: 60, align: 'right' }).text('Outstanding', x[3], y, { width: 65, align: 'right' }); doc.font('Helvetica').moveDown(0.3); doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke(); doc.moveDown(0.3); };
  head(); let tot = { o: 0, r: 0 };
  for (const it of items) {
    if (doc.y > 770) { doc.addPage(); head(); }
    const y = doc.y; const label = `${fmtPower(it.row_label_source)}${it.col_label_source ? '  x  ' + fmtPower(it.col_label_source) : ''}`; tot.o += it.quantity_ordered; tot.r += it.quantity_received;
    doc.fontSize(9).text(label, x[0], y, { width: 285 }).text(String(it.quantity_ordered), x[1], y, { width: 60, align: 'right' }).text(String(it.quantity_received), x[2], y, { width: 60, align: 'right' }).text(String(it.quantity_ordered - it.quantity_received), x[3], y, { width: 65, align: 'right' });
    doc.fontSize(7).fillColor('#666').text(String(it.path), x[0], doc.y, { width: 285 }).fillColor('#000').moveDown(0.2);
  }
  doc.moveDown(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown(0.3).fontSize(10).font('Helvetica-Bold')
    .text(`Total ordered ${tot.o}   received ${tot.r}   outstanding ${tot.o - tot.r}`, 40, doc.y, { width: 515, align: 'right' }).font('Helvetica');
  if (po.notes) doc.moveDown().fontSize(9).text(`Notes: ${po.notes}`, 40, doc.y, { width: 515 });
  doc.end(); await done;
  return new Response(Buffer.concat(chunks), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="PO-${String(po.po_number).replace(/[^\w.-]+/g, '_')}.pdf"` } });
});