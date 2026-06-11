import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import {
  allocateBatchStock,
  ensureInventoryBatchSchema,
  receiveBatchStock,
} from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(request, { params }) {
  const { id } = await params;
  let client;

  try {
    await ensureStockTransferSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    client = await getClient();
    await client.query('BEGIN');

    const transferRes = await client.query(
      `SELECT id, status, source_id, destination_id, transaction_id, reverted_at
       FROM stock_transfer
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    const transfer = transferRes.rows[0];
    if (!transfer) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Stock transfer not found' }, { status: 404 });
    }
    if (transfer.status !== 'confirmed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Only confirmed stock transfers can be reverted' }, { status: 400 });
    }
    if (transfer.reverted_at) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This stock transfer is already reverted' }, { status: 409 });
    }

    for (const storeId of [transfer.source_id, transfer.destination_id].filter(Boolean)) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }
    }

    const itemsRes = await client.query(
      `SELECT id, product_id, product_name, qty, cost_price, mrp, selling_price, destination_mrp, meta
       FROM stock_transfer_items
       WHERE stock_transfer_id = $1
       ORDER BY id ASC`,
      [id],
    );
    if (!itemsRes.rows.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'No items found for this transfer' }, { status: 400 });
    }

    let totalQty = 0;
    for (const item of itemsRes.rows) {
      const qty = toNumber(item.qty);
      if (qty <= 0) continue;
      totalQty += qty;

      const allocations = await allocateBatchStock(client, {
        productId: item.product_id,
        storeId: transfer.destination_id,
        qty,
        referenceType: 'stock_transfer_revert',
        referenceId: id,
        sourceItemId: item.id,
        meta: {
          direction: 'destination_reversal',
          originalTransferId: transfer.id,
          transactionId: transfer.transaction_id || null,
        },
      });

      for (const allocation of allocations) {
        await receiveBatchStock(client, {
          stockInId: id,
          stockInItemId: item.id,
          productId: item.product_id,
          storeId: transfer.source_id,
          qty: allocation.qty,
          costPrice: allocation.costPrice || item.cost_price || 0,
          batchNo: allocation.batchNo,
          mfgDate: allocation.mfgDate,
          expiryDate: allocation.expiryDate,
          meta: {
            source: 'stock_transfer_revert',
            originalTransferId: transfer.id,
            originalTransferItemId: item.id,
            sourceBatchId: allocation.batchId,
            productName: item.product_name || '',
            costPrice: allocation.costPrice || item.cost_price || 0,
            mrp: allocation.mrp || item.mrp || item.destination_mrp || 0,
            sellingPrice: allocation.sellingPrice || item.selling_price || 0,
          },
        });
      }
    }

    await client.query(
      `UPDATE stock_transfer
       SET status = 'reverted',
           reverted_at = NOW(),
           reverted_by = $1,
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
       WHERE id = $3`,
      [
        auth.user.id || null,
        JSON.stringify({
          reverted: true,
          revertedAt: new Date().toISOString(),
          revertedBy: auth.user.id || null,
        }),
        id,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true, id: Number(id), totalQty });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[stocktransfer revert]', err.stack || err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to revert stock transfer' },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
