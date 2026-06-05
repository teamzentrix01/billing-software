import { successResponse, errorResponse } from '@/lib/api-response';
import { query } from '@/lib/db';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureVendorsSchema } from '@/lib/vendorsSchema';
import { appendStoreScope, requireAuth, requirePermission } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Number.isFinite);
}

function addBrandFilter(filters, params, { brandId = null, brandName = '' } = {}) {
  const cleanBrandName = String(brandName || '').trim();
  if (brandId && cleanBrandName) {
    params.push(brandId);
    const brandIdParam = params.length;
    params.push(cleanBrandName);
    filters.push(`(p.brand_id = $${brandIdParam} OR LOWER(COALESCE(b.name, '')) = LOWER($${params.length}))`);
    return;
  }
  if (brandId) {
    params.push(brandId);
    filters.push(`p.brand_id = $${params.length}`);
    return;
  }
  if (cleanBrandName) {
    params.push(cleanBrandName);
    filters.push(`LOWER(COALESCE(b.name, '')) = LOWER($${params.length})`);
  }
}

async function fetchCatalogProducts({ search, pageSize, vendorIds = [], brandId = null, brandName = '' }) {
  const params = [];
  const filters = [`COALESCE(p.is_active, TRUE) = TRUE`];
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(
      COALESCE(p.name, '') ILIKE $${params.length}
      OR COALESCE(p.sku, '') ILIKE $${params.length}
      OR COALESCE(p.barcode, '') ILIKE $${params.length}
      OR COALESCE(p.product_id, '') ILIKE $${params.length}
    )`);
  }
  addBrandFilter(filters, params, { brandId, brandName });
  params.push(pageSize);

  const vendorNameSelect = vendorIds.length
    ? `(SELECT STRING_AGG(DISTINCT v.name, ', ') FROM vendors v WHERE v.id = ANY($${params.length + 1}::int[])) AS vendor_names,`
    : `NULL::text AS vendor_names,`;
  if (vendorIds.length) params.push(vendorIds);

  const res = await query(
    `SELECT
       p.id,
       p.product_id,
       p.name,
       p.sku,
       p.barcode,
       p.mrp,
       p.selling_price,
       COALESCE(p.cost_price, 0) AS cost_price,
       c.name AS "categoryName",
       b.name AS "brandName",
       COALESCE(t.rate, 0) AS "taxRate",
       0::numeric AS "availableStock",
       ${vendorNameSelect}
       NULL::timestamptz AS last_supplied_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN taxes t ON t.id = p.tax_id
     WHERE ${filters.join(' AND ')}
     ORDER BY p.name ASC
     LIMIT $${params.length}`,
    params
  );

  return res.rows.map((row) => ({
    ...row,
    cost_price: toNumber(row.cost_price),
    availableStock: 0,
  }));
}

export async function GET(request) {
  try {
    await ensureStockInSchema();
    await ensureCatalogExtrasSchema();
    await ensureInventoryBatchSchema();
    await ensureVendorsSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_INVENTORY', 'MANAGE_INVENTORY', 'MANAGE_PURCHASE_ORDERS', 'VIEW_PRODUCTS', 'MANAGE_PRODUCTS');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const source = String(searchParams.get('source') || 'warehouse').toLowerCase();
    const search = String(searchParams.get('search') || '').trim();
    const destinationType = String(searchParams.get('destinationType') || '').toLowerCase();
    const vendorIds = parseIds(searchParams.get('vendorIds') || searchParams.get('vendor_ids'));
    const brandId = Number(searchParams.get('brandId') || searchParams.get('brand_id') || 0) || null;
    const brandName = String(searchParams.get('brandName') || searchParams.get('brand_name') || '').trim();
    const catalogOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('catalogOnly') || '').toLowerCase());
    const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 30), 1), 100);

    if (catalogOnly) {
      const records = await fetchCatalogProducts({ search, pageSize, vendorIds, brandId, brandName });
      return successResponse({ records });
    }

    if (source === 'vendor') {
      if (!vendorIds.length) {
        const records = await fetchCatalogProducts({ search, pageSize, brandId, brandName });
        return successResponse({ records });
      }

      const params = [vendorIds];
      const filters = [`COALESCE(p.is_active, TRUE) = TRUE`];
      if (search) {
        params.push(`%${search}%`);
        filters.push(`(
          COALESCE(p.name, '') ILIKE $${params.length}
          OR COALESCE(p.sku, '') ILIKE $${params.length}
          OR COALESCE(p.barcode, '') ILIKE $${params.length}
          OR COALESCE(p.product_id, '') ILIKE $${params.length}
        )`);
      }
      addBrandFilter(filters, params, { brandId, brandName });
      params.push(pageSize);

      const res = await query(
        `WITH vendor_products AS (
           SELECT
             sii.product_id,
             MAX(sii.cost_price) AS last_cost_price,
             MAX(si.confirmed_at) AS last_supplied_at,
             STRING_AGG(DISTINCT COALESCE(v.name, si.vendor_name), ', ') AS vendor_names
           FROM stock_in si
           INNER JOIN stock_in_items sii ON sii.stock_in_id = si.id
           LEFT JOIN vendors v ON v.id = si.vendor_id
           WHERE si.status = 'confirmed'
             AND (
               si.vendor_id = ANY($1::int[])
               OR EXISTS (
                 SELECT 1 FROM vendors selected_v
                 WHERE selected_v.id = ANY($1::int[])
                   AND LOWER(selected_v.name) = LOWER(COALESCE(si.vendor_name, ''))
               )
             )
           GROUP BY sii.product_id
         )
         SELECT
           p.id,
           p.product_id,
           p.name,
           p.sku,
           p.barcode,
           p.mrp,
           p.selling_price,
           COALESCE(vp.last_cost_price, p.cost_price, 0) AS cost_price,
           c.name AS "categoryName",
           b.name AS "brandName",
           COALESCE(t.rate, 0) AS "taxRate",
           0::numeric AS "availableStock",
           vp.vendor_names,
           vp.last_supplied_at
         FROM vendor_products vp
         INNER JOIN products p ON p.id = vp.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN taxes t ON t.id = p.tax_id
         WHERE ${filters.join(' AND ')}
         ORDER BY p.name ASC
         LIMIT $${params.length}`,
        params
      );

      const records = res.rows.map((row) => ({
          ...row,
          cost_price: toNumber(row.cost_price),
          availableStock: 0,
        }));

      if (records.length) return successResponse({ records });

      return successResponse({
        records: await fetchCatalogProducts({ search, pageSize, vendorIds, brandId, brandName }),
      });
    }

    if (destinationType === 'warehouse') {
      const records = await fetchCatalogProducts({ search, pageSize, brandId, brandName });
      return successResponse({ records });
    }

    const params = [];
    const warehouseStoreWhere = [];
    const scope = appendStoreScope(warehouseStoreWhere, params, 'id', auth.user);
    if (scope.error) return scope.error;

    const filters = [`COALESCE(p.is_active, TRUE) = TRUE`];
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(
        COALESCE(p.name, '') ILIKE $${params.length}
        OR COALESCE(p.sku, '') ILIKE $${params.length}
        OR COALESCE(p.barcode, '') ILIKE $${params.length}
        OR COALESCE(p.product_id, '') ILIKE $${params.length}
      )`);
    }
    addBrandFilter(filters, params, { brandId, brandName });
    params.push(pageSize);

    const res = await query(
      `WITH warehouse_locations AS (
         SELECT id
         FROM stores
         WHERE LOWER(COALESCE(meta->>'locationType', 'Warehouse')) = 'warehouse'
           ${warehouseStoreWhere.length ? `AND ${warehouseStoreWhere.join(' AND ')}` : ''}
       ), warehouse_products AS (
         SELECT ib.product_id, SUM(ib.available_qty) AS available_qty, MAX(ib.cost_price) AS last_cost_price
         FROM inventory_batches ib
         INNER JOIN warehouse_locations wl ON wl.id = ib.store_id
         WHERE ib.status = 'active'
           AND ib.available_qty > 0
           AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
         GROUP BY ib.product_id
       )
       SELECT
         p.id,
         p.product_id,
         p.name,
         p.sku,
         p.barcode,
         p.mrp,
         p.selling_price,
         COALESCE(wp.last_cost_price, p.cost_price, 0) AS cost_price,
         c.name AS "categoryName",
         b.name AS "brandName",
         COALESCE(t.rate, 0) AS "taxRate",
         COALESCE(wp.available_qty, 0) AS "availableStock"
       FROM warehouse_products wp
       INNER JOIN products p ON p.id = wp.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN taxes t ON t.id = p.tax_id
       WHERE ${filters.join(' AND ')}
       ORDER BY p.name ASC
       LIMIT $${params.length}`,
      params
    );

    return successResponse({
      records: res.rows.map((row) => ({
        ...row,
        cost_price: toNumber(row.cost_price),
        availableStock: toNumber(row.availableStock),
      })),
    });
  } catch (err) {
    console.error('[stockin source-products]', err);
    return errorResponse(err.message || 'Failed to load source products');
  }
}
