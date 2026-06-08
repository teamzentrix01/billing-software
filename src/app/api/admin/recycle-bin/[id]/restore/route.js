import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { getClient } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { restoreRecycleBinOperation } from '@/lib/recycleBin';

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

export async function POST(request, { params }) {
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
    const result = await restoreRecycleBinOperation(client, itemId, auth.user);
    if (result.error) {
      await client.query('ROLLBACK');
      return errorResponse(result.error, 404);
    }
    await client.query('COMMIT');

    return successResponse(result, 'Recycle bin item restored');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recycle-bin restore]', err);
    if (err?.code === '23505') {
      return errorResponse('Restore failed because a duplicate record already exists', 409);
    }
    if (err?.code === '23503') {
      return errorResponse('Restore failed because a linked record is missing. Restore the related record first.', 409);
    }
    return errorResponse(err.message || 'Failed to restore item');
  } finally {
    client.release();
  }
}
