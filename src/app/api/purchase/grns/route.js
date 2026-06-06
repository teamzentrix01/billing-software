import { NextResponse } from 'next/server';
import { query, getClient } from '@/lib/db';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensurePurchaseOrderSchema } from '@/lib/purchaseOrderSchema';
import { appendStoreScope, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { toDateInputValue } from '@/lib/dateUtils';

function normalizeDate(value) {
  return toDateInputValue(value) || null;
}

export async function GET(request) {
  try {
    await ensureStockInSchema();
    await ensureInventoryBatchSchema();
    await ensurePurchaseOrderSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS');
    if (permissionCheck.error) return permissionCheck.error;

    const where = [`s.reference_type = 'purchase_order'`];
    const params = [];
    const scope = appendStoreScope(where, params, 's.destination_id', auth.user);
    if (scope.error) return scope.error;
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const res = await query(
      `SELECT
        s.id,
        s.transaction_id,
        s.invoice_number,
        s.invoice_date,
        s.vendor_id,
        s.vendor_name,
        s.other_charges,
        s.total_items,
        s.total_cost,
        s.total_tax,
        s.reference_type,
        s.reference_id,
        s.status,
        s.created_at,
        st.name AS destination_name,
        COALESCE(SUM(si.qty), 0) AS item_qty_sum,
        COALESCE(SUM(si.qty * si.cost_price), 0) AS items_cost_sum
      FROM stock_in s
      LEFT JOIN stores st ON st.id = s.destination_id
      LEFT JOIN stock_in_items si ON si.stock_in_id = s.id
      ${whereSql}
      GROUP BY s.id, st.name
      ORDER BY s.confirmed_at DESC NULLS LAST, s.created_at DESC
      LIMIT 200`,
      params
    );

    const records = res.rows.map((row) => {
      const totalItems = Number(row.total_items || row.item_qty_sum || 0);
      const totalCost = Number(row.total_cost || Number(row.items_cost_sum || 0) + Number(row.other_charges || 0));
      return {
        id: row.id,
        transactionId: row.transaction_id || `#STK-${String(row.id).padStart(3, '0')}`,
        invoiceNumber: row.invoice_number || '—',
        destination: row.destination_name || '—',
        invoiceDate: row.invoice_date,
        totalItems,
        cost: totalCost,
        referenceType: row.reference_type || '—',
        referenceId: row.reference_id || '—',
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        totalTax: Number(row.total_tax || 0),
        createdAt: row.created_at,
      };
    });

    return NextResponse.json(records);
  } catch (err) {
    console.error('[grns GET]', err.message);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request) {
  try {
    await ensureStockInSchema();
    await ensurePurchaseOrderSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;
    const payload = await request.json();
    const client = await getClient();
    try {
      await client.query('BEGIN');
      let po = null;
      let poItems = [];
      const rawPoId = String(payload.poId || payload.purchaseOrderId || '').replace(/^#/, '').trim();
      if (rawPoId) {
        const poRes = await client.query(
          `SELECT po.id, po.transaction_id, po.destination_id, po.vendor_id, v.name AS vendor_name,
                  po.invoice_number, po.invoice_date
           FROM purchase_orders po
           LEFT JOIN vendors v ON v.id = po.vendor_id
           WHERE po.id::text = $1 OR po.transaction_id = $1
           LIMIT 1`,
          [rawPoId]
        );
        po = poRes.rows[0] || null;
        if (!po) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
        }
        const poStoreCheck = requireStore(auth.user, po.destination_id);
        if (poStoreCheck.error) {
          await client.query('ROLLBACK');
          return poStoreCheck.error;
        }

        const itemsRes = await client.query(
          `SELECT poi.product_id, COALESCE(poi.product_name, p.name) AS product_name,
                  poi.qty, poi.cost_price, poi.tax_value
           FROM purchase_order_items poi
           LEFT JOIN products p ON p.id = poi.product_id
           WHERE poi.purchase_order_id = $1
           ORDER BY poi.id`,
          [po.id]
        );
        poItems = itemsRes.rows;
      }

      // create a stock_in record referencing the purchase order
      const insertText = `
        INSERT INTO stock_in (method, destination_id, apply_taxes, add_products_prefill, meta, status, reference_type, reference_id, vendor_id, vendor_name, invoice_number, invoice_date, created_at)
        VALUES ($1, $2, $3, $4, $5, 'draft', 'purchase_order', $6, $7, $8, $9, $10, NOW())
        RETURNING id`;
      const vendorId = payload.vendorId || payload.vendor || po?.vendor_id || null;
      const destinationId = payload.destination || po?.destination_id || null;
      const storeCheck = requireStore(auth.user, destinationId);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }
      const values = [
        'purchase_order',
        destinationId,
        payload.applyTaxes ?? true,
        payload.addProductsPrefill ?? false,
        JSON.stringify({
          ...payload,
          sourceType: 'vendor',
          vendorIds: vendorId ? [vendorId] : [],
        }),
        po?.id || payload.poId || null,
        vendorId,
        payload.vendorName || po?.vendor_name || null,
        payload.invoiceNumber || po?.invoice_number || null,
        payload.invoiceDate || po?.invoice_date || null,
      ];
      const res = await client.query(insertText, values);
      const id = res.rows[0].id;
      const transactionId = `GRN-${String(id).padStart(4, '0')}`;
      await client.query('UPDATE stock_in SET transaction_id = $1 WHERE id = $2', [transactionId, id]);

      // optionally insert line items if provided
      const inputItems = Array.isArray(payload.items) && payload.items.length ? payload.items : poItems;
      if (Array.isArray(inputItems) && inputItems.length) {
        const insertItemText = `
          INSERT INTO stock_in_items (
            stock_in_id, product_id, product_name, qty, cost_price, tax_value,
            batch_no, mfg_date, expiry_date, mrp, selling_price, serial_number, scan_code, meta
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`;
        for (const it of inputItems) {
          await client.query(insertItemText, [
            id,
            it.product_id,
            it.product_name || null,
            it.qty || 0,
            it.cost_price || 0,
            it.tax_value || 0,
            it.batch_no || it.batchNo || null,
            normalizeDate(it.mfg_date || it.mfgDate) || null,
            normalizeDate(it.expiry_date || it.expiryDate) || null,
            Number(it.mrp || 0),
            Number(it.selling_price || it.sellingPrice || 0),
            it.serial_number || it.serialNumber || null,
            it.scan_code || it.scanCode || null,
            JSON.stringify({ source: 'purchase_grn' }),
          ]);
        }
      }

      await client.query('COMMIT');
      return NextResponse.json({ id, transactionId }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[grns POST]', err.message);
    return NextResponse.json({ error: 'Failed to create GRN' }, { status: 500 });
  }
}
