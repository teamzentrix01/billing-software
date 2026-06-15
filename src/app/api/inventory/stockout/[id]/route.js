import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockOutSchema();
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const res = await query(
      `SELECT s.id, s.method, s.destination_id, s.meta, s.status, s.created_at,
              s.purchase_order_id, s.vendor_name, s.invoice_number, s.invoice_date,
              s.other_charges, s.remarks, s.reason, s.grn_id,
              s.transaction_id, s.apply_taxes, s.add_products_prefill, st.name AS destination_name
       FROM stock_out s
       LEFT JOIN stores st ON st.id = s.destination_id
       WHERE s.id = $1`,
      [id]
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const row = res.rows[0];
    const storeCheck = requireStore(auth.user, row.destination_id);
    if (storeCheck.error) return storeCheck.error;

    const itemsRes = await query(
      `SELECT
        soi.id,
        soi.product_id,
        soi.product_name,
        soi.qty,
        soi.cost_price,
        soi.tax_value,
        soi.batch_id,
        soi.batch_no,
        soi.expiry_date,
        p.sku,
        p.barcode,
        COALESCE(ib.mrp, 0) AS mrp,
        COALESCE(NULLIF(ib.meta->>'sellingPrice', '')::numeric, 0) AS selling_price
      FROM stock_out_items soi
      LEFT JOIN products p ON p.id = soi.product_id
      LEFT JOIN inventory_batches ib ON ib.id = soi.batch_id
      WHERE soi.stock_out_id = $1
      ORDER BY soi.id ASC`,
      [id]
    );

    const meta = typeof row.meta === 'object' ? row.meta : {};
    return NextResponse.json({
      id: row.id,
      transactionId: row.transaction_id || `STKO-${String(row.id).padStart(4, '0')}`,
      method: row.method,
      destination: row.destination_id,
      destinationName: row.destination_name || 'All',
      status: row.status || 'draft',
      applyTaxes: row.apply_taxes,
      addProductsPrefill: row.add_products_prefill,
      purchase_order_id: row.purchase_order_id || meta.purchaseOrderId || '',
      grn_id: row.grn_id || meta.grnId || '',
      vendor_name: row.vendor_name || meta.vendor || '',
      invoice_number: row.invoice_number || meta.invoiceNumber || '',
      invoice_date: row.invoice_date ? String(row.invoice_date).slice(0, 10) : '',
      other_charges: row.other_charges ?? meta.other_charges ?? '',
      remarks: row.remarks || meta.remarks || '',
      reason: row.reason || meta.reason || '',
      meta,
      items: itemsRes.rows.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        name: item.product_name,
        sku: item.sku || '',
        barcode: item.barcode || '',
        qty: Number(item.qty || 0),
        cost_price: Number(item.cost_price || 0),
        tax_value: Number(item.tax_value || 0),
        batch_id: item.batch_id || null,
        batch_no: item.batch_no || '',
        expiry_date: item.expiry_date ? String(item.expiry_date).slice(0, 10) : '',
        mrp: Number(item.mrp || 0),
        selling_price: Number(item.selling_price || 0),
      })),
    });
  } catch (err) {
    console.error('[stockout GET id]', err.message);
    return NextResponse.json({ error: 'Failed to load stock out' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockOutSchema();
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const currentRes = await query(
      `SELECT id, destination_id FROM stock_out WHERE id = $1`,
      [id]
    );
    if (!currentRes.rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const storeCheck = requireStore(auth.user, currentRes.rows[0].destination_id);
    if (storeCheck.error) return storeCheck.error;

    const otherCharges = Number(body.other_charges || 0);
    if (!Number.isFinite(otherCharges) || otherCharges < 0) {
      return NextResponse.json({ error: 'Other charges must be a valid amount' }, { status: 400 });
    }

    const itemTotals = await query(
      `SELECT
        COALESCE(SUM(qty), 0) AS total_items,
        COALESCE(SUM(qty * cost_price), 0) AS items_cost,
        COALESCE(SUM(qty * tax_value), 0) AS total_tax
      FROM stock_out_items
      WHERE stock_out_id = $1`,
      [id]
    );
    const totals = itemTotals.rows[0] || {};

    await query(
      `UPDATE stock_out SET
        vendor_name = $1,
        invoice_date = $2,
        invoice_number = $3,
        purchase_order_id = $4,
        other_charges = $5,
        remarks = $6,
        reason = $7,
        grn_id = $8,
        total_items = $9,
        total_cost = $10,
        total_tax = $11,
        meta = meta || $12::jsonb
      WHERE id = $13`,
      [
        body.vendor || body.vendor_name || null,
        body.invoice_date || null,
        body.invoice_number || null,
        body.purchase_order_id || null,
        otherCharges,
        body.remarks || null,
        body.reason || null,
        body.grn_id || null,
        Number(totals.total_items || 0),
        Number(totals.items_cost || 0) + otherCharges,
        Number(totals.total_tax || 0),
        JSON.stringify({
          vendor: body.vendor || body.vendor_name || null,
          invoice_date: body.invoice_date || null,
          invoice_number: body.invoice_number || null,
          purchase_order_id: body.purchase_order_id || null,
          other_charges: otherCharges,
          remarks: body.remarks || null,
          reason: body.reason || null,
          grn_id: body.grn_id || null,
        }),
        id,
      ]
    );

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[stockout PUT id]', err.message);
    return NextResponse.json({ error: 'Failed to update stock out' }, { status: 500 });
  }
}
