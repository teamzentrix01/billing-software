import { query } from '@/lib/db';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';

const CREATE_STORE_CASH_SQL = `
  CREATE TABLE IF NOT EXISTS store_cash_balances (
    store_id BIGINT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
    current_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    last_closing_id BIGINT REFERENCES cashier_closings(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS store_cash_transactions (
    id BIGSERIAL PRIMARY KEY,
    store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    transaction_type VARCHAR(40) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    balance_after NUMERIC(14, 2) NOT NULL DEFAULT 0,
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_type VARCHAR(80),
    reference_id VARCHAR(120),
    remarks TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE INDEX IF NOT EXISTS idx_store_cash_transactions_store_date
    ON store_cash_transactions(store_id, transaction_date DESC, id DESC);

  CREATE INDEX IF NOT EXISTS idx_store_cash_transactions_type
    ON store_cash_transactions(transaction_type);
`;

const globalForStoreCash = globalThis;

export async function ensureStoreCashSchema() {
  if (!globalForStoreCash._storeCashSchemaReadyPromise) {
    globalForStoreCash._storeCashSchemaReadyPromise = (async () => {
      await ensureSalesBillingSchema();
      await query(CREATE_STORE_CASH_SQL);
    })().catch((err) => {
      globalForStoreCash._storeCashSchemaReadyPromise = null;
      throw err;
    });
  }

  await globalForStoreCash._storeCashSchemaReadyPromise;
}

export async function ensureStoreCashBalance(client, storeId) {
  const normalizedStoreId = Number(storeId);
  if (!Number.isFinite(normalizedStoreId) || normalizedStoreId <= 0) {
    return { currentCash: 0, initialized: false };
  }

  const existing = await client.query(
    `SELECT current_cash
     FROM store_cash_balances
     WHERE store_id = $1
     FOR UPDATE`,
    [normalizedStoreId]
  );
  if (existing.rows[0]) {
    return {
      currentCash: Number(existing.rows[0].current_cash || 0),
      initialized: true,
    };
  }

  const latestClosing = await client.query(
    `SELECT id, expected_cash
     FROM cashier_closings
     WHERE store_id = $1
     ORDER BY closed_at DESC, id DESC
     LIMIT 1`,
    [normalizedStoreId]
  );
  const currentCash = Number(latestClosing.rows[0]?.expected_cash || 0);
  const lastClosingId = latestClosing.rows[0]?.id || null;

  await client.query(
    `INSERT INTO store_cash_balances (store_id, current_cash, last_closing_id, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (store_id) DO NOTHING`,
    [normalizedStoreId, currentCash, lastClosingId]
  );

  return { currentCash, initialized: false };
}

export async function getStoreCashBalanceSnapshot(storeId) {
  const normalizedStoreId = Number(storeId);
  if (!Number.isFinite(normalizedStoreId) || normalizedStoreId <= 0) {
    return { currentCash: 0, finalCash: 0, activeSessionCash: 0, pendingHandoverCash: 0 };
  }

  const balance = await query(
    `SELECT current_cash
     FROM store_cash_balances
     WHERE store_id = $1`,
    [normalizedStoreId]
  );

  let fallbackCash = 0;
  if (!balance.rows[0]) {
    const latestClosing = await query(
      `SELECT expected_cash
       FROM cashier_closings
       WHERE store_id = $1
       ORDER BY closed_at DESC, id DESC
       LIMIT 1`,
      [normalizedStoreId]
    );
    fallbackCash = Number(latestClosing.rows[0]?.expected_cash || 0);
  }

  const finalCash = balance.rows[0]
    ? Number(balance.rows[0].current_cash || 0)
    : fallbackCash;

  const activeCash = await query(
    `SELECT COALESCE(SUM(session_cash.opening_cash + session_cash.cash_sales), 0) AS active_session_cash
     FROM (
       SELECT
         ucs.session_id,
         COALESCE((ucs.meta->>'opening_cash')::numeric, 0) AS opening_cash,
         COALESCE(SUM(CASE WHEN LOWER(COALESCE(sbp.method, '')) = 'cash' THEN sbp.amount ELSE 0 END), 0) AS cash_sales
       FROM user_counter_sessions ucs
       LEFT JOIN sales_bills sb
         ON sb.session_id = ucs.session_id
        AND sb.status IN ('paid', 'completed')
       LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
       WHERE ucs.store_id = $1
         AND ucs.is_active = TRUE
       GROUP BY ucs.session_id, ucs.meta
     ) session_cash`,
    [normalizedStoreId]
  );

  const pendingCash = await query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN COALESCE(handover_amount, 0) > 0 THEN handover_amount
         WHEN COALESCE(counted_cash, 0) > 0 THEN counted_cash
         ELSE actual_cash
       END
     ), 0) AS pending_handover_cash
     FROM cashier_closings
     WHERE store_id = $1
       AND COALESCE(handover_status, 'pending_handover') IN ('pending_handover', 'handed_over', 'variance_flagged')`,
    [normalizedStoreId]
  );

  const activeSessionCash = Number(activeCash.rows[0]?.active_session_cash || 0);
  const pendingHandoverCash = Number(pendingCash.rows[0]?.pending_handover_cash || 0);
  return {
    currentCash: Number((finalCash + activeSessionCash + pendingHandoverCash).toFixed(2)),
    finalCash,
    activeSessionCash,
    pendingHandoverCash,
  };
}
