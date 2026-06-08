import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

const SELECT = `
  SELECT
    sc.id, sc.name, sc.description, sc.is_active,
    sc.sort_sequence, sc.category_id,
    c.name AS category_name,
    sc.created_at, sc.updated_at
  FROM sub_categories sc
  LEFT JOIN categories c ON sc.category_id = c.id
`;

// ─── GET /api/catalog/sub-categories/[id] ────────────────────
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const result = await query(`${SELECT} WHERE sc.id = $1`, [id]);
    if (!result.rows.length) return notFoundError('Sub Category not found');

    // Also fetch assigned product ids
    const products = await query(
      `SELECT product_id FROM sub_category_products WHERE sub_category_id = $1`,
      [id]
    );

    return successResponse({
      ...result.rows[0],
      product_ids: products.rows.map(r => r.product_id),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── PUT /api/catalog/sub-categories/[id] ────────────────────
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { product_ids = [] } = body;

    if (!body.name?.trim()) {
      return validationError({ name: 'Sub Category name is required' });
    }

    const result = await query(
      `UPDATE sub_categories SET
        name          = $1,
        description   = $2,
        category_id   = $3,
        sort_sequence = $4,
        is_active     = $5,
        updated_at    = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        body.name.trim(),
        body.description   || null,
        body.category_id   || null,
        body.sort_sequence ?? 0,
        body.is_active     ?? true,
        id,
      ]
    );

    if (!result.rows.length) return notFoundError('Sub Category not found');

    // Sync products — delete old, insert new
    await query(`DELETE FROM sub_category_products WHERE sub_category_id = $1`, [id]);
    if (product_ids.length > 0) {
      const values = product_ids.map((pid, i) => `($1, $${i + 2})`).join(', ');
      await query(
        `INSERT INTO sub_category_products (sub_category_id, product_id) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [id, ...product_ids]
      );
    }

    return successResponse(result.rows[0], 'Sub Category updated successfully');
  } catch (err) {
    if (err.code === '23505') return errorResponse('Sub Category already exists', 409);
    return errorResponse(err.message);
  }
}

// ─── DELETE /api/catalog/sub-categories/[id] ─────────────────
export async function DELETE(request, { params }) {
  let client;
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const { id } = await params;
    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Sub Category deleted');
    const result = await client.query(
      `DELETE FROM sub_categories WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFoundError('Sub Category not found');
    }
    await client.query('COMMIT');
    return successResponse({ id }, 'Sub Category deleted successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
