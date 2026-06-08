import { successResponse, errorResponse } from '@/lib/api-response';
import { getClient, query } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { ensureRecycleBinSchema } from '@/lib/recycleBinSchema';
import { purgeExpiredRecycleBinItems } from '@/lib/recycleBin';

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    await ensureRecycleBinSchema();
    await purgeExpiredRecycleBinItems(auth.user.id);

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get('page'), 1);
    const pageSize = Math.min(100, parsePositiveInt(searchParams.get('pageSize'), 20));
    const offset = (page - 1) * pageSize;
    const status = searchParams.get('status') || 'deleted';
    const tableName = searchParams.get('table') || '';
    const search = searchParams.get('search') || '';

    const params = [];
    const where = [];

    if (status !== 'all') {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (tableName) {
      params.push(tableName);
      where.push(`r.table_name = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(r.display_name ILIKE $${params.length} OR r.resource_id ILIKE $${params.length} OR r.table_name ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRes = await query(
      `SELECT COUNT(*)::int AS total
       FROM recycle_bin_items r
       ${whereSql}`,
      params,
    );

    const listParams = [...params, pageSize, offset];
    const listRes = await query(
      `SELECT r.id,
              r.operation_id,
              r.table_name,
              r.resource_type,
              r.resource_id,
              r.display_name,
              r.deleted_by,
              COALESCE(u.name, u.email) AS deleted_by_name,
              r.delete_reason,
              r.status,
              r.deleted_at,
              r.expires_at,
              r.restored_at,
              r.purged_at,
              (
                SELECT COUNT(*)::int
                FROM jsonb_object_keys(COALESCE(r.deleted_snapshot, '{}'::jsonb))
              ) AS field_count,
              COUNT(*) OVER (PARTITION BY r.operation_id) AS operation_count
      FROM recycle_bin_items r
       LEFT JOIN users u ON u.id = r.deleted_by
       ${whereSql}
       ORDER BY r.deleted_at DESC, r.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const tablesRes = await query(
      `SELECT table_name, COUNT(*)::int AS total
       FROM recycle_bin_items
       WHERE status = 'deleted'
       GROUP BY table_name
       ORDER BY table_name ASC`,
    );

    return successResponse({
      records: listRes.rows,
      tableCounts: tablesRes.rows,
      page,
      pageSize,
      total: countRes.rows[0]?.total || 0,
    });
  } catch (err) {
    console.error('[recycle-bin GET]', err);
    return errorResponse(err.message || 'Failed to load recycle bin');
  }
}

export async function DELETE(request) {
  let client;
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    await ensureRecycleBinSchema();
    client = await getClient();
    await client.query('BEGIN');
    const count = await purgeExpiredRecycleBinItems(auth.user.id);
    await client.query('COMMIT');

    return successResponse({ count }, 'Expired recycle bin items purged');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[recycle-bin DELETE expired]', err);
    return errorResponse(err.message || 'Failed to purge expired items');
  } finally {
    client?.release();
  }
}
