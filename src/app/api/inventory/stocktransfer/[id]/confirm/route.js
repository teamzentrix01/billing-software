import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy, receiveBatchStock } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumericId(value) {
  const raw = String(value ?? '').trim();
  const leading = raw.match(/^\d+/)?.[0];
  return Number(leading || raw || 0);
}

function toBatchId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.match(/\d+/g) || [];
  const id = Number(parts.length > 1 ? parts[parts.length - 1] : parts[0]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function POST(request, { params }) {
  const { id } = await params;
    try {
      await ensureStockTransferSchema();
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

      const draft = await client.query('SELECT id, status, source_id, destination_id, transaction_id FROM stock_transfer WHERE id = $1 FOR UPDATE', [id]);
      if (draft.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 });
      }
      if (draft.rows[0].status === 'confirmed') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
      }
      for (const storeId of [draft.rows[0].source_id, draft.rows[0].destination_id].filter(Boolean)) {
        const storeCheck = requireStore(auth.user, storeId);
        if (storeCheck.error) {
          await client.query('ROLLBACK');
          return storeCheck.error;
        }
      }

      await client.query('DELETE FROM stock_transfer_items WHERE stock_transfer_id = $1', [id]);
      for (const item of items) {
        const productId = toNumericId(item.product_id || item.productId);
        if (!productId) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Invalid product id in transfer item' }, { status: 400 });
        }
        const transferItemRes = await client.query(
          `INSERT INTO stock_transfer_items (
            stock_transfer_id, product_id, product_name, sku, barcode, qty,
            cost_price, mrp, selling_price, destination_mrp, tax_value, meta,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
          RETURNING id`,
          [
            id,
            productId,
            item.name || item.product_name || null,
            item.sku || null,
            item.barcode || null,
            item.qty,
            item.cost_price || 0,
            item.mrp || 0,
            item.selling_price || item.sellingPrice || 0,
            item.destination_mrp || item.destinationMrp || item.mrp || 0,
            item.tax_value || 0,
            JSON.stringify(item.meta || {}),
          ]
        );
        const transferItemId = transferItemRes.rows[0]?.id;
        const allocations = await allocateBatchStock(client, {
          productId,
          storeId: draft.rows[0].source_id,
          qty: item.qty,
          preferredBatchId: toBatchId(item.batch_id || item.batchId),
          strategy: getInventoryIssueStrategy(form.issue_strategy),
          referenceType: 'stock_transfer',
          referenceId: id,
          sourceItemId: transferItemId,
          meta: { direction: 'source', transactionId: draft.rows[0].transaction_id || null },
        });

        for (const allocation of allocations) {
          await receiveBatchStock(client, {
            stockInId: id,
            stockInItemId: transferItemId,
            productId,
            storeId: draft.rows[0].destination_id,
            qty: allocation.qty,
            costPrice: allocation.costPrice || item.cost_price || 0,
            batchNo: allocation.batchNo,
            mfgDate: allocation.mfgDate,
            expiryDate: allocation.expiryDate,
            meta: {
              source: 'stock_transfer',
              sourceStoreId: draft.rows[0].source_id,
              transferId: id,
              sourceBatchId: allocation.batchId,
              mrp: item.destination_mrp || item.destinationMrp || allocation.mrp || item.mrp || 0,
              sellingPrice: item.selling_price || item.sellingPrice || allocation.sellingPrice || 0,
              costPrice: allocation.costPrice || item.cost_price || 0,
            },
          });
        }
      }

      await client.query(
        `UPDATE stock_transfer SET
          status = 'confirmed',
          invoice_date = $1,
          invoice_number = $2,
          other_charges = $3,
          remarks = $4,
          total_items = $5,
          total_cost = $6,
          total_tax = $7,
          meta = meta || $8::jsonb,
          confirmed_at = NOW()
        WHERE id = $9`,
        [
          form.invoice_date || null,
          form.invoice_number || null,
          Number(form.other_charges || 0),
          form.remarks || null,
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
    console.error('[stocktransfer confirm]', err.stack || err.message);
    return NextResponse.json({ error: err.message || 'Failed to confirm stock transfer' }, { status: 500 });
  }
}
