import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFoundError, validationError } from '@/lib/api-response';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

async function ensureProductDiscountSchema() {
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS allow_discount_on_pos BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS include_tax BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS stock_item_type VARCHAR(30) NOT NULL DEFAULT 'unbatched',
      ADD COLUMN IF NOT EXISTS inventory_method VARCHAR(30) NOT NULL DEFAULT 'direct',
      ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(80),
      ADD COLUMN IF NOT EXISTS charge_id BIGINT;
  `);
}

function normalizeUnit(value) {
  const unit = String(value || 'PCS').trim().toUpperCase();
  if (['G', 'GM', 'GRAM', 'GRAMS'].includes(unit)) return 'GRAMS';
  return ['PCS', 'KG', 'GRAMS', 'LTR'].includes(unit) ? unit : 'PCS';
}

function normalizeStockItemType(value) {
  return String(value || '').trim().toLowerCase() === 'batched' ? 'batched' : 'unbatched';
}

async function validateBarcodeAvailability({ barcode, stockItemType, excludeId }) {
  const normalizedBarcode = String(barcode || '').trim();
  if (!normalizedBarcode) return null;

  const duplicates = await query(
    `SELECT id, name, stock_item_type
     FROM products
     WHERE barcode = $1
       AND id <> $2
     LIMIT 5`,
    [normalizedBarcode, Number(excludeId)]
  );
  if (!duplicates.rows.length) return null;

  const incomingType = normalizeStockItemType(stockItemType);
  const blocked = duplicates.rows.find((row) => normalizeStockItemType(row.stock_item_type) !== 'batched' || incomingType !== 'batched');
  if (blocked) {
    return `Barcode already used by "${blocked.name}". Duplicate barcodes are allowed only when both products are batched.`;
  }
  return null;
}

const SELECT_PRODUCT = `
  SELECT
    p.id, p.product_id, p.name, p.description, p.barcode, p.sku,
    p.mrp, p.selling_price, p.cost_price, p.unit,
    p.is_active, p.is_service, p.image_url, p.allow_discount_on_pos, p.include_tax,
    p.stock_item_type, p.inventory_method, p.hsn_code, p.charge_id,
    p.category_id, p.sub_category_id, p.brand_id,
    p.manufacturer_id, p.department_id, p.income_head_id, p.tax_id,
    p.created_at, p.updated_at,
    c.name  AS category_name,
    sc.name AS sub_category_name,
    b.name  AS brand_name,
    m.name  AS manufacturer_name,
    d.name  AS department_name,
    ih.name AS income_head_name,
    t.name  AS tax_name,
    t.rate  AS tax_rate
  FROM products p
  LEFT JOIN categories     c  ON p.category_id     = c.id
  LEFT JOIN sub_categories sc ON p.sub_category_id = sc.id
  LEFT JOIN brands         b  ON p.brand_id        = b.id
  LEFT JOIN manufacturers  m  ON p.manufacturer_id = m.id
  LEFT JOIN departments    d  ON p.department_id   = d.id
  LEFT JOIN income_heads   ih ON p.income_head_id  = ih.id
  LEFT JOIN taxes          t  ON p.tax_id          = t.id
`;

// ─── GET /api/catalog/products/[id] ──────────────────────────
export async function GET(request, { params }) {
  try {
    await ensureProductDiscountSchema();
    const resolvedParams = await params;
    const productId = Number(resolvedParams?.id);
    if (!Number.isFinite(productId)) {
      return errorResponse('Invalid product id', 400);
    }

    const result = await query(
      `${SELECT_PRODUCT} WHERE p.id = $1`,
      [productId]
    );
    if (!result.rows.length) return notFoundError('Product not found');
    return successResponse(result.rows[0]);
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── PUT /api/catalog/products/[id] ──────────────────────────
export async function PUT(request, { params }) {
  try {
    await ensureProductDiscountSchema();
    const resolvedParams = await params;
    const productId = Number(resolvedParams?.id);
    if (!Number.isFinite(productId)) {
      return errorResponse('Invalid product id', 400);
    }

    const body = await request.json();

    if (!body.name?.trim()) {
      return validationError({ name: 'Product name is required' });
    }

    const barcodeError = await validateBarcodeAvailability({
      barcode: body.barcode,
      stockItemType: body.stock_item_type,
      excludeId: productId,
    });
    if (barcodeError) return validationError({ barcode: barcodeError }, barcodeError);

    const result = await query(
      `UPDATE products SET
        product_id      = $1,
        name            = $2,
        description     = $3,
        barcode         = $4,
        sku             = $5,
        category_id     = $6,
        sub_category_id = $7,
        brand_id        = $8,
        manufacturer_id = $9,
        department_id   = $10,
        income_head_id  = $11,
        tax_id          = $12,
        mrp             = $13,
        selling_price   = $14,
        cost_price      = $15,
        unit            = $16,
        is_active       = $17,
        is_service      = $18,
        image_url       = $19,
        allow_discount_on_pos = $20,
        include_tax     = $21,
        stock_item_type = $22,
        inventory_method = $23,
        hsn_code        = $24,
        charge_id       = $25,
        updated_at      = NOW()
       WHERE id = $26
       RETURNING *`,
      [
        body.product_id    || null,
        body.name.trim(),
        body.description   || null,
        body.barcode       || null,
        body.sku           || null,
        body.category_id   || null,
        body.sub_category_id || null,
        body.brand_id      || null,
        body.manufacturer_id || null,
        body.department_id || null,
        body.income_head_id || null,
        body.tax_id        || null,
        body.mrp           || 0,
        body.selling_price || 0,
        body.cost_price    || 0,
        normalizeUnit(body.unit),
        body.is_active     ?? true,
        body.is_service    ?? false,
        body.image_url     || null,
        body.allow_discount_on_pos ?? false,
        body.include_tax ?? false,
        normalizeStockItemType(body.stock_item_type),
        body.inventory_method || 'direct',
        body.hsn_code || null,
        body.charge_id || null,
        productId,
      ]
    );

    if (!result.rows.length) return notFoundError('Product not found');
    return successResponse(result.rows[0], 'Product updated successfully');
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse('Product with this SKU already exists', 409);
    }
    return errorResponse(err.message);
  }
}

// ─── DELETE /api/catalog/products/[id] ───────────────────────
export async function DELETE(request, { params }) {
  let client;
  try {
    await ensureProductDiscountSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const resolvedParams = await params;
    const productId = Number(resolvedParams?.id);
    if (!Number.isFinite(productId)) {
      return errorResponse('Invalid product id', 400);
    }

    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Product deleted from catalog');
    const result = await client.query(
      `DELETE FROM products WHERE id = $1 RETURNING id`,
      [productId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFoundError('Product not found');
    }
    await client.query('COMMIT');
    return successResponse({ id: productId }, 'Product deleted successfully');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
