import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function POST(request, { params }) {
  const { id } = await params;
    try {
      await ensureStockOutSchema();
      await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const form = body.form || {};
    const items = body.items || [];

    if (!items.length) {
      return NextResponse.json({ error: 'Add at least one product' }, { status: 400 });
    }

    let totalItems = 0;
    let totalCost = Number(form.other_charges || 0);
    let totalTax = 0;

    for (const item of items) {
      const qty = Number(item.qty || 0);
      const cost = Number(item.cost_price || 0);
      const tax = Number(item.tax_value || 0);
      if (!Number(item.product_id)) {
        return NextResponse.json({ error: 'Each item must have a product' }, { status: 400 });
      }
      if (qty <= 0) {
        return NextResponse.json({ error: 'Quantity must be greater than zero' }, { status: 400 });
      }
      totalItems += qty;
      totalCost += qty * cost;
      totalTax += tax * qty;
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const draft = await client.query('SELECT id, status, method, destination_id, transaction_id FROM stock_out WHERE id = $1 FOR UPDATE', [id]);
      if (draft.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Stock out not found' }, { status: 404 });
      }
      if (draft.rows[0].status === 'confirmed') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
      }
      if (draft.rows[0].method === 'return_warehouse' && auth.user.role !== 'super_admin') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Only super admin can return stock to warehouse' }, { status: 403 });
      }
      const storeCheck = requireStore(auth.user, draft.rows[0].destination_id);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }

      const productIds = [...new Set(items.map((item) => Number(item.product_id)).filter(Boolean))];
      const productsRes = productIds.length
        ? await client.query('SELECT id, name FROM products WHERE id = ANY($1::int[])', [productIds])
        : { rows: [] };
      const productMap = new Map(productsRes.rows.map((row) => [Number(row.id), row]));
      const missingProducts = productIds.filter((productId) => !productMap.has(productId));
      if (missingProducts.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Products not found in catalog: IDs ${missingProducts.join(', ')}` },
          { status: 422 }
        );
      }

      await client.query('DELETE FROM stock_out_items WHERE stock_out_id = $1', [id]);

      for (const item of items) {
        const allocations = await allocateBatchStock(client, {
          productId: item.product_id,
          storeId: draft.rows[0].destination_id,
          qty: item.qty,
          strategy: getInventoryIssueStrategy(form.issue_strategy),
          referenceType: 'stock_out',
          referenceId: id,
          meta: { transactionId: draft.rows[0].transaction_id || null },
        });

        for (const allocation of allocations) {
          await client.query(
            `INSERT INTO stock_out_items (
               stock_out_id, product_id, product_name, qty, cost_price, tax_value,
               batch_id, batch_no, expiry_date, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              id,
              item.product_id,
              productMap.get(Number(item.product_id))?.name || item.name || null,
              allocation.qty,
              allocation.costPrice || item.cost_price || 0,
              item.tax_value || 0,
              allocation.batchId,
              allocation.batchNo,
              allocation.expiryDate,
            ]
          );
        }
      }

      await client.query(
        `UPDATE stock_out SET
          status = 'confirmed',
          vendor_name = $1,
          invoice_date = $2,
          invoice_number = COALESCE($3, invoice_number),
          purchase_order_id = COALESCE($4, purchase_order_id),
          other_charges = $5,
          remarks = $6,
          reason = $7,
          grn_id = COALESCE($8, grn_id),
          total_items = $9,
          total_cost = $10,
          total_tax = $11,
          meta = meta || $12::jsonb,
          confirmed_at = NOW()
        WHERE id = $13`,
        [
          form.vendor || null,
          form.invoice_date || null,
          form.invoice_number || null,
          form.purchase_order_id || null,
          Number(form.other_charges || 0),
          form.remarks || null,
          form.reason || null,
          form.grn_id || form.grnId || null,
          totalItems,
          totalCost,
          totalTax,
          JSON.stringify(form),
          id,
        ]
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, id, totalItems, totalCost, totalTax });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[stockout confirm]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to confirm stock out' }, { status: 500 });
  }
}
