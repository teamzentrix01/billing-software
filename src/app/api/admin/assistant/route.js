import { requireAuth, requireRole } from '@/lib/api-protection';
import { successResponse, validationError, errorResponse } from '@/lib/api-response';
import { ensureAuditLogsSchema } from '@/lib/auditLogsSchema';
import { ensureEmployeesSchema } from '@/lib/employeesSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { query } from '@/lib/db';
import { formatIndianDateTime } from '@/lib/dateUtils';

const RUPEE = '\u20b9';
const MAX_ROWS = 20;

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return `${RUPEE}${Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;
}

function parseDateRange(message) {
  const text = message.toLowerCase();
  const now = new Date();

  if (/(last|pichle)\s*30|30\s*(days|din)/.test(text)) {
    return { from: startOfDay(addDays(now, -29)), to: endOfDay(now), label: 'last 30 days', explicit: true };
  }
  if (/(last|pichle)\s*7|7\s*(days|din|day)/.test(text) || /week|hafta/.test(text)) {
    return { from: startOfDay(addDays(now, -6)), to: endOfDay(now), label: 'last 7 days', explicit: true };
  }
  if (/yesterday|kal/.test(text)) {
    const yesterday = addDays(now, -1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday), label: 'yesterday', explicit: true };
  }
  if (/month|mahina|is mahine|this month/.test(text)) {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: endOfDay(now),
      label: 'this month',
      explicit: true,
    };
  }

  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return { from: startOfDay(date), to: endOfDay(date), label: formatDate(date), explicit: true };
  }

  const indianMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (indianMatch) {
    const date = new Date(Number(indianMatch[3]), Number(indianMatch[2]) - 1, Number(indianMatch[1]));
    return { from: startOfDay(date), to: endOfDay(date), label: formatDate(date), explicit: true };
  }

  const monthNames = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8,
    sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
    dec: 11, december: 11,
  };
  const monthMatch = text.match(/\b(\d{1,2})\s+([a-z]+)(?:\s+(20\d{2}))?\b/);
  if (monthMatch && Object.prototype.hasOwnProperty.call(monthNames, monthMatch[2])) {
    const date = new Date(Number(monthMatch[3] || now.getFullYear()), monthNames[monthMatch[2]], Number(monthMatch[1]));
    return { from: startOfDay(date), to: endOfDay(date), label: formatDate(date), explicit: true };
  }

  return { from: startOfDay(now), to: endOfDay(now), label: 'today', explicit: false };
}

function parseIntent(message) {
  const text = message.toLowerCase();
  if (/expir|near expiry|expiry|expire|kharaab|pass/.test(text)) return 'expiry';
  if (/audit|activity|log|kisne|kya kya|kiya|changes|delete|update|created/.test(text)) return 'activity';
  if (/stock|inventory|transfer|requisition|batch/.test(text)) return 'stock';
  if (/sale|sales|performance|cashier|bill|revenue|employee|staff|top/.test(text)) return 'sales';
  return 'help';
}

function parseStoreId(message) {
  const match = message.toLowerCase().match(/\bstore\s*#?\s*(\d+)\b/);
  return match ? Number(match[1]) : null;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function resolveStoreFilter(message) {
  const storeId = parseStoreId(message);
  if (storeId) return { id: storeId, name: `Store ${storeId}` };

  const normalizedMessage = normalizeSearchText(message);
  if (!normalizedMessage) return null;

  const storesResult = await query(
    `SELECT id, name
     FROM stores
     WHERE name IS NOT NULL AND TRIM(name) <> ''
     ORDER BY LENGTH(name) DESC
     LIMIT 500`
  );

  return storesResult.rows.find((store) => {
    const normalizedName = normalizeSearchText(store.name);
    return normalizedName.length >= 3 && normalizedMessage.includes(normalizedName);
  }) || null;
}

function parseEmployeeSearch(message) {
  const text = message.trim();
  const named = text.match(/\b(?:employee|staff|cashier|user)\s*(?:name|named|called|:)\s+([a-zA-Z0-9._-]{2,40})/i);
  if (named) {
    const candidate = named[1].trim();
    if (!/^(sales|sale|performance|activity|report|wise|top|data|logs?|stock|inventory)$/i.test(candidate)) {
      return candidate;
    }
  }
  const beforeAction = text.match(/^([a-zA-Z][a-zA-Z ._-]{1,35})\s+(?:ne|has|did|kiya)/i);
  return beforeAction ? beforeAction[1].trim() : '';
}

async function addOptionalFilters({ where, params, message }) {
  const store = await resolveStoreFilter(message);
  const employee = parseEmployeeSearch(message);

  if (store?.id) {
    params.push(Number(store.id));
    where.push(`sb.store_id = $${params.length}`);
  }

  if (employee) {
    params.push(`%${employee.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(u.name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(u.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(e.first_name || ' ' || COALESCE(e.last_name, ''), '')) LIKE $${params.length}
      OR LOWER(COALESCE(e.username, '')) LIKE $${params.length}
    )`);
  }
}

function buildAnswer({ title, summary, columns = [], rows = [], cards = [], links = [], range }) {
  return {
    title,
    answer: summary,
    range,
    cards,
    table: { columns, rows },
    links,
  };
}

async function getLatestRange(tableName, dateColumn = 'created_at', days = 7) {
  const result = await query(
    `SELECT MAX(${dateColumn}) AS latest_date FROM ${tableName} WHERE ${dateColumn} IS NOT NULL`
  );
  const latestDate = result.rows[0]?.latest_date ? new Date(result.rows[0].latest_date) : null;
  if (!latestDate || Number.isNaN(latestDate.getTime())) return null;

  return {
    from: startOfDay(addDays(latestDate, -(days - 1))),
    to: endOfDay(latestDate),
    label: `latest ${days} days in data`,
    explicit: false,
    fallback: true,
  };
}

async function runSalesQuery(message, range) {
  const params = [range.from, range.to];
  const where = [`sb.created_at BETWEEN $1 AND $2`];
  await addOptionalFilters({ where, params, message });

  return query(
    `SELECT
       COALESCE(NULLIF(TRIM(e.first_name || ' ' || COALESCE(e.last_name, '')), ''), u.name, u.email, 'Unknown') AS employee,
       COALESCE(s.name, 'Unknown store') AS store,
       COUNT(sb.id)::int AS bills,
       COALESCE(SUM(sb.grand_total), 0)::float AS sales,
       COALESCE(SUM(sb.tax_total), 0)::float AS tax,
       COALESCE(SUM(sb.paid_amount), 0)::float AS paid
     FROM sales_bills sb
     LEFT JOIN users u ON u.id = sb.user_id
     LEFT JOIN employees e ON e.user_id = sb.user_id
     LEFT JOIN stores s ON s.id = sb.store_id
     WHERE ${where.join(' AND ')}
       AND COALESCE(sb.status, 'paid') NOT IN ('cancelled', 'void')
     GROUP BY employee, store
     ORDER BY sales DESC
     LIMIT ${MAX_ROWS}`,
    params
  );
}

async function getSalesAnswer(message, range) {
  let effectiveRange = range;
  let result = await runSalesQuery(message, effectiveRange);

  if (!result.rows.length && !range.explicit) {
    const latestRange = await getLatestRange('sales_bills', 'created_at', 7);
    if (latestRange) {
      effectiveRange = latestRange;
      result = await runSalesQuery(message, effectiveRange);
    }
  }

  const totalSales = result.rows.reduce((sum, row) => sum + Number(row.sales || 0), 0);
  const totalBills = result.rows.reduce((sum, row) => sum + Number(row.bills || 0), 0);
  const top = result.rows[0];

  return buildAnswer({
    title: 'Employee sales performance',
    summary: result.rows.length
      ? `${effectiveRange.label}${effectiveRange.fallback ? ' (selected date had no sales)' : ''}: ${totalBills} bills and ${formatMoney(totalSales)} sales found. Top performer is ${top.employee} with ${formatMoney(top.sales)}.`
      : `${effectiveRange.label} ke liye sales data nahi mila. Date/store/employee filter change karke try karein.`,
    range: effectiveRange,
    cards: [
      { label: 'Sales', value: formatMoney(totalSales) },
      { label: 'Bills', value: String(totalBills) },
      { label: 'Employees/Stores', value: String(result.rows.length) },
    ],
    columns: ['Employee', 'Store', 'Bills', 'Sales', 'Tax', 'Paid'],
    rows: result.rows.map((row) => ({
      Employee: row.employee,
      Store: row.store,
      Bills: row.bills,
      Sales: formatMoney(row.sales),
      Tax: formatMoney(row.tax),
      Paid: formatMoney(row.paid),
    })),
    links: [{ label: 'Employee wise sales report', href: '/reports/sales/employee-wise-sales' }],
  });
}

async function runActivityQuery(message, range) {
  const params = [range.from, range.to];
  const where = [`al.created_at BETWEEN $1 AND $2`];
  const employee = parseEmployeeSearch(message);

  if (employee) {
    params.push(`%${employee.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(u.name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(u.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(e.first_name || ' ' || COALESCE(e.last_name, ''), '')) LIKE $${params.length}
      OR LOWER(COALESCE(e.username, '')) LIKE $${params.length}
    )`);
  }

  return query(
    `SELECT
       al.created_at,
       COALESCE(NULLIF(TRIM(e.first_name || ' ' || COALESCE(e.last_name, '')), ''), u.name, u.email, 'Unknown') AS employee,
       al.action,
       al.resource_type,
       COALESCE(al.resource_id::text, '-') AS resource_id,
       COALESCE(al.status, '-') AS status
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     LEFT JOIN employees e ON e.user_id = al.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT 30`,
    params
  );
}

async function getActivityAnswer(message, range) {
  let effectiveRange = range;
  let result = await runActivityQuery(message, effectiveRange);

  if (!result.rows.length && !range.explicit) {
    const latestRange = await getLatestRange('audit_logs', 'created_at', 7);
    if (latestRange) {
      effectiveRange = latestRange;
      result = await runActivityQuery(message, effectiveRange);
    }
  }

  return buildAnswer({
    title: 'Employee activity trail',
    summary: result.rows.length
      ? `${effectiveRange.label}${effectiveRange.fallback ? ' (selected date had no logs)' : ''}: ${result.rows.length} recent activity logs found.`
      : `${effectiveRange.label} ke liye audit activity nahi mili. Agar old actions audit me log nahi ho rahe the, naye actions se data aayega.`,
    range: effectiveRange,
    cards: [
      { label: 'Logs', value: String(result.rows.length) },
      { label: 'Window', value: effectiveRange.label },
    ],
    columns: ['Time', 'Employee', 'Action', 'Resource', 'Status'],
    rows: result.rows.map((row) => ({
      Time: formatIndianDateTime(row.created_at, '-'),
      Employee: row.employee,
      Action: row.action || '-',
      Resource: `${row.resource_type || '-'} #${row.resource_id}`,
      Status: row.status,
    })),
    links: [{ label: 'Audit trail', href: '/reports/logs/audit-trail' }],
  });
}

async function runStockQuery(range) {
  const params = [range.from, range.to];
  return query(
    `SELECT
       al.created_at,
       COALESCE(NULLIF(TRIM(e.first_name || ' ' || COALESCE(e.last_name, '')), ''), u.name, u.email, 'Unknown') AS employee,
       al.action,
       al.resource_type,
       COALESCE(al.resource_id::text, '-') AS resource_id,
       COALESCE(al.status, '-') AS status
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     LEFT JOIN employees e ON e.user_id = al.user_id
     WHERE al.created_at BETWEEN $1 AND $2
       AND (
         LOWER(COALESCE(al.action, '')) LIKE '%stock%'
         OR LOWER(COALESCE(al.resource_type, '')) LIKE '%stock%'
         OR LOWER(COALESCE(al.resource_type, '')) LIKE '%inventory%'
         OR LOWER(COALESCE(al.resource_type, '')) LIKE '%batch%'
       )
     ORDER BY al.created_at DESC
     LIMIT 30`,
    params
  );
}

async function getStockAnswer(message, range) {
  let effectiveRange = range;
  let result = await runStockQuery(effectiveRange);

  if (!result.rows.length && !range.explicit) {
    const latestRange = await getLatestRange('audit_logs', 'created_at', 7);
    if (latestRange) {
      effectiveRange = latestRange;
      result = await runStockQuery(effectiveRange);
    }
  }

  return buildAnswer({
    title: 'Stock operation activity',
    summary: result.rows.length
      ? `${effectiveRange.label}${effectiveRange.fallback ? ' (selected date had no stock logs)' : ''}: ${result.rows.length} stock/inventory related activities found.`
      : `${effectiveRange.label} me stock audit activity nahi mili. Stock movement reports aur expiry alerts use karke operational view dekh sakte hain.`,
    range: effectiveRange,
    cards: [
      { label: 'Stock logs', value: String(result.rows.length) },
      { label: 'Window', value: effectiveRange.label },
    ],
    columns: ['Time', 'Employee', 'Action', 'Resource', 'Status'],
    rows: result.rows.map((row) => ({
      Time: formatIndianDateTime(row.created_at, '-'),
      Employee: row.employee,
      Action: row.action || '-',
      Resource: `${row.resource_type || '-'} #${row.resource_id}`,
      Status: row.status,
    })),
    links: [
      { label: 'Stock operations report', href: '/reports/inventory/stock-operations' },
      { label: 'Near expiry products', href: '/inventory/expiry-alerts' },
    ],
  });
}

async function getExpiryAnswer(message, range) {
  await ensureStockInSchema();
  await ensureInventoryBatchSchema();

  const params = [];
  const where = ["ib.status = 'active'", 'ib.available_qty > 0'];
  const store = await resolveStoreFilter(message);
  if (store?.id) {
    params.push(Number(store.id));
    where.push(`ib.store_id = $${params.length}`);
  }

  const result = await query(
    `SELECT
       COUNT(*)::int AS total_batches,
       COALESCE(SUM(ib.available_qty), 0)::float AS total_qty,
       COALESCE(SUM(ib.available_qty * ib.cost_price), 0)::float AS total_value,
       COUNT(*) FILTER (WHERE COALESCE(ib.expiry_date, sii.expiry_date) IS NULL)::int AS missing,
       COUNT(*) FILTER (WHERE COALESCE(ib.expiry_date, sii.expiry_date) < CURRENT_DATE)::int AS expired,
       COUNT(*) FILTER (
         WHERE COALESCE(ib.expiry_date, sii.expiry_date) >= CURRENT_DATE
           AND COALESCE(ib.expiry_date, sii.expiry_date) <= CURRENT_DATE + INTERVAL '3 days'
       )::int AS critical,
       COUNT(*) FILTER (
         WHERE COALESCE(ib.expiry_date, sii.expiry_date) >= CURRENT_DATE
           AND COALESCE(ib.expiry_date, sii.expiry_date) <= CURRENT_DATE + INTERVAL '7 days'
       )::int AS urgent
     FROM inventory_batches ib
     LEFT JOIN stock_in_items sii
       ON ib.source_type = 'stock_in'
      AND NULLIF(ib.source_id, '') ~ '^[0-9]+$'
      AND sii.id = NULLIF(ib.source_id, '')::BIGINT
     WHERE ${where.join(' AND ')}`,
    params
  );

  const topStores = await query(
    `SELECT
       COALESCE(s.name, 'Unknown store') AS store,
       COUNT(*)::int AS batches,
       COALESCE(SUM(ib.available_qty), 0)::float AS qty,
       COALESCE(SUM(ib.available_qty * ib.cost_price), 0)::float AS value
     FROM inventory_batches ib
     LEFT JOIN stock_in_items sii
       ON ib.source_type = 'stock_in'
      AND NULLIF(ib.source_id, '') ~ '^[0-9]+$'
      AND sii.id = NULLIF(ib.source_id, '')::BIGINT
     LEFT JOIN stores s ON s.id = ib.store_id
     WHERE ${where.join(' AND ')}
       AND (
         COALESCE(ib.expiry_date, sii.expiry_date) IS NULL
         OR COALESCE(ib.expiry_date, sii.expiry_date) <= CURRENT_DATE + INTERVAL '30 days'
       )
     GROUP BY store
     ORDER BY value DESC, batches DESC
     LIMIT 5`,
    params
  );

  const summary = result.rows[0] || {};
  const scope = store?.name ? ` for ${store.name}` : '';

  return buildAnswer({
    title: 'Expiry risk assistant',
    summary: `${summary.total_batches || 0} active risk batch(es)${scope} found. Critical: ${summary.critical || 0}, expired: ${summary.expired || 0}, missing expiry: ${summary.missing || 0}. Use FEFO sell order and avoid replenishing urgent items before old stock clears.`,
    range,
    cards: [
      { label: 'Stock value', value: formatMoney(summary.total_value || 0) },
      { label: 'Critical', value: String(summary.critical || 0) },
      { label: 'Missing expiry', value: String(summary.missing || 0) },
    ],
    columns: ['Store', 'Batches', 'Qty', 'Value'],
    rows: topStores.rows.map((row) => ({
      Store: row.store,
      Batches: row.batches,
      Qty: Number(row.qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 }),
      Value: formatMoney(row.value),
    })),
    links: [{ label: 'Open Near Expiry dashboard', href: '/inventory/expiry-alerts' }],
  });
}

function getHelpAnswer(range) {
  return buildAnswer({
    title: 'Admin Assistant',
    summary:
      'Aap sales performance, employee activity, stock activity, ya expiry risk ke baare me pooch sakte ho. Example: "kal store 2 me kis employee ne kitni sales ki", "last 7 days top cashier", "Ramesh ne 1 June ko kya kiya", "near expiry products".',
    range,
    cards: [
      { label: 'Sales', value: 'employee/store wise' },
      { label: 'Activity', value: 'audit trail' },
      { label: 'Expiry', value: 'risk dashboard' },
    ],
  });
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    const body = await request.json().catch(() => ({}));
    const message = String(body?.message || '').trim();
    if (!message) return validationError('Message is required');

    await Promise.all([
      ensureSalesBillingSchema(),
      ensureAuditLogsSchema(),
      ensureEmployeesSchema(),
    ]);

    const range = parseDateRange(message);
    const intent = parseIntent(message);
    let response;

    if (intent === 'sales') response = await getSalesAnswer(message, range);
    else if (intent === 'activity') response = await getActivityAnswer(message, range);
    else if (intent === 'stock') response = await getStockAnswer(message, range);
    else if (intent === 'expiry') response = await getExpiryAnswer(message, range);
    else response = getHelpAnswer(range);

    return successResponse({ intent, ...response }, 'Assistant response ready');
  } catch (err) {
    console.error('[ADMIN_ASSISTANT] Error:', err);
    return errorResponse(err.message || 'Unable to answer right now', 500, err);
  }
}
