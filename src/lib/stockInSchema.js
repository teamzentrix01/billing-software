import { query } from '@/lib/db';

// Bump this version when schema migrations change so hot-reload re-runs them
const SCHEMA_VERSION = 5;
let ensuredVersion = 0;

export async function ensureStockInSchema() {
  if (ensuredVersion === SCHEMA_VERSION) return;

  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_in (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(50) UNIQUE,
      method VARCHAR(50) DEFAULT 'new',
      destination_id INTEGER REFERENCES stores(id),
      apply_taxes BOOLEAN DEFAULT true,
      add_products_prefill BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'draft',
      vendor_id INTEGER,
      vendor_name VARCHAR(255),
      invoice_date DATE,
      invoice_number VARCHAR(100),
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

    CREATE TABLE IF NOT EXISTS stock_in_items (
      id SERIAL PRIMARY KEY,
      stock_in_id INTEGER NOT NULL REFERENCES stock_in(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(255),
      qty NUMERIC(14, 3) NOT NULL DEFAULT 1,
      cost_price NUMERIC(18, 9) DEFAULT 0,
      tax_value NUMERIC(14, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migration v2: add FK constraint linking stock_in_items → products catalog
  // Wrapped in DO block so it is idempotent — skipped if constraint already exists.
  // Any orphaned rows (product_id not in products) are logged and cleaned up first
  // so the constraint can always be applied cleanly.
  await query(`
    ALTER TABLE stock_in
      ADD COLUMN IF NOT EXISTS vendor_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_stock_in_vendor_id ON stock_in(vendor_id);
  `);

  await query(`
    ALTER TABLE stock_in_items
      ADD COLUMN IF NOT EXISTS mrp NUMERIC(18, 9) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(18, 9) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS serial_number VARCHAR(120),
      ADD COLUMN IF NOT EXISTS scan_code VARCHAR(255),
      ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await query(`
    ALTER TABLE stock_in_items
      ALTER COLUMN cost_price TYPE NUMERIC(18, 9) USING cost_price::numeric,
      ALTER COLUMN mrp TYPE NUMERIC(18, 9) USING mrp::numeric,
      ALTER COLUMN selling_price TYPE NUMERIC(18, 9) USING selling_price::numeric;

    DO $$
    BEGIN
      IF to_regclass('products') IS NOT NULL THEN
        ALTER TABLE products
          ALTER COLUMN cost_price TYPE NUMERIC(18, 9) USING cost_price::numeric,
          ALTER COLUMN mrp TYPE NUMERIC(18, 9) USING mrp::numeric,
          ALTER COLUMN selling_price TYPE NUMERIC(18, 9) USING selling_price::numeric;
      END IF;
    END
    $$;
  `);

  await query(`
    DO $$
    BEGIN
      -- Remove any orphaned items whose product_id no longer exists in the catalog
      DELETE FROM stock_in_items
      WHERE product_id NOT IN (SELECT id FROM products);

      -- Add FK only if it doesn't already exist
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_stock_in_items_product'
          AND conrelid = 'stock_in_items'::regclass
      ) THEN
        ALTER TABLE stock_in_items
          ADD CONSTRAINT fk_stock_in_items_product
          FOREIGN KEY (product_id)
          REFERENCES products(id)
          ON DELETE RESTRICT;
      END IF;
    END
    $$;
  `);

  ensuredVersion = SCHEMA_VERSION;
}
