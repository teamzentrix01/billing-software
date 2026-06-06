import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { verifyToken } from '@/lib/auth-enhanced';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureStoreCashSchema, getStoreCashBalanceSnapshot } from '@/lib/storeCashSchema';
import { extractAuthUser, requirePermission, requireStore } from '@/lib/api-protection';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { sendBillOnWhatsApp } from '@/lib/whatsappService';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy } from '@/lib/inventoryBatching';
import { ensureSettingsSchema } from '@/lib/settingsSchema';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getToken(req) {
  return req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.cookies?.get('access_token')?.value ||
    req.cookies?.get('auth_token')?.value;
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    counterId: row.counter_id,
    deviceId: row.device_id,
    deviceUid: row.device_uid || '',
    counterUid: row.counter_uid || '',
    storeId: row.store_id,
    userName: row.user_name || '',
    storeName: row.store_name || '',
    counterName: row.counter_name || '',
    openingCash: toNumber(row.meta?.opening_cash),
    startedAt: row.session_start_at,
    isActive: row.is_active,
  };
}

function isStoreAllowed(user, storeId) {
  if (!storeId) return false;
  if (user?.role === 'super_admin') return true;
  return (user?.assigned_stores || []).map(Number).includes(Number(storeId));
}

function canManageDiscounts(user) {
  return user?.role === 'super_admin' ||
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && (
      user.permissions.includes('*') ||
      user.permissions.includes('MANAGE_BILLING')
    ));
}

const DEFAULT_PAYMENT_MODES = [
  { id: 1, name: 'Cash', code: 'cash' },
  { id: 2, name: 'UPI', code: 'upi' },
  { id: 3, name: 'Card', code: 'card' },
  { id: 4, name: 'Credit', code: 'credit' },
];

const STANDARD_PAYMENT_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  credit: 'Credit',
  wallet: 'Wallet',
  split: 'Split',
};

function getPaymentLabel(code, fallback = '') {
  const normalized = String(code || '').trim().toLowerCase();
  return STANDARD_PAYMENT_LABELS[normalized] || fallback || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function mergePaymentModes(modes = []) {
  const byCode = new Map();
  for (const mode of DEFAULT_PAYMENT_MODES) {
    byCode.set(mode.code, mode);
  }
  for (const mode of Array.isArray(modes) ? modes : []) {
    if (!mode?.code) continue;
    byCode.set(mode.code, {
      ...mode,
      name: getPaymentLabel(mode.code, mode.name),
    });
  }
  return Array.from(byCode.values());
}

function normalizePaymentMode(row) {
  const config = row.config || {};
  const code = String(config.paymentMode || row.code || row.name || '').trim().toLowerCase();
  if (!code) return null;
  return {
    id: row.id,
    name: getPaymentLabel(code, row.name),
    code,
    provider: config.provider || '',
    settlementAccount: config.settlementAccount || '',
    allowRefund: config.allowRefund !== false,
  };
}

async function loadPaymentModes(storeId) {
  await ensureSettingsSchema();
  const normalizedStoreId = storeId ? Number(storeId) : null;
  const settingsRes = await query(
    `SELECT id, name, code, config, store_id, setting_type
     FROM settings_records
     WHERE is_active = TRUE
       AND (
         (setting_type = 'store-payment-modes' AND (store_id = $1 OR store_id IS NULL))
         OR setting_type = 'chain-payment-settings'
       )
     ORDER BY
       CASE WHEN store_id = $1 THEN 0 WHEN setting_type = 'store-payment-modes' THEN 1 ELSE 2 END,
       name ASC`,
    [normalizedStoreId]
  );

  const byCode = new Map();
  for (const row of settingsRes.rows) {
    const mode = normalizePaymentMode(row);
    if (mode && !byCode.has(mode.code)) byCode.set(mode.code, mode);
  }
  return mergePaymentModes(Array.from(byCode.values()));
}

async function ensureProductDiscountSchema() {
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS allow_discount_on_pos BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS include_tax BOOLEAN NOT NULL DEFAULT FALSE;
  `);
}

function calculateGstLine({ qty, sellingPrice, discountAmount, taxRate, includeTax }) {
  const gross = Math.max(0, qty * sellingPrice - discountAmount);
  const rate = toNumber(taxRate);
  if (!rate || gross <= 0) return { gstAmount: 0, exclusiveGstAmount: 0, taxableAmount: gross, lineTotal: gross };
  if (includeTax) {
    const taxableAmount = gross / (1 + rate / 100);
    return {
      gstAmount: gross - taxableAmount,
      exclusiveGstAmount: 0,
      taxableAmount,
      lineTotal: gross,
    };
  }
  const gstAmount = (gross * rate) / 100;
  return { gstAmount, exclusiveGstAmount: gstAmount, taxableAmount: gross, lineTotal: gross + gstAmount };
}

function getAvailableStockSql(storeParam = '$1') {
  return `
    COALESCE(batch_totals.qty, 0)
  `.trim();
}

function getBatchVariantNumberSql(key, fallbackSql = '0') {
  return `
    CASE
      WHEN ib.meta ? '${key}' AND (ib.meta->>'${key}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN (ib.meta->>'${key}')::numeric
      ELSE ${fallbackSql}
    END
  `.trim();
}

export async function POST(req) {
  let client;
  try {
    await ensureSalesBillingSchema();
    await ensureStoreCashSchema();
    await ensureCatalogExtrasSchema();
    await ensureProductDiscountSchema();
    await ensureInventoryBatchSchema();

    const token = getToken(req);
    if (!token) return errorResponse('Unauthorized', 401);

    const user = verifyToken(token);
    if (!user) return errorResponse('Invalid token', 401);

    const auth = await extractAuthUser(req);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await req.json();
    const {
      clientBillId,
      invoiceNumber,
      sessionId,
      storeId,
      counterId,
      deviceUid = '',
      counterUid = '',
      counterName = '',
      customerName = '',
      customerMobile = '',
      paymentMode,
      payments = [],
      items = [],
      orderDiscount = 0,
      roundOff = 0,
      sendWhatsapp = true,   // POS sends true by default; pass false to suppress
    } = body;

    const normalizedCustomerName = String(customerName || '').trim() || 'Walk-in Customer';
    const normalizedCustomerMobile = String(customerMobile || '').replace(/\D/g, '').slice(0, 10);
    if (!normalizedCustomerMobile) return errorResponse('Customer mobile number is required for billing', 400);
    const phoneValidation = validatePhoneNumber(normalizedCustomerMobile);
    if (!phoneValidation.isValid) return errorResponse(phoneValidation.error, 400);

    if (!storeId || !items.length || !paymentMode) {
      return errorResponse('Missing required fields', 400);
    }

    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;
    const allowDiscounts = canManageDiscounts(auth.user);

    client = await getClient();
    await client.query('BEGIN');

    const normalizedItems = [];
    for (const item of items) {
      const productId = Number(item.productId);
      const qty = toNumber(item.qty);
      if (!productId || qty <= 0) {
        await client.query('ROLLBACK');
        return errorResponse('Invalid product or quantity', 400);
      }

      const requestedBatchId = Number(item.selectedBatchId || item.batchId || 0) || null;
      const requestedBatchIds = (Array.isArray(item.selectedBatchIds) ? item.selectedBatchIds : [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);
      const hasBatchGroup = requestedBatchIds.length > 0;
      const stockRes = await client.query(
        `SELECT
           p.id,
           p.name,
           p.sku,
           p.barcode,
           p.mrp,
           p.cost_price,
           p.allow_discount_on_pos,
           p.include_tax,
           COALESCE(NULLIF(ps.selling_price, 0), p.selling_price, 0) AS selling_price,
           COALESCE(t.rate, 0) AS tax_rate,
           t.name AS tax_name,
           t.tax_type AS tax_type,
           ${hasBatchGroup || requestedBatchId ? 'COALESCE(selected_batches.available_qty, 0)' : getAvailableStockSql('$2')} AS available_stock
         FROM products p
         INNER JOIN product_saleability ps
           ON ps.product_id = p.id
          AND ps.store_id = $2
          AND ps.is_active = TRUE
         LEFT JOIN taxes t ON p.tax_id = t.id
         LEFT JOIN (
           SELECT product_id, SUM(available_qty) AS qty
           FROM inventory_batches
           WHERE store_id = $2
             AND status = 'active'
             AND available_qty > 0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
           GROUP BY product_id
         ) batch_totals ON batch_totals.product_id = p.id
         LEFT JOIN LATERAL (
           SELECT SUM(selected_batch.available_qty) AS available_qty
           FROM inventory_batches selected_batch
           WHERE selected_batch.product_id = p.id
             AND selected_batch.store_id = $2
             AND selected_batch.status = 'active'
             AND selected_batch.available_qty > 0
             AND (selected_batch.expiry_date IS NULL OR selected_batch.expiry_date >= CURRENT_DATE)
             AND (
               ($3::bigint IS NOT NULL AND selected_batch.id = $3::bigint)
               OR (cardinality($4::bigint[]) > 0 AND selected_batch.id = ANY($4::bigint[]))
             )
         ) selected_batches ON TRUE
         LEFT JOIN (
           SELECT sii.product_id, SUM(sii.qty) AS qty
           FROM stock_in_items sii
           INNER JOIN stock_in si ON si.id = sii.stock_in_id
           WHERE si.status = 'confirmed' AND si.destination_id = $2
           GROUP BY sii.product_id
         ) stock_in_totals ON stock_in_totals.product_id = p.id
         LEFT JOIN (
           SELECT sbi.product_id, SUM(sbi.qty) AS qty
           FROM sales_bill_items sbi
           INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
           WHERE sb.status IN ('paid', 'completed') AND sb.store_id = $2
           GROUP BY sbi.product_id
         ) sales_totals ON sales_totals.product_id = p.id
         LEFT JOIN (
           SELECT soi.product_id, SUM(soi.qty) AS qty
           FROM stock_out_items soi
           INNER JOIN stock_out so ON so.id = soi.stock_out_id
           WHERE so.status = 'confirmed'
             AND so.destination_id = $2
             AND COALESCE(so.reference_type, '') <> 'sales_bill'
           GROUP BY soi.product_id
         ) stock_out_totals ON stock_out_totals.product_id = p.id
         WHERE p.id = $1 AND COALESCE(p.is_active, TRUE) = TRUE
         FOR UPDATE OF ps`,
        [productId, Number(storeId), requestedBatchId, requestedBatchIds]
      );

      const dbProduct = stockRes.rows[0];
      if (!dbProduct) {
        await client.query('ROLLBACK');
        return errorResponse(`${item.name || 'Product'} is not assigned to this store`, 400);
      }

      const availableStock = toNumber(dbProduct.available_stock);
      if (availableStock < qty) {
        await client.query('ROLLBACK');
        return errorResponse(`${dbProduct.name} has only ${availableStock} stock in this store`, 400);
      }

      normalizedItems.push({ ...item, productId, qty, selectedBatchId: requestedBatchId, selectedBatchIds: requestedBatchIds, dbProduct });
    }

    let subtotal = 0;
    let totalTax = 0;
    let exclusiveTaxTotal = 0;

    for (const item of normalizedItems) {
      const qty = toNumber(item.qty);
      const sellingPrice = toNumber(item.sellingPrice, toNumber(item.dbProduct.selling_price));
      const discountAmount = allowDiscounts && item.dbProduct?.allow_discount_on_pos ? toNumber(item.discountAmount) : 0;
      const taxRate = toNumber(item.dbProduct.tax_rate);
      const lineAmount = qty * sellingPrice;
      const lineGst = calculateGstLine({ qty, sellingPrice, discountAmount, taxRate, includeTax: item.dbProduct?.include_tax });
      subtotal += lineAmount;
      totalTax += lineGst.gstAmount;
      exclusiveTaxTotal += lineGst.exclusiveGstAmount;
    }

    const allowOrderDiscount = allowDiscounts && normalizedItems.length > 0 && normalizedItems.every((item) => item.dbProduct?.allow_discount_on_pos);
    const totalDiscount = (allowOrderDiscount ? toNumber(orderDiscount) : 0) +
      normalizedItems.reduce((sum, item) => sum + (allowDiscounts && item.dbProduct?.allow_discount_on_pos ? toNumber(item.discountAmount) : 0), 0);
    const grandTotal = Math.max(0, subtotal - totalDiscount + exclusiveTaxTotal + toNumber(roundOff));
    const normalizedPayments = (Array.isArray(payments) && payments.length ? payments : [{ method: paymentMode, amount: grandTotal, referenceNo: '' }])
      .map((payment) => ({
        method: String(payment.method || paymentMode || 'cash').trim().toLowerCase(),
        amount: toNumber(payment.amount),
        referenceNo: String(payment.referenceNo || payment.reference_no || '').trim(),
      }))
      .filter((payment) => payment.amount > 0);
    const paidAmount = normalizedPayments.reduce((sum, p) => sum + p.amount, 0);
    if (!normalizedPayments.length) {
      await client.query('ROLLBACK');
      return errorResponse('Add at least one payment', 400);
    }
    if (Math.abs(paidAmount - grandTotal) > 0.01) {
      await client.query('ROLLBACK');
      return errorResponse(`Payment total must match bill total. Paid ${paidAmount}, bill ${grandTotal}`, 400);
    }
    const finalPaymentMode = normalizedPayments.length > 1 ? 'split' : normalizedPayments[0].method;
    const billNumber = invoiceNumber || `POS-${Date.now()}`;

    const billRes = await client.query(
      `INSERT INTO sales_bills (
        bill_number, session_id, user_id, store_id, counter_id,
        customer_name, customer_mobile, subtotal, discount_total, tax_total,
        round_off, grand_total, paid_amount, balance_amount, payment_mode,
        payment_meta, status, meta, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16::jsonb, 'paid', $17::jsonb, NOW(), NOW()
      ) ON CONFLICT (bill_number) DO NOTHING
      RETURNING id, bill_number, public_token`,
      [
        billNumber,
        sessionId || null,
        auth.user.id,
        Number(storeId),
        counterId || null,
        normalizedCustomerName,
        normalizedCustomerMobile,
        subtotal,
        totalDiscount,
        totalTax,
        toNumber(roundOff),
        grandTotal,
        paidAmount,
        Math.max(0, grandTotal - paidAmount),
        finalPaymentMode,
        JSON.stringify(normalizedPayments),
        JSON.stringify({ clientBillId, source: 'pos', deviceUid, counterUid, counterName }),
      ]
    );

    // Bill already exists (idempotent retry from offline sync) — return existing bill as success
    if (!billRes.rows[0]) {
      await client.query('ROLLBACK');
      const existingRes = await client.query(
        `SELECT id, bill_number, public_token, customer_name, customer_mobile,
                grand_total, tax_total, payment_mode, payment_meta, status, created_at
         FROM sales_bills WHERE bill_number = $1 LIMIT 1`,
        [billNumber]
      );
      const existing = existingRes.rows[0];
      if (existing) {
        return successResponse({
          bill: {
            id:            existing.id,
            invoiceNumber: existing.bill_number,
            billNumber:    existing.bill_number,
            publicToken:   existing.public_token ?? null,
            customerName:  existing.customer_name,
            customerMobile: existing.customer_mobile,
            grandTotal:    toNumber(existing.grand_total),
            totalTax:      toNumber(existing.tax_total),
            paymentMode:   existing.payment_mode,
            payments:      Array.isArray(existing.payment_meta) ? existing.payment_meta : normalizedPayments,
            itemCount:     items.length,
            createdAt:     existing.created_at,
            status:        existing.status || 'paid',
          },
          message: `Bill ${billNumber} already synced`,
        }, 'Bill already synced', 200);
      }
      return errorResponse('Failed to create bill', 500);
    }

    const billId = billRes.rows[0]?.id;
    if (!billId) return errorResponse('Failed to create bill', 500);

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
        `POS-STKO-${billId}`,
        Number(storeId),
        billNumber,
        normalizedItems.reduce((sum, item) => sum + toNumber(item.qty), 0),
        totalTax,
        String(billId),
        JSON.stringify({ source: 'pos', billId, billNumber, deviceUid, counterUid, counterName }),
      ]
    );

    const stockOutId = stockOutRes.rows[0]?.id;
    const issueStrategy = getInventoryIssueStrategy();

    for (const item of normalizedItems) {
      const qty = toNumber(item.qty);
      const sellingPrice = toNumber(item.sellingPrice, toNumber(item.dbProduct.selling_price));
      const discountAmount = allowDiscounts && item.dbProduct?.allow_discount_on_pos ? toNumber(item.discountAmount) : 0;
      const taxRate = toNumber(item.dbProduct.tax_rate);
      const { gstAmount: lineTax, lineTotal, taxableAmount } = calculateGstLine({
        qty,
        sellingPrice,
        discountAmount,
        taxRate,
        includeTax: item.dbProduct?.include_tax,
      });
      const allocations = await allocateBatchStock(client, {
        productId: item.productId,
        storeId: Number(storeId),
        qty,
        preferredBatchId: item.selectedBatchIds.length ? null : item.selectedBatchId,
        allowedBatchIds: item.selectedBatchIds,
        strategy: issueStrategy,
        referenceType: 'sales_bill',
        referenceId: billId,
        meta: { billNumber, stockOutId },
      });

      await client.query(
        `INSERT INTO sales_bill_items (
          sales_bill_id, product_id, product_name, barcode, sku, qty,
          selling_price, mrp, tax_rate, tax_name, tax_type, include_tax,
          taxable_amount, discount_amount, tax_amount, line_total, batch_allocations
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)`,
        [
          billId,
          item.productId,
          item.name || item.dbProduct.name || 'Product',
          item.barcode || item.dbProduct.barcode || null,
          item.sku || item.dbProduct.sku || null,
          qty,
          sellingPrice,
          toNumber(item.mrp),
          taxRate,
          item.dbProduct.tax_name || null,
          item.dbProduct.tax_type || null,
          !!item.dbProduct.include_tax,
          taxableAmount,
          discountAmount,
          lineTax,
          lineTotal,
          JSON.stringify(allocations),
        ]
      );

      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO stock_out_items (
             stock_out_id, product_id, product_name, qty, cost_price, tax_value,
             batch_id, batch_no, expiry_date, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            stockOutId,
            item.productId,
            item.name || item.dbProduct.name || 'Product',
            allocation.qty,
            allocation.costPrice || toNumber(item.dbProduct.cost_price),
            toNumber(item.dbProduct.tax_rate),
            allocation.batchId,
            allocation.batchNo,
            allocation.expiryDate,
          ]
        );
      }
    }

    for (const payment of normalizedPayments) {
      await client.query(
        `INSERT INTO sales_bill_payments (
          sales_bill_id, method, amount, reference_no, meta, created_at
        ) VALUES ($1, $2, $3, $4, '{}'::jsonb, NOW())`,
        [billId, payment.method || finalPaymentMode, toNumber(payment.amount, grandTotal), payment.referenceNo || '']
      );
    }

    await client.query('COMMIT');

    // ── WhatsApp receipt (fire-and-forget, never blocks the response) ──────
    if (sendWhatsapp && normalizedCustomerMobile) {
      // Fetch store name outside the now-released transaction
      query('SELECT name FROM stores WHERE id = $1', [Number(storeId)])
        .then(({ rows }) => {
          const storeName = rows[0]?.name || 'Our Store';
          const waItems   = normalizedItems.map((item) => ({
            productName: item.name || item.dbProduct?.name || 'Product',
            qty:         toNumber(item.qty),
            lineTotal:   toNumber(item.qty) * toNumber(item.sellingPrice, toNumber(item.dbProduct?.selling_price)),
          }));

          return sendBillOnWhatsApp({
            customerMobile: normalizedCustomerMobile,
            storeName,
            billNumber,
            customerName: normalizedCustomerName,
            items:         waItems,
            subtotal,
            discountTotal: totalDiscount,
            taxTotal:      totalTax,
            grandTotal,
            paymentMode: finalPaymentMode,
            publicToken:   billRes.rows[0].public_token ?? null,
            createdAt:     new Date().toISOString(),
          });
        })
        .then(({ to }) =>
          query(
            'UPDATE sales_bills SET whatsapp_sent = TRUE, whatsapp_sent_at = NOW(), whatsapp_number = $1 WHERE id = $2',
            [to, billId]
          )
        )
        .catch((err) =>
          console.warn('[WhatsApp] Send failed for bill', billNumber, '—', err.message)
        );
    }

    return successResponse({
      bill: {
        id:            billId,
        invoiceNumber: billRes.rows[0].bill_number,
        billNumber:    billRes.rows[0].bill_number,
        publicToken:   billRes.rows[0].public_token ?? null,
        customerName: normalizedCustomerName,
        customerMobile: normalizedCustomerMobile,
        grandTotal,
        totalTax,
        paymentMode: finalPaymentMode,
        payments: normalizedPayments,
        itemCount:  items.length,
        createdAt:  new Date().toISOString(),
        status:     'paid',
      },
      message: `Bill ${billRes.rows[0].bill_number} created successfully`,
    }, 'Bill created successfully', 201);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('POS billing error:', err);
    return errorResponse(err.message, 500);
  } finally {
    if (client) client.release();
  }
}

export async function GET(req) {
  try {
    await ensureSalesBillingSchema();
    await ensureStoreCashSchema();
    await ensureCatalogExtrasSchema();
    await ensureProductDiscountSchema();
    await ensureInventoryBatchSchema();

    const auth = await extractAuthUser(req);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING', 'VIEW_ORDERS', 'MANAGE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '48', 10);
    const search = searchParams.get('search') || '';
    const requestedStoreId = Number(searchParams.get('store_id') || 0) || null;
    const requestedDeviceUid = String(searchParams.get('device_uid') || '').trim();
    const requestedCounterUid = String(searchParams.get('counter_uid') || '').trim();
    const offset = (page - 1) * pageSize;

    const sessionParams = [auth.user.id];
    let sessionFilter = `ucs.is_active = TRUE AND ucs.user_id = $1`;
    if (requestedDeviceUid) {
      sessionParams.push(requestedDeviceUid);
      sessionFilter += ` AND COALESCE(ucs.device_uid, '') = $${sessionParams.length}`;
    }
    if (requestedCounterUid) {
      sessionParams.push(requestedCounterUid);
      sessionFilter += ` AND COALESCE(ucs.counter_uid, '') = $${sessionParams.length}`;
    }

    const sessionRes = await query(
      `SELECT ucs.id, ucs.user_id, ucs.counter_id, ucs.device_id, ucs.store_id,
              ucs.session_id, ucs.session_start_at, ucs.session_end_at, ucs.is_active,
              ucs.serial_number, ucs.counter_name, ucs.device_uid, ucs.counter_uid, ucs.meta,
              u.name AS user_name, s.name AS store_name
       FROM user_counter_sessions ucs
       LEFT JOIN users u ON u.id = ucs.user_id
       LEFT JOIN stores s ON s.id = ucs.store_id
       WHERE ${sessionFilter}
       ORDER BY ucs.session_start_at DESC, ucs.id DESC
       LIMIT 1`,
      sessionParams
    );

    const isGlobalStoreAccess = auth.user.role === 'super_admin';
    const assignedStores = (auth.user.assigned_stores || []).map(Number).filter(Number.isFinite);
    const storesRes = isGlobalStoreAccess
      ? await query('SELECT id, name FROM stores ORDER BY name ASC')
      : assignedStores.length
        ? await query('SELECT id, name FROM stores WHERE id = ANY($1::int[]) ORDER BY name ASC', [assignedStores])
        : { rows: [] };

    const session = mapSession(sessionRes.rows[0]);
    const effectiveStoreId = isStoreAllowed(auth.user, requestedStoreId)
      ? requestedStoreId
      : isStoreAllowed(auth.user, session?.storeId)
        ? Number(session.storeId)
        : !isGlobalStoreAccess && assignedStores.length === 1
          ? assignedStores[0]
          : null;

    const params = [];
    let productsSql = `
      SELECT
        p.id,
        p.name,
        p.sku,
        p.barcode,
        COALESCE(batch_variant.variant_mrp, p.mrp, 0) AS mrp,
        COALESCE(batch_variant.variant_selling_price, NULLIF(ps.selling_price, 0), p.selling_price, 0) AS selling_price,
        COALESCE(batch_variant.variant_cost_price, p.cost_price, 0) AS cost_price,
        p.allow_discount_on_pos,
        p.include_tax,
        c.name AS "categoryName",
        b.name AS "brandName",
        COALESCE(batch_variant.qty, 0) AS "availableStock",
        COALESCE(t.rate, 0) AS "taxRate",
        batch_variant.preferred_batch_id AS "selectedBatchId",
        COALESCE(batch_variant.batch_ids, '[]'::jsonb) AS "selectedBatchIds",
        p.id::text || ':price:' ||
          COALESCE(batch_variant.variant_mrp, p.mrp, 0)::text || ':' ||
          COALESCE(batch_variant.variant_selling_price, NULLIF(ps.selling_price, 0), p.selling_price, 0)::text || ':' ||
          COALESCE(batch_variant.variant_cost_price, p.cost_price, 0)::text AS "variantKey"
      FROM products p
      INNER JOIN product_saleability ps
        ON ps.product_id = p.id
       AND ps.store_id = $1
       AND ps.is_active = TRUE
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN taxes t ON p.tax_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          MIN(priced.id) AS preferred_batch_id,
          jsonb_agg(priced.id ORDER BY priced.expiry_date NULLS LAST, priced.created_at, priced.id) AS batch_ids,
          priced.variant_mrp,
          priced.variant_selling_price,
          priced.variant_cost_price,
          SUM(priced.available_qty) AS qty
        FROM (
          SELECT
            ib.id,
            ib.available_qty,
            ib.expiry_date,
            ib.created_at,
            ${getBatchVariantNumberSql('mrp', 'COALESCE(p.mrp, 0)')} AS variant_mrp,
            ${getBatchVariantNumberSql('sellingPrice', 'COALESCE(NULLIF(ps.selling_price, 0), p.selling_price, 0)')} AS variant_selling_price,
            ${getBatchVariantNumberSql('costPrice', 'COALESCE(ib.cost_price, p.cost_price, 0)')} AS variant_cost_price
          FROM inventory_batches ib
          WHERE ib.product_id = p.id
            AND ib.store_id = $1
            AND ib.status = 'active'
            AND ib.available_qty > 0
            AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
        ) priced
        GROUP BY priced.variant_mrp, priced.variant_selling_price, priced.variant_cost_price
      ) batch_variant ON TRUE
      LEFT JOIN (
        SELECT sii.product_id, SUM(sii.qty) AS qty
        FROM stock_in_items sii
        INNER JOIN stock_in si ON si.id = sii.stock_in_id
        WHERE si.status = 'confirmed' AND si.destination_id = $1
        GROUP BY sii.product_id
      ) stock_in_totals ON stock_in_totals.product_id = p.id
      LEFT JOIN (
        SELECT sbi.product_id, SUM(sbi.qty) AS qty
        FROM sales_bill_items sbi
        INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
        WHERE sb.status IN ('paid', 'completed') AND sb.store_id = $1
        GROUP BY sbi.product_id
      ) sales_totals ON sales_totals.product_id = p.id
      LEFT JOIN (
        SELECT soi.product_id, SUM(soi.qty) AS qty
        FROM stock_out_items soi
        INNER JOIN stock_out so ON so.id = soi.stock_out_id
        WHERE so.status = 'confirmed'
          AND so.destination_id = $1
          AND COALESCE(so.reference_type, '') <> 'sales_bill'
        GROUP BY soi.product_id
      ) stock_out_totals ON stock_out_totals.product_id = p.id
      WHERE COALESCE(p.is_active, TRUE) = TRUE
    `;

    if (!effectiveStoreId) {
      return successResponse({
        products: [],
        recentBills: [],
        paymentModes: DEFAULT_PAYMENT_MODES,
        session,
        stores: storesRes.rows,
        selectedStoreId: null,
        pagination: { page, pageSize, total: 0 },
      });
    }

    params.push(effectiveStoreId);

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      productsSql += ` AND (
        LOWER(COALESCE(p.name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(p.sku, '')) LIKE $${params.length}
        OR LOWER(COALESCE(p.barcode, '')) LIKE $${params.length}
      )`;
    }

    if (!isGlobalStoreAccess && assignedStores.length === 0) {
      return successResponse({
        products: [],
        recentBills: [],
        paymentModes: DEFAULT_PAYMENT_MODES,
        session,
        stores: [],
        selectedStoreId: null,
        pagination: { page, pageSize, total: 0 },
      });
    }

    params.push(pageSize, offset);
    productsSql += ` ORDER BY p.name ASC, selling_price ASC, mrp ASC, cost_price ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const productsRes = await query(productsSql, params);

    const billParams = [];
    let billsSql = `
      SELECT
        id,
        bill_number AS "billNumber",
        customer_name AS "customerName",
        grand_total AS "grandTotal",
        payment_mode AS "paymentMode",
        payment_meta AS "payments",
        status,
        created_at AS "createdAt"
      FROM sales_bills
    `;
    if (!isGlobalStoreAccess) {
      billParams.push(effectiveStoreId);
      billsSql += ` WHERE store_id = $1`;
    } else if (effectiveStoreId) {
      billParams.push(effectiveStoreId);
      billsSql += ` WHERE store_id = $1`;
    }
    billsSql += ` ORDER BY created_at DESC
      LIMIT 10
    `;
    const billsRes = await query(billsSql, billParams);
    const paymentModes = await loadPaymentModes(effectiveStoreId);
    const storeCash = await getStoreCashBalanceSnapshot(effectiveStoreId);

    return successResponse({
      products: productsRes.rows,
      recentBills: billsRes.rows,
      paymentModes,
      session,
      stores: storesRes.rows,
      selectedStoreId: effectiveStoreId,
      storeCash,
      pagination: { page, pageSize, total: productsRes.rowCount },
    });
  } catch (err) {
    console.error('POS fetch error:', err);
    return errorResponse(err.message, 500);
  }
}

export async function PUT(req) {
  try {
    const body = await req.json();
    const { offlineBills = [] } = body;

    if (!Array.isArray(offlineBills) || offlineBills.length === 0) {
      return errorResponse('No bills to sync', 400);
    }

    return successResponse({
      syncedCount: 0,
      totalBills: offlineBills.length,
      errors: ['Please sync offline bills by replaying each bill through POST /api/sales-order/pos.'],
    });
  } catch (err) {
    console.error('Sync error:', err);
    return errorResponse(err.message, 500);
  }
}
