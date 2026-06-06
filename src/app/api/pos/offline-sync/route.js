import { getClient } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy } from '@/lib/inventoryBatching';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Store offline bills in browser's localStorage, sync when online
export async function POST(req) {
  try {
    await ensureSalesBillingSchema();
    await ensureInventoryBatchSchema();

    const body = await req.json();
    const { offline_bills = [] } = body;

    if (!Array.isArray(offline_bills) || offline_bills.length === 0) {
      return errorResponse('No offline bills to sync', 400);
    }

    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING');
    if (permissionCheck.error) return permissionCheck.error;
    const user = auth.user;

    let syncedCount = 0;
    const errors = [];

    for (const bill of offline_bills) {
      let client;
      try {
        const billStoreId = Number(bill.store_id || bill.storeId);
        const storeCheck = requireStore(user, billStoreId);
        if (storeCheck.error) {
          errors.push({ bill: bill.invoice_number || bill.bill_number || bill.sync_id, error: `No access to store ${billStoreId || '-'}` });
          continue;
        }

        client = await getClient();
        await client.query('BEGIN');

        const items = Array.isArray(bill.items) ? bill.items : [];
        const billNumber = bill.invoice_number || bill.bill_number || bill.billNumber || `OFL-${Date.now()}-${syncedCount}`;
        const subtotal = toNumber(
          bill.subtotal,
          items.reduce((sum, item) => sum + toNumber(item.qty) * toNumber(item.selling_price ?? item.sellingPrice), 0)
        );
        const taxTotal = toNumber(bill.total_tax ?? bill.taxTotal);
        const discountTotal = toNumber(bill.discount_amount ?? bill.discountTotal);
        const roundOff = toNumber(bill.round_off ?? bill.roundOff);
        const grandTotal = toNumber(bill.total_amount ?? bill.grandTotal, Math.max(0, subtotal - discountTotal + taxTotal + roundOff));
        const normalizedPayments = (Array.isArray(bill.payments) && bill.payments.length
          ? bill.payments
          : [{ method: bill.payment_mode || bill.paymentMode || 'cash', amount: grandTotal, referenceNo: bill.reference_no || bill.referenceNo || '' }]
        )
          .map((payment) => ({
            method: String(payment.method || bill.payment_mode || bill.paymentMode || 'cash').trim().toLowerCase(),
            amount: toNumber(payment.amount),
            referenceNo: String(payment.referenceNo || payment.reference_no || '').trim(),
          }))
          .filter((payment) => payment.amount > 0);
        const paidAmount = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);
        if (!normalizedPayments.length) throw new Error('Add at least one payment');
        if (Math.abs(paidAmount - grandTotal) > 0.01) {
          throw new Error(`Payment total must match bill total. Paid ${paidAmount}, bill ${grandTotal}`);
        }
        const finalPaymentMode = normalizedPayments.length > 1 ? 'split' : normalizedPayments[0].method;

        const billRes = await client.query(`
          INSERT INTO sales_bills (
            sync_id, bill_number, store_id, customer_name, customer_mobile,
            subtotal, discount_total, tax_total, round_off, grand_total,
            paid_amount, balance_amount, payment_mode, remarks, user_id,
            status, created_offline, device_id, meta, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            'completed', TRUE, $16, $17::jsonb, COALESCE($18::timestamptz, NOW()), NOW()
          )
          ON CONFLICT (bill_number) DO NOTHING
          RETURNING id, bill_number, public_token, created_at
        `, [
          bill.sync_id || bill.syncId || null,
          billNumber,
          billStoreId,
          bill.customer_name || bill.customerName || 'Walk-in Customer',
          bill.customer_mobile || bill.customerMobile || '',
          subtotal,
          discountTotal,
          taxTotal,
          roundOff,
          grandTotal,
          paidAmount,
          Math.max(0, grandTotal - paidAmount),
          finalPaymentMode,
          bill.notes || bill.remarks || '',
          bill.user_id || bill.created_by || user.id,
          bill.device_id || bill.deviceId || null,
          JSON.stringify({ source: 'legacy-pos-offline-sync', customer_id: bill.customer_id || null, payments: normalizedPayments }),
          bill.created_at || bill.createdAt || null,
        ]);

        if (!billRes.rows[0]) {
          await client.query('ROLLBACK');
          syncedCount++;
          continue;
        }

        const bill_id = billRes.rows[0].id;

        const stockOutRes = await client.query(
          `INSERT INTO stock_out (
             transaction_id, method, destination_id, apply_taxes, add_products_prefill,
             status, invoice_number, total_items, total_cost, total_tax,
             reference_type, reference_id, meta, created_at, confirmed_at
           ) VALUES (
             $1, 'pos_sale', $2, true, false,
             'confirmed', $3, $4, 0, $5,
             'sales_bill', $6, $7::jsonb, NOW(), NOW()
           ) RETURNING id`,
          [
            `POS-STKO-${bill_id}`,
            billStoreId,
            billNumber,
            items.reduce((sum, item) => sum + toNumber(item.qty), 0),
            taxTotal,
            String(bill_id),
            JSON.stringify({ source: 'legacy-pos-offline-sync', billId: bill_id, billNumber }),
          ]
        );

        const stockOutId = stockOutRes.rows[0]?.id;
        const issueStrategy = getInventoryIssueStrategy();

        for (const item of items) {
          const productId = Number(item.product_id || item.productId);
          const qty = toNumber(item.qty);
          if (!productId || qty <= 0) throw new Error('Invalid offline product or quantity');
          const selectedBatchId = Number(item.selectedBatchId || item.selected_batch_id || item.batchId || item.batch_id || 0) || null;
          const selectedBatchIds = (Array.isArray(item.selectedBatchIds) ? item.selectedBatchIds : [])
            .map(Number)
            .filter((id) => Number.isFinite(id) && id > 0);

          const productRes = await client.query(
            `SELECT id, name, sku, barcode, mrp, selling_price, cost_price
             FROM products
             WHERE id = $1
             FOR UPDATE`,
            [productId]
          );
          const product = productRes.rows[0];
          if (!product) throw new Error(`Product ${productId} not found`);

          const sellingPrice = toNumber(item.selling_price ?? item.sellingPrice, toNumber(product.selling_price));
          const taxRate = toNumber(item.tax_rate ?? item.taxRate);
          const itemDiscount = toNumber(item.discount_amount ?? item.discountAmount);
          const lineSubtotal = qty * sellingPrice;
          const lineTax = toNumber(item.tax_amount ?? item.taxAmount, (Math.max(0, lineSubtotal - itemDiscount) * taxRate) / 100);
          const lineTotal = toNumber(item.line_total ?? item.lineTotal, Math.max(0, lineSubtotal - itemDiscount + lineTax));

          const allocations = await allocateBatchStock(client, {
            productId,
            storeId: billStoreId,
            qty,
            preferredBatchId: selectedBatchIds.length ? null : selectedBatchId,
            allowedBatchIds: selectedBatchIds,
            strategy: issueStrategy,
            referenceType: 'sales_bill',
            referenceId: bill_id,
            meta: { billNumber, stockOutId },
          });

          await client.query(`
            INSERT INTO sales_bill_items (
              sales_bill_id, product_id, product_name, barcode, sku, qty,
              selling_price, mrp, tax_rate, discount_amount, tax_amount, line_total, batch_allocations
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
          `, [
            bill_id,
            productId,
            item.product_name || item.productName || item.name || product.name,
            item.barcode || product.barcode || null,
            item.sku || product.sku || null,
            qty,
            sellingPrice,
            toNumber(item.mrp, toNumber(product.mrp)),
            taxRate,
            itemDiscount,
            lineTax,
            lineTotal,
            JSON.stringify(allocations),
          ]);

          for (const allocation of allocations) {
            await client.query(
              `INSERT INTO stock_out_items (
                 stock_out_id, product_id, product_name, qty, cost_price, tax_value,
                 batch_id, batch_no, expiry_date, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
              [
                stockOutId,
                productId,
                item.product_name || item.productName || item.name || product.name,
                allocation.qty,
                allocation.costPrice || toNumber(item.cost_price ?? item.costPrice, toNumber(product.cost_price)),
                taxRate,
                allocation.batchId,
                allocation.batchNo,
                allocation.expiryDate,
              ]
            );
          }
        }

        for (const payment of normalizedPayments) {
          await client.query(
            `INSERT INTO sales_bill_payments (sales_bill_id, method, amount, reference_no, meta, created_at)
             VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW())`,
            [bill_id, payment.method || finalPaymentMode, payment.amount, payment.referenceNo || '']
          );
        }

        await client.query('COMMIT');

        syncedCount++;
      } catch (err) {
        errors.push(`Bill sync error: ${err.message}`);
        if (client) await client.query('ROLLBACK').catch(() => {});
      } finally {
        if (client) client.release();
      }
    }

    return successResponse({
      synced_count: syncedCount,
      total_bills: offline_bills.length,
      errors: errors.length > 0 ? errors : null
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// Get bills awaiting sync (client-side data)
export async function GET(req) {
  try {
    // This is a client-side operation, return client instructions
    return successResponse({
      offline_sync_enabled: true,
      storage_key: 'pending_offline_bills',
      instructions: 'Use browser localStorage to store pending bills when offline, sync when connection restored'
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
