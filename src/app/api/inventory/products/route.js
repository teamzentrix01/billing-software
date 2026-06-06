import { query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { ensureStoresSchema } from '@/lib/storesSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { appendStoreScope, getAssignedStoreIds, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request) {
  try {
    await ensureCatalogExtrasSchema();
    await ensureStoresSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const brandId = Number(searchParams.get('brand_id') || 0) || null;
    const vendorName = String(searchParams.get('vendor') || searchParams.get('vendor_name') || '').trim();
    let storeId = Number(searchParams.get('store_id') || 0) || null;
    const warehouseStock = searchParams.get('warehouse_stock') === 'true';
    const batchVariants = ['1', 'true', 'yes'].includes(String(searchParams.get('batch_variants') || '').toLowerCase());
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
    const offset = (page - 1) * pageSize;

    if (warehouseStock) {
      const params = [];
      const filters = [`TRUE`];
      const warehouseStoreWhere = [];
      const scope = appendStoreScope(warehouseStoreWhere, params, 'id', auth.user);
      if (scope.error) return scope.error;

      if (search.trim()) {
        params.push(`%${search.trim()}%`);
        filters.push(`(
          COALESCE(p.name, '') ILIKE $${params.length}
          OR COALESCE(p.sku, '') ILIKE $${params.length}
          OR COALESCE(p.barcode, '') ILIKE $${params.length}
        )`);
      }
      if (brandId) {
        params.push(brandId);
        filters.push(`p.brand_id = $${params.length}`);
      }
      if (vendorName) {
        params.push(vendorName);
        filters.push(`EXISTS (
          SELECT 1
          FROM stock_in_items sii_vendor
          INNER JOIN stock_in si_vendor ON si_vendor.id = sii_vendor.stock_in_id
          WHERE sii_vendor.product_id = p.id
            AND si_vendor.status = 'confirmed'
            AND LOWER(COALESCE(si_vendor.vendor_name, '')) = LOWER($${params.length})
        )`);
      }

      const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

      const warehouseInventoryQuery = `
        WITH warehouse_locations AS (
          SELECT id
          FROM stores
          WHERE LOWER(COALESCE(meta->>'locationType', 'Warehouse')) = 'warehouse'
            ${warehouseStoreWhere.length ? `AND ${warehouseStoreWhere.join(' AND ')}` : ''}
        ), movement_products AS (
          SELECT ib.product_id, SUM(ib.available_qty) AS available_qty
          FROM inventory_batches ib
          INNER JOIN warehouse_locations wl ON wl.id = ib.store_id
          WHERE ib.status = 'active'
            AND ib.available_qty > 0
            AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
          GROUP BY ib.product_id
        )
        SELECT
          COALESCE(p.id, mp.product_id) AS id,
          COALESCE(p.product_id::text, mp.product_id::text) AS product_id,
          COALESCE(p.name, '') AS name,
          COALESCE(p.sku, '') AS sku,
          COALESCE(p.barcode, '') AS barcode,
          COALESCE(p.mrp, 0) AS mrp,
          COALESCE(p.selling_price, 0) AS selling_price,
          COALESCE(p.cost_price, 0) AS cost_price,
          c.name AS "categoryName",
          b.name AS "brandName",
          COALESCE(mp.available_qty, 0) AS "availableStock",
          COALESCE(t.rate, 0) AS "taxRate"
        FROM movement_products mp
        LEFT JOIN products p ON p.id = mp.product_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        WHERE COALESCE(mp.available_qty, 0) > 0
        ${where}
      `;

      const count = await query(
        `SELECT COUNT(*)::int AS count FROM (${warehouseInventoryQuery}) inventory`,
        params
      );

      params.push(pageSize, offset);

      const result = await query(
        `SELECT * FROM (${warehouseInventoryQuery}) inventory
         ORDER BY name ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return successResponse({
        records: result.rows.map((row) => ({
          ...row,
          availableStock: toNumber(row.availableStock),
        })),
        total: count.rows[0]?.count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count.rows[0]?.count || 0) / pageSize),
      });
    }

    if (!storeId && auth.user.role !== 'super_admin') {
      storeId = getAssignedStoreIds(auth.user)[0] || null;
    }

    if (!storeId) {
      return successResponse({ records: [], total: 0, page, pageSize, totalPages: 0 });
    }

    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    if (batchVariants) {
      const params = [storeId];
      const filters = [`COALESCE(p.is_active, TRUE) = TRUE`];

      if (search.trim()) {
        params.push(`%${search.trim()}%`);
        filters.push(`(
          COALESCE(p.name, '') ILIKE $${params.length}
          OR COALESCE(p.sku, '') ILIKE $${params.length}
          OR COALESCE(p.barcode, '') ILIKE $${params.length}
        )`);
      }
      if (brandId) {
        params.push(brandId);
        filters.push(`p.brand_id = $${params.length}`);
      }
      if (vendorName) {
        params.push(vendorName);
        filters.push(`EXISTS (
          SELECT 1
          FROM stock_in_items sii_vendor
          INNER JOIN stock_in si_vendor ON si_vendor.id = sii_vendor.stock_in_id
          WHERE sii_vendor.product_id = p.id
            AND si_vendor.status = 'confirmed'
            AND LOWER(COALESCE(si_vendor.vendor_name, '')) = LOWER($${params.length})
        )`);
      }

      const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
      const inventoryQuery = `
        SELECT
          p.id,
          p.product_id::text AS product_id,
          p.name,
          COALESCE(p.sku, '') AS sku,
          COALESCE(p.barcode, '') AS barcode,
          COALESCE(p.mrp, 0) AS mrp,
          COALESCE(p.selling_price, 0) AS selling_price,
          COALESCE(ib.cost_price, p.cost_price, 0) AS cost_price,
          c.name AS "categoryName",
          b.name AS "brandName",
          COALESCE(ib.available_qty, 0) AS "availableStock",
          COALESCE(t.rate, 0) AS "taxRate",
          ib.id AS "batchId",
          ib.batch_no AS "batchNo",
          ib.expiry_date AS "expiryDate",
          ib.meta AS "batchMeta"
        FROM inventory_batches ib
        INNER JOIN products p ON p.id = ib.product_id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN taxes t ON p.tax_id = t.id
        WHERE ib.store_id = $1
          AND ib.status = 'active'
          AND ib.available_qty > 0
          AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
          ${where}
      `;

      const count = await query(
        `SELECT COUNT(*)::int AS count FROM (${inventoryQuery}) inventory`,
        params
      );

      params.push(pageSize, offset);
      const result = await query(
        `SELECT * FROM (${inventoryQuery}) inventory
         ORDER BY name ASC, cost_price ASC, "batchId" ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return successResponse({
        records: result.rows.map((row) => ({
          ...row,
          availableStock: toNumber(row.availableStock),
          existingQty: toNumber(row.availableStock),
          cost_price: toNumber(row.cost_price),
          variantKey: `${row.id}:batch:${row.batchId}`,
        })),
        total: count.rows[0]?.count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count.rows[0]?.count || 0) / pageSize),
      });
    }

    const params = [storeId];
    const filters = [
      `TRUE`,
    ];

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      filters.push(`(
        COALESCE(p.name, '') ILIKE $${params.length}
        OR COALESCE(p.sku, '') ILIKE $${params.length}
        OR COALESCE(p.barcode, '') ILIKE $${params.length}
      )`);
    }
    if (brandId) {
      params.push(brandId);
      filters.push(`p.brand_id = $${params.length}`);
    }
    if (vendorName) {
      params.push(vendorName);
      filters.push(`EXISTS (
        SELECT 1
        FROM stock_in_items sii_vendor
        INNER JOIN stock_in si_vendor ON si_vendor.id = sii_vendor.stock_in_id
        WHERE sii_vendor.product_id = p.id
          AND si_vendor.status = 'confirmed'
          AND LOWER(COALESCE(si_vendor.vendor_name, '')) = LOWER($${params.length})
      )`);
    }

    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

    const inventoryQuery = `
      WITH movement_products AS (
        SELECT ib.product_id, SUM(ib.available_qty) AS available_qty
        FROM inventory_batches ib
        WHERE ib.store_id = $1
          AND ib.status = 'active'
          AND ib.available_qty > 0
          AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
        GROUP BY ib.product_id
      )
      SELECT
        COALESCE(p.id, mp.product_id) AS id,
        COALESCE(p.product_id::text, mp.product_id::text) AS product_id,
        COALESCE(p.name, '') AS name,
        COALESCE(p.sku, '') AS sku,
        COALESCE(p.barcode, '') AS barcode,
        COALESCE(p.mrp, 0) AS mrp,
        COALESCE(p.selling_price, 0) AS selling_price,
        COALESCE(p.cost_price, 0) AS cost_price,
        c.name AS "categoryName",
        b.name AS "brandName",
        COALESCE(mp.available_qty, 0) AS "availableStock",
        COALESCE(t.rate, 0) AS "taxRate"
      FROM movement_products mp
      LEFT JOIN products p ON p.id = mp.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN taxes t ON p.tax_id = t.id
      WHERE COALESCE(mp.available_qty, 0) > 0
      ${where}
    `;

    const count = await query(
      `SELECT COUNT(*)::int AS count FROM (${inventoryQuery}) inventory`,
      params
    );

    params.push(pageSize, offset);

    const result = await query(
      `SELECT * FROM (${inventoryQuery}) inventory
       ORDER BY name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return successResponse({
      records: result.rows.map((row) => ({
        ...row,
        availableStock: toNumber(row.availableStock),
      })),
      total: count.rows[0]?.count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count.rows[0]?.count || 0) / pageSize),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
