import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureInventoryBatchSchema, receiveBatchStock } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { toDateInputValue } from '@/lib/dateUtils';

function normalizeDate(value) {
  return toDateInputValue(value);
}

async function clearConfirmedStockInBatches(client, stockInId) {
  await ensureInventoryBatchSchema();

  const oldItemsRes = await client.query(
    `SELECT id FROM stock_in_items WHERE stock_in_id = $1`,
    [stockInId]
  );
  const oldItemIds = oldItemsRes.rows.map((row) => String(row.id));
  if (!oldItemIds.length) return;

  const batchRes = await client.query(
    `SELECT id, received_qty, available_qty
     FROM inventory_batches
     WHERE source_type = 'stock_in'
       AND source_id = ANY($1::text[])
     FOR UPDATE`,
    [oldItemIds]
  );

  const consumedBatch = batchRes.rows.find(
    (batch) => Number(batch.available_qty || 0) < Number(batch.received_qty || 0)
  );
  if (consumedBatch) {
    throw new Error('This stock in cannot be edited directly because some quantity has already been used. Use Stock Validation/Adjustment for correction.');
  }

  const batchIds = batchRes.rows.map((batch) => Number(batch.id)).filter(Boolean);
  if (!batchIds.length) return;

  await client.query(
    `DELETE FROM inventory_batch_movements
     WHERE batch_id = ANY($1::bigint[])
       AND direction = 'in'
       AND reference_type = 'stock_in'
       AND reference_id = $2`,
    [batchIds, String(stockInId)]
  );
  await client.query(
    `DELETE FROM inventory_batches
     WHERE id = ANY($1::bigint[])`,
    [batchIds]
  );
}

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockInSchema();
    await ensureInventoryBatchSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const res = await query(
      `SELECT s.id, s.method, s.destination_id, s.meta, s.status, s.created_at,
              s.transaction_id, s.reference_type, s.reference_id,
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
              sii.qty, sii.cost_price, sii.tax_value, sii.batch_no, sii.mfg_date, sii.expiry_date,
              COALESCE(NULLIF(sii.mrp, 0), p.mrp, 0) AS mrp,
              COALESCE(NULLIF(sii.selling_price, 0), p.selling_price, 0) AS selling_price
       FROM stock_in_items sii
       LEFT JOIN products p ON p.id = sii.product_id
       WHERE sii.stock_in_id = $1
       ORDER BY sii.id`,
      [id]
    );

    return NextResponse.json({
      id: row.id,
      method: row.method,
      transactionId: row.transaction_id || `STK-${String(row.id).padStart(4, '0')}`,
      referenceType: row.reference_type || 'stock_in',
      referenceId: row.reference_id || row.transaction_id || `STK-${String(row.id).padStart(4, '0')}`,
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
        mrp: Number(item.mrp || 0),
        selling_price: Number(item.selling_price || 0),
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
    const isConfirmed = String(stockIn.status || '').toLowerCase() === 'confirmed';

    const storeCheck = requireStore(auth.user, stockIn.destination_id);
    if (storeCheck.error) {
      await client.query('ROLLBACK');
      return storeCheck.error;
    }

    const productIds = [...new Set(items.map((item) => Number(item.product_id)).filter(Boolean))];
    const catalogRes = productIds.length
      ? await client.query(`SELECT id, name, cost_price, mrp, selling_price FROM products WHERE id = ANY($1::int[])`, [productIds])
      : { rows: [] };
    const catalogMap = new Map(catalogRes.rows.map((row) => [Number(row.id), row]));

    if (isConfirmed) {
      await clearConfirmedStockInBatches(client, id);
    }

    await client.query('DELETE FROM stock_in_items WHERE stock_in_id = $1', [id]);
    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = Number(item.qty || 0);
      if (!productId || qty <= 0) continue;
      const catalog = catalogMap.get(productId);
      if (!catalog) continue;
      const costPrice = Number(item.cost_price || catalog.cost_price || 0);
      const mrp = Number(item.mrp || catalog.mrp || 0);
      const sellingPrice = Number(item.selling_price || item.sellingPrice || catalog.selling_price || 0);

      const stockInItemRes = await client.query(
        `INSERT INTO stock_in_items (
           stock_in_id, product_id, product_name, qty, cost_price, tax_value,
           batch_no, mfg_date, expiry_date, mrp, selling_price, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         RETURNING id`,
        [
          id,
          productId,
          catalog.name,
          qty,
          costPrice,
          Number(item.tax_value || 0),
          item.batch_no || null,
          normalizeDate(item.mfg_date) || null,
          normalizeDate(item.expiry_date) || null,
          mrp,
          sellingPrice,
        ]
      );
      const stockInItemId = stockInItemRes.rows[0]?.id;
      if (isConfirmed) {
        await receiveBatchStock(client, {
          stockInId: id,
          stockInItemId,
          productId,
          storeId: stockIn.destination_id,
          qty,
          costPrice,
          batchNo: item.batch_no || null,
          mfgDate: normalizeDate(item.mfg_date) || null,
          expiryDate: normalizeDate(item.expiry_date) || null,
          meta: {
            source: 'stock_in_direct_edit',
            editedStockInId: Number(id),
            mrp,
            sellingPrice,
            costPrice,
          },
        });
      }
    }

    await client.query(
      `UPDATE stock_in
       SET vendor_name = $2,
           invoice_date = $3,
           invoice_number = $4,
           other_charges = $5,
           remarks = $6,
           total_items = $8,
           total_cost = $9,
           total_tax = $10,
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
        items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
        items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost_price || 0), Number(body.form?.other_charges || 0)),
        items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.tax_value || 0), 0),
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
