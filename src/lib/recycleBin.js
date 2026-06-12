import crypto from 'crypto';
import { ensureRecycleBinSchema, getRecycleRestorePriority } from '@/lib/recycleBinSchema';
import { query } from '@/lib/db';
import { auditLog } from '@/lib/api-protection';

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableRef(schemaName, tableName) {
  return `${quoteIdent(schemaName || 'public')}.${quoteIdent(tableName)}`;
}

const LEGACY_GROUP_KEY_SQL = `
  COALESCE(
    r.operation_id::text,
    CASE
      WHEN r.table_name = 'stock_in' THEN 'stock_in:' || r.resource_id
      WHEN r.table_name = 'stock_in_items' THEN 'stock_in:' || NULLIF(r.deleted_snapshot->>'stock_in_id', '')
      WHEN r.table_name = 'inventory_batch_movements'
        AND r.deleted_snapshot->>'reference_type' = 'stock_in'
        THEN 'stock_in:' || NULLIF(r.deleted_snapshot->>'reference_id', '')
      WHEN r.table_name = 'inventory_batches'
        AND r.deleted_snapshot->>'source_type' = 'stock_in'
        THEN 'stock_in:' || (
          SELECT NULLIF(item.deleted_snapshot->>'stock_in_id', '')
          FROM recycle_bin_items item
          WHERE item.table_name = 'stock_in_items'
            AND item.status = r.status
            AND item.resource_id = NULLIF(r.deleted_snapshot->>'source_id', '')
          ORDER BY ABS(EXTRACT(EPOCH FROM (item.deleted_at - r.deleted_at))), item.id
          LIMIT 1
        )
      ELSE NULL
    END,
    r.id::text
  )
`;

export async function setRecycleBinContext(client, userId, reason = '', operationId = crypto.randomUUID()) {
  await ensureRecycleBinSchema();
  await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [String(userId || '')]);
  await client.query(`SELECT set_config('app.recycle_bin_operation_id', $1, true)`, [operationId]);
  await client.query(`SELECT set_config('app.recycle_bin_reason', $1, true)`, [String(reason || '')]);
  return operationId;
}

export function isSuperAdmin(user) {
  return user?.role === 'super_admin' || (Array.isArray(user?.permissions) && user.permissions.includes('*'));
}

export async function purgeExpiredRecycleBinItems(userId = null) {
  await ensureRecycleBinSchema();
  const result = await query(
    `DELETE FROM recycle_bin_items
     WHERE status = 'deleted'
       AND expires_at <= NOW()
     RETURNING id`,
  );
  return result.rowCount || 0;
}

export async function restoreRecycleBinOperation(client, itemId, user) {
  await ensureRecycleBinSchema();

  const selected = await client.query(
    `SELECT r.*, ${LEGACY_GROUP_KEY_SQL} AS group_key
     FROM recycle_bin_items r
     WHERE r.id = $1
       AND r.status = 'deleted'
     FOR UPDATE`,
    [itemId],
  );
  const item = selected.rows[0];
  if (!item) {
    return { error: 'Recycle bin item not found or already handled' };
  }

  const related = await client.query(
    `WITH grouped AS (
       SELECT r.id, ${LEGACY_GROUP_KEY_SQL} AS group_key
       FROM recycle_bin_items r
       WHERE r.status = 'deleted'
     )
     SELECT r.*
     FROM recycle_bin_items r
     WHERE r.id IN (
       SELECT id
       FROM grouped
       WHERE group_key = $1
     )
     FOR UPDATE`,
    [item.group_key],
  );

  const rows = related.rows.sort((a, b) => (
    getRecycleRestorePriority(a.table_name) - getRecycleRestorePriority(b.table_name)
    || Number(a.id) - Number(b.id)
  ));

  const restored = [];
  for (const row of rows) {
    const tableName = tableRef(row.table_schema, row.table_name);
    await client.query(
      `INSERT INTO ${tableName}
       SELECT * FROM jsonb_populate_record(NULL::${tableName}, $1::jsonb)`,
      [JSON.stringify(row.deleted_snapshot)],
    );

    await client.query(
      `UPDATE recycle_bin_items
       SET status = 'restored',
           restored_at = NOW(),
           restored_by = $2
       WHERE id = $1`,
      [row.id, Number(user.id)],
    );

    restored.push({
      id: row.id,
      tableName: row.table_name,
      resourceId: row.resource_id,
      displayName: row.display_name,
    });
  }

  await auditLog(user.id, 'recycle_bin.restore', 'recycle_bin', item.id, {
    operationId: item.operation_id,
    restoredCount: restored.length,
    requestedTable: item.table_name,
    requestedResourceId: item.resource_id,
  });

  return { restored };
}

export async function markRecycleBinItemPurged(client, itemId, user) {
  await ensureRecycleBinSchema();
  const selected = await client.query(
    `SELECT r.id, r.operation_id, ${LEGACY_GROUP_KEY_SQL} AS group_key
     FROM recycle_bin_items r
     WHERE r.id = $1
       AND r.status = 'deleted'
     FOR UPDATE`,
    [itemId],
  );

  const selectedItem = selected.rows[0];
  if (!selectedItem) return null;

  const result = await client.query(
    `WITH grouped AS (
       SELECT r.id, ${LEGACY_GROUP_KEY_SQL} AS group_key
       FROM recycle_bin_items r
       WHERE r.status = 'deleted'
     )
     DELETE FROM recycle_bin_items target
     USING grouped
     WHERE target.id = grouped.id
       AND grouped.group_key = $1
     RETURNING target.id, target.operation_id, target.table_name, target.resource_id`,
    [selectedItem.group_key],
  );

  const item = result.rows[0];
  if (!item) return null;

  await auditLog(user.id, 'recycle_bin.purge', 'recycle_bin', item.id, {
    operationId: item.operation_id,
    tableName: item.table_name,
    resourceId: item.resource_id,
    purgedCount: result.rowCount || 0,
  });

  return { ...item, purgedCount: result.rowCount || 0 };
}

export default {
  setRecycleBinContext,
  isSuperAdmin,
  purgeExpiredRecycleBinItems,
  restoreRecycleBinOperation,
  markRecycleBinItemPurged,
};
