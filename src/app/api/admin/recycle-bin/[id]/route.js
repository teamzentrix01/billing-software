import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { getClient, query } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { ensureRecycleBinSchema } from '@/lib/recycleBinSchema';
import { markRecycleBinItemPurged } from '@/lib/recycleBin';

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    await ensureRecycleBinSchema();
    const resolvedParams = await params;
    const itemId = parseId(resolvedParams);
    if (!itemId) return validationError({ id: 'Recycle bin item id is required' });

    const result = await query(
      `SELECT r.*, u.name AS deleted_by_name
       FROM recycle_bin_items r
       LEFT JOIN users u ON u.id = r.deleted_by
       WHERE r.id = $1`,
      [itemId],
    );
    if (!result.rows[0]) return errorResponse('Recycle bin item not found', 404);

    return successResponse({ item: result.rows[0] });
  } catch (err) {
    console.error('[recycle-bin item GET]', err);
    return errorResponse(err.message || 'Failed to load recycle bin item');
  }
}

export async function DELETE(request, { params }) {
  const client = await getClient();
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    const resolvedParams = await params;
    const itemId = parseId(resolvedParams);
    if (!itemId) return validationError({ id: 'Recycle bin item id is required' });

    await client.query('BEGIN');
    const item = await markRecycleBinItemPurged(client, itemId, auth.user);
    if (!item) {
      await client.query('ROLLBACK');
      return errorResponse('Recycle bin item not found or already handled', 404);
    }
    await client.query('COMMIT');

    return successResponse({ item }, 'Recycle bin item permanently purged');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recycle-bin item DELETE]', err);
    return errorResponse(err.message || 'Failed to purge recycle bin item');
  } finally {
    client.release();
  }
}
