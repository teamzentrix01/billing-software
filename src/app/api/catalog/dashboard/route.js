import { query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { getAssignedStoreIds, requireAuth, requirePermission } from '@/lib/api-protection';

async function safeQuery(sql, params = []) {
  try {
    return await query(sql, params);
  } catch {
    return { rows: [{ count: 0 }] };
  }
}

// Actual stock = confirmed stock_in − confirmed stock_out − sold (paid/completed)
// Shared subquery fragments reused across queries
const STOCK_IN_SUB = `(
  SELECT sii.product_id, SUM(sii.qty) AS qty
  FROM stock_in_items sii
  JOIN stock_in si ON si.id = sii.stock_in_id AND si.status = 'confirmed'
  GROUP BY sii.product_id
)`;

const STOCK_OUT_SUB = `(
  SELECT soi.product_id, SUM(soi.qty) AS qty
  FROM stock_out_items soi
  JOIN stock_out so ON so.id = soi.stock_out_id
    AND so.status = 'confirmed'
    AND COALESCE(so.reference_type, '') <> 'sales_bill'
  GROUP BY soi.product_id
)`;

const SOLD_SUB = `(
  SELECT sbi.product_id, SUM(sbi.qty) AS qty
  FROM sales_bill_items sbi
  JOIN sales_bills sb ON sb.id = sbi.sales_bill_id AND sb.status IN ('paid', 'completed')
  GROUP BY sbi.product_id
)`;

const ACTUAL_STOCK_EXPR = `GREATEST(0,
  COALESCE(sin_agg.qty, 0)
  - COALESCE(sout_agg.qty, 0)
  - COALESCE(sold_agg.qty, 0)
)`;

const STOCK_JOINS = `
  LEFT JOIN ${STOCK_IN_SUB}  sin_agg  ON sin_agg.product_id  = p.id
  LEFT JOIN ${STOCK_OUT_SUB} sout_agg ON sout_agg.product_id = p.id
  LEFT JOIN ${SOLD_SUB}      sold_agg ON sold_agg.product_id = p.id
`;

export async function GET(request) {
  try {
    // Ensure tables exist before querying them
    await Promise.allSettled([
      ensureStockInSchema(),
      ensureStockOutSchema(),
      ensureSalesBillingSchema(),
      ensureInventoryBatchSchema(),
    ]);
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_CATALOG', 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const assignedStores = auth.user.role === 'super_admin' ? null : getAssignedStoreIds(auth.user);
    const hasStoreScope = Array.isArray(assignedStores);
    const storeIdList = hasStoreScope && assignedStores.length ? assignedStores.join(',') : '';
    const productScopeWhere = hasStoreScope
      ? storeIdList
        ? `WHERE EXISTS (
            SELECT 1 FROM product_saleability ps_scope
            WHERE ps_scope.product_id = p.id
              AND ps_scope.is_active = TRUE
              AND ps_scope.store_id = ANY(ARRAY[${storeIdList}]::int[])
          )`
        : 'WHERE 1 = 0'
      : '';
    const productScopeAnd = productScopeWhere ? productScopeWhere.replace(/^WHERE /, 'AND ') : '';
    const storeScopedStockInSub = `(
      SELECT ib.product_id, SUM(ib.available_qty) AS qty
      FROM inventory_batches ib
      WHERE ib.status = 'active'
        ${hasStoreScope ? (storeIdList ? `AND ib.store_id = ANY(ARRAY[${storeIdList}]::int[])` : 'AND 1 = 0') : ''}
      GROUP BY ib.product_id
    )`;
    const storeScopedStockOutSub = `(
      SELECT NULL::bigint AS product_id, 0::numeric AS qty
      WHERE FALSE
    )`;
    const storeScopedSoldSub = `(
      SELECT NULL::bigint AS product_id, 0::numeric AS qty
      WHERE FALSE
    )`;
    const stockJoins = `
      LEFT JOIN ${storeScopedStockInSub}  sin_agg  ON sin_agg.product_id  = p.id
      LEFT JOIN ${storeScopedStockOutSub} sout_agg ON sout_agg.product_id = p.id
      LEFT JOIN ${storeScopedSoldSub}     sold_agg ON sold_agg.product_id = p.id
    `;

    const [
      totalProductsRes,
      totalCategoriesRes,
      totalBrandsRes,
      noImageRes,
      outOfStockRes,
      hsnMissingRes,
      missingPriceRes,
      duplicateSkuRes,
      belowCostRes,
      productsRes,
    ] = await Promise.all([
      safeQuery(`SELECT COUNT(*)::int AS count FROM products p ${productScopeWhere}`),
      safeQuery(`SELECT COUNT(*)::int AS count FROM categories`),
      safeQuery(`SELECT COUNT(*)::int AS count FROM brands`),
      safeQuery(`SELECT COUNT(*)::int AS count FROM products p ${productScopeWhere ? `${productScopeWhere} AND` : 'WHERE'} (p.image_url IS NULL OR p.image_url = '')`),

      // Out of stock = actual available stock is 0
      safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM products p
        ${stockJoins}
        ${productScopeWhere ? `${productScopeWhere} AND` : 'WHERE'} ${ACTUAL_STOCK_EXPR} = 0
      `),

      safeQuery(`
        SELECT COUNT(*)::int AS count FROM products p
        ${productScopeWhere ? `${productScopeWhere} AND` : 'WHERE'} (p.hsn_code IS NULL OR TRIM(p.hsn_code) = '')
      `),
      safeQuery(`SELECT COUNT(*)::int AS count FROM products p ${productScopeWhere ? `${productScopeWhere} AND` : 'WHERE'} COALESCE(p.mrp, 0) <= 0`),
      safeQuery(`
        SELECT COUNT(*)::int AS count
        FROM products p
        JOIN (
          SELECT sku FROM products
          WHERE sku IS NOT NULL AND TRIM(sku) <> ''
          GROUP BY sku HAVING COUNT(*) > 1
        ) d ON d.sku = p.sku
        ${productScopeWhere}
      `),
      safeQuery(`
        SELECT COUNT(*)::int AS count FROM products p
        ${productScopeWhere ? `${productScopeWhere} AND` : 'WHERE'} COALESCE(p.cost_price, 0) > 0
          AND COALESCE(p.mrp, 0) > 0
          AND p.mrp < p.cost_price
      `),

      // Products list with actual stock
      safeQuery(`
        SELECT
          p.id, p.name, p.sku, p.barcode, p.image_url,
          p.mrp        AS mrp,
          p.selling_price AS selling_price,
          p.cost_price AS cost,
          CASE
            WHEN p.cost_price > 0 AND p.selling_price > 0
            THEN ROUND(((p.selling_price - p.cost_price) / p.cost_price * 100)::numeric, 0)
            ELSE 0
          END AS margin,
          b.name AS brand,
          c.name AS category,
          COALESCE(p.hsn_code, '') AS hsn_code,
          ${ACTUAL_STOCK_EXPR} AS stock,
          CASE WHEN p.image_url IS NULL OR p.image_url = '' THEN true ELSE false END AS no_image,
          CASE WHEN p.hsn_code IS NULL OR TRIM(p.hsn_code) = '' THEN true ELSE false END AS hsn_missing,
          CASE WHEN COALESCE(p.mrp, 0) <= 0 THEN true ELSE false END AS missing_price,
          CASE
            WHEN COALESCE(p.cost_price, 0) > 0
             AND COALESCE(p.mrp, 0) > 0
             AND p.mrp < p.cost_price
            THEN true ELSE false
          END AS below_cost,
          CASE WHEN d.cnt > 1 THEN true ELSE false END AS duplicate_sku
        FROM products p
        LEFT JOIN brands      b ON p.brand_id  = b.id
        LEFT JOIN categories  c ON p.category_id = c.id
        LEFT JOIN taxes       t ON p.tax_id    = t.id
        ${stockJoins}
        LEFT JOIN (
          SELECT sku, COUNT(*) AS cnt
          FROM products
          WHERE sku IS NOT NULL AND TRIM(sku) <> ''
          GROUP BY sku
        ) d ON d.sku = p.sku
        ${productScopeWhere}
        ORDER BY p.id DESC
        LIMIT 100
      `),
    ]);

    const total_products   = totalProductsRes.rows[0]?.count   || 0;
    const total_categories = totalCategoriesRes.rows[0]?.count || 0;
    const total_brands     = totalBrandsRes.rows[0]?.count     || 0;
    const no_image         = noImageRes.rows[0]?.count         || 0;
    const out_of_stock     = outOfStockRes.rows[0]?.count      || 0;
    const hsn_missing      = hsnMissingRes.rows[0]?.count      || 0;
    const missing_price    = missingPriceRes.rows[0]?.count    || 0;
    const duplicate_skus   = duplicateSkuRes.rows[0]?.count    || 0;
    const below_cost       = belowCostRes.rows[0]?.count       || 0;

    const needs_attention = [
      no_image, out_of_stock, hsn_missing,
      missing_price, duplicate_skus, below_cost,
    ].reduce((sum, v) => sum + Number(v || 0), 0);

    const health_score = Math.min(100, Math.max(0, Math.round(
      100
      - (no_image       * 2)
      - (hsn_missing    * 5)
      - (out_of_stock   * 1)
      - (missing_price  * 4)
      - (duplicate_skus * 3)
      - (below_cost     * 4)
    )));

    return successResponse({
      stats: {
        total_products,
        total_categories,
        total_brands,
        no_image,
        out_of_stock,
        hsn_missing,
        missing_price,
        duplicate_skus,
        below_cost,
        needs_attention,
        health_score,
      },
      products: productsRes.rows || [],
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
