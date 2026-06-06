import { query } from '@/lib/db';
import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { appendStoreScope, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

export async function GET(request) {
  try {
    await ensureCatalogExtrasSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_CATALOG', 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const offset = (page - 1) * pageSize;
    const params = [];
    const filters = [];
    const storeId = searchParams.get('store_id');
    const productId = searchParams.get('product_id');
    if (search) filters.push(`(p.name ILIKE $${params.length + 1} OR COALESCE(st.name, '') ILIKE $${params.length + 1})`) && params.push(`%${search}%`);
    const scope = appendStoreScope(filters, params, 'ps.store_id', auth.user, storeId);
    if (scope.error) return scope.error;
    if (productId) { params.push(productId); filters.push(`ps.product_id = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const count = await query(
      `SELECT COUNT(*) FROM product_saleability ps
       LEFT JOIN products p ON ps.product_id = p.id
       LEFT JOIN stores st ON ps.store_id = st.id
       ${where}`,
      params
    );
    params.push(pageSize, offset);
    const result = await query(
      `SELECT ps.id, ps.product_id, ps.store_id, ps.is_active, ps.selling_price, ps.mrp,
              ps.low_stock_value, ps.minimum_base_quantity, ps.created_at,
              p.name AS product,
              st.name AS store
       FROM product_saleability ps
       LEFT JOIN products p ON ps.product_id = p.id
       LEFT JOIN stores st ON ps.store_id = st.id
       ${where}
       ORDER BY ps.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return successResponse({
      records: result.rows,
      total: parseInt(count.rows[0].count),
      page,
      pageSize,
      totalPages: Math.ceil(parseInt(count.rows[0].count) / pageSize),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

export async function POST(request) {
  try {
    await ensureCatalogExtrasSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    if (!body.product_id) return validationError({ product_id: 'Product is required' });
    const storeId = Number(body.store_id || 0) || null;
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const result = await query(
      `INSERT INTO product_saleability (product_id, store_id, is_active, selling_price, mrp, low_stock_value, minimum_base_quantity)
       VALUES ($1, $2, COALESCE($3, true), COALESCE($4, 0), COALESCE($5, 0), COALESCE($6, 0), COALESCE($7, 0))
       ON CONFLICT (product_id, store_id) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         selling_price = EXCLUDED.selling_price,
         mrp = EXCLUDED.mrp,
         low_stock_value = EXCLUDED.low_stock_value,
         minimum_base_quantity = EXCLUDED.minimum_base_quantity,
         updated_at = NOW()
       RETURNING *`,
      [
        body.product_id,
        storeId,
        body.is_active ?? true,
        Number(body.selling_price || 0),
        Number(body.mrp || 0),
        Number(body.low_stock_value || 0),
        Number(body.minimum_base_quantity || body.mbq || 0),
      ]
    );

    return successResponse(result.rows[0], 'Saleability saved successfully', 201);
  } catch (err) {
    return errorResponse(err.message);
  }
}
