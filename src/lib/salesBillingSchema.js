import { query } from '@/lib/db';
import { ensureUsersTable } from '@/lib/userAuth';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { ensureUserCounterSessionSchema } from '@/lib/userCounterSessionSchema';

const CREATE_SALES_BILLS_SQL = `
  CREATE TABLE IF NOT EXISTS sales_bills (
    id BIGSERIAL PRIMARY KEY,
    bill_number VARCHAR(60) NOT NULL UNIQUE,
    session_id VARCHAR(120),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
    counter_id BIGINT,
    customer_name VARCHAR(190),
    customer_mobile VARCHAR(40),
    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
    discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    round_off NUMERIC(14, 2) NOT NULL DEFAULT 0,
    grand_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    balance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    payment_mode VARCHAR(40) NOT NULL DEFAULT 'cash',
    payment_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'paid',
    remarks TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const CREATE_SALES_BILL_ITEMS_SQL = `
  CREATE TABLE IF NOT EXISTS sales_bill_items (
    id BIGSERIAL PRIMARY KEY,
    sales_bill_id BIGINT NOT NULL REFERENCES sales_bills(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    barcode VARCHAR(120),
    sku VARCHAR(120),
    qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
    mrp NUMERIC(14, 2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tax_name VARCHAR(120),
    tax_type VARCHAR(30),
    include_tax BOOLEAN NOT NULL DEFAULT FALSE,
    taxable_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const CREATE_SALES_BILL_PAYMENTS_SQL = `
  CREATE TABLE IF NOT EXISTS sales_bill_payments (
    id BIGSERIAL PRIMARY KEY,
    sales_bill_id BIGINT NOT NULL REFERENCES sales_bills(id) ON DELETE CASCADE,
    method VARCHAR(40) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    reference_no VARCHAR(120),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const CREATE_CASHIER_CLOSINGS_SQL = `
  CREATE TABLE IF NOT EXISTS cashier_closings (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(120) NOT NULL UNIQUE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
    opening_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    actual_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    counted_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    handover_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    manager_received_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    variance NUMERIC(14, 2) NOT NULL DEFAULT 0,
    handover_status VARCHAR(40) NOT NULL DEFAULT 'pending_handover',
    handed_over_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    handed_over_at TIMESTAMPTZ,
    verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    denominations JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_breakup JSONB NOT NULL DEFAULT '{}'::jsonb,
    remarks TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const CREATE_POS_HELD_BILLS_SQL = `
  CREATE TABLE IF NOT EXISTS pos_held_bills (
    id BIGSERIAL PRIMARY KEY,
    client_hold_id VARCHAR(120) UNIQUE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    store_id BIGINT REFERENCES stores(id) ON DELETE CASCADE,
    session_id VARCHAR(120),
    customer_name VARCHAR(190),
    customer_mobile VARCHAR(40),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    totals JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'held',
    held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pos_held_bills_store_status
    ON pos_held_bills(store_id, status, held_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pos_held_bills_customer_mobile
    ON pos_held_bills(customer_mobile)
    WHERE customer_mobile IS NOT NULL;
`;

const MIGRATE_SALES_BILLING_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  ALTER TABLE sales_bills
    ADD COLUMN IF NOT EXISTS bill_number VARCHAR(60),
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS counter_id BIGINT,
    ADD COLUMN IF NOT EXISTS customer_name VARCHAR(190),
    ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(40),
    ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS round_off NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS grand_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(40) NOT NULL DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS payment_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'paid',
    ADD COLUMN IF NOT EXISTS remarks TEXT,
    ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS sync_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS device_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS created_offline BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  UPDATE sales_bills
  SET bill_number = COALESCE(bill_number, 'BILL-' || id::text)
  WHERE bill_number IS NULL;

  UPDATE sales_bills
  SET public_token = gen_random_uuid()
  WHERE public_token IS NULL;

  ALTER TABLE sales_bills
    ALTER COLUMN public_token SET DEFAULT gen_random_uuid();

  CREATE UNIQUE INDEX IF NOT EXISTS sales_bills_bill_number_unique_idx
    ON sales_bills (bill_number);
  CREATE UNIQUE INDEX IF NOT EXISTS sales_bills_sync_id_unique_idx
    ON sales_bills (sync_id)
    WHERE sync_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS sales_bills_public_token_unique_idx
    ON sales_bills (public_token)
    WHERE public_token IS NOT NULL;

  ALTER TABLE sales_bill_items
    ADD COLUMN IF NOT EXISTS product_name VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS barcode VARCHAR(120),
    ADD COLUMN IF NOT EXISTS sku VARCHAR(120),
    ADD COLUMN IF NOT EXISTS qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS mrp NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS tax_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS include_tax BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS batch_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  ALTER TABLE sales_bill_payments
    ADD COLUMN IF NOT EXISTS method VARCHAR(40) NOT NULL DEFAULT 'cash',
    ADD COLUMN IF NOT EXISTS amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reference_no VARCHAR(120),
    ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  ALTER TABLE cashier_closings
    ADD COLUMN IF NOT EXISTS counted_cash NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS handover_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manager_received_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS handover_status VARCHAR(40) NOT NULL DEFAULT 'pending_handover',
    ADD COLUMN IF NOT EXISTS handed_over_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS denominations JSONB NOT NULL DEFAULT '{}'::jsonb;

  UPDATE cashier_closings
  SET counted_cash = actual_cash
  WHERE counted_cash = 0 AND actual_cash <> 0;

  UPDATE cashier_closings
  SET handover_amount = actual_cash
  WHERE handover_amount = 0 AND actual_cash <> 0;

  CREATE INDEX IF NOT EXISTS idx_cashier_closings_store_handover_status
    ON cashier_closings(store_id, handover_status);

  ALTER TABLE pos_held_bills
    ADD COLUMN IF NOT EXISTS client_hold_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES stores(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS customer_name VARCHAR(190),
    ADD COLUMN IF NOT EXISTS customer_mobile VARCHAR(40),
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS totals JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'held',
    ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  CREATE UNIQUE INDEX IF NOT EXISTS pos_held_bills_client_hold_id_unique_idx
    ON pos_held_bills(client_hold_id)
    WHERE client_hold_id IS NOT NULL;
`;

const CREATE_OFFLINE_SYNC_SQL = `
  CREATE TABLE IF NOT EXISTS offline_sync_queue (
    id BIGSERIAL PRIMARY KEY,
    sync_id VARCHAR(120) NOT NULL UNIQUE,
    device_id VARCHAR(120),
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    entity_type VARCHAR(60) NOT NULL DEFAULT 'bill',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_offline_at TIMESTAMPTZ,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS sync_conflicts (
    id BIGSERIAL PRIMARY KEY,
    sync_id VARCHAR(120),
    conflict_type VARCHAR(80) NOT NULL,
    resolution VARCHAR(80) NOT NULL DEFAULT 'pending',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_offline_sync_queue_status
    ON offline_sync_queue(status);
  CREATE INDEX IF NOT EXISTS idx_sync_conflicts_sync_id
    ON sync_conflicts(sync_id);
`;

const globalForSalesBilling = globalThis;

export async function ensureSalesBillingSchema() {
  if (!globalForSalesBilling._salesBillingSchemaReadyPromise) {
    globalForSalesBilling._salesBillingSchemaReadyPromise = (async () => {
      await ensureUsersTable();
      await ensureUserCounterSessionSchema();
      await ensureStockOutSchema();
      await query(CREATE_SALES_BILLS_SQL);
      await query(CREATE_SALES_BILL_ITEMS_SQL);
      await query(CREATE_SALES_BILL_PAYMENTS_SQL);
      await query(CREATE_CASHIER_CLOSINGS_SQL);
      await query(CREATE_POS_HELD_BILLS_SQL);
      await query(MIGRATE_SALES_BILLING_SQL);
      await query(CREATE_OFFLINE_SYNC_SQL);
    })().catch((err) => {
      globalForSalesBilling._salesBillingSchemaReadyPromise = null;
      throw err;
    });
  }

  await globalForSalesBilling._salesBillingSchemaReadyPromise;
}
