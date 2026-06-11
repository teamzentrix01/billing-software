import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';
import { ensureStockValidationSchema } from '@/lib/stockValidationSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, receiveBatchStock } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function toQty(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 1000) / 1000;
}

function aggregateItems(items) {
  const grouped = new Map();
  for (const item of items) {
    const productId = toNumericId(item.product_id || item.productId);
    if (!productId) throw new Error('Each item must have a product');
    const batchId = toBatchId(item.batch_id || item.batchId);
    const qty = toQty(item.qty);
    const costPrice = toNumber(item.cost_price || item.costPrice);
    const taxValue = toNumber(item.tax_value || item.taxValue);
    const key = `${productId}:${batchId || `cost:${costPrice}`}`;
    const existing = grouped.get(key) || {
      product_id: productId,
      batch_id: batchId,
      batch_no: item.batch_no || item.batchNo || '',
      existing_qty: toQty(item.existing_qty || item.existingQty || 0),
      qty: 0,
      cost_price: costPrice,
      tax_value: taxValue,
    };
    existing.qty = roundQty(existing.qty + qty);
    existing.cost_price = costPrice || existing.cost_price;
    existing.tax_value = taxValue || existing.tax_value;
    grouped.set(key, existing);
  }
  return Array.from(grouped.values());
}

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    await ensureStockValidationSchema();
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

    let aggregatedItems;
    try {
      aggregatedItems = aggregateItems(items);
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    let totalItems = 0;
    let totalCost = toNumber(form.other_charges);
    let totalTax = 0;

    for (const item of aggregatedItems) {
      const qty = toQty(item.qty);
      const cost = toNumber(item.cost_price);
      const tax = toNumber(item.tax_value);
      if (qty < 0) {
        return NextResponse.json({ error: 'Quantity cannot be negative' }, { status: 400 });
      }
      totalItems += qty;
      totalCost += qty * cost;
      totalTax += tax * qty;
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const draft = await client.query('SELECT id, status, destination_id FROM stock_validation WHERE id = $1 FOR UPDATE', [id]);
      if (draft.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Stock validation not found' }, { status: 404 });
      }
      if (draft.rows[0].status === 'confirmed') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
      }
      const storeCheck = requireStore(auth.user, draft.rows[0].destination_id);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }

      const productIds = aggregatedItems.map((item) => Number(item.product_id));
      const productsRes = await client.query(
        `SELECT id, name
         FROM products
         WHERE id = ANY($1::int[])`,
        [productIds]
      );
      const productMap = new Map(productsRes.rows.map((row) => [Number(row.id), row]));
      const missingProducts = productIds.filter((productId) => !productMap.has(productId));
      if (missingProducts.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Products not found in catalog: IDs ${missingProducts.join(', ')}` },
          { status: 422 }
        );
      }

      await client.query('DELETE FROM stock_validation_items WHERE stock_validation_id = $1', [id]);
      for (const item of aggregatedItems) {
        const productId = Number(item.product_id);
        const countedQty = toQty(item.qty);
        const productName = productMap.get(productId)?.name || `Product ${productId}`;
        await client.query(
          `INSERT INTO stock_validation_items (
            stock_validation_id, product_id, product_name, qty, cost_price, tax_value, batch_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [id, productId, productName, countedQty, item.cost_price || 0, item.tax_value || 0, item.batch_id || null]
        );

        const stockRes = await client.query(
          `SELECT COALESCE(SUM(available_qty), 0) AS qty
           FROM inventory_batches
           WHERE product_id = $1
             AND store_id = $2
             AND status = 'active'
             AND available_qty > 0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
             ${item.batch_id ? 'AND id = $3' : ''}`,
          item.batch_id ? [productId, draft.rows[0].destination_id, Number(item.batch_id)] : [productId, draft.rows[0].destination_id]
        );
        const currentQty = toQty(stockRes.rows[0]?.qty || item.existing_qty || 0);
        const variance = roundQty(countedQty - currentQty);

        if (variance > 0) {
          await receiveBatchStock(client, {
            stockInId: id,
            productId,
            storeId: draft.rows[0].destination_id,
            qty: variance,
            costPrice: toNumber(item.cost_price),
            batchNo: item.batch_no || `AUD-${id}-${productId}`,
            meta: {
              source: 'stock_validation',
              validationId: id,
              sourceBatchId: item.batch_id || null,
              productName,
              countedQty,
              previousQty: currentQty,
              variance,
              adjustmentType: 'gain',
              costPrice: toNumber(item.cost_price),
            },
          });
        } else if (variance < 0) {
          await allocateBatchStock(client, {
            productId,
            storeId: draft.rows[0].destination_id,
            qty: Math.abs(variance),
            preferredBatchId: item.batch_id || null,
            referenceType: 'stock_validation',
            referenceId: id,
            meta: {
              source: 'stock_validation',
              validationId: id,
              productName,
              countedQty,
              previousQty: currentQty,
              variance,
              adjustmentType: 'loss',
            },
          });
        }
      }

      await client.query(
        `UPDATE stock_validation SET
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
          toNumber(form.other_charges),
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
    console.error('[stockvalidation confirm]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to confirm stock validation' }, { status: 500 });
  }
}
