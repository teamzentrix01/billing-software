import { query } from '@/lib/db';
import { toDateInputValue } from '@/lib/dateUtils';

const BATCH_SCHEMA_VERSION = 2;
const globalForInventoryBatching = globalThis;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  return toDateInputValue(value) || null;
}

function buildBatchNumber({ stockInId, productId, batchNo }) {
  const clean = String(batchNo || '').trim();
  return clean || `AUTO-${stockInId}-${productId}`;
}

export async function ensureInventoryBatchSchema() {
  if (globalForInventoryBatching._inventoryBatchSchemaVersion === BATCH_SCHEMA_VERSION) return;

  await query(`
    CREATE TABLE IF NOT EXISTS inventory_batches (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      batch_no VARCHAR(120) NOT NULL,
      mfg_date DATE,
      expiry_date DATE,
      received_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
      available_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
      cost_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      source_type VARCHAR(60),
      source_id VARCHAR(120),
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_batch_movements (
      id BIGSERIAL PRIMARY KEY,
      batch_id BIGINT REFERENCES inventory_batches(id) ON DELETE SET NULL,
      product_id BIGINT NOT NULL,
      store_id BIGINT NOT NULL,
      direction VARCHAR(20) NOT NULL,
      qty NUMERIC(14, 3) NOT NULL,
      reference_type VARCHAR(60),
      reference_id VARCHAR(120),
      source_item_id BIGINT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    DO $$
    BEGIN
      IF to_regclass('stock_in_items') IS NOT NULL THEN
        ALTER TABLE stock_in_items
          ADD COLUMN IF NOT EXISTS batch_no VARCHAR(120),
          ADD COLUMN IF NOT EXISTS mfg_date DATE,
          ADD COLUMN IF NOT EXISTS expiry_date DATE;
      END IF;

      IF to_regclass('stock_out_items') IS NOT NULL THEN
        ALTER TABLE stock_out_items
          ADD COLUMN IF NOT EXISTS batch_id BIGINT REFERENCES inventory_batches(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS batch_no VARCHAR(120),
          ADD COLUMN IF NOT EXISTS expiry_date DATE;
      END IF;
    END
    $$;

    DO $$
    BEGIN
      IF to_regclass('sales_bill_items') IS NOT NULL THEN
        ALTER TABLE sales_bill_items
          ADD COLUMN IF NOT EXISTS batch_allocations JSONB NOT NULL DEFAULT '[]'::jsonb;
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_store
      ON inventory_batches(product_id, store_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_batches_fefo
      ON inventory_batches(product_id, store_id, expiry_date, created_at)
      WHERE status = 'active' AND available_qty > 0;
    CREATE INDEX IF NOT EXISTS idx_inventory_batch_movements_ref
      ON inventory_batch_movements(reference_type, reference_id);

    DO $$
    BEGIN
      IF to_regclass('sales_bill_items') IS NOT NULL AND to_regclass('sales_bills') IS NOT NULL THEN
        INSERT INTO inventory_batches (
          product_id, store_id, batch_no, received_qty, available_qty,
          cost_price, source_type, source_id, meta, created_at, updated_at
        )
        SELECT
          legacy.product_id,
          legacy.store_id,
          'LEGACY-' || legacy.product_id || '-' || legacy.store_id,
          legacy.available_qty,
          legacy.available_qty,
          COALESCE(p.cost_price, 0),
          'legacy_migration',
          legacy.product_id || ':' || legacy.store_id,
          '{"migrated": true}'::jsonb,
          NOW(),
          NOW()
        FROM (
          SELECT
            base.product_id,
            base.store_id,
            GREATEST(
              COALESCE(base.stock_in_qty, 0)
              - COALESCE(sales.qty, 0)
              - COALESCE(stock_out.qty, 0),
              0
            ) AS available_qty
          FROM (
            SELECT sii.product_id, si.destination_id AS store_id, SUM(sii.qty) AS stock_in_qty
            FROM stock_in_items sii
            INNER JOIN stock_in si ON si.id = sii.stock_in_id
            WHERE si.status = 'confirmed' AND si.destination_id IS NOT NULL
            GROUP BY sii.product_id, si.destination_id
          ) base
          LEFT JOIN (
            SELECT sbi.product_id, sb.store_id, SUM(sbi.qty) AS qty
            FROM sales_bill_items sbi
            INNER JOIN sales_bills sb ON sb.id = sbi.sales_bill_id
            WHERE sb.status IN ('paid', 'completed') AND sb.store_id IS NOT NULL
            GROUP BY sbi.product_id, sb.store_id
          ) sales ON sales.product_id = base.product_id AND sales.store_id = base.store_id
          LEFT JOIN (
            SELECT soi.product_id, so.destination_id AS store_id, SUM(soi.qty) AS qty
            FROM stock_out_items soi
            INNER JOIN stock_out so ON so.id = soi.stock_out_id
            WHERE so.status = 'confirmed'
              AND so.destination_id IS NOT NULL
              AND COALESCE(so.reference_type, '') <> 'sales_bill'
            GROUP BY soi.product_id, so.destination_id
          ) stock_out ON stock_out.product_id = base.product_id AND stock_out.store_id = base.store_id
        ) legacy
        LEFT JOIN products p ON p.id = legacy.product_id
        WHERE legacy.available_qty > 0
          AND NOT EXISTS (
            SELECT 1 FROM inventory_batches ib
            WHERE ib.product_id = legacy.product_id AND ib.store_id = legacy.store_id
          );
      END IF;
    END
    $$;

    UPDATE inventory_batches destination
    SET mfg_date = source.mfg_date,
        expiry_date = source.expiry_date,
        updated_at = NOW()
    FROM inventory_batches source
    WHERE destination.meta ? 'sourceBatchId'
      AND source.id = NULLIF(destination.meta->>'sourceBatchId', '')::BIGINT
      AND (
        destination.mfg_date IS DISTINCT FROM source.mfg_date
        OR destination.expiry_date IS DISTINCT FROM source.expiry_date
      );
  `);

  globalForInventoryBatching._inventoryBatchSchemaVersion = BATCH_SCHEMA_VERSION;
}

export async function receiveBatchStock(client, {
  stockInId,
  stockInItemId = null,
  productId,
  storeId,
  qty,
  costPrice = 0,
  batchNo = '',
  mfgDate = null,
  expiryDate = null,
  meta = {},
}) {
  await ensureInventoryBatchSchema();

  const quantity = toNumber(qty);
  if (!productId || !storeId || quantity <= 0) return null;

  const normalizedBatchNo = buildBatchNumber({ stockInId, productId, batchNo });
  const normalizedMfgDate = normalizeDate(mfgDate);
  const normalizedExpiryDate = normalizeDate(expiryDate);

  const batchRes = await client.query(
    `INSERT INTO inventory_batches (
       product_id, store_id, batch_no, mfg_date, expiry_date,
       received_qty, available_qty, cost_price, source_type, source_id, meta,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $6, $7, 'stock_in', $8, $9::jsonb,
       NOW(), NOW()
     )
     RETURNING *`,
    [
      Number(productId),
      Number(storeId),
      normalizedBatchNo,
      normalizedMfgDate,
      normalizedExpiryDate,
      quantity,
      toNumber(costPrice),
      String(stockInItemId || stockInId),
      JSON.stringify(meta),
    ]
  );

  const batch = batchRes.rows[0];
  await client.query(
    `INSERT INTO inventory_batch_movements (
       batch_id, product_id, store_id, direction, qty, reference_type, reference_id, source_item_id, meta
     ) VALUES ($1, $2, $3, 'in', $4, 'stock_in', $5, $6, $7::jsonb)`,
    [
      batch.id,
      Number(productId),
      Number(storeId),
      quantity,
      String(stockInId),
      stockInItemId,
      JSON.stringify(meta),
    ]
  );

  return batch;
}

export async function restoreBatchStock(client, {
  batchId,
  productId,
  storeId,
  qty,
  referenceType = 'sales_return',
  referenceId = null,
  sourceItemId = null,
  meta = {},
}) {
  await ensureInventoryBatchSchema();

  const quantity = toNumber(qty);
  const normalizedBatchId = Number(batchId);
  if (!normalizedBatchId || !productId || !storeId || quantity <= 0) return null;

  const batchRes = await client.query(
    `UPDATE inventory_batches
     SET available_qty = available_qty + $1,
         status = 'active',
         updated_at = NOW()
     WHERE id = $2
       AND product_id = $3
       AND store_id = $4
     RETURNING *`,
    [quantity, normalizedBatchId, Number(productId), Number(storeId)]
  );

  const batch = batchRes.rows[0];
  if (!batch) return null;

  await client.query(
    `INSERT INTO inventory_batch_movements (
       batch_id, product_id, store_id, direction, qty, reference_type, reference_id, source_item_id, meta
     ) VALUES ($1, $2, $3, 'in', $4, $5, $6, $7, $8::jsonb)`,
    [
      batch.id,
      Number(productId),
      Number(storeId),
      quantity,
      referenceType,
      referenceId ? String(referenceId) : null,
      sourceItemId,
      JSON.stringify(meta),
    ]
  );

  return batch;
}

export async function allocateBatchStock(client, {
  productId,
  storeId,
  qty,
  preferredBatchId = null,
  allowedBatchIds = [],
  strategy = 'FEFO',
  referenceType = 'stock_out',
  referenceId = null,
  sourceItemId = null,
  allowExpired = false,
  meta = {},
}) {
  await ensureInventoryBatchSchema();

  const requiredQty = toNumber(qty);
  if (!productId || !storeId || requiredQty <= 0) return [];

  const mode = String(strategy || 'FEFO').toUpperCase() === 'FIFO' ? 'FIFO' : 'FEFO';
  const expiryGuard = allowExpired ? '' : 'AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)';
  const preferredId = Number(preferredBatchId);
  const hasPreferredBatch = Number.isFinite(preferredId) && preferredId > 0;
  const allowedIds = (Array.isArray(allowedBatchIds) ? allowedBatchIds : [])
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0);
  const hasAllowedBatches = !hasPreferredBatch && allowedIds.length > 0;
  const batchGuard = hasPreferredBatch
    ? 'AND id = $3'
    : hasAllowedBatches
      ? 'AND id = ANY($3::bigint[])'
      : '';
  const orderBy = mode === 'FIFO'
    ? 'created_at ASC, id ASC'
    : 'CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END ASC, expiry_date ASC, created_at ASC, id ASC';

  const params = hasPreferredBatch
    ? [Number(productId), Number(storeId), preferredId]
    : hasAllowedBatches
      ? [Number(productId), Number(storeId), allowedIds]
      : [Number(productId), Number(storeId)];

  const batchRes = await client.query(
    `SELECT id, product_id, store_id, batch_no, mfg_date, expiry_date, available_qty, cost_price, meta
     FROM inventory_batches
     WHERE product_id = $1
       AND store_id = $2
       AND status = 'active'
       AND available_qty > 0
       ${expiryGuard}
       ${batchGuard}
     ORDER BY ${orderBy}
     FOR UPDATE`,
    params
  );

  let remaining = requiredQty;
  const allocations = [];

  for (const batch of batchRes.rows) {
    if (remaining <= 0) break;
    const available = toNumber(batch.available_qty);
    const usedQty = Math.min(available, remaining);
    if (usedQty <= 0) continue;

    await client.query(
      `UPDATE inventory_batches
       SET available_qty = available_qty - $1,
           status = CASE WHEN available_qty - $1 <= 0 THEN 'depleted' ELSE status END,
           updated_at = NOW()
       WHERE id = $2`,
      [usedQty, batch.id]
    );

    await client.query(
      `INSERT INTO inventory_batch_movements (
         batch_id, product_id, store_id, direction, qty, reference_type, reference_id, source_item_id, meta
       ) VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8::jsonb)`,
      [
        batch.id,
        Number(productId),
        Number(storeId),
        usedQty,
        referenceType,
        referenceId ? String(referenceId) : null,
        sourceItemId,
        JSON.stringify({ ...meta, strategy: mode }),
      ]
    );

    allocations.push({
      batchId: Number(batch.id),
      batchNo: batch.batch_no,
      mfgDate: normalizeDate(batch.mfg_date),
      expiryDate: normalizeDate(batch.expiry_date),
      qty: usedQty,
      costPrice: toNumber(batch.cost_price),
      mrp: toNumber(batch.meta?.mrp),
      sellingPrice: toNumber(batch.meta?.sellingPrice),
      strategy: mode,
    });
    remaining = Math.round((remaining - usedQty) * 1000) / 1000;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient batch stock for product ${productId}. Short by ${remaining}`);
  }

  return allocations;
}

export function getInventoryIssueStrategy(value) {
  const normalized = String(value || process.env.INVENTORY_ISSUE_STRATEGY || 'FEFO').toUpperCase();
  return normalized === 'FIFO' ? 'FIFO' : 'FEFO';
}
