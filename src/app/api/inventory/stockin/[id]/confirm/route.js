import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureInventoryBatchSchema, receiveBatchStock } from '@/lib/inventoryBatching';
import { ensureStoresSchema } from '@/lib/storesSchema';
import { auditLog, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { ensureVendorInvoicesSchema } from '@/lib/vendorInvoicesSchema';
import { ensureVendorsSchema } from '@/lib/vendorsSchema';
import { createMarginApprovalRequest, ensureMarginApprovalSchema } from '@/lib/marginApprovalSchema';
import { toDateInputValue } from '@/lib/dateUtils';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toQty(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function normalizeDate(value) {
  return toDateInputValue(value) || null;
}

function normalizeBatchRows(item) {
  const rawBatches = Array.isArray(item.batches) ? item.batches : [];
  const fallbackQty = toQty(item.qty || 0);
  if (!rawBatches.length) {
    return [{
      qty: fallbackQty,
      batchNo: item.batch_no || item.batchNo || '',
      mfgDate: item.mfg_date || item.mfgDate || null,
      expiryDate: item.expiry_date || item.expiryDate || null,
    }];
  }

  return rawBatches
    .map((batch) => ({
      qty: toQty(batch.qty || 0),
      batchNo: batch.batch_no || batch.batchNo || '',
      mfgDate: batch.mfg_date || batch.mfgDate || null,
      expiryDate: batch.expiry_date || batch.expiryDate || null,
    }))
    .filter((batch) => batch.qty > 0);
}

function generateVendorInvoiceNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VINV-${date}-${time}-${suffix}`;
}

async function allocateWarehouseBatchStock(client, {
  productId,
  qty,
  referenceId,
  sourceItemId = null,
  meta = {},
}) {
  const requiredQty = toNumber(qty);
  if (!productId || requiredQty <= 0) return [];

  const batchRes = await client.query(
    `SELECT ib.id, ib.product_id, ib.store_id, ib.batch_no, ib.mfg_date, ib.expiry_date,
            ib.available_qty, ib.cost_price, ib.meta
     FROM inventory_batches ib
     INNER JOIN stores s ON s.id = ib.store_id
     WHERE ib.product_id = $1
       AND LOWER(COALESCE(s.meta->>'locationType', 'Warehouse')) = 'warehouse'
       AND ib.status = 'active'
       AND ib.available_qty > 0
       AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
     ORDER BY CASE WHEN ib.expiry_date IS NULL THEN 1 ELSE 0 END ASC,
              ib.expiry_date ASC,
              ib.created_at ASC,
              ib.id ASC
     FOR UPDATE`,
    [Number(productId)]
  );

  let remaining = requiredQty;
  const allocations = [];

  for (const batch of batchRes.rows) {
    if (remaining <= 0) break;
    const usedQty = Math.min(toNumber(batch.available_qty), remaining);
    if (usedQty <= 0) continue;

    await client.query(
      `UPDATE inventory_batches
       SET available_qty = available_qty - $1,
           status = CASE WHEN available_qty - $1 <= 0 THEN 'depleted' ELSE status END,
           updated_at = NOW()
       WHERE id = $2`,
      [usedQty, batch.id]
    );

    await client.query(
      `INSERT INTO inventory_batch_movements (
         batch_id, product_id, store_id, direction, qty, reference_type, reference_id, source_item_id, meta
       ) VALUES ($1, $2, $3, 'out', $4, 'stock_in_to_store', $5, $6, $7::jsonb)`,
      [
        batch.id,
        Number(productId),
        Number(batch.store_id),
        usedQty,
        String(referenceId),
        sourceItemId,
        JSON.stringify({ ...meta, destinationType: 'store_stock_in' }),
      ]
    );

    allocations.push({
      batchId: Number(batch.id),
      batchNo: batch.batch_no,
      mfgDate: normalizeDate(batch.mfg_date),
      expiryDate: normalizeDate(batch.expiry_date),
      qty: usedQty,
      costPrice: toNumber(batch.cost_price),
      mrp: toNumber(batch.meta?.mrp),
      sellingPrice: toNumber(batch.meta?.sellingPrice),
      sourceWarehouseId: Number(batch.store_id),
    });
    remaining = Math.round((remaining - usedQty) * 1000) / 1000;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient warehouse batch stock for product ${productId}. Short by ${remaining}`);
  }

  return allocations;
}

export async function POST(request, { params }) {
  const { id } = await params;
    try {
      await ensureStockInSchema();
      await ensureInventoryBatchSchema();
      await ensureStoresSchema();
      await ensureVendorsSchema();
      await ensureVendorInvoicesSchema();
      await ensureMarginApprovalSchema();
      const auth = await requireAuth(request);
      if (auth.error) return auth.error;

      const permissionCheck = requirePermission(auth.user, 'MANAGE_INVENTORY', 'MANAGE_PURCHASE_ORDERS');
      if (permissionCheck.error) return permissionCheck.error;
    const body = await request.json();
    const form  = body.form  || {};
    const items = body.items || [];
    const normalizedInvoiceDate = normalizeDate(form.invoice_date);

    if (!items.length) {
      return NextResponse.json({ error: 'Add at least one product' }, { status: 400 });
    }

    // ── 1. Validate every product_id exists in the catalog ───────────────────
    const productIds = [...new Set(items.map((it) => Number(it.product_id)).filter(Boolean))];

    const catalogRes = await query(
      `SELECT id, name, cost_price, mrp, selling_price, unit FROM products WHERE id = ANY($1::int[])`,
      [productIds]
    );
    const catalogMap = Object.fromEntries(catalogRes.rows.map((r) => [r.id, r]));

    const missing = productIds.filter((pid) => !catalogMap[pid]);
    if (missing.length) {
      return NextResponse.json(
        { error: `Products not found in catalog: IDs ${missing.join(', ')}` },
        { status: 422 }
      );
    }

    // ── 2. Fetch destination store (needed for product_saleability upsert) ───
    const stockInRow = await query(
      `SELECT si.id, si.transaction_id, si.status, si.destination_id, si.reference_type, si.reference_id,
              si.vendor_id, si.vendor_name, si.invoice_number, si.meta, stores.meta AS destination_meta
       FROM stock_in si
       LEFT JOIN stores ON stores.id = si.destination_id
       WHERE si.id = $1`,
      [id]
    );
    if (!stockInRow.rows.length) {
      return NextResponse.json({ error: 'Stock in not found' }, { status: 404 });
    }
    if (stockInRow.rows[0].status === 'confirmed') {
      return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
    }
    const destinationId = stockInRow.rows[0].destination_id;
    const storeCheck = requireStore(auth.user, destinationId);
    if (storeCheck.error) return storeCheck.error;

    // ── 3. Compute totals ─────────────────────────────────────────────────────
    const destinationMeta = typeof stockInRow.rows[0].destination_meta === 'object'
      ? stockInRow.rows[0].destination_meta
      : {};
    const destinationLocationType = String(destinationMeta.locationType || 'Warehouse').toLowerCase();
    const isStoreDestination = destinationLocationType === 'store';
    const isWarehouseDestination = destinationLocationType === 'warehouse';
    const stockInMeta = typeof stockInRow.rows[0].meta === 'object' ? stockInRow.rows[0].meta : {};
    const sourceType = String(form.sourceType || stockInMeta.sourceType || '').toLowerCase();
    const isRemoteGrn = (
      stockInRow.rows[0].reference_type === 'remote_grn' ||
      stockInMeta.source === 'remote_grn' ||
      form.source === 'remote_grn' ||
      items.some((item) => item.remoteGrn || item.source === 'remote_grn')
    );
    const isWarehouseSource = sourceType === 'warehouse';
    const isDirectVendorReceipt = (
      isRemoteGrn ||
      stockInRow.rows[0].reference_type === 'purchase_order' ||
      stockInRow.rows[0].vendor_id ||
      stockInRow.rows[0].vendor_name ||
      sourceType === 'vendor' ||
      form.vendor
    );
    const isVendorToStoreReceipt = isStoreDestination && isDirectVendorReceipt;
    const hasPurchaseOrder = stockInRow.rows[0].reference_type === 'purchase_order' && String(stockInRow.rows[0].reference_id || '').trim();

    if (!hasPurchaseOrder && !isWarehouseSource && !isDirectVendorReceipt) {
      const previousStockRes = await query(
        `SELECT sii.product_id, p.name, COUNT(*)::int AS receipt_count
         FROM stock_in_items sii
         INNER JOIN stock_in si ON si.id = sii.stock_in_id
         INNER JOIN products p ON p.id = sii.product_id
         WHERE si.status = 'confirmed'
           AND si.id <> $1
           AND sii.product_id = ANY($2::int[])
         GROUP BY sii.product_id, p.name
         LIMIT 1`,
        [id, productIds]
      );
      if (previousStockRes.rows.length) {
        return NextResponse.json(
          { error: `${previousStockRes.rows[0].name} already has stock history. Raise/select a purchase order for further stock-in.` },
          { status: 400 }
        );
      }
    }

    if (isWarehouseDestination) {
      for (const item of items) {
        const batchRows = normalizeBatchRows(item);
        const itemQty = toQty(item.qty || 0);
        const batchQty = batchRows.reduce((sum, batch) => sum + toNumber(batch.qty), 0);
        if (batchRows.length === 0 || batchQty <= 0) {
          return NextResponse.json({ error: `Add at least one batch for ${item.name || 'product'}` }, { status: 400 });
        }
        if (Math.abs(batchQty - itemQty) > 0.001) {
          return NextResponse.json(
            { error: `Batch quantity for ${item.name || 'product'} must equal product quantity` },
            { status: 400 }
          );
        }

        const invalidExpiry = batchRows.find((batch) => {
          const normalized = normalizeDate(batch.expiryDate);
          return batch.expiryDate && !normalized;
        });
        if (invalidExpiry) {
          return NextResponse.json({ error: `Invalid expiry date for ${item.name || 'product'}` }, { status: 400 });
        }
      }
    }

    if (isStoreDestination && !isVendorToStoreReceipt) {
      const requestedByProduct = items.reduce((acc, item) => {
        const pid = Number(item.product_id);
        const qty = toQty(item.qty || 0);
        if (pid && qty > 0) acc[pid] = (acc[pid] || 0) + qty;
        return acc;
      }, {});
      const requestedProductIds = Object.keys(requestedByProduct).map(Number);

      const warehouseStockRes = await query(
        `SELECT ib.product_id AS id, SUM(ib.available_qty) AS available_qty
         FROM inventory_batches ib
         INNER JOIN stores s ON s.id = ib.store_id
         WHERE ib.product_id = ANY($1::int[])
           AND LOWER(COALESCE(s.meta->>'locationType', 'Warehouse')) = 'warehouse'
           AND ib.status = 'active'
           AND ib.available_qty > 0
           AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
         GROUP BY ib.product_id`,
        [requestedProductIds]
      );
      const warehouseStockByProduct = Object.fromEntries(
        warehouseStockRes.rows.map((row) => [Number(row.id), Number(row.available_qty || 0)])
      );
      const exceeded = requestedProductIds
        .map((pid) => ({
          name: catalogMap[pid]?.name || `Product ${pid}`,
          requested: requestedByProduct[pid],
          available: warehouseStockByProduct[pid] || 0,
        }))
        .filter((row) => row.requested > row.available);

      if (exceeded.length) {
        const first = exceeded[0];
        return NextResponse.json(
          { error: `${first.name} has only ${first.available} quantity available in warehouse` },
          { status: 400 }
        );
      }
    }

    let totalItems = 0;
    let totalCost  = Number(form.other_charges || 0);
    let totalTax   = 0;
    for (const item of items) {
      const qty  = toQty(item.qty        || 0);
      const cost = Number(item.cost_price || 0);
      const tax  = Number(item.tax_value  || 0);
      if (!item.product_id || qty <= 0) {
        return NextResponse.json({ error: 'Each item must have a product and quantity greater than zero' }, { status: 400 });
      }
      if (cost < 0 || tax < 0) {
        return NextResponse.json({ error: 'Cost and tax cannot be negative' }, { status: 400 });
      }
      totalItems += qty;
      totalCost  += qty * cost;
      totalTax   += tax;
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      let marginApprovalCount = 0;

      const lockedStockInRes = await client.query(
        `SELECT id, status
         FROM stock_in
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      if (!lockedStockInRes.rows.length) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Stock in not found' }, { status: 404 });
      }
      if (String(lockedStockInRes.rows[0].status || '').toLowerCase() === 'confirmed') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Already confirmed' }, { status: 409 });
      }

      // ── 4. Replace line items — use catalog name as source of truth ─────────
      await client.query('DELETE FROM stock_in_items WHERE stock_in_id = $1', [id]);

      for (const item of items) {
        const pid          = Number(item.product_id);
        const catalogEntry = catalogMap[pid];
        // Always store the canonical name from the catalog
        const productName  = catalogEntry.name;
        const qty          = toQty(item.qty        || 1);
        const costPrice    = Number(item.cost_price || 0);
        const taxValue     = Number(item.tax_value  || 0);
        const mrp          = Number(item.mrp || 0);
        const sellingPrice = Number(item.selling_price || item.sellingPrice || 0);
        const itemMeta     = {
          source: item.source || null,
          scanCode: item.scan_code || item.scanCode || '',
          serialNumber: item.serial_number || item.serialNumber || '',
          remoteGrn: Boolean(item.remoteGrn || item.source === 'remote_grn'),
        };

        if (isStoreDestination && !isVendorToStoreReceipt) {
          const allocations = await allocateWarehouseBatchStock(client, {
            productId: pid,
            qty,
            referenceId: id,
            meta: { productName, invoiceNumber: form.invoice_number || null },
          });

          for (const allocation of allocations) {
            const stockInItemRes = await client.query(
              `INSERT INTO stock_in_items
                 (stock_in_id, product_id, product_name, qty, cost_price, tax_value, batch_no, mfg_date, expiry_date, mrp, selling_price, serial_number, scan_code, meta, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW())
               RETURNING id`,
              [
                id,
                pid,
                productName,
                allocation.qty,
                allocation.costPrice || costPrice,
                taxValue,
                allocation.batchNo || null,
                allocation.mfgDate || null,
                allocation.expiryDate || null,
                mrp,
                sellingPrice,
                itemMeta.serialNumber || null,
                itemMeta.scanCode || null,
                JSON.stringify(itemMeta),
              ]
            );

            await receiveBatchStock(client, {
              stockInId: id,
              stockInItemId: stockInItemRes.rows[0]?.id,
              productId: pid,
              storeId: destinationId,
              qty: allocation.qty,
              costPrice: allocation.costPrice || costPrice,
              batchNo: allocation.batchNo,
              mfgDate: allocation.mfgDate,
              expiryDate: allocation.expiryDate,
              meta: {
                productName,
                invoiceNumber: form.invoice_number || null,
                source: 'warehouse_stock_in',
                sourceWarehouseId: allocation.sourceWarehouseId,
                sourceBatchId: allocation.batchId,
                costPrice: allocation.costPrice || costPrice,
                mrp: allocation.mrp || mrp,
                sellingPrice: allocation.sellingPrice || sellingPrice,
              },
            });
          }
        } else {
          const batchRows = normalizeBatchRows(item);

          for (const batch of batchRows) {
            const stockInItemRes = await client.query(
              `INSERT INTO stock_in_items
                 (stock_in_id, product_id, product_name, qty, cost_price, tax_value, batch_no, mfg_date, expiry_date, mrp, selling_price, serial_number, scan_code, meta, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW())
               RETURNING id`,
              [
                id,
                pid,
                productName,
                batch.qty,
                costPrice,
                taxValue,
                batch.batchNo || null,
                normalizeDate(batch.mfgDate) || null,
                normalizeDate(batch.expiryDate) || null,
                mrp,
                sellingPrice,
                itemMeta.serialNumber || null,
                itemMeta.scanCode || null,
                JSON.stringify(itemMeta),
              ]
            );

            await receiveBatchStock(client, {
              stockInId: id,
              stockInItemId: stockInItemRes.rows[0]?.id,
              productId: pid,
              storeId: destinationId,
              qty: batch.qty,
              costPrice,
              batchNo: batch.batchNo,
              mfgDate: normalizeDate(batch.mfgDate) || null,
              expiryDate: normalizeDate(batch.expiryDate) || null,
              meta: {
                productName,
                invoiceNumber: form.invoice_number || null,
                costPrice,
                mrp,
                sellingPrice,
              },
            });
          }
        }

        const saleabilityRes = destinationId
          ? await client.query(
              `SELECT mrp, selling_price
               FROM product_saleability
               WHERE product_id = $1 AND store_id = $2
               LIMIT 1`,
              [pid, destinationId]
            )
          : { rows: [] };
        const saleability = saleabilityRes.rows[0] || {};

        const approvalRequest = await createMarginApprovalRequest(client, {
          stockInId: id,
          stockInItemId: null,
          sourceType: stockInRow.rows[0].reference_type || 'grn',
          sourceReference: stockInRow.rows[0].transaction_id || String(id),
          productId: pid,
          storeId: destinationId,
          requestedBy: auth.user.id,
          currentCostPrice: catalogEntry.cost_price,
          requestedCostPrice: costPrice,
          currentMrp: saleability.mrp ?? catalogEntry.mrp,
          requestedMrp: mrp,
          currentSellingPrice: saleability.selling_price ?? catalogEntry.selling_price,
          requestedSellingPrice: sellingPrice,
          remarks: `Price change requested from ${stockInRow.rows[0].transaction_id || `Stock In ${id}`}`,
          meta: {
            productName,
            invoiceNumber: form.invoice_number || null,
            source: itemMeta.remoteGrn ? 'remote_grn' : 'stock_in_confirm',
          },
        });
        if (approvalRequest?.id) marginApprovalCount += 1;

        // Keep product active at this store after receipt. CP/MRP/SP changes
        // are applied only after admin approval.
        if (destinationId) {
          await client.query(
            `INSERT INTO product_saleability
               (product_id, store_id, is_active, selling_price, mrp, low_stock_value, created_at, updated_at)
             VALUES ($1, $2, true, 0, 0, 0, NOW(), NOW())
             ON CONFLICT (product_id, store_id)
             DO UPDATE SET
               is_active  = true,
               updated_at = NOW()`,
            [pid, destinationId]
          );
        }
      }

      // ── 7. Mark stock_in as confirmed ────────────────────────────────────────
      const stockIn = stockInRow.rows[0];
      const vendorLookupName = String(form.vendor || stockIn.vendor_name || '').trim();
      const formVendorIds = Array.isArray(form.vendorIds) ? form.vendorIds.map(Number).filter(Number.isFinite) : [];
      let vendorId = Number(stockIn.vendor_id || formVendorIds[0] || 0) || null;
      if (!vendorId && vendorLookupName) {
        const vendorRes = await client.query(
          `SELECT id FROM vendors WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [vendorLookupName]
        );
        vendorId = Number(vendorRes.rows[0]?.id || 0) || null;
      }

      await client.query(
        `UPDATE stock_in SET
           status         = 'confirmed',
           vendor_name    = $1,
           vendor_id      = $2,
           invoice_date   = $3,
           invoice_number = $4,
           other_charges  = $5,
           remarks        = $6,
           total_items    = $7,
           total_cost     = $8,
           total_tax      = $9,
           meta           = meta || $10::jsonb,
           confirmed_at   = NOW()
         WHERE id = $11`,
        [
          form.vendor        || null,
          vendorId,
          normalizedInvoiceDate || null,
          form.invoice_number|| null,
          Number(form.other_charges || 0),
          form.remarks       || null,
          totalItems,
          totalCost,
          totalTax,
          JSON.stringify(form),
          id,
        ]
      );

      if (vendorId && (stockIn.reference_type === 'purchase_order' || vendorLookupName)) {
        const grossInvoiceAmount = Math.max(0, totalCost + totalTax);
        const purchaseOrderId = /^\d+$/.test(String(stockIn.reference_id || ''))
          ? Number(stockIn.reference_id)
          : null;
        const invoiceNumber = String(form.invoice_number || stockIn.invoice_number || '').trim() || generateVendorInvoiceNumber();
        const invoiceDate = normalizedInvoiceDate || new Date().toISOString().slice(0, 10);
        const existingInvoiceRes = await client.query(
          `SELECT id, amount_paid
           FROM vendor_invoices
           WHERE stock_in_id = $1
           FOR UPDATE`,
          [Number(id)]
        );

        if (existingInvoiceRes.rows[0]) {
          const existing = existingInvoiceRes.rows[0];
          const amountPaid = toNumber(existing.amount_paid);
          const status = amountPaid >= grossInvoiceAmount && grossInvoiceAmount > 0
            ? 'Paid'
            : amountPaid > 0
              ? 'Partial'
              : 'Pending';
          await client.query(
            `UPDATE vendor_invoices
             SET vendor_id = $2,
                 purchase_order_id = $3,
                 invoice_number = $4,
                 total_amount = $5,
                 invoice_date = $6,
                 created_by = $7,
                 remarks = $8,
                 status = $9,
                 meta = COALESCE(meta, '{}'::jsonb) || $10::jsonb,
                 updated_at = NOW()
             WHERE id = $1`,
            [
              existing.id,
              vendorId,
              purchaseOrderId,
              invoiceNumber,
              grossInvoiceAmount,
              invoiceDate,
              auth.user?.name || auth.user?.email || 'System',
              form.remarks || null,
              status,
              JSON.stringify({
                source: 'auto-grn-confirm',
                stockInId: Number(id),
                stockInTransactionId: stockIn.transaction_id,
                purchaseOrderId,
              }),
            ]
          );
        } else {
          const invoiceRes = await client.query(
            `INSERT INTO vendor_invoices (
              vendor_id, purchase_order_id, stock_in_id, invoice_number, total_amount, amount_paid,
              invoice_date, created_by, remarks, status, meta, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, 'Pending', $9::jsonb, NOW(), NOW())
            RETURNING id`,
            [
              vendorId,
              purchaseOrderId,
              Number(id),
              invoiceNumber,
              grossInvoiceAmount,
              invoiceDate,
              auth.user?.name || auth.user?.email || 'System',
              form.remarks || null,
              JSON.stringify({
                source: 'auto-grn-confirm',
                stockInId: Number(id),
                stockInTransactionId: stockIn.transaction_id,
                purchaseOrderId,
              }),
            ]
          );
          const vendorInvoiceId = invoiceRes.rows[0]?.id;
          await client.query(
            `UPDATE vendor_invoices SET transaction_id = $1 WHERE id = $2`,
            [`VINV-${String(vendorInvoiceId).padStart(4, '0')}`, vendorInvoiceId]
          );
        }
      }

      await client.query('COMMIT');
      await auditLog(auth.user.id, 'stock_in.confirm', 'stock_in', id, {
        destinationId,
        totalItems,
        totalCost,
        totalTax,
        vendorId,
        marginApprovalCount,
      });
      return NextResponse.json({ success: true, id, totalItems, totalCost, totalTax, marginApprovalCount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[stockin confirm]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to confirm stock in' }, { status: 500 });
  }
}
