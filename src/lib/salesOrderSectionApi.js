import { query } from '@/lib/db';
import { ensureInvoiceSalesOrdersSchema } from '@/lib/invoiceSalesOrdersSchema';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureCustomersSchema } from '@/lib/customersSchema';
import { getAssignedStoreIds, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

const VIEW_FILTER_SQL = {
  'invoice-sales-order': "(iso.invoice_id IS NOT NULL OR LOWER(COALESCE(iso.status, '')) LIKE 'invoiced%')",
  'uninvoiced-sales-order': "(iso.invoice_id IS NULL OR LOWER(COALESCE(iso.status, '')) NOT LIKE 'invoiced%')",
  'bulk-sales-order': "(LOWER(COALESCE(iso.sales_order_type, '')) LIKE 'bulk%' OR LOWER(COALESCE(iso.status, '')) LIKE 'bulk%')",
  'invoice-conversion-tracker': "(iso.invoice_id IS NOT NULL OR iso.converted_by IS NOT NULL OR iso.converted_at IS NOT NULL)",
  'write-off': "(LOWER(COALESCE(iso.status, '')) LIKE 'written off%' OR iso.write_off_amount > 0)",
  'quotation-pending-approval': "(LOWER(COALESCE(iso.status, '')) LIKE 'quotation pending approval%' OR (iso.quotation_id IS NOT NULL AND iso.invoice_id IS NULL))",
  'auto-invoice': "(iso.auto_invoice_id IS NOT NULL OR LOWER(COALESCE(iso.status, '')) LIKE 'auto invoice%')",
};

const VIEW_LABELS = {
  'invoice-sales-order': 'Invoice Sales Order',
  'uninvoiced-sales-order': 'Uninvoiced Sales Order',
  'bulk-sales-order': 'Bulk Sales Order',
  'invoice-conversion-tracker': 'Invoice Conversion Tracker',
  'write-off': 'Write Off',
  'quotation-pending-approval': 'Quotation Pending Approval',
  'auto-invoice': 'Auto Invoice',
};

function normalizeView(view) {
  const normalized = String(view || '').trim().toLowerCase();
  return VIEW_FILTER_SQL[normalized] ? normalized : 'invoice-sales-order';
}

function parseDatePart(value) {
  if (!value) return null;
  const date = new Date(String(value).trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseDateRange(dateRange) {
  if (!dateRange) return null;

  const text = String(dateRange).trim();
  if (!text || text.toLowerCase() === 'all') return null;

  const parts = text.split(' - ').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const single = parseDatePart(parts[0]);
    return single ? { start: single, end: single } : null;
  }

  if (parts.length >= 2) {
    const start = parseDatePart(parts[0]);
    const end = parseDatePart(parts[1]);
    if (start && end) return { start, end };
  }

  return null;
}

function normalizeStoreFilter(stores) {
  const text = String(stores || '').trim();
  if (!text || /^all$/i.test(text) || /regions?\s*&\s*stores?/i.test(text)) {
    return null;
  }

  return text;
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];

  return ids
    .map((value) => String(value).replace(/^(SO-|POS-)/, ''))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapSalesOrderRow(row) {
  const grossBill = asNumber(row.gross_bill);
  const additionalChargeValue = asNumber(row.additional_charge_value);
  const totalDiscount = asNumber(row.total_discount);
  const writeOffAmount = asNumber(row.write_off_amount);
  const grandTotal = asNumber(
    row.grand_total,
    Math.max(grossBill + additionalChargeValue - totalDiscount - writeOffAmount, 0)
  );
  const billNumber = row.bill_number || row.invoice_id || row.sales_order_id || '';
  const paymentMode = row.payment_mode || row.channel || '';
  const createdAt = row.created_at || row.invoice_date || row.booking_date || row.submitted_date;

  return {
    id: row.id,
    source: row.source || 'sales_order',
    billNumber,
    customerName: row.customer_name || '',
    billingUser: row.billing_username || row.billing_name || row.created_by || '',
    grandTotal,
    paymentMode,
    createdAt,
    sales_order_id: row.sales_order_id,
    sales_order_type: row.sales_order_type || '',
    booking_id: row.booking_id,
    booking_date: row.booking_date,
    billing_username: row.billing_username || row.billing_name || '',
    created_by: row.created_by || '',
    submitted_date: row.submitted_date,
    approver: row.approver || '',
    gross_bill: row.gross_bill,
    additional_charge_value: row.additional_charge_value,
    total_discount: row.total_discount,
    tds_rate: row.tds_rate,
    tds_value: row.tds_value,
    tcs_rate: row.tcs_rate,
    tcs_value: row.tcs_value,
    quotation_id: row.quotation_id || '',
    invoice_id: row.invoice_id || '',
    publicToken: row.public_token || '',
    invoice_date: row.invoice_date,
    auto_invoice_id: row.auto_invoice_id || '',
    auto_invoice_date: row.auto_invoice_date,
    write_off_amount: row.write_off_amount,
    write_off_reason: row.write_off_reason || '',
    written_off_by: row.written_off_by || '',
    written_off_date: row.written_off_date,
    converted_by: row.converted_by || '',
    converted_at: row.converted_at,
    status: row.status,
    channel: row.channel || '',
    store_id: row.store_id,
    store_name: row.store_name || '',
  };
}

function buildInvoiceSalesOrderSql(whereSql) {
  return `
    SELECT ('SO-' || iso.id::text) AS id,
           'sales_order' AS source,
           iso.sales_order_id,
           iso.sales_order_type,
           COALESCE(NULLIF(iso.invoice_id, ''), iso.sales_order_id) AS bill_number,
           iso.booking_id,
           iso.booking_date,
           COALESCE(iso.billing_username, u.name) AS billing_username,
           COALESCE(
             NULLIF(iso.customer_name, ''),
             NULLIF(iso.meta->>'customerName', ''),
             NULLIF(iso.meta->>'customer_name', ''),
             NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '')
           ) AS customer_name,
           COALESCE(NULLIF(iso.payment_mode, ''), NULLIF(iso.meta->>'paymentMode', ''), NULLIF(iso.meta->>'payment_mode', ''), iso.channel) AS payment_mode,
           iso.created_by,
           iso.submitted_date,
           iso.approver,
           iso.gross_bill,
           iso.additional_charge_value,
           iso.total_discount,
           iso.tds_rate,
           iso.tds_value,
           iso.tcs_rate,
           iso.tcs_value,
           iso.quotation_id,
           iso.invoice_id,
           NULL::uuid AS public_token,
           iso.invoice_date,
           iso.auto_invoice_id,
           iso.auto_invoice_date,
           iso.write_off_amount,
           iso.write_off_reason,
           iso.written_off_by,
           iso.written_off_date,
           iso.converted_by,
           iso.converted_at,
           iso.status,
           iso.channel,
           iso.store_id,
           s.name AS store_name,
           iso.created_at,
           GREATEST(COALESCE(iso.gross_bill, 0) + COALESCE(iso.additional_charge_value, 0) - COALESCE(iso.total_discount, 0) - COALESCE(iso.write_off_amount, 0), 0) AS grand_total
    FROM invoice_sales_orders iso
    LEFT JOIN users u ON u.id = iso.billing_user_id
    LEFT JOIN customers c ON (
      iso.booking_id = c.customer_code
      OR iso.booking_id = c.id::text
      OR (iso.meta->>'customer_id') = c.id::text
    )
    LEFT JOIN stores s ON s.id = iso.store_id
    ${whereSql}
  `;
}

function buildSalesBillSql(whereSql) {
  return `
    SELECT ('POS-' || sb.id::text) AS id,
           'sales_bill' AS source,
           sb.bill_number AS sales_order_id,
           'POS Sale' AS sales_order_type,
           sb.bill_number AS bill_number,
           COALESCE(sb.customer_mobile, sb.bill_number) AS booking_id,
           sb.created_at::date AS booking_date,
           COALESCE(u.name, '') AS billing_username,
           COALESCE(NULLIF(sb.customer_name, ''), 'Walk-in Customer') AS customer_name,
           sb.payment_mode AS payment_mode,
           COALESCE(u.name, '') AS created_by,
           sb.created_at::date AS submitted_date,
           '' AS approver,
           sb.subtotal AS gross_bill,
           0::numeric AS additional_charge_value,
           sb.discount_total AS total_discount,
           0::numeric AS tds_rate,
           0::numeric AS tds_value,
           0::numeric AS tcs_rate,
           0::numeric AS tcs_value,
           '' AS quotation_id,
           sb.bill_number AS invoice_id,
           sb.public_token,
           sb.created_at::date AS invoice_date,
           '' AS auto_invoice_id,
           NULL::date AS auto_invoice_date,
           0::numeric AS write_off_amount,
           '' AS write_off_reason,
           '' AS written_off_by,
           NULL::date AS written_off_date,
           COALESCE(u.name, '') AS converted_by,
           sb.created_at AS converted_at,
           sb.status,
           sb.payment_mode AS channel,
           sb.store_id,
           s.name AS store_name,
           sb.created_at,
           sb.grand_total
    FROM sales_bills sb
    LEFT JOIN users u ON u.id = sb.user_id
    LEFT JOIN stores s ON s.id = sb.store_id
    ${whereSql}
      AND NOT EXISTS (
        SELECT 1
        FROM invoice_sales_orders iso_existing
        WHERE iso_existing.sales_bill_id = sb.id
           OR NULLIF(iso_existing.invoice_id, '') = sb.bill_number
      )
  `;
}

export async function listSalesOrderRows(view, request) {
  await Promise.all([
    ensureInvoiceSalesOrdersSchema(),
    ensureSalesBillingSchema(),
    ensureCustomersSchema(),
  ]);
  const auth = await requireAuth(request);
  if (auth.error) return [];
  const permissionCheck = requirePermission(auth.user, 'VIEW_SALES', 'MANAGE_SALES', 'MANAGE_POS');
  if (permissionCheck.error) return [];

  const url = request instanceof Request ? new URL(request.url) : new URL(String(request || 'http://localhost'));
  const normalizedView = normalizeView(view);
  const dateRange = parseDateRange(url.searchParams.get('dateRange'));
  const storeFilter = normalizeStoreFilter(url.searchParams.get('stores'));

  const isoWhereClauses = [VIEW_FILTER_SQL[normalizedView]];
  const params = [];

  if (dateRange) {
    params.push(dateRange.start, dateRange.end);
    isoWhereClauses.push(`COALESCE(iso.invoice_date, iso.booking_date, iso.created_at::date) BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
  }

  if (storeFilter) {
    params.push(storeFilter);
    isoWhereClauses.push(`(s.name = $${params.length} OR CAST(iso.store_id AS TEXT) = $${params.length})`);
  }

  if (auth.user.role !== 'super_admin') {
    const assignedStores = getAssignedStoreIds(auth.user);
    if (!assignedStores.length) return [];
    params.push(assignedStores);
    isoWhereClauses.push(`iso.store_id = ANY($${params.length}::int[])`);
  }

  const selects = [buildInvoiceSalesOrderSql(`WHERE ${isoWhereClauses.join(' AND ')}`)];
  const shouldIncludeSalesBills = ['invoice-sales-order', 'invoice-conversion-tracker'].includes(normalizedView);

  if (shouldIncludeSalesBills) {
    const salesBillWhereClauses = ["sb.status IN ('paid', 'completed')"];

    if (dateRange) {
      params.push(dateRange.start, dateRange.end);
      salesBillWhereClauses.push(`sb.created_at::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
    }

    if (storeFilter) {
      params.push(storeFilter);
      salesBillWhereClauses.push(`(s.name = $${params.length} OR CAST(sb.store_id AS TEXT) = $${params.length})`);
    }

    if (auth.user.role !== 'super_admin') {
      params.push(getAssignedStoreIds(auth.user));
      salesBillWhereClauses.push(`sb.store_id = ANY($${params.length}::int[])`);
    }

    selects.push(buildSalesBillSql(`WHERE ${salesBillWhereClauses.join(' AND ')}`));
  }

  const res = await query(
    `SELECT *
     FROM (${selects.join('\nUNION ALL\n')}) sales_order_rows
     ORDER BY COALESCE(invoice_date, booking_date, created_at::date) DESC, id DESC`,
    params
  );

  return res.rows.map(mapSalesOrderRow);
}

function buildBulkActionUpdate(action) {
  const normalizedAction = String(action || '').trim().toLowerCase();

  if (normalizedAction === 'create invoice') {
    return {
      status: 'Invoiced',
      extraSql: `invoice_id = COALESCE(NULLIF(invoice_id, ''), 'INV-' || id::text),
                 invoice_date = COALESCE(invoice_date, CURRENT_DATE),
                 converted_by = COALESCE(NULLIF(converted_by, ''), 'System'),
                 converted_at = COALESCE(converted_at, NOW())`,
    };
  }

  if (normalizedAction === 'write off') {
    return {
      status: 'Written Off',
      extraSql: `write_off_amount = COALESCE(NULLIF(write_off_amount, 0), GREATEST(gross_bill - total_discount, 0)),
                 write_off_reason = COALESCE(NULLIF(write_off_reason, ''), 'Bulk write off'),
                 written_off_by = COALESCE(NULLIF(written_off_by, ''), 'System'),
                 written_off_date = COALESCE(written_off_date, CURRENT_DATE)`,
    };
  }

  if (normalizedAction === 'auto invoice') {
    return {
      status: 'Auto Invoiced',
      extraSql: `auto_invoice_id = COALESCE(NULLIF(auto_invoice_id, ''), 'AUTO-' || id::text),
                 auto_invoice_date = COALESCE(auto_invoice_date, CURRENT_DATE),
                 converted_by = COALESCE(NULLIF(converted_by, ''), 'System'),
                 converted_at = COALESCE(converted_at, NOW())`,
    };
  }

  if (normalizedAction === 'approve quotation') {
    return {
      status: 'Quotation Approved',
      extraSql: `approver = COALESCE(NULLIF(approver, ''), 'System'),
                 submitted_date = COALESCE(submitted_date, CURRENT_DATE)`,
    };
  }

  if (normalizedAction === 'reject quotation') {
    return {
      status: 'Quotation Rejected',
      extraSql: `approver = COALESCE(NULLIF(approver, ''), 'System')`,
    };
  }

  return null;
}

export async function applySalesOrderBulkAction(view, request) {
  await ensureInvoiceSalesOrdersSchema();
  const auth = await requireAuth(request);
  if (auth.error) return { error: 'Authentication required', status: 401 };
  const permissionCheck = requirePermission(auth.user, 'MANAGE_SALES', 'MANAGE_POS');
  if (permissionCheck.error) return { error: 'Access denied', status: 403 };

  const body = await request.json();
  const ids = normalizeIds(body.ids || body.selectedRowIds || []);
  const action = String(body.action || '').trim();
  const normalizedView = normalizeView(view);

  if (ids.length === 0) {
    return { error: 'At least one sales order is required', status: 400 };
  }

  const update = buildBulkActionUpdate(action);
  if (!update) {
    return { error: 'Unsupported bulk action', status: 400 };
  }

  const updateParams = [update.status, ids];
  const storeGuard =
    auth.user.role === 'super_admin'
      ? ''
      : ` AND store_id = ANY($${updateParams.push(getAssignedStoreIds(auth.user))}::int[])`;

  const res = await query(
    `UPDATE invoice_sales_orders
     SET status = $1,
         ${update.extraSql},
         updated_at = NOW()
     WHERE id = ANY($2::bigint[])
       ${storeGuard}
     RETURNING ('SO-' || id::text) AS id,
               'sales_order' AS source,
               sales_order_id,
               sales_order_type,
               COALESCE(NULLIF(invoice_id, ''), sales_order_id) AS bill_number,
               booking_id,
               booking_date,
               billing_username,
               customer_name,
               payment_mode,
               created_by,
               submitted_date,
               approver,
               gross_bill,
               additional_charge_value,
               total_discount,
               tds_rate,
               tds_value,
               tcs_rate,
               tcs_value,
               quotation_id,
               invoice_id,
               NULL::uuid AS public_token,
               invoice_date,
               auto_invoice_id,
               auto_invoice_date,
               write_off_amount,
               write_off_reason,
               written_off_by,
               written_off_date,
               converted_by,
               converted_at,
               status,
               channel,
               store_id,
               NULL::text AS store_name,
               created_at,
               GREATEST(COALESCE(gross_bill, 0) + COALESCE(additional_charge_value, 0) - COALESCE(total_discount, 0) - COALESCE(write_off_amount, 0), 0) AS grand_total`,
    updateParams
  );

  return {
    success: true,
    updatedCount: res.rowCount,
    rows: res.rows.map(mapSalesOrderRow),
    view: normalizedView,
  };
}

export function getSalesOrderViewLabel(view) {
  return VIEW_LABELS[normalizeView(view)];
}
