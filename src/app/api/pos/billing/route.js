import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError } from '@/lib/api-response';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureSalesReturnsSchema } from '@/lib/salesReturnsSchema';
import { ensureInvoiceSalesOrdersSchema } from '@/lib/invoiceSalesOrdersSchema';
import { allocateBatchStock, ensureInventoryBatchSchema, getInventoryIssueStrategy } from '@/lib/inventoryBatching';
import { auditLog, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { validatePhoneNumber } from '@/lib/phoneValidator';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function POST(req) {
  let client;
  try {
    await ensureSalesBillingSchema();
    await ensureInvoiceSalesOrdersSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING');
    if (permissionCheck.error) return permissionCheck.error;
    const user = auth.user;

    const body = await req.json();
    const {
      store_id,
      customer_id,
      customer_name,
      customer_mobile,
      items = [],
      payment_mode,
      payments = [],
      total_amount,
      total_tax,
      discount_amount = 0,
      round_off = 0,
      notes = '',
      invoice_number,
    } = body;

    if (!store_id || !items.length || !total_amount) {
      return errorResponse('Missing required fields', 400);
    }
    const normalizedCustomerName = String(customer_name || '').trim() || 'Walk-in Customer';
    const normalizedCustomerMobile = String(customer_mobile || '').replace(/\D/g, '').slice(0, 10);
    if (!normalizedCustomerMobile) return errorResponse('Customer mobile number is required for billing', 400);
    const phoneValidation = validatePhoneNumber(normalizedCustomerMobile);
    if (!phoneValidation.isValid) return errorResponse(phoneValidation.error, 400);

    const storeCheck = requireStore(user, store_id);
    if (storeCheck.error) return storeCheck.error;

    client = await getClient();
    await client.query('BEGIN');

    const normalizedItems = [];
    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedExclusiveTax = 0;

    for (const item of items) {
      const productId = Number(item.product_id || item.productId);
      const qty = toNumber(item.qty);
      if (!productId || qty <= 0) throw new Error('Invalid product or quantity');
      const selectedBatchId = Number(item.selectedBatchId || item.selected_batch_id || item.batchId || item.batch_id || 0) || null;
      const selectedBatchIds = (Array.isArray(item.selectedBatchIds) ? item.selectedBatchIds : [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);

      const productRes = await client.query(
        `SELECT p.id, p.name, p.sku, p.barcode, p.mrp, p.selling_price, p.cost_price,
                p.include_tax, COALESCE(t.rate, 0) AS tax_rate, t.name AS tax_name, t.tax_type
         FROM products p
         LEFT JOIN taxes t ON p.tax_id = t.id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [productId]
      );
      const product = productRes.rows[0];
      if (!product) throw new Error(`Product ${productId} not found`);

      const sellingPrice = toNumber(item.selling_price ?? item.sellingPrice, toNumber(product.selling_price));
      const taxRate = toNumber(product.tax_rate);
      const itemDiscount = toNumber(item.discount_amount ?? item.discountAmount);
      const lineSubtotal = qty * sellingPrice;
      const taxableGross = Math.max(0, lineSubtotal - itemDiscount);
      const lineTax = taxRate
        ? product.include_tax
          ? taxableGross - taxableGross / (1 + taxRate / 100)
          : (taxableGross * taxRate) / 100
        : 0;
      const lineTotal = product.include_tax ? taxableGross : Math.max(0, taxableGross + lineTax);

      calculatedSubtotal += lineSubtotal;
      calculatedTax += lineTax;
      if (!product.include_tax) calculatedExclusiveTax += lineTax;
      normalizedItems.push({ item, product, productId, qty, sellingPrice, taxRate, itemDiscount, lineTax, lineTotal, selectedBatchId, selectedBatchIds });
    }

    const billNumber = invoice_number || `POS-${Date.now()}`;
    const subtotal = calculatedSubtotal;
    const taxTotal = calculatedTax;
    const discountTotal = toNumber(discount_amount);
    const grandTotal = Math.max(0, subtotal - discountTotal + calculatedExclusiveTax + toNumber(round_off));
    const normalizedPayments = (Array.isArray(payments) && payments.length ? payments : [{ method: payment_mode || 'cash', amount: grandTotal, referenceNo: '' }])
      .map((payment) => ({
        method: String(payment.method || payment.payment_mode || payment_mode || 'cash').trim().toLowerCase(),
        amount: toNumber(payment.amount),
        referenceNo: String(payment.referenceNo || payment.reference_no || '').trim(),
      }))
      .filter((payment) => payment.amount > 0);
    const paidAmount = normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const finalPaymentMode = normalizedPayments.length > 1 ? 'split' : (normalizedPayments[0]?.method || payment_mode || 'cash');

    const billRes = await client.query(`
      INSERT INTO sales_bills (
        bill_number, store_id, customer_name, customer_mobile,
        subtotal, discount_total, tax_total, round_off, grand_total,
        paid_amount, balance_amount, payment_mode, payment_meta, remarks, user_id, status, meta,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, 0, $11, $12::jsonb, $13, $14, 'completed', $15::jsonb,
        NOW(), NOW()
      ) RETURNING id, bill_number, public_token, created_at
    `, [
      billNumber,
      Number(store_id),
      normalizedCustomerName,
      normalizedCustomerMobile,
      subtotal,
      discountTotal,
      taxTotal,
      toNumber(round_off),
      grandTotal,
      paidAmount,
      finalPaymentMode,
      JSON.stringify(normalizedPayments),
      notes,
      user.id,
      JSON.stringify({
        source: 'legacy-pos-billing',
        customer_id: customer_id || null,
        payments: normalizedPayments,
        billed_by: {
          user_id: user.id,
          name: user.name || user.email || null,
          email: user.email || null,
          role: user.role || null,
        },
      }),
    ]);

    const bill_id = billRes.rows[0]?.id;

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
        Number(store_id),
        billNumber,
        normalizedItems.reduce((sum, row) => sum + row.qty, 0),
        taxTotal,
        String(bill_id),
        JSON.stringify({ source: 'legacy-pos-billing', billId: bill_id, billNumber, billedByUserId: user.id, billedBy: user.name || user.email || null }),
      ]
    );

    const stockOutId = stockOutRes.rows[0]?.id;
    const issueStrategy = getInventoryIssueStrategy();

    for (const row of normalizedItems) {
      const allocations = await allocateBatchStock(client, {
        productId: row.productId,
        storeId: Number(store_id),
        qty: row.qty,
        preferredBatchId: row.selectedBatchIds.length ? null : row.selectedBatchId,
        allowedBatchIds: row.selectedBatchIds,
        strategy: issueStrategy,
        referenceType: 'sales_bill',
        referenceId: bill_id,
        meta: { billNumber, stockOutId },
      });

      await client.query(`
        INSERT INTO sales_bill_items (
          sales_bill_id, product_id, product_name, barcode, sku, qty,
          selling_price, mrp, tax_rate, tax_name, tax_type, include_tax,
          taxable_amount, discount_amount, tax_amount, line_total, batch_allocations
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      `, [
        bill_id,
        row.productId,
        row.item.product_name || row.item.name || row.product.name,
        row.item.barcode || row.product.barcode || null,
        row.item.sku || row.product.sku || null,
        row.qty,
        row.sellingPrice,
        toNumber(row.item.mrp, toNumber(row.product.mrp)),
        row.taxRate,
        row.product.tax_name || null,
        row.product.tax_type || null,
        !!row.product.include_tax,
        row.product.include_tax
          ? Math.max(0, row.qty * row.sellingPrice - row.itemDiscount - row.lineTax)
          : Math.max(0, row.qty * row.sellingPrice - row.itemDiscount),
        row.itemDiscount,
        row.lineTax,
        row.lineTotal,
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
            row.productId,
            row.item.product_name || row.item.name || row.product.name,
            allocation.qty,
            allocation.costPrice || toNumber(row.item.cost_price, toNumber(row.product.cost_price)),
            row.taxRate,
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

    const invoiceRes = await client.query(`
      INSERT INTO invoice_sales_orders (
        transaction_id, sales_order_id, sales_order_type, booking_id, booking_date,
        billing_user_id, sales_bill_id, customer_name, customer_mobile, payment_mode,
        gross_bill, total_discount, invoice_id, invoice_date, status, store_id, meta
      ) VALUES (
        $1, $2, 'POS', $3, CURRENT_DATE,
        $4, $5, $6, $7, $8,
        $9, $10, $11, CURRENT_DATE, 'generated', $12, $13::jsonb
      ) RETURNING id, invoice_id
    `, [
      `INV-${bill_id}`,
      billNumber,
      billNumber,
      user.id,
      bill_id,
      normalizedCustomerName,
      normalizedCustomerMobile,
      finalPaymentMode,
      grandTotal,
      discountTotal,
      billNumber,
      Number(store_id),
      JSON.stringify({ source: 'legacy-pos-billing' }),
    ]);

    await client.query('COMMIT');
    await auditLog(user.id, 'pos_bill.create', 'sales_bill', bill_id, {
      billNumber,
      storeId: Number(store_id),
      grandTotal,
      paidAmount,
      itemCount: normalizedItems.length,
    });

    return successResponse({
      bill_id,
      bill_number: billRes.rows[0]?.bill_number,
      invoice_number: invoiceRes.rows[0]?.invoice_id,
      public_token: billRes.rows[0]?.public_token,
      total_amount: grandTotal,
      total_tax: taxTotal,
      status: 'completed'
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('POS billing error:', err);
    return errorResponse(err.message);
  } finally {
    if (client) client.release();
  }
}

// Get bill details
export async function GET(req) {
  try {
    await ensureSalesBillingSchema();
    await ensureSalesReturnsSchema();

    const { searchParams } = new URL(req.url);
    const bill_id = searchParams.get('bill_id');

    if (!bill_id) return errorResponse('bill_id required', 400);

    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING', 'VIEW_ORDERS', 'MANAGE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const isNumericId = /^\d+$/.test(bill_id);
    const billRes = await query(
      isNumericId
        ? `SELECT * FROM sales_bills WHERE id = $1`
        : `SELECT * FROM sales_bills WHERE bill_number = $1`,
      [bill_id]
    );

    const bill = billRes.rows[0];
    if (!bill) {
      return notFoundError('Bill not found');
    }

    const storeCheck = requireStore(auth.user, bill.store_id);
    if (storeCheck.error) return storeCheck.error;

    const itemsRes = await query(`
      SELECT
        sbi.*,
        COALESCE(sbi.product_name, p.name) AS name,
        COALESCE(sbi.sku, p.sku) AS sku,
        return_state.status AS return_status,
        return_state.return_id,
        return_state.return_number,
        return_state.updated_at AS return_updated_at
      FROM sales_bill_items sbi
      JOIN products p ON sbi.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT sr.status, sr.id AS return_id, sr.return_number, sr.updated_at
        FROM sales_return_items sri
        INNER JOIN sales_returns sr ON sr.id = sri.sales_return_id
        WHERE sr.original_bill_id = sbi.sales_bill_id
          AND sri.product_id = sbi.product_id
          AND sr.status <> 'declined'
        ORDER BY
          CASE sr.status
            WHEN 'completed' THEN 1
            WHEN 'approved' THEN 2
            WHEN 'pending' THEN 3
            ELSE 4
          END,
          sr.updated_at DESC
        LIMIT 1
      ) return_state ON TRUE
      WHERE sbi.sales_bill_id = $1
    `, [bill.id]);
    const paymentsRes = await query(
      `SELECT method, amount, reference_no AS "referenceNo", created_at AS "createdAt"
       FROM sales_bill_payments
       WHERE sales_bill_id = $1
       ORDER BY id ASC`,
      [bill.id]
    );

    return successResponse({
      bill: { ...bill, payments: paymentsRes.rows || [] },
      items: itemsRes.rows || [],
      payments: paymentsRes.rows || []
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
