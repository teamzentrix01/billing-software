import { errorResponse, successResponse } from "@/lib/api-response";
import { query } from "@/lib/db";
import { requireAuth, requirePermission, requireStore } from "@/lib/api-protection";
import { ensureStoresSchema } from "@/lib/storesSchema";
import {
  ALLOWED_STORE_DOCUMENT_EXTENSIONS,
  ALLOWED_STORE_DOCUMENT_TYPES,
  MAX_STORE_DOCUMENT_BYTES,
  REQUIRED_STORE_DOCUMENT_KEYS,
} from "@/lib/storeMeta";

function cleanDocumentPayload(doc) {
  if (!doc || typeof doc !== "object") return null;
  const name = String(doc.name || "").trim();
  const dataUrl = String(doc.dataUrl || "").trim();
  if (!name) return null;

  const lowerName = name.toLowerCase();
  const type = String(doc.type || "").trim().toLowerCase();
  const size = Number(doc.size || 0);
  const hasAllowedExtension = ALLOWED_STORE_DOCUMENT_EXTENSIONS.some((ext) =>
    lowerName.endsWith(ext),
  );
  const hasAllowedType = !type || ALLOWED_STORE_DOCUMENT_TYPES.includes(type);

  if (!hasAllowedExtension || !hasAllowedType || size > MAX_STORE_DOCUMENT_BYTES) {
    return null;
  }

  return {
    name,
    type,
    size,
    ...(dataUrl ? { dataUrl } : {}),
  };
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
    const key = String(resolvedParams?.key || "").trim();

    if (!Number.isFinite(storeId)) return errorResponse("Invalid store id", 400);
    if (!REQUIRED_STORE_DOCUMENT_KEYS.includes(key)) {
      return errorResponse("Invalid document type", 400);
    }

    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    const body = await request.json().catch(() => ({}));
    const document = cleanDocumentPayload(body.document);
    if (!document) return errorResponse("Invalid document payload", 422);

    const existing = await query("SELECT meta FROM stores WHERE id = $1 LIMIT 1", [storeId]);
    if (!existing.rows.length) return errorResponse("Store not found", 404);

    const meta = existing.rows[0].meta && typeof existing.rows[0].meta === "object"
      ? existing.rows[0].meta
      : {};
    const nextMeta = {
      ...meta,
      documents: {
        ...(meta.documents && typeof meta.documents === "object" ? meta.documents : {}),
        [key]: document,
      },
    };

    const updated = await query(
      `UPDATE stores
       SET meta = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, meta, updated_at`,
      [JSON.stringify(nextMeta), storeId],
    );

    return successResponse({ store: updated.rows[0] }, "Document uploaded");
  } catch (err) {
    console.error("[store document PUT]", err);
    return errorResponse(err.message || "Unable to upload store document");
  }
}
