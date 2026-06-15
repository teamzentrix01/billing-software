import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockTransferSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const res = await query(
      `SELECT
        st.id,
        st.transaction_id,
        st.source_id,
        st.destination_id,
        st.apply_taxes,
        st.status,
        st.invoice_number,
        st.invoice_date,
        st.other_charges,
        st.remarks,
        st.meta,
        source.name AS source_name,
        destination.name AS destination_name
      FROM stock_transfer st
      LEFT JOIN stores source ON source.id = st.source_id
      LEFT JOIN stores destination ON destination.id = st.destination_id
      WHERE st.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const row = res.rows[0];
    const visibleStoreId = row.destination_id || row.source_id;
    const storeCheck = requireStore(auth.user, visibleStoreId);
    if (storeCheck.error) return storeCheck.error;

    const itemsRes = await query(
      `SELECT
        id,
        product_id,
        product_name,
        sku,
        barcode,
        qty,
        cost_price,
        mrp,
        selling_price,
        destination_mrp,
        tax_value,
        meta
      FROM stock_transfer_items
      WHERE stock_transfer_id = $1
      ORDER BY id ASC`,
      [id]
    );

    const meta = typeof row.meta === 'object' ? row.meta : {};
    return NextResponse.json({
      id: row.id,
      transactionId: row.transaction_id || `TRN-${String(row.id).padStart(4, '0')}`,
      source: row.source_id || meta.source || '',
      sourceName: row.source_name || '',
      destination: row.destination_id || meta.destination || '',
      destinationName: row.destination_name || '',
      applyTaxes: row.apply_taxes,
      status: row.status || 'draft',
      invoice_number: row.invoice_number || '',
      invoice_date: row.invoice_date ? String(row.invoice_date).slice(0, 10) : '',
      other_charges: row.other_charges ?? '',
      remarks: row.remarks || '',
      meta,
      items: itemsRes.rows.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        name: item.product_name,
        sku: item.sku,
        barcode: item.barcode,
        qty: Number(item.qty || 0),
        cost_price: Number(item.cost_price || 0),
        mrp: Number(item.mrp || 0),
        selling_price: Number(item.selling_price || 0),
        destination_mrp: Number(item.destination_mrp || 0),
        tax_value: Number(item.tax_value || 0),
        meta: typeof item.meta === 'object' ? item.meta : {},
      })),
    });
  } catch (err) {
    console.error('[stocktransfer GET id]', err.message);
    return NextResponse.json({ error: 'Failed to load stock transfer' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockTransferSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const currentRes = await query(
      `SELECT id, source_id, destination_id, status, reverted_at
      FROM stock_transfer
      WHERE id = $1`,
      [id]
    );
    if (currentRes.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const current = currentRes.rows[0];
    const visibleStoreId = current.destination_id || current.source_id;
    const storeCheck = requireStore(auth.user, visibleStoreId);
    if (storeCheck.error) return storeCheck.error;
    if (current.reverted_at) {
      return NextResponse.json({ error: 'Reverted stock transfers cannot be edited' }, { status: 400 });
    }

    const otherCharges = Number(body.other_charges || 0);
    if (!Number.isFinite(otherCharges) || otherCharges < 0) {
      return NextResponse.json({ error: 'Other charges must be a valid amount' }, { status: 400 });
    }

    const itemTotals = await query(
      `SELECT
        COALESCE(SUM(qty), 0) AS total_items,
        COALESCE(SUM(qty * cost_price), 0) AS items_cost,
        COALESCE(SUM(qty * tax_value), 0) AS total_tax
      FROM stock_transfer_items
      WHERE stock_transfer_id = $1`,
      [id]
    );
    const totals = itemTotals.rows[0] || {};

    const updated = await query(
      `UPDATE stock_transfer SET
        invoice_date = $1,
        invoice_number = $2,
        other_charges = $3,
        remarks = $4,
        total_items = $5,
        total_cost = $6,
        total_tax = $7,
        meta = meta || $8::jsonb
      WHERE id = $9
      RETURNING id`,
      [
        body.invoice_date || null,
        body.invoice_number || null,
        otherCharges,
        body.remarks || null,
        Number(totals.total_items || 0),
        Number(totals.items_cost || 0) + otherCharges,
        Number(totals.total_tax || 0),
        JSON.stringify({
          invoice_date: body.invoice_date || null,
          invoice_number: body.invoice_number || null,
          other_charges: otherCharges,
          remarks: body.remarks || null,
        }),
        id,
      ]
    );

    return NextResponse.json({ success: true, id: updated.rows[0].id });
  } catch (err) {
    console.error('[stocktransfer PUT id]', err.message);
    return NextResponse.json({ error: 'Failed to update stock transfer' }, { status: 500 });
  }
}
