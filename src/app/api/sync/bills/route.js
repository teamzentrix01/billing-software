/**
 * POST /api/sync/bills
 *
 * Accepts a batch of offline-created bills from the browser's IndexedDB and
 * commits them to PostgreSQL.
 *
 * Idempotency: every bill carries a sync_id (UUID).  The server uses
 * ON CONFLICT (sync_id) to silently skip duplicates — re-sending the same
 * batch is always safe.
 *
 * Inventory: each bill creates a stock_out record that feeds into the same
 * stock-level formula used by the existing POS route, so offline sales
 * reduce inventory correctly after sync.
 *
 * Response shape:
 *   { synced: string[], duplicates: string[], failed: { syncId, error }[] }
 */

import { NextResponse }       from 'next/server';
import { query }              from '@/lib/db';
import { sendBillOnWhatsApp } from '@/lib/whatsappService';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy } from '@/lib/inventoryBatching';
import { requireAuth, requireStore } from '@/lib/api-protection';
import { validatePhoneNumber } from '@/lib/phoneValidator';

export async function POST(request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user;
  await ensureSalesBillingSchema();
  await ensureInventoryBatchSchema();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { bills } = body;
  if (!Array.isArray(bills) || bills.length === 0) {
    return NextResponse.json({ synced: [], duplicates: [], failed: [] });
  }

  const synced     = [];
  const duplicates = [];
  const failed     = [];

  for (const bill of bills) {
    const syncId = bill.syncId;
    const billStoreId = Number(bill.storeId || bill.store_id || 0) || null;

    if (!syncId) {
      failed.push({ syncId: null, error: 'Missing syncId' });
      continue;
    }

    const storeCheck = requireStore(user, billStoreId);
    if (storeCheck.error) {
      failed.push({ syncId, error: `No access to store ${billStoreId || '-'}` });
      continue;
    }

    try {
      // ── Deduplication check ────────────────────────────────────────────
      const existing = await query(
        'SELECT id FROM sales_bills WHERE sync_id = $1',
        [syncId]
      );

      if (existing.rows.length > 0) {
        duplicates.push(syncId);
        continue;
      }

      // ── Compute totals from items if the client didn't send them ───────
      const items        = Array.isArray(bill.items) ? bill.items : [];
      const subtotal     = bill.subtotal     ?? items.reduce((s, i) => s + Number(i.lineTotal ?? (i.qty * i.sellingPrice)), 0);
      const discountTotal = bill.discountTotal ?? items.reduce((s, i) => s + Number(i.discountAmount ?? 0), 0);
      const taxTotal     = bill.taxTotal     ?? items.reduce((s, i) => s + Number(i.taxAmount ?? 0), 0);
      const roundOff     = bill.roundOff     ?? 0;
      const grandTotal   = bill.grandTotal   ?? (subtotal - discountTotal + taxTotal + roundOff);
      const paidAmount   = bill.paidAmount   ?? grandTotal;
      const balanceAmount = bill.balanceAmount ?? 0;
      const normalizedCustomerName = String(bill.customerName || bill.customer_name || '').trim() || 'Walk-in Customer';
      const normalizedCustomerMobile = String(bill.customerMobile || bill.customer_mobile || '').replace(/\D/g, '').slice(0, 10);
      if (!normalizedCustomerMobile) {
        failed.push({ syncId, error: 'Customer mobile number is required for billing' });
        continue;
      }
      const phoneValidation = validatePhoneNumber(normalizedCustomerMobile);
      if (!phoneValidation.isValid) {
        failed.push({ syncId, error: phoneValidation.error });
        continue;
      }

      const billCreatedAt = bill.createdAt ? new Date(bill.createdAt) : new Date();

      // ── Insert sales_bills ─────────────────────────────────────────────
      const billResult = await query(
        `INSERT INTO sales_bills (
           sync_id,       bill_number,    session_id,     user_id,
           store_id,      counter_id,     customer_name,  customer_mobile,
           subtotal,      discount_total, tax_total,      round_off,
           grand_total,   paid_amount,    balance_amount, payment_mode,
           payment_meta,  status,         remarks,
           created_offline, device_id,   created_at,     updated_at
         ) VALUES (
           $1,  $2,  $3,  $4,
           $5,  $6,  $7,  $8,
           $9,  $10, $11, $12,
           $13, $14, $15, $16,
           $17::jsonb, $18, $19,
           TRUE, $20, $21, $21
         )
         RETURNING id, bill_number`,
        [
          syncId,
          bill.billNumber    || `OFL-${syncId.slice(0, 8).toUpperCase()}`,
          bill.sessionId     || null,
          user.id,
          billStoreId,
          bill.counterId     || null,
          normalizedCustomerName,
          normalizedCustomerMobile,
          subtotal,
          discountTotal,
          taxTotal,
          roundOff,
          grandTotal,
          paidAmount,
          balanceAmount,
          bill.paymentMode   || 'cash',
          JSON.stringify(bill.payments || []),
          bill.status        || 'paid',
          bill.remarks       || null,
          bill.deviceId      || null,
          billCreatedAt,
        ]
      );

      const salesBillId  = billResult.rows[0].id;
      const billNumber   = billResult.rows[0].bill_number;

      // ── Insert sales_bill_items ────────────────────────────────────────
      for (const item of items) {
        const lineTotal = item.lineTotal ?? (Number(item.qty) * Number(item.sellingPrice));
        await query(
          `INSERT INTO sales_bill_items (
             sales_bill_id,  product_id,      product_name, barcode,
             sku,            qty,             mrp,          selling_price,
             discount_amount, tax_rate,       tax_amount,   line_total
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            salesBillId,
            item.productId       || null,
            item.productName     || item.name || 'Unknown',
            item.barcode         || null,
            item.sku             || null,
            item.qty,
            item.mrp             || item.sellingPrice || 0,
            item.sellingPrice    || 0,
            item.discountAmount  || 0,
            item.taxRate         || 0,
            item.taxAmount       || 0,
            lineTotal,
          ]
        );
      }

      // ── Insert sales_bill_payments ─────────────────────────────────────
      const payments = Array.isArray(bill.payments) ? bill.payments : [];
      for (const payment of payments) {
        await query(
          `INSERT INTO sales_bill_payments (sales_bill_id, method, amount, reference_no)
           VALUES ($1, $2, $3, $4)`,
          [salesBillId, payment.method, payment.amount, payment.referenceNo || null]
        );
      }

      // ── Create stock_out + items for inventory tracking ────────────────
      if (items.length > 0) {
        const totalQty   = items.reduce((s, i) => s + Number(i.qty), 0);
        const stockOutTxId = `SO-${syncId.slice(0, 12)}`;

        const soResult = await query(
          `INSERT INTO stock_out (
             transaction_id, method,  destination_id,
             reference_type, reference_id,
             status,         total_items, confirmed_at, created_at
           ) VALUES ($1, 'sale', $2, 'sales_bill', $3, 'confirmed', $4, $5, $5)
           RETURNING id`,
          [stockOutTxId, billStoreId, billNumber, totalQty, billCreatedAt]
        );

        const stockOutId = soResult.rows[0].id;
        const issueStrategy = getInventoryIssueStrategy(bill.issueStrategy);

        for (const item of items) {
          const allocations = await allocateBatchStock({ query }, {
            productId: item.productId,
            storeId: billStoreId,
            qty: item.qty,
            strategy: issueStrategy,
            referenceType: 'offline_sales_bill',
            referenceId: salesBillId,
            meta: { syncId, billNumber },
          });

          for (const allocation of allocations) {
            await query(
              `INSERT INTO stock_out_items (
                 stock_out_id, product_id, product_name, qty, cost_price,
                 batch_id, batch_no, expiry_date
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                stockOutId,
                item.productId || null,
                item.productName || item.name || 'Unknown',
                allocation.qty,
                allocation.costPrice || item.costPrice || 0,
                allocation.batchId,
                allocation.batchNo,
                allocation.expiryDate,
              ]
            );
          }
        }

        // Check for inventory conflicts (stock went negative) — log only, don't block
        for (const item of items) {
          if (!item.productId) continue;
          try {
            const stockCheck = await query(
              `SELECT
                 COALESCE(si.qty,  0)  AS stock_in,
                 COALESCE(so.qty,  0)  AS stock_out,
                 COALESCE(sb.qty,  0)  AS sold
               FROM (SELECT $1::BIGINT AS pid) base
               LEFT JOIN LATERAL (
                 SELECT COALESCE(SUM(sii.qty), 0) AS qty
                 FROM stock_in_items sii
                 JOIN stock_in sin ON sin.id = sii.stock_in_id
                 WHERE sii.product_id = base.pid AND sin.destination_id = $2
               ) si ON TRUE
               LEFT JOIN LATERAL (
                 SELECT COALESCE(SUM(soi.qty), 0) AS qty
                 FROM stock_out_items soi
                 JOIN stock_out sou ON sou.id = soi.stock_out_id
                 WHERE soi.product_id = base.pid AND sou.destination_id = $2
                   AND sou.method = 'sale'
               ) so ON TRUE
               LEFT JOIN LATERAL (
                 SELECT COALESCE(SUM(bi.qty), 0) AS qty
                 FROM sales_bill_items bi
                 JOIN sales_bills b ON b.id = bi.sales_bill_id
                 WHERE bi.product_id = base.pid AND b.store_id = $2
               ) sb ON TRUE`,
              [item.productId, billStoreId]
            );

            const row = stockCheck.rows[0];
            const available = Number(row.stock_in) - Number(row.stock_out) - Number(row.sold);

            if (available < 0) {
              await query(
                `INSERT INTO sync_conflicts
                   (sync_id, conflict_type, resolution, details)
                 VALUES ($1, 'inventory_negative', 'auto_resolved', $2::jsonb)`,
                [
                  syncId,
                  JSON.stringify({
                    productId:  item.productId,
                    productName: item.productName || item.name,
                    available,
                    soldOffline: item.qty,
                  }),
                ]
              );
            }
          } catch {
            // Inventory conflict check is non-critical — never block the sync
          }
        }
      }

      // ── Record in sync queue ───────────────────────────────────────────
      await query(
        `INSERT INTO offline_sync_queue
           (sync_id, device_id, user_id, entity_type, payload, status, created_offline_at, synced_at)
         VALUES ($1, $2, $3, 'bill', $4::jsonb, 'synced', $5, NOW())
         ON CONFLICT (sync_id) DO UPDATE
           SET status = 'synced', synced_at = NOW()`,
        [
          syncId,
          bill.deviceId       || null,
          user.id,
          JSON.stringify(bill),
          billCreatedAt,
        ]
      );

      // ── WhatsApp receipt for offline-synced bills ───────────────────────
      if (normalizedCustomerMobile) {
        query('SELECT name FROM stores WHERE id = $1', [billStoreId])
          .then(async ({ rows }) => {
            const storeName = rows[0]?.name || 'Our Store';
            // Fetch the public_token that was just inserted
            const tokenRow = await query(
              'SELECT public_token FROM sales_bills WHERE sync_id = $1',
              [syncId]
            );
            return sendBillOnWhatsApp({
              customerMobile: normalizedCustomerMobile,
              storeName,
              billNumber:     bill.billNumber || billNumber,
              customerName:   normalizedCustomerName,
              items:          (bill.items || []).map((i) => ({
                productName: i.productName || i.name || 'Item',
                qty:         i.qty,
                lineTotal:   i.lineTotal ?? i.total ?? (i.qty * (i.sellingPrice || 0)),
              })),
              subtotal:       bill.subtotal      || 0,
              discountTotal:  bill.discountTotal  || 0,
              taxTotal:       bill.taxTotal       || 0,
              grandTotal:     bill.grandTotal     || 0,
              paymentMode:    bill.paymentMode    || 'Cash',
              publicToken:    tokenRow.rows[0]?.public_token ?? null,
              createdAt:      bill.createdAt      || new Date().toISOString(),
            });
          })
          .then(({ to }) =>
            query(
              'UPDATE sales_bills SET whatsapp_sent = TRUE, whatsapp_sent_at = NOW(), whatsapp_number = $1 WHERE sync_id = $2',
              [to, syncId]
            )
          )
          .catch((err) =>
            console.warn('[WhatsApp/Sync] Send failed for syncId', syncId, '—', err.message)
          );
      }

      synced.push(syncId);
    } catch (err) {
      console.error('[SYNC/BILLS] Failed for syncId', syncId, ':', err.message);
      failed.push({ syncId, error: err.message });
    }
  }

  return NextResponse.json({ synced, duplicates, failed });
}
