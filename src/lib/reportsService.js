import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { ensureInvoiceSalesOrdersSchema } from '@/lib/invoiceSalesOrdersSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensureVendorsSchema } from '@/lib/vendorsSchema';
import { ensurePurchaseOrderSchema } from '@/lib/purchaseOrderSchema';
import { ensureStockRequisitionSchema } from '@/lib/stockRequisitionSchema';
import { ensureStockTransferSchema } from '@/lib/stockTransferSchema';
import { ensureAuditLogsSchema } from '@/lib/auditLogsSchema';
import { ensureProcurementSchema } from '@/lib/procurementSchema';
import { ensureVendorInvoicesSchema } from '@/lib/vendorInvoicesSchema';

const REPORT_ROLES = ['super_admin', 'admin', 'manager'];

const REPORTS = {
  'orders/list-of-orders': {
    title: 'List Of Orders',
    worksheet: 'Orders',
    columns: [
      { key: 'order_id', label: 'Order ID' },
      { key: 'sales_order_id', label: 'Sales Order ID' },
      { key: 'store', label: 'Store' },
      { key: 'invoice_number', label: 'Invoice Number' },
      { key: 'order_mode', label: 'Order Mode' },
      { key: 'order_date', label: 'Order Date' },
      { key: 'order_time', label: 'Order Time' },
      { key: 'sales', label: 'Sales' },
      { key: 'discount', label: '(-) Discount' },
      { key: 'net_bill', label: '(=) Net Bill' },
      { key: 'taxes_product', label: '(+) Taxes (Product Level)' },
      { key: 'gross_bill', label: '(=) Gross Bill' },
      { key: 'payment_status', label: 'Payment Status' },
      { key: 'paid_amount', label: 'Paid Amount' },
      { key: 'unpaid_amount', label: 'Unpaid Amount' },
      { key: 'employee', label: 'Employee' },
      { key: 'invoiced_customer', label: 'Invoiced Customer Name' },
      { key: 'inv_customer_phone', label: 'Invoiced Customer Phone' },
      { key: 'payment_mode', label: 'Payment Mode' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
  'sales/daily-sales': {
    title: 'Daily Sales',
    worksheet: 'Daily Sales',
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'date', label: 'Date' },
      { key: 'sales', label: 'Sales' },
      { key: 'discount', label: 'Discount' },
      { key: 'net_bill', label: 'Net Bill' },
      { key: 'taxes', label: 'Taxes' },
      { key: 'gross_bill', label: 'Gross Bill' },
      { key: 'orders', label: 'Orders' },
      { key: 'avg_order_value', label: 'Avg Order Value' },
    ],
  },
  'daily-sales-dsr': {
    title: 'Daily Sales (DSR)',
    worksheet: 'DSR',
    columns: [
      { key: 'store',     label: 'Store'     },
      { key: 'date',      label: 'Date'      },
      { key: 'orders',    label: 'Orders'    },
      { key: 'sales',     label: 'Sales'     },
      { key: 'discount',  label: 'Discount'  },
      { key: 'net_bill',  label: 'Net Bill'  },
      { key: 'taxes',     label: 'Taxes'     },
      { key: 'gross_bill',label: 'Gross Bill'},
    ],
  },
  'sales/monthly-sales': {
    title: 'Monthly Sales',
    worksheet: 'Monthly Sales',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'store', label: 'Store' },
      { key: 'orders', label: 'Orders' },
      { key: 'sales', label: 'Sales' },
      { key: 'discount', label: 'Discount' },
      { key: 'net_bill', label: 'Net Bill' },
      { key: 'taxes', label: 'Taxes' },
      { key: 'gross_bill', label: 'Gross Bill' },
      { key: 'avg_order_value', label: 'Avg Order Value' },
    ],
  },
  'net-sales': {
    title: 'Net Sales',
    worksheet: 'Net Sales',
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'date', label: 'Date' },
      { key: 'gross_sales', label: 'Gross Sales' },
      { key: 'discount', label: '(-) Discount' },
      { key: 'taxes', label: '(+) Taxes' },
      { key: 'net_sales', label: '(=) Net Sales' },
      { key: 'orders', label: 'Orders' },
    ],
  },
  'inventory/stock-level': {
    title: 'Stock Level',
    worksheet: 'Stock Level',
    columns: [
      { key: 'product',       label: 'Product'       },
      { key: 'sku',           label: 'SKU'           },
      { key: 'store',         label: 'Store'         },
      { key: 'stock_in',      label: 'Stock In'      },
      { key: 'stock_out',     label: 'Stock Out'     },
      { key: 'current_stock', label: 'Current Stock' },
      { key: 'unit',          label: 'Unit'          },
      { key: 'status',        label: 'Status'        },
    ],
  },
  'stock-level': {
    title: 'Stock Level',
    worksheet: 'Stock Level',
    columns: [
      { key: 'product',       label: 'Product'       },
      { key: 'sku',           label: 'SKU'           },
      { key: 'store',         label: 'Store'         },
      { key: 'stock_in',      label: 'Stock In'      },
      { key: 'stock_out',     label: 'Stock Out'     },
      { key: 'current_stock', label: 'Current Stock' },
      { key: 'unit',          label: 'Unit'          },
      { key: 'status',        label: 'Status'        },
    ],
  },
  'purchase/vendor-quotation-comparison': {
    title: 'Vendor Quotation Comparison',
    worksheet: 'Vendor Quotes',
    columns: [
      { key: 'quote_id', label: 'Quote ID' },
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'store', label: 'Store' },
      { key: 'items', label: 'Items' },
      { key: 'amount', label: 'Amount' },
      { key: 'freight', label: 'Freight' },
      { key: 'lead_days', label: 'Lead Days' },
      { key: 'score', label: 'Score' },
      { key: 'status', label: 'Status' },
    ],
  },
  'purchase/purchase-return-report': {
    title: 'Purchase Return Report',
    worksheet: 'Purchase Returns',
    columns: [
      { key: 'return_id', label: 'Return ID' },
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'store', label: 'Store' },
      { key: 'qty', label: 'Qty' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
    ],
  },
  'purchase/vendor-ledger-report': {
    title: 'Vendor Ledger Report',
    worksheet: 'Vendor Ledger',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'entry_type', label: 'Type' },
      { key: 'transaction_id', label: 'Transaction' },
      { key: 'reference_no', label: 'Reference' },
      { key: 'debit', label: 'Debit' },
      { key: 'credit', label: 'Credit' },
      { key: 'balance', label: 'Balance' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
  'purchase/vendor-performance-report': {
    title: 'Vendor Performance Report',
    worksheet: 'Vendor Performance',
    columns: [
      { key: 'vendor', label: 'Vendor' },
      { key: 'score', label: 'Score' },
      { key: 'grade', label: 'Grade' },
      { key: 'po_count', label: 'POs' },
      { key: 'purchase_value', label: 'Purchase Value' },
      { key: 'avg_lead_days', label: 'Lead Days' },
      { key: 'return_count', label: 'Returns' },
      { key: 'outstanding', label: 'Outstanding' },
    ],
  },
  'purchase/auto-reorder-suggestions': {
    title: 'Auto Reorder Suggestions',
    worksheet: 'Auto Reorder',
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'store', label: 'Store' },
      { key: 'current_stock', label: 'Current Stock' },
      { key: 'reorder_level', label: 'Reorder Level' },
      { key: 'suggested_qty', label: 'Suggested Qty' },
      { key: 'vendor', label: 'Last Vendor' },
      { key: 'cost', label: 'Cost' },
    ],
  },
  'logs/audit-trail': {
    title: 'Audit Trail',
    worksheet: 'Audit Trail',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'employee', label: 'Employee' },
      { key: 'action', label: 'Action' },
      { key: 'resource_type', label: 'Resource Type' },
      { key: 'resource_id', label: 'Resource ID' },
      { key: 'status', label: 'Status' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
};

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStockDisplayUnit(unit) {
  const normalized = String(unit || 'PCS').trim().toUpperCase();
  if (['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS', 'GRAM', 'GRAMS', 'GM', 'G'].includes(normalized)) {
    return 'GRAMS';
  }
  return normalized || 'PCS';
}

function stockDisplayQty(value, unit) {
  const normalized = String(unit || 'PCS').trim().toUpperCase();
  const factor = ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(normalized) ? 1000 : 1;
  const converted = number(value) * factor;
  return Number.isInteger(converted) ? converted : Number(converted.toFixed(3));
}

function isoDate(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (match) return match[1];
  }
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function displayTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPaymentMethod(method) {
  const value = String(method || 'cash').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Cash';
}

function paymentBreakupText(value, fallbackMode = 'cash') {
  const rows = Array.isArray(value) ? value : [];
  const payments = rows
    .map((payment) => ({
      method: payment.method || payment.payment_mode || fallbackMode,
      amount: number(payment.amount),
    }))
    .filter((payment) => payment.amount > 0);
  if (!payments.length) return formatPaymentMethod(fallbackMode);
  if (payments.length === 1) return formatPaymentMethod(payments[0].method);
  return `Split: ${payments.map((payment) => `${formatPaymentMethod(payment.method)} ${money(payment.amount)}`).join(' + ')}`;
}

function parseReportDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  const displayMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (displayMatch) {
    const months = {
      jan: '01', january: '01',
      feb: '02', february: '02',
      mar: '03', march: '03',
      apr: '04', april: '04',
      may: '05',
      jun: '06', june: '06',
      jul: '07', july: '07',
      aug: '08', august: '08',
      sep: '09', sept: '09', september: '09',
      oct: '10', october: '10',
      nov: '11', november: '11',
      dec: '12', december: '12',
    };
    const month = months[displayMatch[2].toLowerCase()];
    if (month) return `${displayMatch[3]}-${month}-${displayMatch[1].padStart(2, '0')}`;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  return null;
}

function parseDateRange(value) {
  const today = new Date().toISOString().slice(0, 10);
  if (!value) return { from: today, to: today };
  const parts = String(value).split(/\s+-\s+/);
  const from = parseReportDate(parts[0]) || today;
  const to = parseReportDate(parts[1] || parts[0]) || from;
  return from <= to ? { from, to } : { from: to, to: from };
}

function addStoreScope({ conditions, params, user, alias = 'sb', requestedStoreId }) {
  const storeId = Number(requestedStoreId || 0) || null;
  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);

  if (user.role === 'super_admin') {
    if (storeId) {
      params.push(storeId);
      conditions.push(`${alias}.store_id = $${params.length}`);
    }
    return;
  }

  if (storeId && assignedStores.includes(storeId)) {
    params.push(storeId);
    conditions.push(`${alias}.store_id = $${params.length}`);
    return;
  }

  if (assignedStores.length > 0) {
    params.push(assignedStores);
    conditions.push(`${alias}.store_id = ANY($${params.length}::int[])`);
    return;
  }

  conditions.push('1 = 0');
}

function addSalesFilters({ conditions, params, filters, user, alias = 'sb' }) {
  const range = parseDateRange(filters.date_range);
  params.push(range.from);
  conditions.push(`DATE(${alias}.created_at AT TIME ZONE 'Asia/Kolkata') >= $${params.length}`);
  params.push(range.to);
  conditions.push(`DATE(${alias}.created_at AT TIME ZONE 'Asia/Kolkata') <= $${params.length}`);
  addStoreScope({ conditions, params, user, alias, requestedStoreId: filters.store });

  if (filters.customer) {
    params.push(`%${String(filters.customer).trim()}%`);
    conditions.push(`(${alias}.customer_name ILIKE $${params.length} OR ${alias}.customer_mobile ILIKE $${params.length})`);
  }

  if (filters.payment_type && !['all', 'select', 'select...'].includes(String(filters.payment_type).toLowerCase())) {
    params.push(String(filters.payment_type).toLowerCase());
    conditions.push(`(
      LOWER(${alias}.payment_mode) = $${params.length}
      OR EXISTS (
        SELECT 1 FROM sales_bill_payments filter_sbp
        WHERE filter_sbp.sales_bill_id = ${alias}.id
          AND LOWER(filter_sbp.method) = $${params.length}
      )
    )`);
  }

  if (filters.payment_status && !['all', 'select'].includes(String(filters.payment_status).toLowerCase())) {
    params.push(String(filters.payment_status).toLowerCase());
    conditions.push(`LOWER(${alias}.status) = $${params.length}`);
  }
}

function addStoreColumnScope({ conditions, params, user, columnName, requestedStoreId }) {
  const storeId = Number(requestedStoreId || 0) || null;
  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);

  if (user.role === 'super_admin') {
    if (storeId) {
      params.push(storeId);
      conditions.push(`${columnName} = $${params.length}`);
    }
    return;
  }

  if (storeId && assignedStores.includes(storeId)) {
    params.push(storeId);
    conditions.push(`${columnName} = $${params.length}`);
    return;
  }

  if (assignedStores.length > 0) {
    params.push(assignedStores);
    conditions.push(`${columnName} = ANY($${params.length}::int[])`);
    return;
  }

  conditions.push('1 = 0');
}

async function ensureReportSchemas() {
  await ensureStockInSchema();
  await ensureStockOutSchema();
  await ensureCatalogExtrasSchema();
  await ensureSalesBillingSchema();
  await ensureInvoiceSalesOrdersSchema();
  await ensureInventoryBatchSchema();
  await ensureVendorsSchema();
  await ensurePurchaseOrderSchema();
  await ensureStockRequisitionSchema();
  await ensureStockTransferSchema();
  await ensureAuditLogsSchema();
  await ensureProcurementSchema();
  await ensureVendorInvoicesSchema();
}

export function normalizeReportKey(slug) {
  if (Array.isArray(slug)) return slug.join('/');
  return String(slug || '').replace(/^\/+|\/+$/g, '');
}

export function canAccessReports(user) {
  return REPORT_ROLES.includes(user?.role);
}

export function getReportDefinition(reportKey) {
  return REPORTS[reportKey] || createGenericReportDefinition(reportKey);
}

function titleFromReportKey(reportKey) {
  return normalizeReportKey(reportKey)
    .split('/')
    .pop()
    ?.split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Report';
}

function createGenericReportDefinition(reportKey, columns = null) {
  const title = titleFromReportKey(reportKey);
  const defaultColumns = columns || [
    { key: 'date', label: 'Date' },
    { key: 'store', label: 'Store' },
    { key: 'orders', label: 'Orders' },
    { key: 'items', label: 'Items' },
    { key: 'sales', label: 'Sales' },
    { key: 'discount', label: 'Discount' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'gross_bill', label: 'Gross Bill' },
    { key: 'status', label: 'Status' },
  ];
  return { title, worksheet: title.slice(0, 31), columns: defaultColumns };
}

export async function getStoresForUser(user) {
  if (user.role === 'super_admin') {
    const res = await query('SELECT id, name FROM stores ORDER BY name ASC');
    return res.rows;
  }

  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
  if (!assignedStores.length) return [];
  const res = await query('SELECT id, name FROM stores WHERE id = ANY($1::int[]) ORDER BY name ASC', [assignedStores]);
  return res.rows;
}

export async function getReportRows(reportKey, filters = {}, user) {
  await ensureReportSchemas();

  if (reportKey === 'orders/list-of-orders') return getOrdersReport(filters, user);
  if (reportKey === 'sales/daily-sales') return getDailySalesReport(filters, user);
  if (reportKey === 'sales/monthly-sales') return getMonthlySalesReport(filters, user);
  if (reportKey === 'daily-sales-dsr') return getDailySalesReport(filters, user);
  if (reportKey === 'net-sales') return getNetSalesReport(filters, user);
  if (reportKey === 'orders-list') return getOrdersReport(filters, user);
  if (reportKey === 'inventory/stock-level') return getStockLevelReport(filters, user);
  if (reportKey === 'stock-level') return getStockLevelReport(filters, user);
  if (reportKey.startsWith('sales/')) return getSalesDimensionReport(reportKey, filters, user);
  if (reportKey.startsWith('orders/')) return getOrderFamilyReport(reportKey, filters, user);
  if (reportKey.startsWith('online-order/')) return getOnlineOrderReport(reportKey, filters, user);
  if (reportKey.startsWith('proforma-invoices/')) return getProformaInvoiceReport(reportKey, filters, user);
  if (reportKey.startsWith('accounting/')) return getAccountingTaxReport(reportKey, filters, user);
  if (reportKey.startsWith('inventory/')) return getInventoryFamilyReport(reportKey, filters, user);
  if (reportKey === 'purchase/vendor-quotation-comparison') return getVendorQuotationReport(filters, user);
  if (reportKey === 'purchase/purchase-return-report') return getPurchaseReturnReport(filters, user);
  if (reportKey === 'purchase/vendor-ledger-report') return getVendorLedgerReport(filters, user);
  if (reportKey === 'purchase/vendor-performance-report') return getVendorPerformanceReport(filters, user);
  if (reportKey === 'purchase/auto-reorder-suggestions') return getAutoReorderReport(filters, user);
  if (reportKey.startsWith('purchase/')) return getPurchaseFamilyReport(reportKey, filters, user);
  if (reportKey.startsWith('promotions/')) return getPromotionsFamilyReport(reportKey, filters, user);
  if (reportKey.startsWith('insights/')) return getInsightsFamilyReport(reportKey, filters, user);
  if (reportKey.startsWith('logs/')) return getLogsFamilyReport(reportKey, filters, user);
  if (reportKey.startsWith('custom/')) return getDailySalesReport(filters, user);

  return [];
}

async function getOrdersReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed', 'partial', 'pending')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });

  const res = await query(
    `SELECT
       sb.id,
       sb.bill_number,
       sb.created_at,
       sb.subtotal,
       sb.discount_total,
       sb.tax_total,
       sb.grand_total,
       sb.paid_amount,
       sb.balance_amount,
       sb.status,
       sb.payment_mode,
       COALESCE(payments.payments, '[]'::jsonb) AS payments,
       sb.customer_name,
       sb.customer_mobile,
       sb.remarks,
       s.name AS store_name,
       u.name AS employee_name
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     LEFT JOIN users u ON u.id = sb.user_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('method', sbp.method, 'amount', sbp.amount, 'referenceNo', sbp.reference_no) ORDER BY sbp.id) AS payments
       FROM sales_bill_payments sbp
       WHERE sbp.sales_bill_id = sb.id
     ) payments ON TRUE
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => ({
    id: `bill-${row.id}`,
    order_id: row.id,
    sales_order_id: row.bill_number,
    store: row.store_name || 'Store',
    customer: row.customer_name || 'Walk-in Customer',
    invoice_number: row.bill_number,
    order_mode: 'POS',
    date: isoDate(row.created_at),
    order_date: isoDate(row.created_at),
    order_time: displayTime(row.created_at),
    order_log_time: displayTime(row.created_at),
    sales: money(row.subtotal),
    discount: money(row.discount_total),
    net_bill: money(number(row.subtotal) - number(row.discount_total)),
    taxes_product: money(row.tax_total),
    taxes_order: '0.00',
    gross_bill: money(row.grand_total),
    payment_status: row.status,
    paid_amount: money(row.paid_amount),
    unpaid_amount: money(row.balance_amount),
    employee: row.employee_name || '',
    invoiced_customer: row.customer_name || 'Walk-in Customer',
    original_customer: row.customer_name || 'Walk-in Customer',
    inv_customer_phone: row.customer_mobile || '',
    orig_customer_phone: row.customer_mobile || '',
    payment_mode: paymentBreakupText(row.payments, row.payment_mode),
    remarks: row.remarks || '',
  }));
}

async function getDailySalesReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });

  const res = await query(
    `SELECT
       COALESCE(s.name, 'Store') AS store,
       DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
       COUNT(*)::int AS orders,
       COALESCE(SUM(sb.subtotal), 0) AS sales,
       COALESCE(SUM(sb.discount_total), 0) AS discount,
       COALESCE(SUM(sb.tax_total), 0) AS taxes,
       COALESCE(SUM(sb.grand_total), 0) AS gross_bill
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY s.name, DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') DESC, s.name ASC`,
    params
  );

  return res.rows.map((row, index) => ({
    id: `daily-${index}`,
    store: row.store,
    date: isoDate(row.date),
    sales: money(row.sales),
    discount: money(row.discount),
    net_bill: money(number(row.sales) - number(row.discount)),
    taxes: money(row.taxes),
    gross_bill: money(row.gross_bill),
    orders: row.orders,
    avg_order_value: money(number(row.gross_bill) / Math.max(1, number(row.orders))),
  }));
}

async function getNetSalesReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });

  const res = await query(
    `SELECT
       COALESCE(s.name, 'Store') AS store,
       DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
       COUNT(*)::int AS orders,
       COALESCE(SUM(sb.subtotal), 0) AS gross_sales,
       COALESCE(SUM(sb.discount_total), 0) AS discount,
       COALESCE(SUM(sb.tax_total), 0) AS taxes,
       COALESCE(SUM(sb.grand_total), 0) AS net_sales
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY s.name, DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') DESC, s.name ASC`,
    params
  );

  return res.rows.map((row, index) => ({
    id: `net-${index}`,
    store: row.store,
    date: isoDate(row.date),
    gross_sales: money(row.gross_sales),
    discount: money(row.discount),
    taxes: money(row.taxes),
    net_sales: money(row.net_sales),
    orders: row.orders,
  }));
}

async function getMonthlySalesReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });

  const res = await query(
    `SELECT
       COALESCE(s.name, 'Store') AS store,
       DATE_TRUNC('month', sb.created_at AT TIME ZONE 'Asia/Kolkata')::date AS month_date,
       TO_CHAR(DATE_TRUNC('month', sb.created_at AT TIME ZONE 'Asia/Kolkata'), 'Mon YYYY') AS month,
       COUNT(*)::int AS orders,
       COALESCE(SUM(sb.subtotal), 0) AS sales,
       COALESCE(SUM(sb.discount_total), 0) AS discount,
       COALESCE(SUM(sb.tax_total), 0) AS taxes,
       COALESCE(SUM(sb.grand_total), 0) AS gross_bill
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY s.name, DATE_TRUNC('month', sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY month_date DESC, s.name ASC`,
    params
  );

  return res.rows.map((row, index) => ({
    id: `monthly-${index}`,
    month: row.month,
    date: isoDate(row.month_date),
    store: row.store,
    sales: money(row.sales),
    discount: money(row.discount),
    net_bill: money(number(row.sales) - number(row.discount)),
    taxes: money(row.taxes),
    gross_bill: money(row.gross_bill),
    orders: row.orders,
    avg_order_value: money(number(row.gross_bill) / Math.max(1, number(row.orders))),
  }));
}

async function getStockLevelReport(filters, user) {
  const range    = parseDateRange(filters.date_range);
  const fromDate = range.from;
  const toDate   = range.to;

  const params     = [];
  const conditions = ['COALESCE(p.is_active, TRUE) = TRUE'];

  // Store scope on outer product_saleability — sub-queries reference ps.store_id
  addStoreScope({ conditions, params, user, alias: 'ps', requestedStoreId: filters.store });

  if (filters.product && String(filters.product).trim()) {
    params.push(`%${String(filters.product).trim()}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR COALESCE(p.sku,'') ILIKE $${params.length})`);
  }

  // Date params — sub-queries share these positional params
  params.push(fromDate); const pFrom = params.length;
  params.push(toDate);   const pTo   = params.length;

  const res = await query(
    `SELECT
       p.id,
       p.name  AS product,
       p.sku,
       p.unit,
       COALESCE(s.name, 'Unknown Store') AS store,
       COALESCE(ps.low_stock_value, 0)   AS low_stock_value,
       COALESCE((
         SELECT SUM(ib.available_qty)
         FROM inventory_batches ib
         WHERE ib.product_id = p.id
           AND ib.store_id = ps.store_id
           AND ib.status = 'active'
       ), 0) AS current_stock,

       -- Stock In within date range
       COALESCE((
         SELECT SUM(sii.qty)
         FROM stock_in_items sii
         JOIN stock_in si ON si.id = sii.stock_in_id
         WHERE sii.product_id = p.id
           AND si.destination_id = ps.store_id
           AND si.status = 'confirmed'
           AND DATE(si.created_at) BETWEEN $${pFrom} AND $${pTo}
       ), 0) AS stock_in,

       -- Stock Out within date range (manual stock_out + sales)
       COALESCE((
         SELECT SUM(soi.qty)
         FROM stock_out_items soi
         JOIN stock_out so ON so.id = soi.stock_out_id
         WHERE soi.product_id = p.id
           AND so.destination_id = ps.store_id
           AND so.status = 'confirmed'
           AND DATE(so.created_at) BETWEEN $${pFrom} AND $${pTo}
       ), 0)
       + COALESCE((
         SELECT SUM(sbi.qty)
         FROM sales_bill_items sbi
         JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
         WHERE sbi.product_id = p.id
           AND sb.store_id = ps.store_id
           AND sb.status IN ('paid', 'completed')
           AND DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') BETWEEN $${pFrom} AND $${pTo}
       ), 0) AS stock_out

     FROM product_saleability ps
     INNER JOIN products p ON p.id = ps.product_id
     LEFT  JOIN stores s ON s.id = ps.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.name ASC, s.name ASC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => {
    const stockIn       = number(row.stock_in);
    const stockOut      = number(row.stock_out);
    const currentStock  = number(row.current_stock);
    const lowStockValue = number(row.low_stock_value);
    const displayUnit   = getStockDisplayUnit(row.unit);
    return {
      id:            `stock-${row.id}-${row.store}`,
      product:       row.product,
      sku:           row.sku || '',
      store:         row.store,
      stock_in:      stockDisplayQty(stockIn, row.unit),
      stock_out:     stockDisplayQty(stockOut, row.unit),
      current_stock: stockDisplayQty(currentStock, row.unit),
      unit:          displayUnit,
      status:        lowStockValue > 0 && currentStock <= lowStockValue
                       ? 'Low'
                       : currentStock <= 0 ? 'Out' : 'In Stock',
    };
  });
}

async function getSalesDimensionReport(reportKey, filters, user) {
  if (reportKey.includes('daily-payment-breakup')) return getDailyPaymentBreakupReport(filters, user);
  if (reportKey.includes('store-hourly')) return getStoreHourlySalesReport(filters, user);

  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });

  let dimensionSql = 'COALESCE(s.name, \'Store\')';
  let dimensionAlias = 'store';
  let joins = '';

  if (reportKey.includes('product-wise') || reportKey.includes('store-wise-product') || reportKey.includes('employee-wise-product')) {
    dimensionSql = 'COALESCE(p.name, sbi.product_name, \'Product\')';
    dimensionAlias = 'product';
  } else if (reportKey.includes('customer-wise')) {
    dimensionSql = 'COALESCE(NULLIF(sb.customer_name, \'\'), \'Walk-in Customer\')';
    dimensionAlias = 'customer';
  } else if (reportKey.includes('employee-wise')) {
    dimensionSql = 'COALESCE(u.name, \'Unassigned\')';
    dimensionAlias = 'employee';
  } else if (reportKey.includes('brand-wise')) {
    dimensionSql = 'COALESCE(b.name, \'Unbranded\')';
    dimensionAlias = 'brand';
    joins += ' LEFT JOIN brands b ON b.id = p.brand_id';
  } else if (reportKey.includes('category-wise')) {
    dimensionSql = 'COALESCE(c.name, \'Uncategorised\')';
    dimensionAlias = 'category';
    joins += ' LEFT JOIN categories c ON c.id = p.category_id';
  } else if (reportKey.includes('sub-category')) {
    dimensionSql = 'COALESCE(sc.name, \'No Sub Category\')';
    dimensionAlias = 'sub_category';
    joins += ' LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id';
  } else if (reportKey.includes('department-wise')) {
    dimensionSql = 'COALESCE(d.name, \'No Department\')';
    dimensionAlias = 'department';
    joins += ' LEFT JOIN departments d ON d.id = p.department_id';
  } else if (reportKey.includes('income-head')) {
    dimensionSql = 'COALESCE(ih.name, \'No Income Head\')';
    dimensionAlias = 'income_head';
    joins += ' LEFT JOIN income_heads ih ON ih.id = p.income_head_id';
  } else if (reportKey.includes('location') || reportKey.includes('region') || reportKey.includes('entity') || reportKey.includes('device') || reportKey.includes('fiscal')) {
    dimensionSql = 'COALESCE(s.name, \'Store\')';
    dimensionAlias = reportKey.includes('region') ? 'region' : reportKey.includes('device') ? 'device' : 'store';
  }

  const res = await query(
    `SELECT
       ${dimensionSql} AS dimension,
       COALESCE(s.name, 'Store') AS store,
       DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
       COUNT(DISTINCT sb.id)::int AS orders,
       COALESCE(SUM(sbi.qty), 0) AS items,
       COALESCE(SUM(sbi.qty * sbi.selling_price), 0) AS sales,
       COALESCE(SUM(sbi.discount_amount), 0) AS discount,
       COALESCE(SUM(sbi.tax_amount), 0) AS taxes,
       COALESCE(SUM(sbi.line_total), 0) AS gross_bill,
       COALESCE(SUM(sbi.qty * COALESCE(p.cost_price, 0)), 0) AS cost_amount
     FROM sales_bills sb
     LEFT JOIN sales_bill_items sbi ON sbi.sales_bill_id = sb.id
     LEFT JOIN products p ON p.id = sbi.product_id
     LEFT JOIN stores s ON s.id = sb.store_id
     LEFT JOIN users u ON u.id = sb.user_id
     ${joins}
     WHERE ${conditions.join(' AND ')}
     GROUP BY ${dimensionSql}, COALESCE(s.name, 'Store'), DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY gross_bill DESC, date DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row, index) => {
    const netSales = number(row.sales) - number(row.discount);
    const profit = netSales - number(row.cost_amount);
    const marginPercent = netSales > 0 ? (profit / netSales) * 100 : 0;
    return {
      id: `sales-${reportKey}-${index}`,
      [dimensionAlias]: row.dimension,
      product: row.dimension,
      category: row.dimension,
      brand: row.dimension,
      department: row.dimension,
      employee: row.dimension,
      customer: row.dimension,
      store: row.store,
      date: isoDate(row.date),
      orders: row.orders,
      items: number(row.items),
      quantity: number(row.items),
      sales: money(row.sales),
      discount: money(row.discount),
      net_bill: money(netSales),
      taxes: money(row.taxes),
      gross_bill: money(row.gross_bill),
      cost_amount: money(row.cost_amount),
      margin_amount: money(profit),
      margin_percent: `${marginPercent.toFixed(2)}%`,
      avg_order_value: money(number(row.gross_bill) / Math.max(1, number(row.orders))),
      margin: `${marginPercent.toFixed(2)}%`,
      profit: money(profit),
    };
  });
}

async function getDailyPaymentBreakupReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const res = await query(
    `WITH bill_payments AS (
       SELECT
         sb.id,
         DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
         COALESCE(s.name, 'Store') AS store,
         COALESCE(NULLIF(sbp.method, ''), NULLIF(sb.payment_mode, ''), 'cash') AS payment_mode,
         COALESCE(sbp.amount, sb.grand_total) AS amount
       FROM sales_bills sb
       LEFT JOIN stores s ON s.id = sb.store_id
       LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
       WHERE ${conditions.join(' AND ')}
     )
     SELECT date, store, payment_mode, COUNT(DISTINCT id)::int AS orders, COALESCE(SUM(amount), 0) AS amount
     FROM bill_payments
     GROUP BY date, store, payment_mode
     ORDER BY date DESC, store ASC`,
    params
  );
  return res.rows.map((row, index) => ({
    id: `payment-${index}`,
    date: isoDate(row.date),
    store: row.store,
    payment_mode: row.payment_mode,
    orders: row.orders,
    amount: money(row.amount),
    sales: money(row.amount),
    gross_bill: money(row.amount),
  }));
}

async function getStoreHourlySalesReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const res = await query(
    `SELECT COALESCE(s.name, 'Store') AS store,
            DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
            EXTRACT(HOUR FROM sb.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
            COUNT(*)::int AS orders,
            COALESCE(SUM(sb.grand_total), 0) AS gross_bill
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY s.name, DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata'), EXTRACT(HOUR FROM sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY date DESC, store ASC, hour ASC`,
    params
  );
  return res.rows.map((row, index) => ({
    id: `hourly-${index}`,
    store: row.store,
    date: isoDate(row.date),
    hour: `${String(row.hour).padStart(2, '0')}:00`,
    orders: row.orders,
    sales: money(row.gross_bill),
    gross_bill: money(row.gross_bill),
    avg_order_value: money(number(row.gross_bill) / Math.max(1, number(row.orders))),
  }));
}

async function getOrderFamilyReport(reportKey, filters, user) {
  if (reportKey.includes('product-in') || reportKey.includes('product-transaction')) return getProductInOrdersReport(filters, user);
  if (reportKey.includes('payment')) return getOrderPaymentReport(filters, user);
  if (reportKey.includes('void')) {
    const next = { ...filters, payment_status: 'void' };
    return getOrdersReport(next, user);
  }
  return getOrdersReport(filters, user);
}

async function getProductInOrdersReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed', 'partial', 'pending')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  if (filters.product) {
    params.push(`%${String(filters.product).trim()}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR COALESCE(p.sku, '') ILIKE $${params.length})`);
  }
  const res = await query(
    `SELECT sb.id AS order_id, sb.bill_number, sb.created_at, sb.payment_mode, sb.status,
            COALESCE(s.name, 'Store') AS store,
            COALESCE(p.name, sbi.product_name, 'Product') AS product,
            COALESCE(p.sku, sbi.sku, '') AS sku,
            sbi.qty, sbi.selling_price, sbi.discount_amount, sbi.tax_amount, sbi.line_total
     FROM sales_bill_items sbi
     INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
     LEFT JOIN products p ON p.id = sbi.product_id
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC, sb.id DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `order-product-${row.order_id}-${row.sku}`,
    order_id: row.order_id,
    sales_order_id: row.bill_number,
    invoice_number: row.bill_number,
    store: row.store,
    date: isoDate(row.created_at),
    order_date: isoDate(row.created_at),
    order_time: displayTime(row.created_at),
    product: row.product,
    sku: row.sku,
    qty: number(row.qty),
    quantity: number(row.qty),
    rate: money(row.selling_price),
    sales: money(number(row.qty) * number(row.selling_price)),
    discount: money(row.discount_amount),
    taxes: money(row.tax_amount),
    gross_bill: money(row.line_total),
    payment_mode: row.payment_mode,
    status: row.status,
  }));
}

async function getOrderPaymentReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed', 'partial', 'pending')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const res = await query(
    `SELECT sb.id, sb.bill_number, sb.created_at, sb.payment_mode, sb.status,
            sb.grand_total, sb.paid_amount, sb.balance_amount,
            COALESCE(payments.payments, '[]'::jsonb) AS payments,
            COALESCE(s.name, 'Store') AS store,
            sb.customer_name, sb.customer_mobile
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('method', sbp.method, 'amount', sbp.amount, 'referenceNo', sbp.reference_no) ORDER BY sbp.id) AS payments
       FROM sales_bill_payments sbp
       WHERE sbp.sales_bill_id = sb.id
     ) payments ON TRUE
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `order-pay-${row.id}`,
    order_id: row.id,
    sales_order_id: row.bill_number,
    invoice_number: row.bill_number,
    date: isoDate(row.created_at),
    order_date: isoDate(row.created_at),
    order_time: displayTime(row.created_at),
    store: row.store,
    customer: row.customer_name || 'Walk-in Customer',
    customer_mobile: row.customer_mobile || '',
    payment_mode: paymentBreakupText(row.payments, row.payment_mode),
    payment_status: row.status,
    amount: money(row.grand_total),
    paid_amount: money(row.paid_amount || row.grand_total),
    unpaid_amount: money(row.balance_amount),
    gross_bill: money(row.grand_total),
    status: row.status,
  }));
}

async function getProformaInvoiceReport(reportKey, filters, user) {
  if (reportKey.includes('product-in') || reportKey.includes('product-sale-transaction') || reportKey.includes('product-level-discount')) {
    return getProformaProductReport(reportKey, filters, user);
  }
  if (reportKey.includes('payment')) return getProformaPaymentReport(reportKey, filters, user);
  return getProformaListReport(filters, user);
}

async function getOnlineOrderReport(reportKey, filters, user) {
  const onlineFilters = { ...filters };
  const params = [];
  const conditions = [
    `sb.status IN ('paid', 'completed', 'partial', 'pending')`,
    `(
      LOWER(COALESCE(sb.meta->>'orderMode', sb.meta->>'channel', sb.payment_meta->>'channel', '')) LIKE '%online%'
      OR LOWER(COALESCE(sb.meta->>'source', '')) LIKE '%online%'
      OR LOWER(COALESCE(sb.payment_mode, '')) IN ('online', 'razorpay', 'paytm', 'phonepe')
    )`,
  ];
  addSalesFilters({ conditions, params, filters: onlineFilters, user, alias: 'sb' });

  if (reportKey.includes('product-in') || reportKey.includes('product-wise')) {
    const res = await query(
      `SELECT sb.id AS order_id, sb.bill_number, sb.created_at, sb.status, sb.payment_mode,
              COALESCE(s.name, 'Store') AS store,
              COALESCE(p.name, sbi.product_name, 'Product') AS product,
              COALESCE(p.sku, sbi.sku, '') AS sku,
              sbi.qty, sbi.selling_price, sbi.discount_amount, sbi.tax_amount, sbi.line_total
       FROM sales_bill_items sbi
       INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
       LEFT JOIN products p ON p.id = sbi.product_id
       LEFT JOIN stores s ON s.id = sb.store_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY sb.created_at DESC, sb.id DESC
       LIMIT 1000`,
      params
    );
    return res.rows.map((row) => ({
      id: `online-product-${row.order_id}-${row.sku}`,
      order_id: row.order_id,
      invoice_number: row.bill_number,
      store: row.store,
      date: isoDate(row.created_at),
      product: row.product,
      sku: row.sku,
      qty: number(row.qty),
      sales: money(number(row.qty) * number(row.selling_price)),
      discount: money(row.discount_amount),
      taxes: money(row.tax_amount),
      gross_bill: money(row.line_total),
      payment_mode: row.payment_mode,
      status: row.status,
    }));
  }

  const res = await query(
    `SELECT sb.id, sb.bill_number, sb.created_at, sb.status, sb.payment_mode,
            sb.subtotal, sb.discount_total, sb.tax_total, sb.grand_total,
            sb.customer_name, sb.customer_mobile,
            COALESCE(s.name, 'Store') AS store
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `online-${row.id}`,
    order_id: row.id,
    invoice_number: row.bill_number,
    store: row.store,
    customer: row.customer_name || 'Online Customer',
    customer_mobile: row.customer_mobile || '',
    date: isoDate(row.created_at),
    sales: money(row.subtotal),
    discount: money(row.discount_total),
    net_bill: money(number(row.subtotal) - number(row.discount_total)),
    taxes: money(row.tax_total),
    gross_bill: money(row.grand_total),
    payment_mode: row.payment_mode,
    status: row.status,
  }));
}

function addProformaFilters({ conditions, params, filters, user, alias = 'iso' }) {
  const range = parseDateRange(filters.date_range);
  params.push(range.from);
  conditions.push(`DATE(COALESCE(${alias}.invoice_date, ${alias}.booking_date, ${alias}.submitted_date, ${alias}.created_at::date)) >= $${params.length}`);
  params.push(range.to);
  conditions.push(`DATE(COALESCE(${alias}.invoice_date, ${alias}.booking_date, ${alias}.submitted_date, ${alias}.created_at::date)) <= $${params.length}`);
  addStoreColumnScope({ conditions, params, user, columnName: `${alias}.store_id`, requestedStoreId: filters.store });
  if (filters.customer) {
    params.push(`%${String(filters.customer).trim()}%`);
    conditions.push(`(${alias}.customer_name ILIKE $${params.length} OR ${alias}.customer_mobile ILIKE $${params.length})`);
  }
}

async function getProformaListReport(filters, user) {
  const params = [];
  const conditions = [`TRUE`];
  addProformaFilters({ conditions, params, filters, user });
  const res = await query(
    `SELECT iso.*, COALESCE(s.name, 'Store') AS store_name,
            COALESCE(sb.subtotal, iso.gross_bill, 0) AS subtotal,
            COALESCE(sb.discount_total, iso.total_discount, 0) AS discount_total,
            COALESCE(sb.tax_total, 0) AS tax_total,
            COALESCE(sb.grand_total, iso.gross_bill, 0) AS grand_total
     FROM invoice_sales_orders iso
     LEFT JOIN stores s ON s.id = iso.store_id
     LEFT JOIN sales_bills sb ON sb.id = iso.sales_bill_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(iso.invoice_date, iso.booking_date, iso.created_at::date) DESC, iso.id DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `pi-${row.id}`,
    pi_number: row.invoice_id || row.auto_invoice_id || row.transaction_id || row.sales_order_id || row.id,
    sales_order_id: row.sales_order_id || '',
    store: row.store_name || '',
    customer: row.customer_name || 'Walk-in Customer',
    customer_mobile: row.customer_mobile || '',
    date: isoDate(row.invoice_date || row.booking_date || row.created_at),
    sales: money(row.subtotal),
    discount: money(row.discount_total),
    net_bill: money(number(row.subtotal) - number(row.discount_total)),
    taxes: money(row.tax_total),
    gross_bill: money(row.grand_total),
    payment_mode: row.payment_mode || row.channel || '',
    status: row.status || '',
  }));
}

async function getProformaProductReport(reportKey, filters, user) {
  const params = [];
  const conditions = [`TRUE`];
  addProformaFilters({ conditions, params, filters, user });
  if (reportKey.includes('product-level-discount')) {
    conditions.push(`COALESCE(sbi.discount_amount, 0) > 0`);
  }
  const res = await query(
    `SELECT iso.id AS pi_id, iso.invoice_id, iso.auto_invoice_id, iso.transaction_id, iso.sales_order_id,
            COALESCE(iso.invoice_date, iso.booking_date, iso.created_at::date) AS pi_date,
            iso.customer_name, iso.status, COALESCE(s.name, 'Store') AS store_name,
            COALESCE(p.name, sbi.product_name, 'Product') AS product,
            COALESCE(p.sku, sbi.sku, '') AS sku,
            sbi.qty, sbi.selling_price, sbi.discount_amount, sbi.tax_amount, sbi.line_total
     FROM invoice_sales_orders iso
     LEFT JOIN stores s ON s.id = iso.store_id
     LEFT JOIN sales_bill_items sbi ON sbi.sales_bill_id = iso.sales_bill_id
     LEFT JOIN products p ON p.id = sbi.product_id
     WHERE ${conditions.join(' AND ')}
       AND sbi.id IS NOT NULL
     ORDER BY pi_date DESC, iso.id DESC, product ASC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `pi-product-${row.pi_id}-${row.sku || row.product}`,
    pi_number: row.invoice_id || row.auto_invoice_id || row.transaction_id || row.sales_order_id || row.pi_id,
    store: row.store_name || '',
    customer: row.customer_name || 'Walk-in Customer',
    date: isoDate(row.pi_date),
    product: row.product,
    sku: row.sku || '',
    qty: number(row.qty),
    quantity: number(row.qty),
    rate: money(row.selling_price),
    sales: money(number(row.qty) * number(row.selling_price)),
    discount: money(row.discount_amount),
    net_bill: money(number(row.line_total) - number(row.tax_amount)),
    taxes: money(row.tax_amount),
    gross_bill: money(row.line_total),
    status: row.status || '',
  }));
}

async function getProformaPaymentReport(reportKey, filters, user) {
  const params = [];
  const conditions = [`TRUE`];
  addProformaFilters({ conditions, params, filters, user });
  const res = await query(
    `SELECT iso.id AS pi_id, iso.invoice_id, iso.auto_invoice_id, iso.transaction_id, iso.sales_order_id,
            COALESCE(iso.invoice_date, iso.booking_date, iso.created_at::date) AS pi_date,
            iso.customer_name, iso.customer_mobile, iso.payment_mode, iso.channel, iso.status,
            COALESCE(s.name, 'Store') AS store_name,
            COALESCE(sb.subtotal, iso.gross_bill, 0) AS subtotal,
            COALESCE(sb.discount_total, iso.total_discount, 0) AS discount_total,
            COALESCE(sb.tax_total, 0) AS tax_total,
            COALESCE(sb.grand_total, iso.gross_bill, 0) AS grand_total,
            COALESCE(sbp.method, iso.payment_mode, iso.channel, 'unpaid') AS payment_method,
            COALESCE(sbp.amount, sb.paid_amount, 0) AS payment_amount,
            sbp.reference_no,
            COALESCE(sbp.created_at, iso.updated_at, iso.created_at) AS payment_date
     FROM invoice_sales_orders iso
     LEFT JOIN stores s ON s.id = iso.store_id
     LEFT JOIN sales_bills sb ON sb.id = iso.sales_bill_id
     LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY payment_date DESC, iso.id DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row, index) => ({
    id: `pi-payment-${row.pi_id}-${index}`,
    pi_number: row.invoice_id || row.auto_invoice_id || row.transaction_id || row.sales_order_id || row.pi_id,
    store: row.store_name || '',
    customer: row.customer_name || 'Walk-in Customer',
    customer_mobile: row.customer_mobile || '',
    date: isoDate(row.pi_date),
    payment_date: isoDate(row.payment_date),
    payment_mode: formatPaymentMethod(row.payment_method),
    reference_no: row.reference_no || '',
    sales: money(row.subtotal),
    discount: money(row.discount_total),
    net_bill: money(number(row.subtotal) - number(row.discount_total)),
    taxes: money(row.tax_total),
    gross_bill: money(row.grand_total),
    paid_amount: money(row.payment_amount),
    amount: money(row.payment_amount),
    status: row.status || '',
  }));
}

async function getAccountingTaxReport(reportKey, filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const groupExpr = reportKey.includes('hsn')
    ? `COALESCE(t.hsn_code, 'NA')`
    : reportKey.includes('order-wise')
      ? `sb.bill_number`
      : `COALESCE(p.name, sbi.product_name, 'Product')`;
  const res = await query(
    `SELECT ${groupExpr} AS group_name,
            COALESCE(s.name, 'Store') AS store,
            DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata') AS date,
            COUNT(DISTINCT sb.id)::int AS orders,
            COALESCE(SUM(sbi.line_total - sbi.tax_amount), 0) AS taxable_amount,
            COALESCE(SUM(sbi.tax_amount), 0) AS tax,
            COALESCE(SUM(sbi.line_total), 0) AS gross_bill
     FROM sales_bill_items sbi
     INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
     LEFT JOIN products p ON p.id = sbi.product_id
     LEFT JOIN taxes t ON t.id = p.tax_id
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY ${groupExpr}, s.name, DATE(sb.created_at AT TIME ZONE 'Asia/Kolkata')
     ORDER BY date DESC, tax DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row, index) => ({
    id: `tax-${index}`,
    hsn_sac: row.group_name,
    product: row.group_name,
    order_id: row.group_name,
    invoice_number: row.group_name,
    store: row.store,
    date: isoDate(row.date),
    orders: row.orders,
    taxable_amount: money(row.taxable_amount),
    tax: money(row.tax),
    taxes: money(row.tax),
    cgst: money(number(row.tax) / 2),
    sgst: money(number(row.tax) / 2),
    gross_bill: money(row.gross_bill),
  }));
}

async function getInventoryFamilyReport(reportKey, filters, user) {
  if (reportKey.includes('stock-requisition') || reportKey.includes('unfulfilled-stock-requests') || reportKey.includes('stock-fulfillment')) {
    return getStockRequisitionReport(reportKey, filters, user);
  }
  if (reportKey.includes('unfulfilled-stock-transfers')) {
    return getUnfulfilledStockTransfersReport(filters, user);
  }
  if (reportKey.includes('low-stock')) {
    const rows = await getStockLevelReport(filters, user);
    return rows.filter((row) => row.status === 'Low' || row.status === 'Out');
  }
  if (reportKey.includes('stock-movement') || reportKey.includes('stock-operations') || reportKey.includes('ledger')) {
    return getStockMovementReport(filters, user);
  }
  if (reportKey.includes('store-wise') || reportKey.includes('product-group') || reportKey.includes('ageing') || reportKey.includes('profit-margin')) {
    return getStockLevelReport(filters, user);
  }
  return getStockLevelReport(filters, user);
}

async function getStockRequisitionReport(reportKey, filters, user) {
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(sr.created_at) BETWEEN $1 AND $2`];
  addStoreColumnScope({ conditions, params, user, columnName: 'sr.destination_id', requestedStoreId: filters.store });

  if (reportKey.includes('unfulfilled-stock-requests')) {
    conditions.push(`sr.fulfillment_status <> 'completed'`);
    conditions.push(`sr.approval_status <> 'rejected'`);
  } else if (reportKey.includes('stock-fulfillment')) {
    conditions.push(`sr.approval_status = 'approved'`);
  }

  const res = await query(
    `SELECT sr.id, sr.transaction_id, sr.created_at, sr.requested_by, sr.mail_to, sr.remarks,
            sr.status, sr.approval_status, sr.fulfillment_status, sr.approved_at, sr.fulfilled_at,
            sr.purchase_order_id, sr.stock_transfer_id, sr.rejection_reason,
            COALESCE(src.name, '') AS source_name,
            COALESCE(dst.name, '') AS destination_name,
            COALESCE(p.name, sri.product_name, 'Product') AS product,
            COALESCE(p.sku, '') AS sku,
            sri.qty, sri.fulfilled_qty
     FROM stock_requisitions sr
     LEFT JOIN stores src ON src.id = sr.source_id
     LEFT JOIN stores dst ON dst.id = sr.destination_id
     LEFT JOIN stock_requisition_items sri ON sri.requisition_id = sr.id
     LEFT JOIN products p ON p.id = sri.product_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sr.created_at DESC, sr.id DESC, product ASC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => {
    const requestedQty = number(row.qty);
    const fulfilledQty = row.fulfillment_status === 'completed' ? requestedQty : number(row.fulfilled_qty);
    return {
      id: `req-${row.id}-${row.sku || row.product}`,
      requisition_id: row.transaction_id || `REQ-${String(row.id).padStart(4, '0')}`,
      date: isoDate(row.created_at),
      requested_time: displayTime(row.created_at),
      source: row.source_name || '',
      destination: row.destination_name || '',
      store: row.destination_name || '',
      product: row.product,
      sku: row.sku || '',
      requested_qty: requestedQty,
      fulfilled_qty: fulfilledQty,
      pending_qty: Math.max(0, requestedQty - fulfilledQty),
      requested_by: row.requested_by || '',
      mail_to: row.mail_to || '',
      remarks: row.remarks || row.rejection_reason || '',
      approval_status: row.approval_status || '',
      fulfillment_status: row.fulfillment_status || '',
      purchase_order_id: row.purchase_order_id || '',
      stock_transfer_id: row.stock_transfer_id || '',
      status: row.status || '',
      unit: 'PCS',
      opening_stock: requestedQty,
      stock_in: fulfilledQty,
      stock_out: Math.max(0, requestedQty - fulfilledQty),
      current_stock: Math.max(0, requestedQty - fulfilledQty),
    };
  });
}

async function getUnfulfilledStockTransfersReport(filters, user) {
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(st.created_at) BETWEEN $1 AND $2`, `st.status <> 'confirmed'`];
  addStoreColumnScope({ conditions, params, user, columnName: 'st.destination_id', requestedStoreId: filters.store });

  const res = await query(
    `SELECT st.id, st.transaction_id, st.created_at, st.status,
            COALESCE(src.name, '') AS source_name,
            COALESCE(dst.name, '') AS destination_name,
            COALESCE(p.name, sti.product_name, 'Product') AS product,
            COALESCE(p.sku, '') AS sku,
            sti.qty
     FROM stock_transfer st
     LEFT JOIN stores src ON src.id = st.source_id
     LEFT JOIN stores dst ON dst.id = st.destination_id
     LEFT JOIN stock_transfer_items sti ON sti.stock_transfer_id = st.id
     LEFT JOIN products p ON p.id = sti.product_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY st.created_at DESC, st.id DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => ({
    id: `transfer-${row.id}-${row.sku || row.product}`,
    transfer_id: row.transaction_id || `TRN-${String(row.id).padStart(4, '0')}`,
    date: isoDate(row.created_at),
    source: row.source_name || '',
    destination: row.destination_name || '',
    store: row.destination_name || '',
    product: row.product || '',
    sku: row.sku || '',
    requested_qty: number(row.qty),
    pending_qty: number(row.qty),
    status: row.status || 'draft',
    unit: 'PCS',
    opening_stock: 0,
    stock_in: 0,
    stock_out: number(row.qty),
    current_stock: number(row.qty),
  }));
}

async function getStockMovementReport(filters, user) {
  const range = parseDateRange(filters.date_range);
  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
  const params = [range.from, range.to];
  let storeClause = '';
  if (user.role !== 'super_admin') {
    if (!assignedStores.length) return [];
    params.push(assignedStores);
    storeClause = ` AND m.store_id = ANY($${params.length}::int[])`;
  } else if (filters.store && filters.store !== 'all') {
    params.push(Number(filters.store));
    storeClause = ` AND m.store_id = $${params.length}`;
  }
  const res = await query(
    `SELECT m.*, COALESCE(p.name, 'Product') AS product, p.sku, COALESCE(s.name, 'Store') AS store
     FROM inventory_batch_movements m
     LEFT JOIN products p ON p.id = m.product_id
     LEFT JOIN stores s ON s.id = m.store_id
     WHERE DATE(m.created_at) BETWEEN $1 AND $2 ${storeClause}
     ORDER BY m.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `movement-${row.id}`,
    date: isoDate(row.created_at),
    time: displayTime(row.created_at),
    product: row.product,
    sku: row.sku || '',
    store: row.store,
    direction: row.direction,
    qty: number(row.qty),
    quantity: number(row.qty),
    reference_type: row.reference_type || '',
    reference_id: row.reference_id || '',
    status: row.direction === 'in' ? 'Stock In' : 'Stock Out',
  }));
}

async function getVendorQuotationReport(filters, user) {
  await ensureProcurementSchema();
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(vq.quotation_date) BETWEEN $1 AND $2`];
  addStoreColumnScope({ conditions, params, user, columnName: 'vq.store_id', requestedStoreId: filters.store });

  const res = await query(
    `SELECT vq.id, vq.transaction_id, vq.quotation_no, vq.quotation_date, vq.delivery_days,
            vq.freight_amount, vq.status, COALESCE(v.name, 'Vendor') AS vendor,
            COALESCE(s.name, 'Store') AS store,
            COUNT(vqi.id)::int AS items,
            COALESCE(SUM(vqi.qty * vqi.quoted_price + vqi.tax_value), 0) AS amount
     FROM vendor_quotations vq
     LEFT JOIN vendors v ON v.id = vq.vendor_id
     LEFT JOIN stores s ON s.id = vq.store_id
     LEFT JOIN vendor_quotation_items vqi ON vqi.quotation_id = vq.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY vq.id, v.name, s.name
     ORDER BY vq.quotation_date DESC, vq.created_at DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => {
    const amount = number(row.amount);
    const score = Math.max(0, Math.round(100 - number(row.delivery_days) * 2 - number(row.freight_amount) / Math.max(amount || 1, 1) * 10));
    return {
      id: `quote-${row.id}`,
      quote_id: row.transaction_id || row.quotation_no || `VQ-${String(row.id).padStart(4, '0')}`,
      date: isoDate(row.quotation_date),
      vendor: row.vendor,
      store: row.store,
      items: number(row.items),
      amount: money(amount),
      freight: money(row.freight_amount),
      lead_days: number(row.delivery_days),
      score,
      status: row.status || 'Draft',
    };
  });
}

async function getPurchaseReturnReport(filters, user) {
  await ensureProcurementSchema();
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(pr.return_date) BETWEEN $1 AND $2`];
  addStoreColumnScope({ conditions, params, user, columnName: 'pr.store_id', requestedStoreId: filters.store });

  const res = await query(
    `SELECT pr.id, pr.transaction_id, pr.return_date, pr.total_qty, pr.total_amount,
            pr.status, pr.reason, COALESCE(v.name, 'Vendor') AS vendor, COALESCE(s.name, 'Store') AS store
     FROM purchase_returns pr
     LEFT JOIN vendors v ON v.id = pr.vendor_id
     LEFT JOIN stores s ON s.id = pr.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pr.return_date DESC, pr.created_at DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row) => ({
    id: `purchase-return-${row.id}`,
    return_id: row.transaction_id || `PR-${String(row.id).padStart(4, '0')}`,
    date: isoDate(row.return_date),
    vendor: row.vendor,
    store: row.store,
    qty: number(row.total_qty),
    amount: money(row.total_amount),
    status: row.status || 'Draft',
    reason: row.reason || '',
  }));
}

async function getVendorLedgerReport(filters, user) {
  await ensureProcurementSchema();
  await ensureVendorInvoicesSchema();
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(ledger.entry_at) BETWEEN $1 AND $2`];
  if (user.role !== 'super_admin') {
    const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
    if (!assignedStores.length) conditions.push('1 = 0');
    else {
      params.push(assignedStores);
      conditions.push(`(ledger.store_id IS NULL OR ledger.store_id = ANY($${params.length}::int[]))`);
    }
  }

  const res = await query(
    `WITH ledger AS (
       SELECT vi.created_at AS entry_at, vi.vendor_id, v.name AS vendor_name,
              COALESCE(po.destination_id, si.destination_id) AS store_id,
              vi.transaction_id, vi.invoice_number AS reference_no,
              'Invoice' AS entry_type, vi.total_amount AS debit, 0::numeric AS credit, vi.remarks
       FROM vendor_invoices vi
       LEFT JOIN vendors v ON v.id = vi.vendor_id
       LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
       LEFT JOIN stock_in si ON si.id = vi.stock_in_id
       UNION ALL
       SELECT vis.created_at AS entry_at, vi.vendor_id, v.name AS vendor_name,
              COALESCE(po.destination_id, si.destination_id) AS store_id,
              vi.transaction_id, vis.reference_no,
              'Payment' AS entry_type, 0::numeric AS debit, vis.amount AS credit, vis.remarks
       FROM vendor_invoice_settlements vis
       JOIN vendor_invoices vi ON vi.id = vis.vendor_invoice_id
       LEFT JOIN vendors v ON v.id = vi.vendor_id
       LEFT JOIN purchase_orders po ON po.id = vi.purchase_order_id
       LEFT JOIN stock_in si ON si.id = vi.stock_in_id
       UNION ALL
       SELECT pr.created_at AS entry_at, pr.vendor_id, v.name AS vendor_name,
              pr.store_id, pr.transaction_id, pr.transaction_id AS reference_no,
              'Purchase Return' AS entry_type, 0::numeric AS debit, pr.total_amount AS credit, pr.reason AS remarks
       FROM purchase_returns pr
       LEFT JOIN vendors v ON v.id = pr.vendor_id
     )
     SELECT ledger.*,
            SUM(debit - credit) OVER (PARTITION BY vendor_id ORDER BY entry_at, transaction_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
     FROM ledger
     WHERE ${conditions.join(' AND ')}
     ORDER BY entry_at DESC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row, index) => ({
    id: `vendor-ledger-${index}`,
    date: isoDate(row.entry_at),
    vendor: row.vendor_name || 'Vendor',
    entry_type: row.entry_type,
    transaction_id: row.transaction_id || '',
    reference_no: row.reference_no || '',
    debit: money(row.debit),
    credit: money(row.credit),
    balance: money(row.balance),
    remarks: row.remarks || '',
  }));
}

async function getVendorPerformanceReport(filters, user) {
  const rows = await getPurchaseFamilyReport('purchase/vendor-purchase-summary', filters, user);
  const byVendor = new Map();
  rows.forEach((row) => {
    const current = byVendor.get(row.vendor) || { vendor: row.vendor, po_count: 0, purchase_value: 0, return_count: 0, outstanding: 0 };
    current.po_count += 1;
    current.purchase_value += number(String(row.grand_total || row.total_amount || '0').replace(/,/g, ''));
    byVendor.set(row.vendor, current);
  });
  return [...byVendor.values()].map((row, index) => {
    const score = Math.max(50, Math.min(100, 100 - row.return_count * 5));
    return {
      id: `vendor-performance-${index}`,
      vendor: row.vendor,
      score,
      grade: score >= 85 ? 'A' : score >= 70 ? 'B' : 'C',
      po_count: row.po_count,
      purchase_value: money(row.purchase_value),
      avg_lead_days: 0,
      return_count: row.return_count,
      outstanding: money(row.outstanding),
    };
  });
}

async function getAutoReorderReport(filters, user) {
  await ensureProcurementSchema();
  await ensureInventoryBatchSchema();
  const params = [];
  const conditions = ['ps.is_active = TRUE'];
  addStoreColumnScope({ conditions, params, user, columnName: 'ps.store_id', requestedStoreId: filters.store });

  const res = await query(
    `WITH stock AS (
       SELECT product_id, store_id, COALESCE(SUM(available_qty), 0) AS available_qty
       FROM inventory_batches
       WHERE status = 'active'
       GROUP BY product_id, store_id
     )
     SELECT p.name AS product, p.sku, COALESCE(s.name, 'Store') AS store,
            COALESCE(stock.available_qty, 0) AS current_stock,
            COALESCE(NULLIF(ps.low_stock_value, 0), 10) AS reorder_level,
            GREATEST(COALESCE(NULLIF(ps.low_stock_value, 0), 10) * 2 - COALESCE(stock.available_qty, 0), 0) AS suggested_qty,
            COALESCE(p.cost_price, 0) AS cost,
            last_vendor.vendor_name AS vendor
     FROM product_saleability ps
     JOIN products p ON p.id = ps.product_id
     JOIN stores s ON s.id = ps.store_id
     LEFT JOIN stock ON stock.product_id = ps.product_id AND stock.store_id = ps.store_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(v.name, si.vendor_name) AS vendor_name
       FROM stock_in_items sii
       JOIN stock_in si ON si.id = sii.stock_in_id
       LEFT JOIN vendors v ON v.id = si.vendor_id
       WHERE sii.product_id = p.id AND si.vendor_id IS NOT NULL
       ORDER BY si.confirmed_at DESC NULLS LAST, si.created_at DESC
       LIMIT 1
     ) last_vendor ON TRUE
     WHERE ${conditions.join(' AND ')}
       AND COALESCE(stock.available_qty, 0) <= COALESCE(NULLIF(ps.low_stock_value, 0), 10)
     ORDER BY suggested_qty DESC, p.name ASC
     LIMIT 1000`,
    params
  );

  return res.rows.map((row, index) => ({
    id: `auto-reorder-${index}`,
    product: row.product,
    sku: row.sku || '',
    store: row.store,
    current_stock: number(row.current_stock),
    reorder_level: number(row.reorder_level),
    suggested_qty: number(row.suggested_qty),
    vendor: row.vendor || '',
    cost: money(row.cost),
  }));
}

async function getPurchaseFamilyReport(reportKey, filters, user) {
  await ensureStockInSchema();
  await ensureVendorsSchema();
  await ensurePurchaseOrderSchema();
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const poConditions = [`DATE(COALESCE(po.confirmed_at, po.created_at)) BETWEEN $1 AND $2`];
  const stockConditions = [`DATE(COALESCE(si.confirmed_at, si.created_at)) BETWEEN $1 AND $2`];
  const requestedStoreId = Number(filters.store || 0) || null;
  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
  if (user.role === 'super_admin') {
    if (requestedStoreId) {
      params.push(requestedStoreId);
      poConditions.push(`po.destination_id = $${params.length}`);
      stockConditions.push(`si.destination_id = $${params.length}`);
    }
  } else if (requestedStoreId && assignedStores.includes(requestedStoreId)) {
    params.push(requestedStoreId);
    poConditions.push(`po.destination_id = $${params.length}`);
    stockConditions.push(`si.destination_id = $${params.length}`);
  } else if (assignedStores.length) {
    params.push(assignedStores);
    poConditions.push(`po.destination_id = ANY($${params.length}::int[])`);
    stockConditions.push(`si.destination_id = ANY($${params.length}::int[])`);
  } else {
    poConditions.push('1 = 0');
    stockConditions.push('1 = 0');
  }
  const productJoin = reportKey.includes('product') || reportKey.includes('details');
  const res = await query(
    `SELECT *
     FROM (
       SELECT
         po.id,
         po.transaction_id,
         po.invoice_number,
         po.invoice_date,
         COALESCE(v.name, 'Vendor') AS vendor_name,
         po.vendor_id,
         po.total_items,
         po.total_cost,
         po.total_tax,
         po.status,
         COALESCE(po.confirmed_at, po.created_at) AS created_at,
         COALESCE(s.name, 'Store') AS store,
         'purchase_order' AS source_type
         ${productJoin ? `, COALESCE(p.name, poi.product_name, 'Product') AS product, p.sku, poi.qty, poi.cost_price, poi.tax_value` : ''}
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN stores s ON s.id = po.destination_id
       ${productJoin ? 'LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id LEFT JOIN products p ON p.id = poi.product_id' : ''}
       WHERE ${poConditions.join(' AND ')}

       UNION ALL

       SELECT
         si.id,
         si.transaction_id,
         si.invoice_number,
         si.invoice_date,
         COALESCE(v.name, NULLIF(si.vendor_name, ''), 'Vendor') AS vendor_name,
         si.vendor_id,
         si.total_items,
         si.total_cost,
         si.total_tax,
         si.status,
         COALESCE(si.confirmed_at, si.created_at) AS created_at,
         COALESCE(s.name, 'Store') AS store,
         'stock_in' AS source_type
         ${productJoin ? `, COALESCE(p.name, sii.product_name, 'Product') AS product, p.sku, sii.qty, sii.cost_price, sii.tax_value` : ''}
       FROM stock_in si
       LEFT JOIN vendors v ON v.id = si.vendor_id OR LOWER(v.name) = LOWER(COALESCE(si.vendor_name, ''))
       LEFT JOIN stores s ON s.id = si.destination_id
       ${productJoin ? 'LEFT JOIN stock_in_items sii ON sii.stock_in_id = si.id LEFT JOIN products p ON p.id = sii.product_id' : ''}
       WHERE ${stockConditions.join(' AND ')}
         AND COALESCE(si.reference_type, '') <> 'purchase_order'
     ) purchases
     ORDER BY created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row, index) => ({
    id: `purchase-${row.id}-${index}`,
    po_id: row.transaction_id || row.id,
    purchase_order_id: row.transaction_id || row.id,
    vendor: row.vendor_name || 'Vendor',
    store: row.store,
    date: isoDate(row.invoice_date || row.created_at),
    invoice_number: row.invoice_number || '',
    product: row.product || '',
    sku: row.sku || '',
    qty: number(row.qty || row.total_items),
    items: number(row.total_items || row.qty),
    rate: money(row.cost_price),
    total_amount: money(row.total_cost || (number(row.qty) * number(row.cost_price))),
    tax: money(row.total_tax || row.tax_value),
    grand_total: money(number(row.total_cost || (number(row.qty) * number(row.cost_price))) + number(row.total_tax || row.tax_value)),
    status: row.status,
  }));
}

async function getPromotionsFamilyReport(reportKey, filters, user) {
  if (reportKey.includes('coupon-redemption')) return getCouponRedemptionReport(filters, user);
  if (reportKey.includes('membership')) return getMembershipReport(filters, user);
  if (reportKey.includes('discounted-products') || reportKey.includes('product-discount')) return getDiscountedProductsReport(filters, user);

  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`, `COALESCE(sb.discount_total, 0) > 0`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const res = await query(
    `SELECT sb.id, sb.bill_number, sb.created_at, sb.discount_total, sb.grand_total,
            COALESCE(s.name, 'Store') AS store, sb.customer_name
     FROM sales_bills sb
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `promo-${row.id}`,
    order_id: row.id,
    invoice_number: row.bill_number,
    date: isoDate(row.created_at),
    store: row.store,
    customer: row.customer_name || 'Walk-in Customer',
    coupon: '',
    membership: '',
    discount: money(row.discount_total),
    discount_amount: money(row.discount_total),
    sales: money(row.grand_total),
    gross_bill: money(row.grand_total),
    status: 'Applied',
  }));
}

async function getCouponRedemptionReport(filters, user) {
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`COALESCE(v.is_used, false) = true`, `DATE(COALESCE(v.updated_at, v.created_at)) BETWEEN $1 AND $2`];
  addStoreColumnScope({ conditions, params, user, columnName: 'v.store_id', requestedStoreId: filters.store });

  const res = await query(
    `SELECT v.id, v.code, v.value, v.voucher_type, v.redeemed_count, v.updated_at, v.created_at,
            COALESCE(s.name, 'Store') AS store,
            COALESCE(c.name, '') AS customer
     FROM vouchers v
     LEFT JOIN stores s ON s.id = v.store_id
     LEFT JOIN customers c ON c.id = v.customer_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(v.updated_at, v.created_at) DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `coupon-${row.id}`,
    date: isoDate(row.updated_at || row.created_at),
    store: row.store,
    customer: row.customer || '',
    coupon: row.code,
    voucher: row.code,
    discount: money(row.value),
    discount_amount: money(row.value),
    redeemed_count: number(row.redeemed_count || 1),
    status: 'Redeemed',
    type: row.voucher_type || '',
  }));
}

async function getMembershipReport(filters, user) {
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(m.created_at) BETWEEN $1 AND $2`];
  const res = await query(
    `SELECT m.id, m.name, m.membership_code, m.price, m.quantity, m.validity_days,
            m.discount_type, m.discount_value, m.is_active, m.created_at,
            COALESCE(c.name, '') AS category
     FROM memberships m
     LEFT JOIN categories c ON c.id = m.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `membership-${row.id}`,
    date: isoDate(row.created_at),
    membership: row.name,
    membership_code: row.membership_code || '',
    category: row.category || '',
    sales: money(row.price),
    gross_bill: money(row.price),
    discount: row.discount_value ? `${row.discount_type || ''} ${row.discount_value}`.trim() : '',
    qty: number(row.quantity),
    validity_days: number(row.validity_days),
    status: row.is_active ? 'Active' : 'Inactive',
  }));
}

async function getDiscountedProductsReport(filters, user) {
  const params = [];
  const conditions = [`sb.status IN ('paid', 'completed')`, `COALESCE(sbi.discount_amount, 0) > 0`];
  addSalesFilters({ conditions, params, filters, user, alias: 'sb' });
  const res = await query(
    `SELECT sb.id AS order_id, sb.bill_number, sb.created_at,
            COALESCE(s.name, 'Store') AS store,
            COALESCE(p.name, sbi.product_name, 'Product') AS product,
            COALESCE(p.sku, sbi.sku, '') AS sku,
            sbi.qty, sbi.selling_price, sbi.discount_amount, sbi.line_total
     FROM sales_bill_items sbi
     INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
     LEFT JOIN products p ON p.id = sbi.product_id
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sb.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `discount-product-${row.order_id}-${row.sku}`,
    date: isoDate(row.created_at),
    order_id: row.order_id,
    invoice_number: row.bill_number,
    store: row.store,
    product: row.product,
    sku: row.sku,
    qty: number(row.qty),
    sales: money(number(row.qty) * number(row.selling_price)),
    discount: money(row.discount_amount),
    discount_amount: money(row.discount_amount),
    gross_bill: money(row.line_total),
    status: 'Discounted',
  }));
}

async function getInsightsFamilyReport(reportKey, filters, user) {
  if (reportKey.includes('dead-stock') || reportKey.includes('stockout') || reportKey.includes('smart-reorder')) {
    const rows = await getStockLevelReport(filters, user);
    return rows
      .filter((row) => reportKey.includes('dead-stock') ? number(row.current_stock) > 0 : number(row.current_stock) <= 0 || row.status === 'Low')
      .map((row) => ({
        ...row,
        risk: row.status === 'Out' ? 'High' : row.status === 'Low' ? 'Medium' : 'Low',
        recommendation: row.status === 'Out' ? 'Reorder immediately' : row.status === 'Low' ? 'Plan reorder' : 'Review movement',
      }));
  }
  if (reportKey.includes('basket')) return getProductInOrdersReport(filters, user);
  if (reportKey.includes('purchase-price')) return getPurchaseFamilyReport('purchase/product-in-purchase-orders', filters, user);
  return getSalesDimensionReport('sales/product-wise-sales', filters, user);
}

async function getLogsFamilyReport(reportKey, filters, user) {
  if (reportKey.includes('audit-trail')) return getAuditLogReport(filters, user, '');
  if (reportKey.includes('system')) return getAuditLogReport(filters, user, 'system');
  if (reportKey.includes('order-sync')) return getAuditLogReport(filters, user, 'order');
  if (reportKey.includes('product')) {
    const auditRows = await getAuditLogReport(filters, user, 'product');
    if (auditRows.length) return auditRows;
    const range = parseDateRange(filters.date_range);
    const res = await query(
      `SELECT p.id, p.name, p.sku, p.updated_at
       FROM products p
       WHERE DATE(COALESCE(p.updated_at, p.created_at)) BETWEEN $1 AND $2
       ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
       LIMIT 1000`,
      [range.from, range.to]
    );
    return res.rows.map((row) => ({
      id: `product-log-${row.id}`,
      date: isoDate(row.updated_at),
      time: displayTime(row.updated_at),
      product: row.name,
      sku: row.sku || '',
      resource_type: 'product',
      resource_id: row.id,
      action: 'Updated',
      employee: '',
      status: 'Logged',
    }));
  }
  const rows = await getOrdersReport(filters, user);
  return rows.map((row) => ({
    ...row,
    action: reportKey.includes('sync') ? 'Synced' : 'System activity',
    status: row.payment_status || 'Logged',
  }));
}

async function getAuditLogReport(filters, user, type = '') {
  const range = parseDateRange(filters.date_range);
  const params = [range.from, range.to];
  const conditions = [`DATE(al.created_at) BETWEEN $1 AND $2`];
  if (type === 'product') {
    conditions.push(`LOWER(COALESCE(al.resource_type, '')) LIKE '%product%'`);
  } else if (type === 'order') {
    conditions.push(`(LOWER(COALESCE(al.resource_type, '')) LIKE '%order%' OR LOWER(COALESCE(al.action, '')) LIKE '%sync%')`);
  }
  const res = await query(
    `SELECT al.id, al.action, al.resource_type, al.resource_id, al.status, al.error_message,
            al.created_at, COALESCE(u.name, u.email, '') AS employee
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT 1000`,
    params
  );
  return res.rows.map((row) => ({
    id: `audit-${row.id}`,
    date: isoDate(row.created_at),
    time: displayTime(row.created_at),
    action: row.action || '',
    resource_type: row.resource_type || '',
    resource_id: row.resource_id || '',
    employee: row.employee || '',
    status: row.status || (row.error_message ? 'Failed' : 'Logged'),
    remarks: row.error_message || '',
    product: row.resource_type === 'product' ? row.resource_id : '',
    order_id: row.resource_type === 'order' ? row.resource_id : '',
  }));
}

export async function getReportsDashboard(user) {
  await ensureReportSchemas();
  const today = new Date().toISOString().slice(0, 10);
  const filters = { date_range: `${today} - ${today}` };
  const [orders, dailySales, netSales, stockRows, stores] = await Promise.all([
    getOrdersReport(filters, user),
    getDailySalesReport(filters, user),
    getNetSalesReport(filters, user),
    getStockLevelReport({}, user),
    getStoresForUser(user),
  ]);

  const dailyTotal = dailySales.reduce((sum, row) => sum + number(String(row.gross_bill).replace(/,/g, '')), 0);
  const netTotal = netSales.reduce((sum, row) => sum + number(String(row.net_sales).replace(/,/g, '')), 0);
  const lowStock = stockRows.filter((row) => row.status === 'Low' || row.status === 'Out');

  return {
    stores,
    pinned: {
      orders: { value: orders.length, label: `${orders.length} orders` },
      dailySales: { value: dailyTotal, label: `₹${money(dailyTotal)}` },
      netSales: { value: netTotal, label: `₹${money(netTotal)}` },
      stockLevel: { value: stockRows.length, low: lowStock.length, label: `${stockRows.length} SKUs` },
    },
  };
}

export function createReportWorkbookBuffer(definition, rows) {
  const headers = definition.columns.map((column) => column.label);
  const body = rows.map((row) => definition.columns.map((column) => row[column.key] ?? ''));
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, definition.worksheet || definition.title || 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
