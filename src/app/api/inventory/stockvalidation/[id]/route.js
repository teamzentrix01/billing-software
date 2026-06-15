import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensureStockValidationSchema } from '@/lib/stockValidationSchema';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockValidationSchema();
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const res = await query(
      `SELECT
        sv.id,
        sv.transaction_id,
        sv.destination_id,
        sv.apply_taxes,
        sv.status,
        sv.invoice_number,
        sv.invoice_date,
        sv.other_charges,
        sv.remarks,
        sv.meta,
        stores.name AS destination_name
      FROM stock_validation sv
      LEFT JOIN stores ON stores.id = sv.destination_id
      WHERE sv.id = $1`,
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
        svi.id,
        svi.product_id,
        svi.product_name,
        svi.qty,
        svi.cost_price,
        svi.tax_value,
        svi.batch_id,
        p.sku,
        p.barcode,
        ib.batch_no,
        ib.expiry_date,
        COALESCE(ib.available_qty, 0) AS available_qty,
        COALESCE(ib.mrp, 0) AS mrp,
        COALESCE(NULLIF(ib.meta->>'sellingPrice', '')::numeric, 0) AS selling_price
      FROM stock_validation_items svi
      LEFT JOIN products p ON p.id = svi.product_id
      LEFT JOIN inventory_batches ib ON ib.id = svi.batch_id
      WHERE svi.stock_validation_id = $1
      ORDER BY svi.id ASC`,
      [id]
    );

    const meta = typeof row.meta === 'object' ? row.meta : {};
    return NextResponse.json({
      id: row.id,
      transactionId: row.transaction_id || `AUD-${String(row.id).padStart(4, '0')}`,
      destination: row.destination_id || meta.destination || 'none',
      destinationName: row.destination_name || 'None',
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
        sku: item.sku || '',
        barcode: item.barcode || '',
        qty: Number(item.qty || 0),
        existing_qty: Number(item.available_qty || 0),
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
    console.error('[stockvalidation GET id]', err.message);
    return NextResponse.json({ error: 'Failed to load stock validation' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockValidationSchema();
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const currentRes = await query(
      `SELECT id, destination_id FROM stock_validation WHERE id = $1`,
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
      FROM stock_validation_items
      WHERE stock_validation_id = $1`,
      [id]
    );
    const totals = itemTotals.rows[0] || {};

    await query(
      `UPDATE stock_validation SET
        invoice_date = $1,
        invoice_number = $2,
        other_charges = $3,
        remarks = $4,
        total_items = $5,
        total_cost = $6,
        total_tax = $7,
        meta = meta || $8::jsonb
      WHERE id = $9`,
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

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[stockvalidation PUT id]', err.message);
    return NextResponse.json({ error: 'Failed to update stock validation' }, { status: 500 });
  }
}
