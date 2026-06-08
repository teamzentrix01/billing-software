import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

// ─── GET /api/catalog/manufacturers/[id] ────────────────────────
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT id, name, contact, email, phone, address, is_active, created_at
       FROM manufacturers
       WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) return notFoundError('Manufacturer not found');
    return successResponse(result.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── PUT /api/catalog/manufacturers/[id] ────────────────────────
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.name?.trim()) {
      return validationError({ name: 'Manufacturer name is required' });
    }

    const result = await query(
      `UPDATE manufacturers SET
        name = $1,
        contact = $2,
        email = $3,
        phone = $4,
        address = $5,
        is_active = $6
       WHERE id = $7
       RETURNING id, name, contact, email, phone, address, is_active, created_at`,
      [
        body.name.trim(),
        body.contact || null,
        body.email || null,
        body.phone || null,
        body.address || null,
        body.is_active ?? true,
        id,
      ]
    );

    if (!result.rows.length) return notFoundError('Manufacturer not found');
    return successResponse(result.rows[0], 'Manufacturer updated successfully');
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse('Manufacturer already exists', 409);
    }
    return errorResponse(err.message);
  }
}

// ─── DELETE /api/catalog/manufacturers/[id] ─────────────────────
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
    await setRecycleBinContext(client, auth.user.id, 'Manufacturer deleted');
    const result = await client.query(
      `DELETE FROM manufacturers WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFoundError('Manufacturer not found');
    }
    await client.query('COMMIT');
    return successResponse({ id }, 'Manufacturer deleted successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
