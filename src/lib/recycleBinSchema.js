import { query } from '@/lib/db';

const RECYCLE_BIN_TABLES = [
  'stores',
  'users',
  'user_stores',
  'regions',
  'region_store_mappings',
  'settings_records',
  'vendors',
  'vendor_brands',
  'products',
  'categories',
  'sub_categories',
  'manufacturers',
  'brands',
  'departments',
  'income_heads',
  'services',
  'service_groups',
  'promotions',
  'employees',
  'employee_departments',
  'roles',
  'stock_in',
  'stock_in_items',
  'stock_out',
  'stock_out_items',
  'stock_transfer',
  'stock_transfer_items',
  'stock_validation',
  'stock_validation_items',
  'inventory_batches',
  'inventory_batch_movements',
  'purchase_orders',
  'purchase_order_items',
  'vendor_invoices',
  'customers',
  'customer_groups',
  'sales_bills',
  'sales_bill_items',
  'held_bills',
  'pos_held_bills',
];

const RESTORE_PRIORITY = {
  stores: 10,
  regions: 20,
  users: 25,
  employees: 30,
  categories: 40,
  sub_categories: 45,
  manufacturers: 45,
  brands: 45,
  departments: 45,
  income_heads: 45,
  vendors: 50,
  products: 60,
  settings_records: 70,
  purchase_orders: 80,
  stock_in: 90,
  stock_out: 90,
  stock_transfer: 90,
  stock_validation: 90,
  purchase_order_items: 100,
  stock_in_items: 110,
  stock_out_items: 110,
  stock_transfer_items: 110,
  stock_validation_items: 110,
  inventory_batches: 120,
  inventory_batch_movements: 130,
  vendor_brands: 140,
  region_store_mappings: 140,
};

const globalForRecycleBin = globalThis;

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function getRecycleRestorePriority(tableName) {
  return RESTORE_PRIORITY[tableName] || 500;
}

export async function ensureRecycleBinSchema() {
  if (globalForRecycleBin._recycleBinSchemaReadyPromise) {
    await globalForRecycleBin._recycleBinSchemaReadyPromise;
    return;
  }

  globalForRecycleBin._recycleBinSchemaReadyPromise = (async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS recycle_bin_items (
      id BIGSERIAL PRIMARY KEY,
      operation_id UUID,
      table_schema TEXT NOT NULL DEFAULT 'public',
      table_name TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      display_name TEXT,
      deleted_snapshot JSONB NOT NULL,
      deleted_by BIGINT,
      delete_reason TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'deleted',
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 days'),
      restored_at TIMESTAMPTZ,
      restored_by BIGINT,
      purged_at TIMESTAMPTZ,
      purged_by BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_status_expires
      ON recycle_bin_items(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_table_resource
      ON recycle_bin_items(table_name, resource_id);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_by
      ON recycle_bin_items(deleted_by);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_operation
      ON recycle_bin_items(operation_id);
    CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at
      ON recycle_bin_items(deleted_at DESC);
  `);

  await query(`
    CREATE OR REPLACE FUNCTION recycle_bin_capture_delete()
    RETURNS trigger AS $$
    DECLARE
      actor_id BIGINT;
      op_id UUID;
      reason_text TEXT;
      row_json JSONB;
      resource_text TEXT;
      display_text TEXT;
    BEGIN
      BEGIN
        actor_id := NULLIF(current_setting('app.current_user_id', TRUE), '')::BIGINT;
      EXCEPTION WHEN OTHERS THEN
        actor_id := NULL;
      END;

      BEGIN
        op_id := NULLIF(current_setting('app.recycle_bin_operation_id', TRUE), '')::UUID;
      EXCEPTION WHEN OTHERS THEN
        op_id := NULL;
      END;

      reason_text := NULLIF(current_setting('app.recycle_bin_reason', TRUE), '');
      row_json := to_jsonb(OLD);
      resource_text := COALESCE(row_json->>'id', row_json->>'uuid', row_json->>'code');
      display_text := COALESCE(
        row_json->>'name',
        row_json->>'title',
        row_json->>'transaction_id',
        row_json->>'invoice_number',
        row_json->>'employee_code',
        row_json->>'username',
        row_json->>'email',
        row_json->>'mobile_number',
        resource_text,
        TG_TABLE_NAME
      );

      INSERT INTO recycle_bin_items (
        operation_id,
        table_schema,
        table_name,
        resource_type,
        resource_id,
        display_name,
        deleted_snapshot,
        deleted_by,
        delete_reason,
        metadata
      )
      VALUES (
        op_id,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        TG_TABLE_NAME,
        resource_text,
        display_text,
        row_json,
        actor_id,
        reason_text,
        jsonb_build_object('trigger', TG_NAME)
      );

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const tableName of RECYCLE_BIN_TABLES) {
    const exists = await query('SELECT to_regclass($1) AS regclass', [`public.${tableName}`]);
    if (!exists.rows[0]?.regclass) continue;

    const triggerName = `trg_recycle_bin_${tableName}`;
    await query(`
      DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON public.${quoteIdent(tableName)};
      CREATE TRIGGER ${quoteIdent(triggerName)}
        AFTER DELETE ON public.${quoteIdent(tableName)}
        FOR EACH ROW
        EXECUTE FUNCTION recycle_bin_capture_delete();
    `);
  }
  })().catch((err) => {
    globalForRecycleBin._recycleBinSchemaReadyPromise = null;
    throw err;
  });

  await globalForRecycleBin._recycleBinSchemaReadyPromise;
}

export default { ensureRecycleBinSchema };
