import { NextResponse } from "next/server";
import { query, getClient } from "@/lib/db";
import { ensureStockInSchema } from "@/lib/stockInSchema";
import { ensureCatalogExtrasSchema } from "@/lib/catalogExtrasSchema";
import {
  appendStoreScope,
  requireAuth,
  requirePermission,
  requireStore,
} from "@/lib/api-protection";

function isWarehouseMeta(meta) {
  return (
    String(meta?.locationType || "")
      .trim()
      .toLowerCase() === "warehouse"
  );
}

export async function GET(request) {
  try {
    await ensureStockInSchema();
    await ensureCatalogExtrasSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(
      auth.user,
      "VIEW_INVENTORY",
      "MANAGE_INVENTORY",
    );
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    if (searchParams.get("template") === "products") {
      const templateParams = [];
      const templateWhere = [`COALESCE(p.is_active, TRUE) = TRUE`];
      const brandId = String(searchParams.get("brand_id") || "").trim();
      const categoryId = String(searchParams.get("category_id") || "").trim();

      if (brandId) {
        templateParams.push(Number(brandId));
        templateWhere.push(`p.brand_id = $${templateParams.length}`);
      }
      if (categoryId) {
        templateParams.push(Number(categoryId));
        templateWhere.push(`p.category_id = $${templateParams.length}`);
      }

      const productsRes = await query(
        `SELECT
           p.id,
           p.product_id,
           p.name,
           p.barcode,
           p.sku,
           p.unit,
           p.stock_item_type,
           COALESCE(p.cost_price, 0) AS cost_price,
           COALESCE(p.mrp, 0) AS mrp,
           COALESCE(p.selling_price, 0) AS selling_price,
           c.name AS category_name,
           b.name AS brand_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE ${templateWhere.join(" AND ")}
         ORDER BY p.id ASC
         LIMIT 10000`,
        templateParams,
      );

      return NextResponse.json({
        records: productsRes.rows.map((row) => ({
          id: row.id,
          productId: row.product_id || row.id,
          productName: row.name || "",
          sizeId: row.id,
          sizeName: "",
          category: row.category_name || "",
          brand: row.brand_name || "",
          barcode: row.barcode || "",
          sku: row.sku || "",
          unit: row.unit || "Piece",
          stockItemsType: String(
            row.stock_item_type || "BATCHED",
          ).toUpperCase(),
          quantity: "",
          costPerUnit: Number(row.cost_price || 0),
          mrp: Number(row.mrp || 0),
          sellingPrice: Number(row.selling_price || 0),
          expiryDate: "",
          serialNumberLabel: "",
          serialNumber: "",
          remarks: "",
        })),
      });
    }

    const params = [];
    const whereClauses = [`s.status = 'confirmed'`];
    const scope = appendStoreScope(
      whereClauses,
      params,
      "s.destination_id",
      auth.user,
    );
    if (scope.error) return scope.error;
    const search = String(searchParams.get("search") || "").trim();
    const dateFrom = String(searchParams.get("date_from") || "").trim();
    const dateTo = String(searchParams.get("date_to") || "").trim();
    const source = String(searchParams.get("source") || "").trim();

    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(`(
        s.transaction_id ILIKE $${params.length}
        OR s.invoice_number ILIKE $${params.length}
        OR s.vendor_name ILIKE $${params.length}
        OR st.name ILIKE $${params.length}
        OR s.reference_type ILIKE $${params.length}
        OR s.reference_id ILIKE $${params.length}
      )`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      whereClauses.push(
        `COALESCE(s.invoice_date::date, s.created_at::date) >= $${params.length}::date`,
      );
    }
    if (dateTo) {
      params.push(dateTo);
      whereClauses.push(
        `COALESCE(s.invoice_date::date, s.created_at::date) <= $${params.length}::date`,
      );
    }
    if (source) {
      params.push(source);
      whereClauses.push(`COALESCE(s.reference_type, '') = $${params.length}`);
    }

    const res = await query(
      `SELECT
        s.id,
        s.transaction_id,
        s.invoice_number,
        s.invoice_date,
        s.vendor_name,
        s.other_charges,
        s.total_items,
        s.total_cost,
        s.total_tax,
        s.reference_type,
        s.reference_id,
        s.status,
        s.created_at,
        st.name AS destination_name,
        COALESCE(SUM(si.qty), 0) AS item_qty_sum,
        COALESCE(SUM(si.qty * si.cost_price), 0) AS items_cost_sum
      FROM stock_in s
      LEFT JOIN stores st ON st.id = s.destination_id
      LEFT JOIN stock_in_items si ON si.stock_in_id = s.id
      WHERE ${whereClauses.join(" AND ")}
      GROUP BY s.id, st.name
      ORDER BY s.confirmed_at DESC NULLS LAST, s.created_at DESC
      LIMIT 200`,
      params,
    );

    const records = res.rows.map((row) => {
      const totalItems = Number(row.total_items || row.item_qty_sum || 0);
      const totalCost = Number(
        row.total_cost ||
          Number(row.items_cost_sum || 0) + Number(row.other_charges || 0),
      );
      return {
        id: row.id,
        transactionId:
          row.transaction_id || `#STK-${String(row.id).padStart(3, "0")}`,
        invoiceNumber: row.invoice_number || "—",
        destination: row.destination_name || "—",
        invoiceDate: row.invoice_date,
        totalItems,
        cost: totalCost,
        referenceType: row.reference_type || "—",
        referenceId: row.reference_id || "—",
        vendorName: row.vendor_name,
        totalTax: Number(row.total_tax || 0),
        createdAt: row.created_at,
      };
    });

    return NextResponse.json(records);
  } catch (err) {
    console.error("[stockin GET]", err.message);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request) {
  try {
    await ensureStockInSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, "MANAGE_INVENTORY");
    if (permissionCheck.error) return permissionCheck.error;

    const payload = await request.json();
    const sourceType = String(
      payload.sourceType || payload.source_type || "warehouse",
    ).toLowerCase();
    const isWarehouseSource = sourceType === "warehouse";
    const destinationId = payload.destination
      ? Number(payload.destination)
      : null;
    if (!destinationId && auth.user.role !== "super_admin") {
      return NextResponse.json(
        { error: "Store destination is required for your account" },
        { status: 403 },
      );
    }
    if (destinationId) {
      const storeCheck = requireStore(auth.user, destinationId);
      if (storeCheck.error) return storeCheck.error;

      const destinationRes = await query(
        `SELECT meta
         FROM stores
         WHERE id = $1
         LIMIT 1`,
        [destinationId],
      );
      const destinationMeta = destinationRes.rows[0]?.meta || {};
      if (isWarehouseMeta(destinationMeta) && sourceType !== "vendor") {
        return NextResponse.json(
          { error: "Stock in destination must be a store, not a warehouse" },
          { status: 400 },
        );
      }
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");
      const method = payload.method || "new";
      const referenceType =
        method === "purchase_order" ? "purchase_order" : null;
      const referenceId =
        payload.purchaseOrderId || payload.purchase_order_id || null;
      if (
        destinationId &&
        method !== "purchase_order" &&
        !isWarehouseSource &&
        sourceType !== "vendor"
      ) {
        const previousStockIn = await client.query(
          `SELECT id
             FROM stock_in
            WHERE destination_id = $1
              AND COALESCE(status, 'draft') <> 'cancelled'
            LIMIT 1`,
          [destinationId],
        );
        if (previousStockIn.rowCount > 0) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            {
              error:
                "Only first stock in can be created without PO. Please use Purchase Order.",
            },
            { status: 400 },
          );
        }
      }
      const insertText = `
        INSERT INTO stock_in (method, destination_id, apply_taxes, add_products_prefill, reference_type, reference_id, invoice_number, meta, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', NOW())
        RETURNING id`;
      const values = [
        method,
        destinationId,
        payload.applyTaxes ?? true,
        payload.addProductsPrefill ?? false,
        referenceType,
        referenceId,
        payload.invoiceNumber || payload.invoice_number || null,
        JSON.stringify({
          ...payload,
          sourceType,
          vendorIds: Array.isArray(payload.vendorIds) ? payload.vendorIds : [],
          vendorNames: Array.isArray(payload.vendorNames)
            ? payload.vendorNames
            : [],
        }),
      ];
      const res = await client.query(insertText, values);
      const id = res.rows[0].id;
      const transactionId = `STK-${String(id).padStart(4, "0")}`;
      await client.query(
        "UPDATE stock_in SET transaction_id = $1 WHERE id = $2",
        [transactionId, id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ id, transactionId }, { status: 201 });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[stockin POST]", err.message);
    return NextResponse.json(
      { error: "Failed to create stock in" },
      { status: 500 },
    );
  }
}
