import { getClient, query } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ensureCatalogExtrasSchema } from "@/lib/catalogExtrasSchema";
import { ensureStockInSchema } from "@/lib/stockInSchema";
import {
  requireAuth,
  requirePermission,
  requireStore,
} from "@/lib/api-protection";

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

const PRODUCT_TAX_COLUMNS = [
  "1-CGST-2.5%",
  "2-SGST-2.5%",
  "3-IGST-5%",
  "4-CGST-6%",
  "5-SGST-6%",
  "6-IGST-12%",
  "7-CGST-9%",
  "8-SGST-9%",
  "9-IGST-18%",
  "10-CGST-14%",
  "11-SGST-14%",
  "12-IGST-28%",
  "13-CGST-20%",
  "14-SGST-20%",
  "15-IGST-40%",
];

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImportKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseProductTaxHeader(header) {
  const match = String(header || "").match(/^\d+-(CGST|SGST|IGST)-([\d.]+)%$/i);
  if (!match) return null;
  return {
    label: `${match[1].toUpperCase()}-${match[2]}%`,
    type: match[1].toUpperCase(),
    rate: Number(match[2]),
  };
}

function normalizeProductImportRow(row = {}) {
  const aliases = {
    product_name: "name",
    product_code: "product_id",
    existing_product_id: "product_id",
    brand: "brand_name",
    category: "category_name",
    sub_category: "sub_category_name",
    sub_catalogy: "sub_category_name",
    sub_category_name: "sub_category_name",
    income_head: "income_head_name",
    price_includes_tax: "include_tax",
    gst_included: "include_tax",
    manage_inventory: "manage_inventory_enabled",
    stock_item_type: "stock_item_type",
    is_sellable_on_pos: "is_sellable_on_pos",
    is_sellable_on: "is_sellable_on_pos",
    allow_variable_pricing: "allow_variable_pricing",
    allow_discount_on_pos: "allow_discount_on_pos",
    hsn_sac_code: "hsn_code",
    hsn_sac: "hsn_code",
    default_price: "selling_price",
    selling_price: "selling_price",
    mrp: "mrp",
    cost_price: "cost_price",
    barcode: "barcode",
    sku: "sku",
    description: "description",
    gst: "tax_name",
    tax: "tax_name",
    tax_name: "tax_name",
    opening_stock_store: "inventory_store_name",
    inventory_store: "inventory_store_name",
    opening_stock_qty: "opening_stock_qty",
    default_low_stock_value: "default_low_stock_value",
    disable_billing_on_zero: "disable_billing_on_zero",
    disable_sales_on_expiry: "disable_sales_on_expiry",
    inventory_method: "inventory_method",
    manufacturer: "manufacturer_name",
    department: "department_name",
    unit: "unit",
    size: "size",
  };

  const normalized = Object.entries(row || {}).reduce((acc, [key, value]) => {
    const taxHeader = parseProductTaxHeader(key);
    if (taxHeader) {
      acc[normalizeImportKey(key)] = toBoolean(value, false);
      if (toBoolean(value, false)) acc.tax_name = taxHeader.label;
      return acc;
    }

    const normalizedKey = normalizeImportKey(key);
    acc[aliases[normalizedKey] || normalizedKey] = value;
    return acc;
  }, {});

  const includeTax = toBoolean(normalized.include_tax, false);
  normalized.include_tax = includeTax;

  for (const taxColumn of PRODUCT_TAX_COLUMNS) {
    const key = normalizeImportKey(taxColumn);
    normalized[key] = toBoolean(normalized[key], false);
  }

  if (!includeTax) {
    normalized.tax_name = "";
  }

  return normalized;
}

async function findExistingProductForImport(client, row) {
  const checks = [];
  const values = [];
  const addCheck = (field, value) => {
    const text = normalizeText(value);
    if (!text) return;
    values.push(field === "name" ? text.toLowerCase() : text);
    checks.push(
      field === "name"
        ? `regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') = $${values.length}`
        : `${field} = $${values.length}`,
    );
  };

  addCheck("product_id", row.product_id);
  addCheck("sku", row.sku);
  addCheck("barcode", row.barcode);
  addCheck("name", row.name);

  if (!checks.length) return null;

  const result = await client.query(
    `SELECT id, name
     FROM products
     WHERE ${checks.join(" OR ")}
     LIMIT 1`,
    values,
  );
  return result.rows[0] || null;
}

function normalizeReferenceName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.replace(/^['"]+|['"]+$/g, "").trim();
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeUnit(value) {
  const unit = normalizeText(value).toUpperCase() || "PCS";
  return ["PCS", "KG", "LTR"].includes(unit) ? unit : "PCS";
}

function normalizeStockItemType(value) {
  const type = normalizeText(value).toLowerCase() || "unbatched";
  return type === "batched" ? "batched" : "unbatched";
}

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

async function resolveIdByName(
  client,
  table,
  name,
  { categoryId = null } = {},
) {
  const lookup = normalizeReferenceName(name);
  if (!lookup) return null;

  const normalizedLookup = lookup.toLowerCase();

  if (table === "sub_categories" && categoryId) {
    const scoped = await client.query(
      `SELECT id
       FROM sub_categories
       WHERE category_id = $1
         AND regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') = $2
       LIMIT 1`,
      [categoryId, normalizedLookup],
    );
    if (scoped.rows.length) return scoped.rows[0].id;
  }

  const res = await client.query(
    `SELECT id
     FROM ${table}
     WHERE regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') = $1
     LIMIT 1`,
    [normalizedLookup],
  );
  return res.rows[0]?.id || null;
}

async function findExistingNamedRecord(
  table,
  name,
  { categoryId = null } = {},
) {
  const lookup = normalizeReferenceName(name);
  if (!lookup) return null;

  const params = [lookup.toLowerCase()];
  let scopedClause = "";
  if (table === "sub_categories" && categoryId) {
    params.push(categoryId);
    scopedClause = `AND category_id = $${params.length}`;
  }
  if (table === "product_groups" && categoryId) {
    params.push(categoryId);
    scopedClause = `AND COALESCE(category_id, 0) = COALESCE($${params.length}::bigint, 0)`;
  }

  const result = await query(
    `SELECT id, name
     FROM ${table}
     WHERE regexp_replace(lower(trim(name)), '\\s+', ' ', 'g') = $1
       ${scopedClause}
     LIMIT 1`,
    params,
  );
  return result.rows[0] || null;
}

async function resolveTaxIdForImport(client, taxName) {
  const lookup = normalizeReferenceName(taxName);
  if (!lookup) return null;

  const directId = await resolveIdByName(client, "taxes", lookup);
  if (directId) return directId;

  const parsed =
    parseProductTaxHeader(`1-${lookup}`) || parseProductTaxHeader(lookup);
  if (!parsed) return null;

  const byTypeAndRate = await client.query(
    `SELECT id
     FROM taxes
     WHERE upper(tax_type) = $1
       AND ABS(COALESCE(rate, 0)::numeric - $2::numeric) < 0.001
     ORDER BY id DESC
     LIMIT 1`,
    [parsed.type, parsed.rate],
  );
  if (byTypeAndRate.rows.length) return byTypeAndRate.rows[0].id;

  const byNameAndRate = await client.query(
    `SELECT id
     FROM taxes
     WHERE upper(name) LIKE $1
       AND ABS(COALESCE(rate, 0)::numeric - $2::numeric) < 0.001
     ORDER BY id DESC
     LIMIT 1`,
    [`%${parsed.type}%`, parsed.rate],
  );
  if (byNameAndRate.rows.length) return byNameAndRate.rows[0].id;

  const byRate = await client.query(
    `SELECT id
     FROM taxes
     WHERE ABS(COALESCE(rate, 0)::numeric - $1::numeric) < 0.001
       AND COALESCE(is_active, true) = true
     ORDER BY id DESC
     LIMIT 1`,
    [parsed.rate],
  );
  if (byRate.rows.length) return byRate.rows[0].id;

  const taxLabel = `${parsed.type}-${parsed.rate}%`;
  try {
    const inserted = await client.query(
      `INSERT INTO taxes (name, rate, tax_type, hsn_code, is_active, parent_tax_id, store_id)
       VALUES ($1, $2, $3, NULL, true, NULL, NULL)
       RETURNING id`,
      [taxLabel, parsed.rate, parsed.type],
    );
    return inserted.rows[0]?.id || null;
  } catch (err) {
    if (err.code !== "23505") throw err;
    const existing = await resolveIdByName(client, "taxes", taxLabel);
    return existing || null;
  }
}

async function ensureReferenceId(
  client,
  table,
  name,
  { categoryId = null, manufacturerId = null } = {},
) {
  const lookup = normalizeReferenceName(name);
  if (!lookup) return null;

  const existingId = await resolveIdByName(client, table, lookup, {
    categoryId,
  });
  if (existingId) return existingId;

  if (table === "categories") {
    const inserted = await client.query(
      `INSERT INTO categories (name, description, sort_sequence, is_active)
       VALUES ($1, NULL, 0, true)
       RETURNING id`,
      [lookup],
    );
    return inserted.rows[0]?.id || null;
  }

  if (table === "sub_categories") {
    const inserted = await client.query(
      `INSERT INTO sub_categories (name, description, category_id, sort_sequence, is_active)
       VALUES ($1, NULL, $2, 0, true)
       RETURNING id`,
      [lookup, categoryId],
    );
    return inserted.rows[0]?.id || null;
  }

  if (table === "manufacturers") {
    const inserted = await client.query(
      `INSERT INTO manufacturers (name, contact, email, phone, address, is_active)
       VALUES ($1, NULL, NULL, NULL, NULL, true)
       RETURNING id`,
      [lookup],
    );
    return inserted.rows[0]?.id || null;
  }

  if (table === "brands") {
    const inserted = await client.query(
      `INSERT INTO brands (name, description, manufacturer_id, is_active)
       VALUES ($1, NULL, $2, true)
       RETURNING id`,
      [lookup, manufacturerId],
    );
    return inserted.rows[0]?.id || null;
  }

  if (table === "departments") {
    const inserted = await client.query(
      `INSERT INTO departments (name, code, is_active)
       VALUES ($1, NULL, true)
       RETURNING id`,
      [lookup],
    );
    return inserted.rows[0]?.id || null;
  }

  return null;
}

function parseStoreSaleabilityFromRow(row = {}) {
  const byStore = new Map();
  for (const [key, value] of Object.entries(row)) {
    const match = key.match(
      /^store_(\d+)_(enabled|selling_price|mrp|low_stock_value)$/,
    );
    if (!match) continue;
    const storeId = Number(match[1]);
    const field = match[2];
    if (!Number.isFinite(storeId)) continue;
    if (!byStore.has(storeId)) byStore.set(storeId, {});
    byStore.get(storeId)[field] = value;
  }
  return [...byStore.entries()].map(([storeId, fields]) => ({
    storeId,
    enabled: toBoolean(fields.enabled, true),
    sellingPrice: toNumber(fields.selling_price, 0),
    mrp: toNumber(fields.mrp, 0),
    lowStockValue: toNumber(fields.low_stock_value, 0),
  }));
}

function validateMoneyField(row, field, label, errors) {
  const value = row[field];
  if (value === "" || value === null || value === undefined) return;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0)
    errors.push(`${label} must be a valid positive number`);
}

async function insertProductWithIntegrations(client, row, user) {
  const name = normalizeText(row.name);
  if (!name) {
    throw new Error("name is required");
  }
  if (
    row.selling_price === "" ||
    row.selling_price === null ||
    row.selling_price === undefined
  ) {
    throw new Error("selling_price is required");
  }
  if (!normalizeText(row.unit)) {
    throw new Error("unit is required");
  }

  const rowErrors = [];
  validateMoneyField(row, "mrp", "MRP", rowErrors);
  validateMoneyField(row, "selling_price", "Selling price", rowErrors);
  validateMoneyField(row, "cost_price", "Cost price", rowErrors);
  validateMoneyField(
    row,
    "opening_stock_qty",
    "Opening stock quantity",
    rowErrors,
  );
  if (
    normalizeText(row.stock_item_type) &&
    !["batched", "unbatched"].includes(
      normalizeText(row.stock_item_type).toLowerCase(),
    )
  ) {
    rowErrors.push("stock_item_type must be batched or unbatched");
  }
  if (rowErrors.length) throw new Error(rowErrors.join(", "));

  const categoryId = await ensureReferenceId(
    client,
    "categories",
    row.category_name,
  );
  const subCategoryId = await ensureReferenceId(
    client,
    "sub_categories",
    row.sub_category_name,
    { categoryId },
  );
  const manufacturerId = await ensureReferenceId(
    client,
    "manufacturers",
    row.manufacturer_name,
  );
  const brandId = await ensureReferenceId(client, "brands", row.brand_name, {
    manufacturerId,
  });
  const departmentId = await ensureReferenceId(
    client,
    "departments",
    row.department_name,
  );
  const incomeHeadId = await resolveIdByName(
    client,
    "income_heads",
    row.income_head_name,
  );
  const inventoryStoreId = await resolveIdByName(
    client,
    "stores",
    row.inventory_store_name,
  );
  const includeTax = toBoolean(row.include_tax, false);
  const taxName = includeTax ? row.tax_name : "";
  const taxId = await resolveTaxIdForImport(client, taxName);
  const barcode = nullableText(row.barcode);
  if (barcode) {
    const duplicates = await client.query(
      `SELECT id, name, stock_item_type
       FROM products
       WHERE barcode = $1
       LIMIT 5`,
      [barcode],
    );
    const incomingType = normalizeStockItemType(row.stock_item_type);
    const blocked = duplicates.rows.find(
      (item) =>
        normalizeStockItemType(item.stock_item_type) !== "batched" ||
        incomingType !== "batched",
    );
    if (blocked) {
      throw new Error(
        `Barcode already used by "${blocked.name}". Duplicate barcodes are allowed only when both products are batched.`,
      );
    }
  }

  const referenceErrors = [];
  if (normalizeText(row.category_name) && !categoryId)
    referenceErrors.push(`Category "${row.category_name}" not found`);
  if (normalizeText(row.sub_category_name) && !subCategoryId)
    referenceErrors.push(`Sub-category "${row.sub_category_name}" not found`);
  if (normalizeText(row.brand_name) && !brandId)
    referenceErrors.push(`Brand "${row.brand_name}" not found`);
  if (normalizeText(row.manufacturer_name) && !manufacturerId)
    referenceErrors.push(`Manufacturer "${row.manufacturer_name}" not found`);
  if (normalizeText(row.department_name) && !departmentId)
    referenceErrors.push(`Department "${row.department_name}" not found`);
  if (normalizeText(row.income_head_name) && !incomeHeadId)
    referenceErrors.push(`Income Head "${row.income_head_name}" not found`);
  if (includeTax && !normalizeText(taxName))
    referenceErrors.push("Select one GST column when include_tax is Yes");
  if (inventoryStoreId) {
    const storeCheck = requireStore(user, inventoryStoreId);
    if (storeCheck.error)
      referenceErrors.push(
        `No access to inventory store "${row.inventory_store_name}"`,
      );
  }
  if (referenceErrors.length) throw new Error(referenceErrors.join(", "));

  const insert = await client.query(
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
      nullableText(row.product_id),
      name,
      nullableText(row.description),
      barcode,
      nullableText(row.sku),
      categoryId,
      subCategoryId,
      brandId,
      manufacturerId,
      departmentId,
      incomeHeadId,
      taxId,
      toNumber(row.mrp, 0),
      toNumber(row.selling_price, 0),
      toNumber(row.cost_price, 0),
      normalizeUnit(row.unit),
      toBoolean(row.is_active, true),
      toBoolean(row.is_service, false),
      nullableText(row.image_url),
      toBoolean(row.allow_discount_on_pos, false),
      includeTax,
      normalizeStockItemType(row.stock_item_type),
      normalizeText(row.inventory_method) || "direct",
      nullableText(row.hsn_code),
      null,
    ],
  );

  const createdProduct = insert.rows[0];
  const openingStockQty = toNumber(row.opening_stock_qty, 0);
  const manageInventoryEnabled = toBoolean(row.manage_inventory_enabled, true);

  if (manageInventoryEnabled && openingStockQty > 0 && inventoryStoreId) {
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
        'Opening stock from product import',
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
        openingStockQty * toNumber(row.cost_price, 0),
        String(createdProduct.id),
        JSON.stringify({
          source: "product-import",
          disable_billing_on_zero: toBoolean(row.disable_billing_on_zero, true),
          disable_sales_on_expiry: toBoolean(
            row.disable_sales_on_expiry,
            false,
          ),
          inventory_method: normalizeText(row.inventory_method) || "direct",
          stock_item_type: normalizeStockItemType(row.stock_item_type),
          default_low_stock_value: toNumber(row.default_low_stock_value, 0),
          flags: {
            is_sellable_on_pos: toBoolean(row.is_sellable_on_pos, true),
            allow_variable_pricing: toBoolean(
              row.allow_variable_pricing,
              false,
            ),
            include_tax: includeTax,
            charge_name: nullableText(row.charge_name),
            selected_color: nullableText(row.selected_color),
          },
        }),
      ],
    );

    const stockInId = stockInInsert.rows[0].id;
    await client.query(
      "UPDATE stock_in SET transaction_id = $1 WHERE id = $2",
      [`STK-${String(stockInId).padStart(4, "0")}`, stockInId],
    );
    await client.query(
      `INSERT INTO stock_in_items (stock_in_id, product_id, product_name, qty, cost_price, tax_value, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, NOW())`,
      [
        stockInId,
        createdProduct.id,
        createdProduct.name,
        openingStockQty,
        toNumber(row.cost_price, 0),
      ],
    );
  }

  const saleabilityRows = parseStoreSaleabilityFromRow(row);
  for (const saleability of saleabilityRows) {
    if (!saleability.enabled) continue;
    await client.query(
      `INSERT INTO product_saleability (product_id, store_id, is_active, selling_price, mrp, low_stock_value)
       VALUES ($1, $2, true, $3, $4, $5)
       ON CONFLICT (product_id, store_id) DO UPDATE SET
         is_active = EXCLUDED.is_active,
         selling_price = EXCLUDED.selling_price,
         mrp = EXCLUDED.mrp,
         low_stock_value = EXCLUDED.low_stock_value,
         updated_at = NOW()`,
      [
        createdProduct.id,
        saleability.storeId,
        saleability.sellingPrice,
        saleability.mrp,
        saleability.lowStockValue,
      ],
    );
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, "MANAGE_CATALOG");
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const { type, rows } = body; // type: 'categories' | 'sub-categories' | 'products'

    if (!rows?.length) return errorResponse("No data to import");
    if (rows.length > 5000)
      return errorResponse("Import limit is 5000 rows at a time");

    if (type === "products") {
      await Promise.all([
        ensureStockInSchema(),
        ensureCatalogExtrasSchema(),
        ensureProductDiscountSchema(),
      ]);
    }
    // Ensure catalog extras schema exists for product-groups as well
    if (type === "product-groups") {
      await ensureCatalogExtrasSchema();
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];
    const seenProductKeys = new Set();
    const seenImportKeys = new Set();

    for (let index = 0; index < rows.length; index++) {
      let row = rows[index];
      try {
        if (type === "products") {
          row = normalizeProductImportRow(row);
        }

        if (type === "categories") {
          const name = normalizeReferenceName(row.name);
          if (!name) {
            skipped++;
            continue;
          }
          const importKey = `categories:${name.toLowerCase()}`;
          if (
            seenImportKeys.has(importKey) ||
            (await findExistingNamedRecord("categories", name))
          ) {
            skipped++;
            continue;
          }
          seenImportKeys.add(importKey);
          const insert = await query(
            `INSERT INTO categories (name, description, sort_sequence, is_active)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              name,
              row.description || null,
              row.sort_sequence ?? 0,
              row.is_active ?? true,
            ],
          );
          if (insert.rowCount) inserted++;
          else skipped++;
        } else if (type === "sub-categories") {
          const name = normalizeReferenceName(row.name);
          if (!name) {
            skipped++;
            continue;
          }
          // Find category by name if provided
          let category_id = null;
          if (row.category_name) {
            const cat = await query(
              `SELECT id FROM categories WHERE name ILIKE $1 LIMIT 1`,
              [row.category_name.trim()],
            );
            if (cat.rows.length) category_id = cat.rows[0].id;
          }
          const importKey = `sub-categories:${category_id || "none"}:${name.toLowerCase()}`;
          if (
            seenImportKeys.has(importKey) ||
            (await findExistingNamedRecord("sub_categories", name, {
              categoryId: category_id,
            }))
          ) {
            skipped++;
            continue;
          }
          seenImportKeys.add(importKey);
          const insert = await query(
            `INSERT INTO sub_categories (name, description, category_id, sort_sequence, is_active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              name,
              row.description || null,
              category_id,
              row.sort_sequence ?? 0,
              row.is_active ?? true,
            ],
          );
          if (insert.rowCount) inserted++;
          else skipped++;
        } else if (type === "products") {
          const client = await getClient();
          try {
            const existingProduct = await findExistingProductForImport(
              client,
              row,
            );
            if (existingProduct) {
              skipped++;
              continue;
            }

            const duplicateKeys = ["product_id", "sku", "barcode"]
              .map((field) => [field, normalizeText(row[field]).toLowerCase()])
              .filter(([, value]) => value);
            for (const [field, value] of duplicateKeys) {
              const key = `${field}:${value}`;
              if (seenProductKeys.has(key)) {
                throw new Error(
                  `Duplicate ${field.replace("_", " ")} in import file`,
                );
              }
              seenProductKeys.add(key);
            }

            await client.query("BEGIN");
            await insertProductWithIntegrations(client, row, auth.user);
            await client.query("COMMIT");
            inserted++;
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        } else if (type === "product-groups") {
          const name = normalizeReferenceName(row.name);
          if (!name) {
            skipped++;
            continue;
          }
          // Resolve category by name if provided
          let category_id = null;
          if (row.category_name) {
            const cat = await query(
              `SELECT id FROM categories WHERE name ILIKE $1 LIMIT 1`,
              [row.category_name.trim()],
            );
            if (cat.rows.length) category_id = cat.rows[0].id;
          }
          const importKey = `product-groups:${category_id || "none"}:${name.toLowerCase()}`;
          if (
            seenImportKeys.has(importKey) ||
            (await findExistingNamedRecord("product_groups", name, {
              categoryId: category_id,
            }))
          ) {
            skipped++;
            continue;
          }
          seenImportKeys.add(importKey);
          const insert = await query(
            `INSERT INTO product_groups (name, description, category_id, is_active)
             VALUES ($1, $2, $3, COALESCE($4, true))
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [name, row.description || null, category_id, row.is_active ?? true],
          );
          if (insert.rowCount) inserted++;
          else skipped++;
        } else {
          throw new Error(`Unsupported import type: ${type}`);
        }
      } catch (err) {
        errors.push({
          row: row.name || `Row ${index + 2}`,
          error:
            err.code === "23505"
              ? "Duplicate product (likely SKU/barcode conflict)"
              : err.message,
        });
        skipped++;
      }
    }

    return successResponse(
      { inserted, skipped, errors },
      `${inserted} records imported successfully`,
    );
  } catch (err) {
    return errorResponse(err.message);
  }
}
