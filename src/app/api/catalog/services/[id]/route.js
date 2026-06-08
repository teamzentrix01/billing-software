import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFound, validationError } from '@/lib/apiResponse';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

const SELECT_SERVICE = `
  SELECT s.id, s.name, s.price, s.duration_minutes, s.is_active, s.hsn_code, s.sku, s.description, s.created_at, s.updated_at,
         s.service_group_id, s.service_department_id, s.income_head_id, s.tax_id,
         sg.name AS service_group_name,
         sd.name AS service_department_name,
         ih.name AS income_head_name,
         t.name  AS tax_name, t.rate AS tax_rate
  FROM services s
  LEFT JOIN service_groups sg ON s.service_group_id = sg.id
  LEFT JOIN service_departments sd ON s.service_department_id = sd.id
  LEFT JOIN income_heads ih ON s.income_head_id = ih.id
  LEFT JOIN taxes t ON s.tax_id = t.id
`;

export async function GET(request, { params }) {
  try {
    const result = await query(`${SELECT_SERVICE} WHERE s.id = $1`, [params.id]);
    if (!result.rows.length) return notFound('Service not found');
    return successResponse(result.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}

export async function PUT(request, { params }) {
  try {
    const body = await request.json();
    if (!body.name?.trim()) return validationError({ name: 'Name is required' });

    const result = await query(
      `UPDATE services SET
         name = $1,
         service_group_id = $2,
         service_department_id = $3,
         income_head_id = $4,
         tax_id = $5,
         price = $6,
         duration_minutes = $7,
         hsn_code = $8,
         sku = $9,
         description = $10,
         is_active = COALESCE($11, true),
         updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [
        body.name.trim(),
        body.service_group_id || null,
        body.service_department_id || null,
        body.income_head_id || null,
        body.tax_id || null,
        body.price || 0,
        body.duration_minutes || 0,
        body.hsn_code || null,
        body.sku || null,
        body.description || null,
        body.is_active ?? true,
        params.id,
      ]
    );

    if (!result.rows.length) return notFound('Service not found');
    return successResponse(result.rows[0], 'Service updated successfully');
  } catch (err) {
    if (err.code === '23505') return errorResponse('Service with this SKU already exists', 409);
    return errorResponse(err.message);
  }
}

export async function DELETE(request, { params }) {
  let client;
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Service deleted');
    const result = await client.query(`DELETE FROM services WHERE id = $1 RETURNING id`, [params.id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFound('Service not found');
    }
    await client.query('COMMIT');
    return successResponse({ id: params.id }, 'Service deleted successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
