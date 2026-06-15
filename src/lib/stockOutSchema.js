import { query } from '@/lib/db';

let ensured = false;

export async function ensureStockOutSchema() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_out (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(50) UNIQUE,
      method VARCHAR(50) DEFAULT 'stock_out',
      destination_id INTEGER REFERENCES stores(id),
      apply_taxes BOOLEAN DEFAULT true,
      add_products_prefill BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'draft',
      purchase_order_id VARCHAR(100),
      vendor_name VARCHAR(255),
      invoice_number VARCHAR(100),
      invoice_date DATE,
      other_charges NUMERIC(14, 2) DEFAULT 0,
      remarks TEXT,
      total_items NUMERIC(14, 3) DEFAULT 0,
      total_cost NUMERIC(14, 2) DEFAULT 0,
      total_tax NUMERIC(14, 2) DEFAULT 0,
      reference_type VARCHAR(50),
      reference_id VARCHAR(100),
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    );

    ALTER TABLE stock_out
      ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS other_charges NUMERIC(14, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reason VARCHAR(255),
      ADD COLUMN IF NOT EXISTS grn_id VARCHAR(100);

    CREATE TABLE IF NOT EXISTS stock_out_items (
      id SERIAL PRIMARY KEY,
      stock_out_id INTEGER NOT NULL REFERENCES stock_out(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(255),
      qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
      cost_price NUMERIC(14, 2) DEFAULT 0,
      tax_value NUMERIC(14, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE stock_out_items
      ADD COLUMN IF NOT EXISTS batch_id BIGINT,
      ADD COLUMN IF NOT EXISTS batch_no VARCHAR(120),
      ADD COLUMN IF NOT EXISTS expiry_date DATE;

    CREATE INDEX IF NOT EXISTS idx_stock_out_status ON stock_out(status);
    CREATE INDEX IF NOT EXISTS idx_stock_out_items_stock_out_id ON stock_out_items(stock_out_id);
  `);
  ensured = true;
}
