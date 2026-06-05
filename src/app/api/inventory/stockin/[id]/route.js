import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { toDateInputValue } from '@/lib/dateUtils';

function normalizeDate(value) {
  return toDateInputValue(value);
}

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockInSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const res = await query(
      `SELECT s.id, s.method, s.destination_id, s.meta, s.status, s.created_at,
              s.vendor_name, s.invoice_date, s.invoice_number, s.other_charges, s.remarks,
              s.apply_taxes, st.name AS destination_name, st.meta AS destination_meta
       FROM stock_in s
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

    const meta = typeof row.meta === 'object' ? row.meta : {};
    const destinationMeta = typeof row.destination_meta === 'object' ? row.destination_meta : {};
    const itemsRes = await query(
      `SELECT sii.id, sii.product_id, COALESCE(sii.product_name, p.name) AS product_name,
              p.sku, p.barcode, p.product_id AS catalog_product_id,
              sii.qty, sii.cost_price, sii.tax_value, sii.batch_no, sii.mfg_date, sii.expiry_date
       FROM stock_in_items sii
       LEFT JOIN products p ON p.id = sii.product_id
       WHERE sii.stock_in_id = $1
       ORDER BY sii.id`,
      [id]
    );

    return NextResponse.json({
      id: row.id,
      method: row.method,
      destination: row.destination_id,
      destinationName: row.destination_name,
      destinationLocationType: destinationMeta.locationType || 'Warehouse',
      status: row.status || 'draft',
      applyTaxes: row.apply_taxes,
      meta,
      vendor_name: row.vendor_name || meta.vendor || '',
      invoice_date: normalizeDate(row.invoice_date) || normalizeDate(meta.invoice_date),
      invoice_number: row.invoice_number || meta.invoice_number || '',
      other_charges: row.other_charges ?? meta.other_charges ?? '',
      remarks: row.remarks || meta.remarks || '',
      items: itemsRes.rows.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        name: item.product_name,
        sku: item.sku || item.barcode || item.catalog_product_id || '',
        qty: Number(item.qty || 0),
        cost_price: Number(item.cost_price || 0),
        tax_value: Number(item.tax_value || 0),
        batch_no: item.batch_no || '',
        mfg_date: normalizeDate(item.mfg_date),
        expiry_date: normalizeDate(item.expiry_date),
      })),
    });
  } catch (err) {
    console.error('[stockin GET id]', err.message);
    return NextResponse.json({ error: 'Failed to load stock in' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const { id } = await params;
  const client = await getClient();
  try {
    await ensureStockInSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];

    await client.query('BEGIN');
    const stockInRes = await client.query(
      `SELECT id, status, destination_id FROM stock_in WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const stockIn = stockInRes.rows[0];
    if (!stockIn) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (String(stockIn.status || '').toLowerCase() === 'confirmed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Confirmed stock in cannot be edited' }, { status: 409 });
    }

    const storeCheck = requireStore(auth.user, stockIn.destination_id);
    if (storeCheck.error) {
      await client.query('ROLLBACK');
      return storeCheck.error;
    }

    const productIds = [...new Set(items.map((item) => Number(item.product_id)).filter(Boolean))];
    const catalogRes = productIds.length
      ? await client.query(`SELECT id, name FROM products WHERE id = ANY($1::int[])`, [productIds])
      : { rows: [] };
    const catalogMap = new Map(catalogRes.rows.map((row) => [Number(row.id), row]));

    await client.query('DELETE FROM stock_in_items WHERE stock_in_id = $1', [id]);
    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = Number(item.qty || 0);
      if (!productId || qty <= 0) continue;
      const catalog = catalogMap.get(productId);
      if (!catalog) continue;

      await client.query(
        `INSERT INTO stock_in_items (
           stock_in_id, product_id, product_name, qty, cost_price, tax_value,
           batch_no, mfg_date, expiry_date, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          id,
          productId,
          catalog.name,
          qty,
          Number(item.cost_price || 0),
          Number(item.tax_value || 0),
          item.batch_no || null,
          normalizeDate(item.mfg_date) || null,
          normalizeDate(item.expiry_date) || null,
        ]
      );
    }

    await client.query(
      `UPDATE stock_in
       SET vendor_name = $2,
           invoice_date = $3,
           invoice_number = $4,
           other_charges = $5,
           remarks = $6,
           meta = COALESCE(meta, '{}'::jsonb) || $7::jsonb
       WHERE id = $1`,
      [
        id,
        body.form?.vendor || null,
        body.form?.invoice_date || null,
        body.form?.invoice_number || null,
        Number(body.form?.other_charges || 0),
        body.form?.remarks || null,
        JSON.stringify({ bulkTemplateUpload: true, ...(body.form || {}) }),
      ]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true, id, inserted: items.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[stockin PUT id]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update stock in' }, { status: 500 });
  } finally {
    client.release();
  }
}
