import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

// ─── GET /api/catalog/departments/[id] ──────────────────────────
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT id, name, code, is_active, created_at
       FROM departments
       WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) return notFoundError('Department not found');
    return successResponse(result.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── PUT /api/catalog/departments/[id] ───────────────────────────
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.name?.trim()) {
      return validationError({ name: 'Department name is required' });
    }

    const result = await query(
      `UPDATE departments SET
        name = $1,
        code = $2,
        is_active = $3
       WHERE id = $4
       RETURNING id, name, code, is_active, created_at`,
      [
        body.name.trim(),
        body.code || null,
        body.is_active ?? true,
        id,
      ]
    );

    if (!result.rows.length) return notFoundError('Department not found');
    // handle category associations when provided
    if (Array.isArray(body.category_ids)) {
      // assign selected categories to this department
      if (body.category_ids.length) {
        await query(
          `UPDATE categories SET department_id = $1 WHERE id = ANY($2::bigint[])`,
          [id, body.category_ids]
        );
      }
      // clear department_id for categories previously assigned but not in the new list
      await query(
        `UPDATE categories SET department_id = NULL WHERE department_id = $1 AND (NOT (id = ANY($2::bigint[])))`,
        [id, body.category_ids.length ? body.category_ids : [-1]]
      );
    }
    return successResponse(result.rows[0], 'Department updated successfully');
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse('Department already exists', 409);
    }
    return errorResponse(err.message);
  }
}

// ─── DELETE /api/catalog/departments/[id] ────────────────────────
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
    await setRecycleBinContext(client, auth.user.id, 'Department deleted');
    const result = await client.query(
      `DELETE FROM departments WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFoundError('Department not found');
    }
    await client.query('COMMIT');
    return successResponse({ id }, 'Department deleted successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
