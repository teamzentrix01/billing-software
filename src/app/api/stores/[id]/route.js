import {
  successResponse,
  errorResponse,
  notFoundError,
} from "@/lib/api-response";
import { getClient, query } from "@/lib/db";
import { ensureStoresSchema } from "@/lib/storesSchema";
import {
  requireAuth,
  requirePermission,
  requireStore,
} from "@/lib/api-protection";
import { setRecycleBinContext } from "@/lib/recycleBin";
import {
  buildStoreCodeDuplicateQuery,
  getStoreCode,
  mergeStoreMeta,
  validateStoreCommercialPayload,
} from "@/lib/storeMeta";

const STORE_DELETE_DEPENDENCIES = [
  { table: "stock_in", column: "destination_id", label: "Stock In" },
  { table: "stock_out", column: "destination_id", label: "Stock Out" },
  {
    table: "stock_transfer",
    column: "source_id",
    label: "Stock Transfer (Source)",
  },
  {
    table: "stock_transfer",
    column: "destination_id",
    label: "Stock Transfer (Destination)",
  },
  {
    table: "stock_validation",
    column: "destination_id",
    label: "Stock Validation",
  },
  {
    table: "purchase_orders",
    column: "destination_id",
    label: "Purchase Orders",
  },
];

async function tableExists(client, tableName) {
  const res = await client.query("SELECT to_regclass($1) AS regclass", [
    tableName,
  ]);
  return !!res.rows?.[0]?.regclass;
}

async function deleteStoreDependencies(client, storeId) {
  const deleted = [];

  for (const dep of STORE_DELETE_DEPENDENCIES) {
    const exists = await tableExists(client, dep.table);
    if (!exists) {
      continue;
    }

    const res = await client.query(
      `DELETE FROM ${dep.table} WHERE ${dep.column} = $1 RETURNING id`,
      [storeId],
    );

    deleted.push({
      table: dep.table,
      column: dep.column,
      label: dep.label,
      count: res.rowCount || 0,
    });
  }

  return deleted.filter((item) => item.count > 0);
}

export async function GET(request, { params }) {
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const resolvedParams = await params;
    const storeId = Number(resolvedParams?.id);

    if (!Number.isFinite(storeId)) {
      return errorResponse("Invalid store id", 400);
    }
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const res = await query(
      `SELECT id, name, address_line1, address_line2, city, state, pincode, country, manager_name, manager_mobile, manager_email, opening_time, closing_time, is_active, meta, created_at, updated_at
       FROM stores
       WHERE id = $1
       LIMIT 1`,
      [storeId],
    );

    if (!res.rows.length) {
      return notFoundError("Store not found");
    }

    return successResponse({ store: res.rows[0] });
  } catch (err) {
    return errorResponse(err.message || "Unable to fetch store");
  }
}

export async function PUT(request, { params }) {
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, "MANAGE_STORES");
    if (permissionCheck.error) return permissionCheck.error;

    const resolvedParams = await params;
    const storeId = Number(resolvedParams?.id);

    if (!Number.isFinite(storeId)) {
      return errorResponse("Invalid store id", 400);
    }
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const body = await request.json();
    const name = (body.name || "").trim();
    const locationType = String(body.locationType || "").trim();
    const addressLine1 = String(body.addressLine1 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();
    const pincode = String(body.pincode || "").trim();
    const country = String(body.country || "").trim() || "India";
    if (!name) return errorResponse("Store name is required", 422);
    if (!locationType) return errorResponse("Location type is required", 422);
    if (!addressLine1) return errorResponse("Address line 1 is required", 422);
    if (!city) return errorResponse("City is required", 422);
    if (!state) return errorResponse("State is required", 422);
    if (!pincode) return errorResponse("Pincode is required", 422);
    if (!/^\d{6}$/.test(pincode))
      return errorResponse("Pincode must be 6 digits", 422);
    if (!country) return errorResponse("Country is required", 422);
    const managerMobile = String(body.managerMobile || "").replace(/\D/g, "");
    const managerEmail = String(body.managerEmail || "")
      .trim()
      .toLowerCase();
    if (!managerMobile) {
      return errorResponse("Mobile number is required", 422);
    }
    if (!/^\d{10}$/.test(managerMobile)) {
      return errorResponse("Mobile number must be exactly 10 digits", 422);
    }
    if (managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
      return errorResponse("Enter a valid e-mail address", 422);
    }
    if (!String(body.gstNumber || "").trim()) {
      return errorResponse("GST number is required", 422);
    }

    const existing = await query(
      "SELECT meta FROM stores WHERE id = $1 LIMIT 1",
      [storeId],
    );
    if (!existing.rows.length) {
      return notFoundError("Store not found");
    }

    const currentMeta = existing.rows[0].meta || {};
    const mergedDocumentPayload = {
      ...body,
      documents: {
        ...(currentMeta.documents && typeof currentMeta.documents === "object"
          ? currentMeta.documents
          : {}),
        ...(body.documents && typeof body.documents === "object"
          ? body.documents
          : {}),
      },
    };
    const commercialErrors = validateStoreCommercialPayload(
      mergedDocumentPayload,
    );
    if (commercialErrors.length) {
      return errorResponse(
        commercialErrors.map((item) => item.message).join(", "),
        422,
      );
    }

    const meta = mergeStoreMeta(existing.rows[0].meta, body);
    const storeCode = getStoreCode(meta);
    if (!storeCode) {
      return errorResponse("Store code is required", 422);
    }
    const duplicateQuery = buildStoreCodeDuplicateQuery(storeCode, storeId);
    const duplicate = await query(duplicateQuery.sql, duplicateQuery.params);
    if (duplicate.rows.length) {
      return errorResponse("Store code is already in use", 422);
    }

    const update = await query(
      `UPDATE stores
       SET name = $1,
           address_line1 = $2,
           address_line2 = $3,
           city = $4,
           state = $5,
           pincode = $6,
           country = $7,
           manager_name = $8,
           manager_mobile = $9,
           manager_email = $10,
           opening_time = $11,
           closing_time = $12,
           meta = $13,
           updated_at = NOW()
       WHERE id = $14
       RETURNING id, name, address_line1, address_line2, city, state, pincode, country, manager_name, manager_mobile, manager_email, opening_time, closing_time, is_active, meta, created_at, updated_at`,
      [
        name,
        addressLine1,
        body.addressLine2 || null,
        city,
        state,
        pincode,
        country,
        body.managerName || null,
        managerMobile || null,
        managerEmail || null,
        body.openingTime || null,
        body.closingTime || null,
        JSON.stringify(meta),
        storeId,
      ],
    );

    if (!update.rows.length) {
      return notFoundError("Store not found");
    }

    return successResponse({ store: update.rows[0] }, "Store updated");
  } catch (err) {
    return errorResponse(err.message || "Unable to update store");
  }
}

export async function DELETE(request, { params }) {
  let client;
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, "MANAGE_STORES");
    if (permissionCheck.error) return permissionCheck.error;

    const resolvedParams = await params;
    const storeId = Number(resolvedParams?.id);

    if (!Number.isFinite(storeId)) {
      return errorResponse("Invalid store id", 400);
    }
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    client = await getClient();
    await client.query("BEGIN");
    await setRecycleBinContext(client, auth.user.id, "Store deleted");

    const deletedDependencies = await deleteStoreDependencies(client, storeId);
    const del = await client.query(
      "DELETE FROM stores WHERE id = $1 RETURNING id",
      [storeId],
    );
    if (!del.rows.length) {
      await client.query("ROLLBACK");
      return notFoundError("Store not found");
    }

    await client.query("COMMIT");

    return successResponse(
      { id: storeId, deletedDependencies },
      "Store and related records deleted",
    );
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failures; original error is more useful for response.
      }
    }

    if (err?.code === "23503") {
      return errorResponse(
        "Store cannot be deleted because it is referenced by existing records.",
        409,
      );
    }
    return errorResponse(err.message || "Unable to delete store");
  } finally {
    client?.release();
  }
}
