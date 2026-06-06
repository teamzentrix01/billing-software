import { query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { getAssignedStoreIds, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(req) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(req.url);
    const barcode = searchParams.get('barcode');
    const sku = searchParams.get('sku');
    let store_id = Number(searchParams.get('store_id') || 0) || null;

    if (!barcode && !sku) {
      return errorResponse('barcode or sku required', 400);
    }

    if (!store_id && auth.user.role !== 'super_admin') {
      store_id = getAssignedStoreIds(auth.user)[0] || null;
    }
    if (store_id) {
      const storeCheck = requireStore(auth.user, store_id);
      if (storeCheck.error) return storeCheck.error;
    } else if (auth.user.role !== 'super_admin') {
      return errorResponse('Store is required', 400);
    }

    let searchQuery = `
      SELECT 
        p.id,
        p.name,
        p.sku,
        p.barcode,
        p.mrp,
        p.cost_price,
        COALESCE(batch_totals.qty, 0) AS stock,
        COALESCE(NULLIF(ps.selling_price, 0), p.selling_price, 0) AS selling_price,
        c.name as category,
        b.name as brand,
        COALESCE(t.rate, 0) as tax_rate,
        p.image_url
      FROM products p
      ${store_id ? `INNER JOIN product_saleability ps ON ps.product_id = p.id AND ps.store_id = $1 AND ps.is_active = TRUE` : `LEFT JOIN product_saleability ps ON ps.product_id = p.id AND ps.is_active = TRUE`}
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      LEFT JOIN taxes t ON p.tax_id = t.id
      LEFT JOIN (
        SELECT product_id, SUM(available_qty) AS qty
        FROM inventory_batches
        ${store_id ? `WHERE store_id = $1` : ''}
          ${store_id ? 'AND' : 'WHERE'} status = 'active'
          AND available_qty > 0
          AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        GROUP BY product_id
      ) batch_totals ON batch_totals.product_id = p.id
      WHERE COALESCE(p.is_active, TRUE) = TRUE
    `;

    const params = store_id ? [store_id] : [];

    if (barcode) {
      searchQuery += ` AND p.barcode = $${params.length + 1}`;
      params.push(barcode);
    }

    if (sku) {
      searchQuery += ` AND p.sku = $${params.length + 1}`;
      params.push(sku);
    }

    searchQuery += ' ORDER BY p.name ASC LIMIT 2';

    const res = await query(searchQuery, params);

    if (!res.rows.length) {
      return errorResponse('Product not found', 404);
    }

    if (res.rows.length > 1) {
      return errorResponse(
        'Multiple products found for this barcode/SKU. Please fix duplicate barcode/SKU in product master.',
        409
      );
    }

    return successResponse(res.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}
