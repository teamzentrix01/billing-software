import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import { appendStoreScope, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(request) {
  try {
    await ensureStockTransferSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const params = [];
    const whereClauses = [`st.status = 'confirmed'`];
    const scope = appendStoreScope(whereClauses, params, 'st.destination_id', auth.user);
    if (scope.error) return scope.error;

    const res = await query(
      `SELECT
        st.id,
        st.transaction_id,
        st.invoice_number,
        st.invoice_date,
        st.other_charges,
        st.total_items,
        st.total_cost,
        st.total_tax,
        st.created_at,
        st.reverted_at,
        source.name AS source_name,
        destination.name AS destination_name,
        COALESCE(SUM(sti.qty), 0) AS item_qty_sum,
        COALESCE(SUM(sti.qty * sti.cost_price), 0) AS items_cost_sum
      FROM stock_transfer st
      LEFT JOIN stores source ON source.id = st.source_id
      LEFT JOIN stores destination ON destination.id = st.destination_id
      LEFT JOIN stock_transfer_items sti ON sti.stock_transfer_id = st.id
      WHERE ${whereClauses.join(' AND ')}
      GROUP BY st.id, source.name, destination.name
      ORDER BY st.confirmed_at DESC NULLS LAST, st.created_at DESC
      LIMIT 200`,
      params
    );

      return NextResponse.json(
      res.rows.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id || `TRN-${String(row.id).padStart(4, '0')}`,
        invoiceNumber: row.invoice_number || '-',
        sourceName: row.source_name || '-',
        destinationName: row.destination_name || '-',
        invoiceDate: row.invoice_date,
        totalItems: Number(row.total_items || row.item_qty_sum || 0),
        cost: Number(row.total_cost || Number(row.items_cost_sum || 0) + Number(row.other_charges || 0)),
        totalTax: Number(row.total_tax || 0),
        revertedAt: row.reverted_at,
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    console.error('[stocktransfer GET]', err.message);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request) {
  try {
    await ensureStockTransferSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const payload = await request.json();
    const sourceId = payload.source ? Number(payload.source) : null;
    const destinationId = payload.destination ? Number(payload.destination) : null;
    if ((!sourceId || !destinationId) && auth.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Source and destination stores are required for your account' }, { status: 403 });
    }
    for (const storeId of [sourceId, destinationId].filter(Boolean)) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) return storeCheck.error;
    }

    const client = await getClient();

    try {
      await client.query('BEGIN');
      const res = await client.query(
        `INSERT INTO stock_transfer (
          source_id, destination_id, apply_taxes, meta, status, created_at
        ) VALUES ($1, $2, $3, $4, 'draft', NOW())
        RETURNING id`,
        [
          sourceId,
          destinationId,
          payload.applyTaxes ?? true,
          JSON.stringify(payload),
        ]
      );

      const id = res.rows[0].id;
      const transactionId = `TRN-${String(id).padStart(4, '0')}`;
      await client.query('UPDATE stock_transfer SET transaction_id = $1 WHERE id = $2', [transactionId, id]);
      await client.query('COMMIT');
      return NextResponse.json({ id, transactionId }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[stocktransfer POST]', err.message);
    return NextResponse.json({ error: 'Failed to create stock transfer' }, { status: 500 });
  }
}
