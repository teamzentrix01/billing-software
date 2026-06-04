import {
  successResponse,
  errorResponse,
  validationError,
} from "@/lib/api-response";
import { query } from "@/lib/db";
import { ensureStoresSchema } from "@/lib/storesSchema";
import {
  appendStoreScope,
  requireAuth,
  requirePermission,
} from "@/lib/api-protection";
import {
  buildStoreMeta,
  buildStoreCodeDuplicateQuery,
  normalizeStoreCode,
  validateStoreCommercialPayload,
} from "@/lib/storeMeta";

export async function GET(request) {
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const pageParam = url.searchParams.get("page");
    const pageSizeParam = url.searchParams.get("pageSize");
    const searchParam = (url.searchParams.get("search") || "").trim();

    // If pagination/search params present, return paginated shape expected by stores list page
    if (pageParam || pageSizeParam || searchParam) {
      const page = Math.max(1, Number(pageParam) || 1);
      const pageSize = Math.max(1, Number(pageSizeParam) || 10);

      const where = [];
      const params = [];
      const scope = appendStoreScope(where, params, "s.id", auth.user);
      if (scope.error) return scope.error;

      if (searchParam) {
        params.push(`%${searchParam}%`);
        where.push(`(
          s.name ILIKE $${params.length}
          OR COALESCE(s.meta->>'storeCode', s.meta->>'shortCode', '') ILIKE $${params.length}
        )`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const totalRes = await query(
        `SELECT COUNT(*)::INT AS total FROM stores s ${whereSql}`,
        params,
      );
      const total = Number(totalRes.rows[0]?.total || 0);

      const offset = (page - 1) * pageSize;
      const qParams = params.slice();
      qParams.push(pageSize, offset);

      const res = await query(
        `SELECT s.id, s.name, s.address_line1, s.address_line2, s.city, s.state, s.pincode, s.country,
                s.manager_name, s.manager_mobile, s.manager_email, s.opening_time, s.closing_time,
                s.is_active, s.meta, s.created_at, s.updated_at
         FROM stores s
         ${whereSql}
         ORDER BY s.name ASC
         LIMIT $${qParams.length - 1} OFFSET $${qParams.length}`,
        qParams,
      );

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return successResponse(
        {
          stores: res.rows,
          records: res.rows,
          page,
          pageSize,
          total,
          totalPages,
        },
        "Stores fetched",
      );
    }

    const where = [];
    const params = [];
    const scope = appendStoreScope(where, params, "id", auth.user);
    if (scope.error) return scope.error;
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Fallback: return accessible stores as an array for legacy callers
    const res = await query(
      `SELECT id, name, address_line1, address_line2, city, state, pincode, country,
              manager_name, manager_mobile, manager_email, opening_time, closing_time, is_active, meta, created_at, updated_at
       FROM stores
       ${whereSql}
       ORDER BY name`,
      params,
    );
    return successResponse(
      { stores: res.rows, records: res.rows },
      "Stores fetched",
    );
  } catch (err) {
    console.error(err);
    return errorResponse("Failed to fetch stores");
  }
}

export async function POST(request) {
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const permissionCheck = requirePermission(auth.user, "MANAGE_STORES");
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const locationType = String(body.locationType || "").trim();
    const addressLine1 = String(body.addressLine1 || "").trim();
    const addressLine2 = String(body.addressLine2 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim();
    const pincode = String(body.pincode || "").trim();
    const country = String(body.country || "").trim() || "India";
    const requiredErrors = [];
    if (!name)
      requiredErrors.push({ field: "name", message: "Store name is required" });
    if (!locationType)
      requiredErrors.push({
        field: "locationType",
        message: "Location type is required",
      });
    if (!addressLine1)
      requiredErrors.push({
        field: "addressLine1",
        message: "Address line 1 is required",
      });
    if (!city)
      requiredErrors.push({ field: "city", message: "City is required" });
    if (!state)
      requiredErrors.push({ field: "state", message: "State is required" });
    if (!pincode)
      requiredErrors.push({ field: "pincode", message: "Pincode is required" });
    else if (!/^\d{6}$/.test(pincode))
      requiredErrors.push({
        field: "pincode",
        message: "Pincode must be 6 digits",
      });
    if (!country)
      requiredErrors.push({ field: "country", message: "Country is required" });
    requiredErrors.push(...validateStoreCommercialPayload(body));
    if (requiredErrors.length) {
      return validationError(requiredErrors);
    }
    const managerMobile = String(body.managerMobile || "").replace(/\D/g, "");
    const managerEmail = String(body.managerEmail || "")
      .trim()
      .toLowerCase();
    if (managerMobile && !/^\d{10}$/.test(managerMobile)) {
      return validationError([
        {
          field: "managerMobile",
          message: "Mobile number must be exactly 10 digits",
        },
      ]);
    }
    if (managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) {
      return validationError([
        { field: "managerEmail", message: "Enter a valid e-mail address" },
      ]);
    }

    const storeCode = normalizeStoreCode(body);
    if (!storeCode) {
      return validationError([
        { field: "storeCode", message: "Store code is required" },
      ]);
    }
    const duplicateQuery = buildStoreCodeDuplicateQuery(storeCode);
    const duplicate = await query(duplicateQuery.sql, duplicateQuery.params);
    if (duplicate.rows.length) {
      return validationError([
        { field: "storeCode", message: "Store code is already in use" },
      ]);
    }

    const meta = buildStoreMeta(body);

    const insert = await query(
      `INSERT INTO stores (
         name, address_line1, address_line2, city, state, pincode, country,
         manager_name, manager_mobile, manager_email, opening_time, closing_time, meta, is_active, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,NOW(),NOW())
       RETURNING id, name, address_line1, address_line2, city, state, pincode, country,
                 manager_name, manager_mobile, manager_email, opening_time, closing_time, is_active, meta, created_at, updated_at`,
      [
        name,
        addressLine1,
        addressLine2 || null,
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
      ],
    );

    if (!insert.rows.length) {
      return errorResponse("Failed to create store");
    }

    return successResponse({ store: insert.rows[0] }, "Store created", 201);
  } catch (err) {
    console.error("[stores POST]", err);
    return errorResponse("Failed to create store");
  }
}
