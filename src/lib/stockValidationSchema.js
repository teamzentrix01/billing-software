import { query } from '@/lib/db';

let ensured = false;

export async function ensureStockValidationSchema() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_validation (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(50) UNIQUE,
      destination_id INTEGER REFERENCES stores(id),
      apply_taxes BOOLEAN DEFAULT true,
      status VARCHAR(20) DEFAULT 'draft',
      invoice_number VARCHAR(100),
      invoice_date DATE,
      other_charges NUMERIC(14, 2) DEFAULT 0,
      remarks TEXT,
      total_items NUMERIC(14, 3) DEFAULT 0,
      total_cost NUMERIC(14, 2) DEFAULT 0,
      total_tax NUMERIC(14, 2) DEFAULT 0,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS stock_validation_items (
      id SERIAL PRIMARY KEY,
      stock_validation_id INTEGER NOT NULL REFERENCES stock_validation(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(255),
      qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
      cost_price NUMERIC(14, 2) DEFAULT 0,
      tax_value NUMERIC(14, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_stock_validation_status ON stock_validation(status);
    CREATE INDEX IF NOT EXISTS idx_stock_validation_items_validation_id ON stock_validation_items(stock_validation_id);

    DO $$
    BEGIN
      IF to_regclass('inventory_batches') IS NOT NULL THEN
        ALTER TABLE stock_validation_items
          ADD COLUMN IF NOT EXISTS batch_id BIGINT REFERENCES inventory_batches(id) ON DELETE SET NULL;
      ELSE
        ALTER TABLE stock_validation_items
          ADD COLUMN IF NOT EXISTS batch_id BIGINT;
      END IF;
    END
    $$;
  `);
  ensured = true;
}
