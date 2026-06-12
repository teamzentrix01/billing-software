import { successResponse, errorResponse } from '@/lib/api-response';
import { getClient, query } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { ensureRecycleBinSchema } from '@/lib/recycleBinSchema';
import { purgeExpiredRecycleBinItems } from '@/lib/recycleBin';

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const BUSINESS_LABELS = {
  stores: 'Stores',
  users: 'Users',
  regions: 'Regions',
  vendors: 'Vendors',
  products: 'Products',
  categories: 'Categories',
  sub_categories: 'Sub Categories',
  manufacturers: 'Manufacturers',
  brands: 'Brands',
  departments: 'Departments',
  income_heads: 'Income Heads',
  services: 'Services',
  service_groups: 'Service Groups',
  promotions: 'Promotions',
  employees: 'Employees',
  employee_departments: 'Employee Departments',
  roles: 'Roles',
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  stock_transfer: 'Stock Transfer',
  stock_validation: 'Stock Validation',
  purchase_orders: 'Purchase Orders',
  vendor_invoices: 'Vendor Invoices',
  customers: 'Customers',
  customer_groups: 'Customer Groups',
  sales_bills: 'Sales Bills',
  held_bills: 'Held Bills',
  pos_held_bills: 'POS Held Bills',
};

const REPRESENTATIVE_PRIORITY_SQL = `
  CASE r.table_name
    WHEN 'stores' THEN 10
    WHEN 'regions' THEN 20
    WHEN 'users' THEN 25
    WHEN 'employees' THEN 30
    WHEN 'categories' THEN 40
    WHEN 'sub_categories' THEN 45
    WHEN 'manufacturers' THEN 45
    WHEN 'brands' THEN 45
    WHEN 'departments' THEN 45
    WHEN 'income_heads' THEN 45
    WHEN 'vendors' THEN 50
    WHEN 'products' THEN 60
    WHEN 'settings_records' THEN 70
    WHEN 'purchase_orders' THEN 80
    WHEN 'stock_in' THEN 90
    WHEN 'stock_out' THEN 90
    WHEN 'stock_transfer' THEN 90
    WHEN 'stock_validation' THEN 90
    WHEN 'vendor_invoices' THEN 95
    WHEN 'sales_bills' THEN 95
    WHEN 'customers' THEN 100
    ELSE 500
  END
`;

const GROUP_KEY_SQL = `
  COALESCE(
    r.operation_id::text,
    CASE
      WHEN r.table_name = 'stock_in' THEN 'stock_in:' || r.resource_id
      WHEN r.table_name = 'stock_in_items' THEN 'stock_in:' || NULLIF(r.deleted_snapshot->>'stock_in_id', '')
      WHEN r.table_name = 'inventory_batch_movements'
        AND r.deleted_snapshot->>'reference_type' = 'stock_in'
        THEN 'stock_in:' || NULLIF(r.deleted_snapshot->>'reference_id', '')
      WHEN r.table_name = 'inventory_batches'
        AND r.deleted_snapshot->>'source_type' = 'stock_in'
        THEN 'stock_in:' || (
          SELECT NULLIF(item.deleted_snapshot->>'stock_in_id', '')
          FROM recycle_bin_items item
          WHERE item.table_name = 'stock_in_items'
            AND item.status = r.status
            AND item.resource_id = NULLIF(r.deleted_snapshot->>'source_id', '')
          ORDER BY ABS(EXTRACT(EPOCH FROM (item.deleted_at - r.deleted_at))), item.id
          LIMIT 1
        )
      ELSE NULL
    END,
    r.id::text
  )
`;

export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    await ensureRecycleBinSchema();
    await purgeExpiredRecycleBinItems(auth.user.id);

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(100, parsePositiveInt(searchParams.get('pageSize'), 20));
    const offset = (page - 1) * pageSize;
    const status = searchParams.get('status') || 'deleted';
    const tableName = searchParams.get('table') || '';
    const search = searchParams.get('search') || '';

    const params = [];
    const baseWhere = [];

    if (status !== 'all') {
      params.push(status);
      baseWhere.push(`r.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      baseWhere.push(`EXISTS (
        SELECT 1
        FROM recycle_bin_items rs
        WHERE COALESCE(rs.operation_id::text, rs.id::text) = COALESCE(r.operation_id::text, r.id::text)
          AND (
            rs.display_name ILIKE $${params.length}
            OR rs.resource_id ILIKE $${params.length}
            OR rs.table_name ILIKE $${params.length}
          )
      )`);
    }

    const baseWhereSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';
    const representativeWhere = [];
    if (tableName) {
      params.push(tableName);
      representativeWhere.push(`ranked.table_name = $${params.length}`);
    }
    const representativeWhereSql = representativeWhere.length ? `AND ${representativeWhere.join(' AND ')}` : '';

    const groupedCte = `
      WITH base AS (
        SELECT r.*,
               ${GROUP_KEY_SQL} AS group_key,
               ${REPRESENTATIVE_PRIORITY_SQL} AS representative_priority
        FROM recycle_bin_items r
        ${baseWhereSql}
      ),
      ranked AS (
        SELECT base.id,
               base.operation_id,
               base.table_name,
               base.resource_type,
               base.resource_id,
               base.display_name,
               base.deleted_by,
               base.delete_reason,
               base.status,
               base.deleted_at,
               base.expires_at,
               base.restored_at,
               base.purged_at,
               base.deleted_snapshot,
               base.group_key,
               COUNT(*) OVER (PARTITION BY base.group_key) AS operation_count,
               ROW_NUMBER() OVER (
                 PARTITION BY base.group_key
                 ORDER BY base.representative_priority, base.id
               ) AS rn
        FROM base
      )
    `;

    const countRes = await query(
      `${groupedCte}
       SELECT COUNT(*)::int AS total
       FROM ranked
       WHERE rn = 1
       ${representativeWhereSql}`,
      params,
    );

    const listParams = [...params, pageSize, offset];
    const listRes = await query(
      `${groupedCte}
       SELECT ranked.id,
              ranked.operation_id,
              ranked.table_name,
              ranked.resource_type,
              ranked.resource_id,
              ranked.display_name,
              ranked.deleted_by,
              COALESCE(u.name, u.email) AS deleted_by_name,
              ranked.delete_reason,
              ranked.status,
              ranked.deleted_at,
              ranked.expires_at,
              ranked.restored_at,
              ranked.purged_at,
              (
                SELECT COUNT(*)::int
                FROM jsonb_object_keys(COALESCE(ranked.deleted_snapshot, '{}'::jsonb))
              ) AS field_count,
              ranked.operation_count,
              $${listParams.length + 1}::jsonb->>ranked.table_name AS type_label
       FROM ranked
       LEFT JOIN users u ON u.id = ranked.deleted_by
       WHERE ranked.rn = 1
       ${representativeWhereSql.replaceAll('ranked.', 'ranked.')}
       ORDER BY ranked.deleted_at DESC, ranked.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      [...listParams, JSON.stringify(BUSINESS_LABELS)],
    );

    const tablesRes = await query(
      `WITH base AS (
         SELECT r.table_name,
                r.id,
                ${GROUP_KEY_SQL} AS group_key,
                ${REPRESENTATIVE_PRIORITY_SQL} AS representative_priority
         FROM recycle_bin_items r
         WHERE r.status = 'deleted'
       ),
       ranked AS (
         SELECT table_name,
                ROW_NUMBER() OVER (
                  PARTITION BY group_key
                  ORDER BY representative_priority, id
                ) AS rn
         FROM base
       )
       SELECT table_name,
              COUNT(*)::int AS total,
              $1::jsonb->>table_name AS type_label
       FROM ranked
       WHERE rn = 1
       GROUP BY table_name
       ORDER BY COALESCE($1::jsonb->>table_name, table_name) ASC`,
      [JSON.stringify(BUSINESS_LABELS)],
    );

    return successResponse({
      records: listRes.rows,
      tableCounts: tablesRes.rows,
      page,
      pageSize,
      total: countRes.rows[0]?.total || 0,
    });
  } catch (err) {
    console.error('[recycle-bin GET]', err);
    return errorResponse(err.message || 'Failed to load recycle bin');
  }
}

export async function DELETE(request) {
  let client;
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    await ensureRecycleBinSchema();
    client = await getClient();
    await client.query('BEGIN');
    const count = await purgeExpiredRecycleBinItems(auth.user.id);
    await client.query('COMMIT');

    return successResponse({ count }, 'Expired recycle bin items purged');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[recycle-bin DELETE expired]', err);
    return errorResponse(err.message || 'Failed to purge expired items');
  } finally {
    client?.release();
  }
}
