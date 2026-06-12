import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { getClient } from '@/lib/db';
import { requireAuth, requireRole } from '@/lib/api-protection';
import { markRecycleBinItemPurged, restoreRecycleBinOperation } from '@/lib/recycleBin';

function parseIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => Math.floor(id));
  return Array.from(new Set(ids));
}

export async function POST(request) {
  const client = await getClient();
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const roleCheck = requireRole(auth.user, 'super_admin');
    if (roleCheck.error) return roleCheck.error;

    const body = await request.json().catch(() => ({}));
    const ids = parseIds(body?.ids);
    const action = String(body?.action || '').trim();

    if (!ids.length) return validationError({ ids: 'Select at least one recycle-bin record' });
    if (!['restore', 'purge'].includes(action)) {
      return validationError({ action: 'Bulk action must be restore or purge' });
    }

    await client.query('BEGIN');
    const results = [];
    for (const id of ids) {
      if (action === 'restore') {
        const result = await restoreRecycleBinOperation(client, id, auth.user);
        if (result.error) {
          results.push({ id, skipped: true, error: result.error });
        } else {
          results.push({ id, restored: result.restored?.length || 0 });
        }
      } else {
        const item = await markRecycleBinItemPurged(client, id, auth.user);
        results.push(item ? { id, purged: item.purgedCount || 1 } : { id, skipped: true });
      }
    }
    await client.query('COMMIT');

    const handled = results.filter((item) => !item.skipped).length;
    return successResponse(
      { results, handled, requested: ids.length },
      action === 'restore' ? 'Selected recycle-bin records restored' : 'Selected recycle-bin records deleted',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[recycle-bin bulk]', err);
    if (err?.code === '23505') {
      return errorResponse('Restore failed because a duplicate record already exists', 409);
    }
    if (err?.code === '23503') {
      return errorResponse('Restore failed because a linked record is missing. Restore the related record first.', 409);
    }
    return errorResponse(err.message || 'Failed to run bulk recycle-bin action');
  } finally {
    client.release();
  }
}
