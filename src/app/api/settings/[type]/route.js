import { successResponse, errorResponse, validationError, notFoundError } from '@/lib/api-response';
import { getClient, query } from '@/lib/db';
import { ensureSettingsSchema } from '@/lib/settingsSchema';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function normalizeType(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function normalizeCode(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parsePositiveInt(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mapRecord(row) {
  return {
    id: row.id,
    settingType: row.setting_type,
    name: row.name,
    code: row.code || '',
    description: row.description || '',
    storeId: row.store_id,
    storeName: row.store_name || '',
    isActive: row.is_active,
    config: row.config || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAccessibleStoreFilter(user, params, alias = 'sr') {
  if (user.role === 'super_admin') return '';

  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
  if (assignedStores.length === 0) return ' AND 1 = 0';

  params.push(assignedStores);
  return ` AND (${alias}.store_id IS NULL OR ${alias}.store_id = ANY($${params.length}::int[]))`;
}

export async function GET(request, context) {
  try {
    await ensureSettingsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const type = normalizeType((await context.params)?.type);
    if (!type) return validationError({ type: 'Setting type is required' });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const storeId = parsePositiveInt(searchParams.get('storeId') || searchParams.get('store_id'));
    const isActive = searchParams.get('isActive') ?? searchParams.get('is_active');
    const page = Math.max(1, parsePositiveInt(searchParams.get('page'), 1));
    const pageSize = Math.max(1, parsePositiveInt(searchParams.get('pageSize'), 10));
    const offset = (page - 1) * pageSize;

    const params = [type];
    const where = ['sr.setting_type = $1'];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(sr.name ILIKE $${params.length} OR COALESCE(sr.code, '') ILIKE $${params.length} OR COALESCE(sr.description, '') ILIKE $${params.length})`);
    }

    if (storeId) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) return storeCheck.error;
      params.push(storeId);
      where.push(`sr.store_id = $${params.length}`);
    }

    if (isActive === 'true' || isActive === 'false') {
      params.push(isActive === 'true');
      where.push(`sr.is_active = $${params.length}`);
    }

    const accessFilter = getAccessibleStoreFilter(auth.user, params, 'sr');
    const whereSql = `WHERE ${where.join(' AND ')}${accessFilter}`;

    const countRes = await query(
      `SELECT COUNT(*)::int AS total
       FROM settings_records sr
       ${whereSql}`,
      params
    );

    const listParams = params.slice();
    listParams.push(pageSize, offset);
    const recordsRes = await query(
      `SELECT sr.*, s.name AS store_name
       FROM settings_records sr
       LEFT JOIN stores s ON s.id = sr.store_id
       ${whereSql}
       ORDER BY sr.updated_at DESC, sr.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const total = Number(countRes.rows[0]?.total || 0);
    return successResponse({
      records: recordsRes.rows.map(mapRecord),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    console.error('[settings GET]', err);
    return errorResponse(err.message || 'Failed to load settings');
  }
}

export async function POST(request, context) {
  let client;
  try {
    await ensureSettingsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const type = normalizeType((await context.params)?.type);
    if (!type) return validationError({ type: 'Setting type is required' });

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const id = parsePositiveInt(body.id);
    const storeId = parsePositiveInt(body.storeId ?? body.store_id);

    if (!name) return validationError({ name: 'Name is required' });
    if (storeId) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) return storeCheck.error;
    }

    client = await getClient();
    const code = normalizeCode(body.code) || normalizeCode(name);
    const payload = [
      type,
      name,
      code || null,
      String(body.description || '').trim() || null,
      storeId,
      body.isActive ?? body.is_active ?? true,
      JSON.stringify(body.config || {}),
    ];

    let result;
    if (id) {
      result = await client.query(
        `UPDATE settings_records
         SET name = $2, code = $3, description = $4, store_id = $5,
             is_active = COALESCE($6, TRUE), config = $7::jsonb, updated_at = NOW()
         WHERE id = $8 AND setting_type = $1
         RETURNING *`,
        [...payload, id]
      );
    } else {
      const existing = await client.query(
        `SELECT id
         FROM settings_records
         WHERE setting_type = $1
           AND code = $2
           AND store_id IS NOT DISTINCT FROM $3
         LIMIT 1`,
        [type, code || null, storeId]
      );

      result = existing.rows[0]
        ? await client.query(
            `UPDATE settings_records
             SET name = $2, description = $4, is_active = COALESCE($6, TRUE),
                 config = $7::jsonb, updated_at = NOW()
             WHERE id = $8 AND setting_type = $1
             RETURNING *`,
            [...payload, existing.rows[0].id]
          )
        : await client.query(
            `INSERT INTO settings_records (
               setting_type, name, code, description, store_id, is_active, config, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7::jsonb, NOW(), NOW())
             RETURNING *`,
            payload
          );
    }

    if (!result.rows[0]) return notFoundError('Setting not found');
    return successResponse(mapRecord(result.rows[0]), id ? 'Setting updated' : 'Setting created', id ? 200 : 201);
  } catch (err) {
    console.error('[settings POST]', err);
    return errorResponse(err.message || 'Failed to save setting');
  } finally {
    if (client) client.release();
  }
}

export async function DELETE(request, context) {
  let client;
  try {
    await ensureSettingsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(
      auth.user,
      'MANAGE_STORES',
      'MANAGE_BILLING',
      'MANAGE_PAYMENTS',
      'MANAGE_TAXES',
      'MANAGE_INVENTORY'
    );
    if (permissionCheck.error) return permissionCheck.error;

    const type = normalizeType((await context.params)?.type);
    const id = parsePositiveInt(new URL(request.url).searchParams.get('id'));
    if (!id) return validationError({ id: 'Setting id is required' });

    const existing = await query(
      'SELECT id, store_id FROM settings_records WHERE id = $1 AND setting_type = $2 LIMIT 1',
      [id, type]
    );
    const row = existing.rows[0];
    if (!row) return notFoundError('Setting not found');

    if (row.store_id) {
      const storeCheck = requireStore(auth.user, row.store_id);
      if (storeCheck.error) return storeCheck.error;
    }

    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, `Setting deleted: ${type}`);
    await client.query('DELETE FROM settings_records WHERE id = $1 AND setting_type = $2', [id, type]);
    await client.query('COMMIT');
    return successResponse({ id }, 'Setting deleted');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[settings DELETE]', err);
    return errorResponse(err.message || 'Failed to delete setting');
  } finally {
    if (client) client.release();
  }
}
