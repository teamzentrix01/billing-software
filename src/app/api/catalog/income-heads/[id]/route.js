import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];

    const result = await query(
      `SELECT id, name, code, is_active, created_at
       FROM income_heads
       WHERE id = $1::int`,
      [id]
    );

    if (!result.rows.length) return notFoundError('Income Head not found');
    return successResponse(result.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}

export async function PUT(request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    const body = await request.json();

    if (!body.name || !body.name.trim()) {
      return validationError({ name: 'Name is required' });
    }

    const result = await query(
      `UPDATE income_heads SET name = $1, code = $2, is_active = COALESCE($3, true)
       WHERE id = $4::int RETURNING *`,
      [body.name?.trim(), body.code || null, body.is_active ?? true, id]
    );

    if (!result.rows.length) return notFoundError('Income Head not found');
    return successResponse(result.rows[0], 'Income Head updated successfully');
  } catch (err) {
    if (err.code === '23505') return errorResponse('Income Head already exists', 409);
    return errorResponse(err.message);
  }
}

export async function DELETE(request) {
  let client;
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Income Head deleted');
    const result = await client.query(`DELETE FROM income_heads WHERE id = $1::int RETURNING *`, [id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFoundError('Income Head not found');
    }
    await client.query('COMMIT');
    return successResponse(null, 'Income Head deleted');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
