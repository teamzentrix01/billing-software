import { query } from '@/lib/db';

let ensured = false;

export async function ensureStockTransferSchema() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_transfer (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(50) UNIQUE,
      source_id INTEGER REFERENCES stores(id),
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
      confirmed_at TIMESTAMPTZ,
      reverted_at TIMESTAMPTZ,
      reverted_by INTEGER
    );

    ALTER TABLE stock_transfer
      ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reverted_by INTEGER;

    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id SERIAL PRIMARY KEY,
      stock_transfer_id INTEGER NOT NULL REFERENCES stock_transfer(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(255),
      sku VARCHAR(120),
      barcode VARCHAR(120),
      qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
      cost_price NUMERIC(14, 2) DEFAULT 0,
      mrp NUMERIC(18, 9) DEFAULT 0,
      selling_price NUMERIC(18, 9) DEFAULT 0,
      destination_mrp NUMERIC(18, 9) DEFAULT 0,
      tax_value NUMERIC(14, 2) DEFAULT 0,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE stock_transfer_items
      ADD COLUMN IF NOT EXISTS sku VARCHAR(120),
      ADD COLUMN IF NOT EXISTS barcode VARCHAR(120),
      ADD COLUMN IF NOT EXISTS mrp NUMERIC(18, 9) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(18, 9) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS destination_mrp NUMERIC(18, 9) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_stock_transfer_status ON stock_transfer(status);
    CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id ON stock_transfer_items(stock_transfer_id);
  `);
  ensured = true;
}
