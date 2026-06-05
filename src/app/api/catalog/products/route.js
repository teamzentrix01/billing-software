import { query, getClient } from '@/lib/db';
import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureStockOutSchema } from '@/lib/stockOutSchema';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureInventoryBatchSchema, receiveBatchStock } from '@/lib/inventoryBatching';
import { getAssignedStoreIds, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

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

async function validateBarcodeAvailability(client, { barcode, stockItemType, excludeId = null }) {
  const normalizedBarcode = String(barcode || '').trim();
  if (!normalizedBarcode) return null;

  const params = [normalizedBarcode];
  const excludeClause = excludeId ? `AND id <> $2` : '';
  if (excludeId) params.push(Number(excludeId));

  const duplicates = await client.query(
    `SELECT id, name, stock_item_type
     FROM products
     WHERE barcode = $1
       ${excludeClause}
     LIMIT 5`,
    params
  );
  if (!duplicates.rows.length) return null;

  const incomingType = normalizeStockItemType(stockItemType);
  const blocked = duplicates.rows.find((row) => normalizeStockItemType(row.stock_item_type) !== 'batched' || incomingType !== 'batched');
  if (blocked) {
    return `Barcode already used by "${blocked.name}". Duplicate barcodes are allowed only when both products are batched.`;
  }
  return null;
}

// ─── GET /api/catalog/products ───────────────────────────────
export async function GET(request) {
  try {
    await Promise.allSettled([
      ensureStockInSchema(),
      ensureStockOutSchema(),
      ensureSalesBillingSchema(),
      ensureInventoryBatchSchema(),
    ]);

    await ensureProductDiscountSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'VIEW_CATALOG', 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const search      = searchParams.get('search')   || '';
    const department_id = searchParams.get('department_id') || '';
    const category_id = searchParams.get('category_id') || '';
    const brand_id    = searchParams.get('brand_id')    || '';
    const is_active   = searchParams.get('is_active');
    const page        = parseInt(searchParams.get('page')     || '1');
    const pageSize    = parseInt(searchParams.get('pageSize') || '10');
    const offset      = (page - 1) * pageSize;
    const requestedStoreId = Number(searchParams.get('store_id') || 0) || null;

    const conditions = [];
    const params = [];
    let i = 1;
    let stockStoreFilter = '';

    if (requestedStoreId) {
      const storeCheck = requireStore(auth.user, requestedStoreId);
      if (storeCheck.error) return storeCheck.error;
      conditions.push(`EXISTS (SELECT 1 FROM product_saleability ps_scope WHERE ps_scope.product_id = p.id AND ps_scope.store_id = $${i} AND ps_scope.is_active = TRUE)`);
      params.push(requestedStoreId);
      stockStoreFilter = `AND store_id = $${i}`;
      i++;
    } else if (auth.user.role !== 'super_admin') {
      const assignedStores = getAssignedStoreIds(auth.user);
      if (!assignedStores.length) {
        conditions.push('1 = 0');
        stockStoreFilter = 'AND 1 = 0';
      } else {
        conditions.push(`EXISTS (SELECT 1 FROM product_saleability ps_scope WHERE ps_scope.product_id = p.id AND ps_scope.store_id = ANY($${i}::int[]) AND ps_scope.is_active = TRUE)`);
        params.push(assignedStores);
        stockStoreFilter = `AND store_id = ANY($${i}::int[])`;
        i++;
      }
    }

    if (search) {
      conditions.push(`(p.name ILIKE $${i} OR p.barcode ILIKE $${i} OR p.sku ILIKE $${i} OR p.product_id ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    if (category_id) {
      conditions.push(`p.category_id = $${i}`);
      params.push(category_id);
      i++;
    }
    if (department_id) {
      conditions.push(`p.department_id = $${i}`);
      params.push(department_id);
      i++;
    }
    if (brand_id) {
      conditions.push(`p.brand_id = $${i}`);
      params.push(brand_id);
      i++;
    }
    if (is_active !== null && is_active !== '') {
      conditions.push(`p.is_active = $${i}`);
      params.push(is_active === 'true');
      i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM products p ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT
        p.id, p.product_id, p.name, p.barcode, p.sku,
        p.mrp, p.selling_price, p.cost_price, p.unit,
        p.is_active, p.is_service, p.image_url, p.allow_discount_on_pos, p.include_tax,
        p.stock_item_type, p.inventory_method, p.hsn_code, p.charge_id,
        p.created_at, p.updated_at,
        c.name  AS category_name,
        sc.name AS sub_category_name,
        b.name  AS brand_name,
        m.name  AS manufacturer_name,
        d.name  AS department_name,
        ih.name AS income_head_name,
        t.name  AS tax_name,
        t.rate  AS tax_rate,
        COALESCE(batch_agg.qty, 0) AS actual_stock
       FROM products p
       LEFT JOIN categories     c   ON p.category_id     = c.id
       LEFT JOIN sub_categories sc  ON p.sub_category_id = sc.id
       LEFT JOIN brands         b   ON p.brand_id        = b.id
       LEFT JOIN manufacturers  m   ON p.manufacturer_id = m.id
       LEFT JOIN departments    d   ON p.department_id   = d.id
       LEFT JOIN income_heads   ih  ON p.income_head_id  = ih.id
       LEFT JOIN taxes          t   ON p.tax_id          = t.id
       LEFT JOIN (
         SELECT product_id, SUM(available_qty) AS qty
         FROM inventory_batches
         WHERE status = 'active'
           ${stockStoreFilter}
           AND available_qty > 0
           AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
         GROUP BY product_id
       ) batch_agg ON batch_agg.product_id = p.id
       ${where}
       ORDER BY p.id DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, pageSize, offset]
    );

    return successResponse({
      records: result.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── POST /api/catalog/products ──────────────────────────────
export async function POST(request) {
  try {
    await ensureStockInSchema();
    await ensureInventoryBatchSchema();
    await ensureProductDiscountSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const { name } = body;

    if (!name?.trim()) {
      return validationError({ name: 'Product name is required' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const barcodeError = await validateBarcodeAvailability(client, {
        barcode: body.barcode,
        stockItemType: body.stock_item_type,
      });
      if (barcodeError) {
        await client.query('ROLLBACK');
        return validationError({ barcode: barcodeError }, barcodeError);
      }

      const result = await client.query(
        `INSERT INTO products (
          product_id, name, description, barcode, sku,
          category_id, sub_category_id, brand_id, manufacturer_id,
          department_id, income_head_id, tax_id,
          mrp, selling_price, cost_price, unit,
          is_active, is_service, image_url, allow_discount_on_pos, include_tax,
          stock_item_type, inventory_method, hsn_code, charge_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14, $15, COALESCE($16, 'PCS'),
          COALESCE($17, true), COALESCE($18, false), $19, COALESCE($20, false), COALESCE($21, false),
          $22, $23, $24, $25
        ) RETURNING *`,
        [
          body.product_id || null,
          body.name.trim(),
          body.description || null,
          body.barcode || null,
          body.sku || null,
          body.category_id || null,
          body.sub_category_id || null,
          body.brand_id || null,
          body.manufacturer_id || null,
          body.department_id || null,
          body.income_head_id || null,
          body.tax_id || null,
          body.mrp || 0,
          body.selling_price || 0,
          body.cost_price || 0,
          normalizeUnit(body.unit),
          body.is_active ?? true,
          body.is_service ?? false,
          body.image_url || null,
          body.allow_discount_on_pos ?? false,
          body.include_tax ?? false,
          normalizeStockItemType(body.stock_item_type),
          body.inventory_method || 'direct',
          body.hsn_code || null,
          body.charge_id || null,
        ]
      );

      const createdProduct = result.rows[0];
      const openingStockQty = Number(body.opening_stock_qty || 0);
      const inventoryStoreId = body.inventory_store_id ? Number(body.inventory_store_id) : null;
      const manageInventoryEnabled = body.manage_inventory_enabled !== false;
      if (inventoryStoreId) {
        const storeCheck = requireStore(auth.user, inventoryStoreId);
        if (storeCheck.error) {
          await client.query('ROLLBACK');
          return storeCheck.error;
        }
      } else if (openingStockQty > 0 && auth.user.role !== 'super_admin') {
        await client.query('ROLLBACK');
        return errorResponse('Store is required for opening stock', 403);
      }

      if (manageInventoryEnabled && openingStockQty > 0) {
        const stockInInsert = await client.query(
          `INSERT INTO stock_in (
            method,
            destination_id,
            apply_taxes,
            add_products_prefill,
            status,
            vendor_name,
            invoice_date,
            invoice_number,
            other_charges,
            remarks,
            total_items,
            total_cost,
            total_tax,
            reference_type,
            reference_id,
            meta,
            created_at,
            confirmed_at
          ) VALUES (
            'new',
            $1,
            true,
            false,
            'confirmed',
            'Opening Stock',
            CURRENT_DATE,
            $2,
            0,
            'Opening stock from product creation',
            $3,
            $4,
            0,
            'product',
            $5,
            $6,
            NOW(),
            NOW()
          ) RETURNING id`,
          [
            inventoryStoreId,
            `OPEN-${createdProduct.id}`,
            openingStockQty,
            openingStockQty * Number(body.cost_price || 0),
            String(createdProduct.id),
            JSON.stringify({
              source: 'product-create',
              disable_billing_on_zero: !!body.disable_billing_on_zero,
              disable_sales_on_expiry: !!body.disable_sales_on_expiry,
              inventory_method: body.inventory_method || 'direct',
              stock_item_type: body.stock_item_type || 'unbatched',
              default_low_stock_value: Number(body.default_low_stock_value || 0),
              minimum_base_quantity: Number(body.minimum_base_quantity || body.mbq || 0),
            }),
          ]
        );

        const stockInId = stockInInsert.rows[0].id;
        await client.query('UPDATE stock_in SET transaction_id = $1 WHERE id = $2', [`STK-${String(stockInId).padStart(4, '0')}`, stockInId]);
        const stockInItemRes = await client.query(
          `INSERT INTO stock_in_items (stock_in_id, product_id, product_name, qty, cost_price, tax_value, created_at)
           VALUES ($1, $2, $3, $4, $5, 0, NOW())
           RETURNING id`,
          [stockInId, createdProduct.id, createdProduct.name, openingStockQty, Number(body.cost_price || 0)]
        );

        await receiveBatchStock(client, {
          stockInId,
          stockInItemId: stockInItemRes.rows[0]?.id,
          productId: createdProduct.id,
          storeId: inventoryStoreId,
          qty: openingStockQty,
          costPrice: Number(body.cost_price || 0),
          batchNo: body.batch_no || body.batchNo || `OPEN-${createdProduct.id}`,
          mfgDate: body.mfg_date || body.mfgDate || null,
          expiryDate: body.expiry_date || body.expiryDate || null,
          meta: { source: 'product-create', productName: createdProduct.name },
        });
      }

      await client.query('COMMIT');
      return successResponse(createdProduct, 'Product created successfully', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse('Product with this SKU already exists', 409);
    }
    return errorResponse(err.message);
  }
}
