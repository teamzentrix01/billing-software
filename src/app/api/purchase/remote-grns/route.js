import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { ensureInventoryBatchSchema } from '@/lib/inventoryBatching';
import { appendStoreScope, requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function mapItem(item) {
  return {
    id: item.id,
    productId: item.product_id ?? item.productId,
    productName: item.product_name ?? item.productName,
    qty: toNumber(item.qty),
    costPrice: toNumber(item.cost_price ?? item.costPrice),
    taxValue: toNumber(item.tax_value ?? item.taxValue),
    taxRate: toNumber(item.tax_rate ?? item.taxRate ?? item.meta?.taxRate),
    mrp: toNumber(item.mrp),
    sellingPrice: toNumber(item.selling_price ?? item.sellingPrice),
    batchNo: item.batch_no ?? item.batchNo ?? '',
    mfgDate: item.mfg_date ?? item.mfgDate ?? '',
    expiryDate: item.expiry_date ?? item.expiryDate ?? '',
    serialNumber: item.serial_number ?? item.serialNumber ?? '',
    scanCode: item.scan_code ?? item.scanCode ?? '',
    meta: item.meta || {},
  };
}

async function lookupProduct(scan, storeId) {
  const normalizedScan = String(scan || '').trim();
  if (!normalizedScan) return null;

  const params = [normalizedScan];
  let saleabilityJoin = '';
  if (storeId) {
    params.push(Number(storeId));
    saleabilityJoin = 'LEFT JOIN product_saleability ps ON ps.product_id = p.id AND ps.store_id = $2';
  } else {
    saleabilityJoin = 'LEFT JOIN product_saleability ps ON false';
  }

  const productRes = await query(
    `SELECT
       p.id,
       p.product_id,
       p.name,
       p.barcode,
       p.sku,
       p.unit,
       p.stock_item_type,
       COALESCE(p.cost_price, 0) AS cost_price,
       COALESCE(NULLIF(ps.mrp, 0), p.mrp, 0) AS mrp,
       COALESCE(NULLIF(ps.selling_price, 0), p.selling_price, 0) AS selling_price,
       COALESCE(t.rate, 0) AS tax_rate,
       c.name AS category_name,
       b.name AS brand_name
     FROM products p
     ${saleabilityJoin}
     LEFT JOIN taxes t ON t.id = p.tax_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE COALESCE(p.is_active, TRUE) = TRUE
       AND (
         p.barcode = $1
         OR p.sku = $1
         OR p.product_id::text = $1
         OR p.id::text = $1
       )
     ORDER BY
       CASE WHEN p.barcode = $1 THEN 0 WHEN p.sku = $1 THEN 1 ELSE 2 END,
       p.id
     LIMIT 1`,
    params
  );

  const row = productRes.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    productId: row.product_id || row.id,
    name: row.name || '',
    barcode: row.barcode || '',
    sku: row.sku || '',
    unit: row.unit || 'Piece',
    stockItemType: row.stock_item_type || '',
    category: row.category_name || '',
    brand: row.brand_name || '',
    costPrice: toNumber(row.cost_price),
    mrp: toNumber(row.mrp),
    sellingPrice: toNumber(row.selling_price),
    taxValue: toNumber(row.tax_rate),
    taxRate: toNumber(row.tax_rate),
  };
}

export async function GET(request) {
  try {
    await ensureStockInSchema();
    await ensureCatalogExtrasSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const scan = searchParams.get('scan');
    const id = Number(searchParams.get('id') || 0) || null;
    const storeId = Number(searchParams.get('store_id') || 0) || null;

    if (scan != null) {
      if (storeId) {
        const storeCheck = requireStore(auth.user, storeId);
        if (storeCheck.error) return storeCheck.error;
      }
      const product = await lookupProduct(scan, storeId);
      if (!product) return NextResponse.json({ error: 'Product not found in master' }, { status: 404 });
      return NextResponse.json({ product });
    }

    if (id) {
      const res = await query(
        `SELECT s.*, st.name AS destination_name
         FROM stock_in s
         LEFT JOIN stores st ON st.id = s.destination_id
         WHERE s.id = $1 AND s.reference_type = 'remote_grn'
         LIMIT 1`,
        [id]
      );
      const row = res.rows[0];
      if (!row) return NextResponse.json({ error: 'Remote GRN not found' }, { status: 404 });
      const storeCheck = requireStore(auth.user, row.destination_id);
      if (storeCheck.error) return storeCheck.error;

      const itemsRes = await query(
        `SELECT
           sii.id,
           sii.product_id,
           COALESCE(sii.product_name, p.name) AS product_name,
           p.sku,
           p.barcode,
           sii.qty,
           sii.cost_price,
           sii.tax_value,
           sii.batch_no,
           sii.mfg_date,
           sii.expiry_date,
           sii.mrp,
           sii.selling_price,
           sii.serial_number,
           sii.scan_code,
           sii.meta
         FROM stock_in_items sii
         LEFT JOIN products p ON p.id = sii.product_id
         WHERE sii.stock_in_id = $1
         ORDER BY sii.id`,
        [id]
      );

      return NextResponse.json({
        id: row.id,
        transactionId: row.transaction_id,
        destinationId: row.destination_id,
        destinationName: row.destination_name || '',
        vendorName: row.vendor_name || '',
        invoiceNumber: row.invoice_number || '',
        invoiceDate: normalizeDate(row.invoice_date) || '',
        otherCharges: toNumber(row.other_charges),
        remarks: row.remarks || '',
        status: row.status || 'draft',
        items: itemsRes.rows.map((item) => ({
          ...mapItem(item),
          sku: item.sku || '',
          barcode: item.barcode || '',
        })),
      });
    }

    const params = [];
    const where = [`s.reference_type = 'remote_grn'`];
    const scope = appendStoreScope(where, params, 's.destination_id', auth.user);
    if (scope.error) return scope.error;

    const res = await query(
      `SELECT
         s.id,
         s.transaction_id,
         s.invoice_number,
         s.invoice_date,
         s.vendor_name,
         s.status,
         s.total_items,
         s.total_cost,
         s.total_tax,
         s.created_at,
         s.confirmed_at,
         st.name AS destination_name,
         COALESCE(SUM(si.qty), 0) AS item_qty_sum,
         COALESCE(SUM(si.qty * si.cost_price), 0) AS items_cost_sum
       FROM stock_in s
       LEFT JOIN stores st ON st.id = s.destination_id
       LEFT JOIN stock_in_items si ON si.stock_in_id = s.id
       WHERE ${where.join(' AND ')}
       GROUP BY s.id, st.name
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params
    );

    return NextResponse.json({
      records: res.rows.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        invoiceNumber: row.invoice_number || '',
        invoiceDate: row.invoice_date,
        vendorName: row.vendor_name || '',
        destination: row.destination_name || '',
        status: row.status || 'draft',
        totalItems: toNumber(row.total_items || row.item_qty_sum),
        totalCost: toNumber(row.total_cost || row.items_cost_sum),
        totalTax: toNumber(row.total_tax),
        createdAt: row.created_at,
        confirmedAt: row.confirmed_at,
      })),
    });
  } catch (err) {
    console.error('[remote-grns GET]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to load remote GRNs' }, { status: 500 });
  }
}

export async function PUT(request) {
  let client;
  try {
    await ensureStockInSchema();
    await ensureCatalogExtrasSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const id = Number(body.id || body.remoteGrnId || 0) || null;
    if (!id) return NextResponse.json({ error: 'Remote GRN id is required' }, { status: 400 });

    const destinationId = Number(body.destinationId || body.destination || body.storeId || 0) || null;
    if (!destinationId) return NextResponse.json({ error: 'Store is required' }, { status: 400 });
    const storeCheck = requireStore(auth.user, destinationId);
    if (storeCheck.error) return storeCheck.error;

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: 'Add at least one product' }, { status: 400 });

    const productIds = [...new Set(items.map((item) => Number(item.product_id || item.productId)).filter(Boolean))];
    const productsRes = await query('SELECT id, name FROM products WHERE id = ANY($1::int[])', [productIds]);
    const productMap = new Map(productsRes.rows.map((row) => [Number(row.id), row]));

    let totalItems = 0;
    let totalCost = toNumber(body.otherCharges || body.other_charges);
    let totalTax = 0;
    const normalizedItems = items.map((item) => {
      const productId = Number(item.product_id || item.productId);
      const qty = toNumber(item.qty);
      const costPrice = toNumber(item.cost_price ?? item.costPrice);
      const taxRate = toNumber(item.tax_rate ?? item.taxRate);
      const explicitTaxValue = item.tax_value ?? item.taxValue;
      const taxValue = explicitTaxValue == null ? (qty * costPrice * taxRate) / 100 : toNumber(explicitTaxValue);
      if (!productId || qty <= 0) throw new Error('Every item needs product and quantity greater than zero');
      totalItems += qty;
      totalCost += qty * costPrice;
      totalTax += taxValue;
      return {
        productId,
        productName: productMap.get(productId)?.name || item.product_name || item.productName || 'Product',
        qty,
        costPrice,
        taxValue,
        taxRate,
        mrp: toNumber(item.mrp),
        sellingPrice: toNumber(item.selling_price ?? item.sellingPrice),
        batchNo: String(item.batch_no || item.batchNo || '').trim(),
        expiryDate: normalizeDate(item.expiry_date || item.expiryDate),
        serialNumber: String(item.serial_number || item.serialNumber || '').trim(),
        scanCode: String(item.scan_code || item.scanCode || '').trim(),
      };
    });

    client = await getClient();
    await client.query('BEGIN');
    const existingRes = await client.query(
      `SELECT id, status, destination_id
       FROM stock_in
       WHERE id = $1 AND reference_type = 'remote_grn'
       FOR UPDATE`,
      [id]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Remote GRN not found' }, { status: 404 });
    }
    if (String(existing.status || '').toLowerCase() === 'confirmed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Confirmed Remote GRN cannot be edited' }, { status: 409 });
    }

    await client.query(
      `UPDATE stock_in
       SET destination_id = $2,
           vendor_name = $3,
           invoice_number = $4,
           invoice_date = $5,
           other_charges = $6,
           total_items = $7,
           total_cost = $8,
           total_tax = $9,
           remarks = $10,
           meta = COALESCE(meta, '{}'::jsonb) || $11::jsonb
       WHERE id = $1`,
      [
        id,
        destinationId,
        body.vendorName || null,
        body.invoiceNumber || null,
        normalizeDate(body.invoiceDate),
        toNumber(body.otherCharges || body.other_charges),
        totalItems,
        totalCost,
        totalTax,
        body.remarks || null,
        JSON.stringify({ updatedFrom: 'remote_grn_page', updatedBy: auth.user?.id || null }),
      ]
    );

    await client.query('DELETE FROM stock_in_items WHERE stock_in_id = $1', [id]);
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO stock_in_items (
           stock_in_id, product_id, product_name, qty, cost_price, tax_value,
           batch_no, expiry_date, mrp, selling_price, serial_number, scan_code, meta, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NOW())`,
        [
          id,
          item.productId,
          item.productName,
          item.qty,
          item.costPrice,
          item.taxValue,
          item.batchNo || null,
          item.expiryDate || null,
          item.mrp,
          item.sellingPrice,
          item.serialNumber || null,
          item.scanCode || null,
          JSON.stringify({
            source: 'remote_grn',
            scanCode: item.scanCode,
            serialNumber: item.serialNumber,
            taxRate: item.taxRate,
          }),
        ]
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ id, totalItems, totalCost, totalTax });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[remote-grns PUT]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update Remote GRN' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}

export async function POST(request) {
  let client;
  try {
    await ensureStockInSchema();
    await ensureCatalogExtrasSchema();
    await ensureInventoryBatchSchema();

    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const destinationId = Number(body.destinationId || body.destination || body.storeId || 0) || null;
    if (!destinationId) return NextResponse.json({ error: 'Store is required' }, { status: 400 });
    const storeCheck = requireStore(auth.user, destinationId);
    if (storeCheck.error) return storeCheck.error;

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: 'Add at least one product' }, { status: 400 });

    const productIds = [...new Set(items.map((item) => Number(item.product_id || item.productId)).filter(Boolean))];
    const productsRes = await query('SELECT id, name FROM products WHERE id = ANY($1::int[])', [productIds]);
    const productMap = new Map(productsRes.rows.map((row) => [Number(row.id), row]));
    const missing = productIds.filter((id) => !productMap.has(id));
    if (missing.length) {
      return NextResponse.json({ error: `Products not found in master: ${missing.join(', ')}` }, { status: 422 });
    }

    let totalItems = 0;
    let totalCost = toNumber(body.otherCharges || body.other_charges);
    let totalTax = 0;

    const normalizedItems = items.map((item) => {
      const productId = Number(item.product_id || item.productId);
      const qty = toNumber(item.qty);
      const costPrice = toNumber(item.cost_price ?? item.costPrice);
      const taxRate = toNumber(item.tax_rate ?? item.taxRate);
      const explicitTaxValue = item.tax_value ?? item.taxValue;
      const taxValue = explicitTaxValue == null ? (qty * costPrice * taxRate) / 100 : toNumber(explicitTaxValue);
      const mrp = toNumber(item.mrp);
      const sellingPrice = toNumber(item.selling_price ?? item.sellingPrice);
      if (!productId || qty <= 0) throw new Error('Every item needs product and quantity greater than zero');
      if (costPrice < 0 || mrp < 0 || sellingPrice < 0) throw new Error('MRP, CP and SP cannot be negative');
      totalItems += qty;
      totalCost += qty * costPrice;
      totalTax += taxValue;
      return {
        productId,
        productName: productMap.get(productId)?.name || item.product_name || item.productName || 'Product',
        qty,
        costPrice,
        taxValue,
        taxRate,
        mrp,
        sellingPrice,
        batchNo: String(item.batch_no || item.batchNo || '').trim(),
        mfgDate: normalizeDate(item.mfg_date || item.mfgDate),
        expiryDate: normalizeDate(item.expiry_date || item.expiryDate),
        serialNumber: String(item.serial_number || item.serialNumber || '').trim(),
        scanCode: String(item.scan_code || item.scanCode || '').trim(),
      };
    });

    client = await getClient();
    await client.query('BEGIN');

    const stockInRes = await client.query(
      `INSERT INTO stock_in (
         method, destination_id, apply_taxes, add_products_prefill, status,
         vendor_id, vendor_name, invoice_number, invoice_date, other_charges,
         total_items, total_cost, total_tax, reference_type, reference_id,
         remarks, meta, created_at
       ) VALUES (
         'remote_grn', $1, true, false, 'draft',
         $2, $3, $4, $5, $6,
         $7, $8, $9, 'remote_grn', NULL,
         $10, $11::jsonb, NOW()
       )
       RETURNING id`,
      [
        destinationId,
        body.vendorId || null,
        body.vendorName || null,
        body.invoiceNumber || null,
        normalizeDate(body.invoiceDate),
        toNumber(body.otherCharges || body.other_charges),
        totalItems,
        totalCost,
        totalTax,
        body.remarks || null,
        JSON.stringify({
          source: 'remote_grn',
          createdFrom: 'barcode_scan',
          createdBy: auth.user?.id || null,
          clientMeta: body.meta || {},
        }),
      ]
    );

    const id = stockInRes.rows[0].id;
    const transactionId = `RGRN-${String(id).padStart(4, '0')}`;
    await client.query('UPDATE stock_in SET transaction_id = $1, reference_id = $1 WHERE id = $2', [transactionId, id]);

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO stock_in_items (
           stock_in_id, product_id, product_name, qty, cost_price, tax_value,
           batch_no, mfg_date, expiry_date, mrp, selling_price, serial_number,
           scan_code, meta, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14::jsonb, NOW()
         )`,
        [
          id,
          item.productId,
          item.productName,
          item.qty,
          item.costPrice,
          item.taxValue,
          item.batchNo || null,
          item.mfgDate || null,
          item.expiryDate || null,
          item.mrp,
          item.sellingPrice,
          item.serialNumber || null,
          item.scanCode || null,
          JSON.stringify({
            source: 'remote_grn',
            scanCode: item.scanCode,
            serialNumber: item.serialNumber,
            taxRate: item.taxRate,
          }),
        ]
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({
      id,
      transactionId,
      totalItems,
      totalCost,
      totalTax,
      items: normalizedItems.map(mapItem),
    }, { status: 201 });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[remote-grns POST]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to save Remote GRN' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
