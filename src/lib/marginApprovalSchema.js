import { query } from '@/lib/db';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';

const globalForMarginApprovals = globalThis;
const SCHEMA_VERSION = 1;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function marginPercent(cost, sellingPrice) {
  const cp = toNumber(cost);
  const sp = toNumber(sellingPrice);
  if (sp <= 0) return 0;
  return Number((((sp - cp) / sp) * 100).toFixed(2));
}

export async function ensureMarginApprovalSchema() {
  if (globalForMarginApprovals._marginApprovalSchemaVersion === SCHEMA_VERSION) return;

  await ensureCatalogExtrasSchema();
  await query(`
    CREATE TABLE IF NOT EXISTS margin_approval_requests (
      id BIGSERIAL PRIMARY KEY,
      stock_in_id BIGINT REFERENCES stock_in(id) ON DELETE SET NULL,
      stock_in_item_id BIGINT REFERENCES stock_in_items(id) ON DELETE SET NULL,
      source_type VARCHAR(60) NOT NULL DEFAULT 'grn',
      source_reference VARCHAR(120),
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      rejected_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      current_cost_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      requested_cost_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      current_mrp NUMERIC(14, 2) NOT NULL DEFAULT 0,
      requested_mrp NUMERIC(14, 2) NOT NULL DEFAULT 0,
      current_selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      requested_selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
      current_margin_percent NUMERIC(8, 2) NOT NULL DEFAULT 0,
      requested_margin_percent NUMERIC(8, 2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      remarks TEXT,
      rejection_reason TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_margin_approval_status
      ON margin_approval_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_margin_approval_store
      ON margin_approval_requests(store_id, status);
    CREATE INDEX IF NOT EXISTS idx_margin_approval_product
      ON margin_approval_requests(product_id, store_id, status);
  `);

  globalForMarginApprovals._marginApprovalSchemaVersion = SCHEMA_VERSION;
}

export function hasPriceChange({
  currentCostPrice,
  requestedCostPrice,
  currentMrp,
  requestedMrp,
  currentSellingPrice,
  requestedSellingPrice,
}) {
  const diff = (a, b) => Math.abs(toNumber(a) - toNumber(b)) > 0.01;
  return (
    (toNumber(requestedCostPrice) > 0 && diff(currentCostPrice, requestedCostPrice)) ||
    (toNumber(requestedMrp) > 0 && diff(currentMrp, requestedMrp)) ||
    (toNumber(requestedSellingPrice) > 0 && diff(currentSellingPrice, requestedSellingPrice))
  );
}

export async function createMarginApprovalRequest(client, payload) {
  await ensureMarginApprovalSchema();

  const currentCostPrice = toNumber(payload.currentCostPrice);
  const requestedCostPrice = toNumber(payload.requestedCostPrice);
  const currentMrp = toNumber(payload.currentMrp);
  const requestedMrp = toNumber(payload.requestedMrp);
  const currentSellingPrice = toNumber(payload.currentSellingPrice);
  const requestedSellingPrice = toNumber(payload.requestedSellingPrice);

  if (!hasPriceChange({
    currentCostPrice,
    requestedCostPrice,
    currentMrp,
    requestedMrp,
    currentSellingPrice,
    requestedSellingPrice,
  })) {
    return null;
  }

  const existing = await client.query(
    `SELECT id
     FROM margin_approval_requests
     WHERE status = 'pending'
       AND product_id = $1
       AND store_id = $2
       AND requested_cost_price = $3
       AND requested_mrp = $4
       AND requested_selling_price = $5
     LIMIT 1`,
    [payload.productId, payload.storeId, requestedCostPrice, requestedMrp, requestedSellingPrice]
  );
  if (existing.rows[0]) return existing.rows[0];

  const res = await client.query(
    `INSERT INTO margin_approval_requests (
       stock_in_id, stock_in_item_id, source_type, source_reference,
       product_id, store_id, requested_by,
       current_cost_price, requested_cost_price,
       current_mrp, requested_mrp,
       current_selling_price, requested_selling_price,
       current_margin_percent, requested_margin_percent,
       remarks, meta, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, $9,
       $10, $11,
       $12, $13,
       $14, $15,
       $16, $17::jsonb, NOW(), NOW()
     )
     RETURNING id`,
    [
      payload.stockInId || null,
      payload.stockInItemId || null,
      payload.sourceType || 'grn',
      payload.sourceReference || null,
      payload.productId,
      payload.storeId,
      payload.requestedBy || null,
      currentCostPrice,
      requestedCostPrice,
      currentMrp,
      requestedMrp,
      currentSellingPrice,
      requestedSellingPrice,
      marginPercent(currentCostPrice, currentSellingPrice),
      marginPercent(requestedCostPrice, requestedSellingPrice),
      payload.remarks || null,
      JSON.stringify(payload.meta || {}),
    ]
  );

  return res.rows[0];
}

export async function applyApprovedMarginRequest(client, requestId, approverId) {
  await ensureMarginApprovalSchema();

  const reqRes = await client.query(
    `SELECT *
     FROM margin_approval_requests
     WHERE id = $1
     FOR UPDATE`,
    [requestId]
  );
  const row = reqRes.rows[0];
  if (!row) throw new Error('Approval request not found');
  if (String(row.status || '').toLowerCase() !== 'pending') {
    throw new Error('Only pending requests can be approved');
  }

  if (toNumber(row.requested_cost_price) > 0) {
    await client.query(
      `UPDATE products SET cost_price = $1, updated_at = NOW() WHERE id = $2`,
      [toNumber(row.requested_cost_price), row.product_id]
    );
  }

  await client.query(
    `INSERT INTO product_saleability (
       product_id, store_id, is_active, selling_price, mrp, low_stock_value, created_at, updated_at
     ) VALUES ($1, $2, true, $3, $4, 0, NOW(), NOW())
     ON CONFLICT (product_id, store_id)
     DO UPDATE SET
       is_active = true,
       selling_price = CASE WHEN EXCLUDED.selling_price > 0 THEN EXCLUDED.selling_price ELSE product_saleability.selling_price END,
       mrp = CASE WHEN EXCLUDED.mrp > 0 THEN EXCLUDED.mrp ELSE product_saleability.mrp END,
       updated_at = NOW()`,
    [
      row.product_id,
      row.store_id,
      toNumber(row.requested_selling_price),
      toNumber(row.requested_mrp),
    ]
  );

  await client.query(
    `UPDATE margin_approval_requests
     SET status = 'approved',
         approved_by = $2,
         approved_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [requestId, approverId || null]
  );

  return row;
}
