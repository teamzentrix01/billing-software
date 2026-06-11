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

const MAX_CHUNK_CHARS = 250_000;

async function ensureDocumentUploadChunksSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS store_document_upload_chunks (
      store_id INTEGER NOT NULL,
      document_key TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      chunk_data TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (store_id, document_key, upload_id, chunk_index)
    )
  `);
  await query(
    "DELETE FROM store_document_upload_chunks WHERE created_at < NOW() - INTERVAL '1 day'",
  );
}

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

async function getDocumentFromRequest(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
      return null;
    }

    const name = String(form.get("name") || file.name || "").trim();
    const type = String(form.get("type") || file.type || "").trim();
    const size = Number(form.get("size") || file.size || 0);
    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${type || "application/octet-stream"};base64,${buffer.toString("base64")}`;

    return cleanDocumentPayload({
      name,
      type,
      size,
      dataUrl,
    });
  }

  const body = await request.json().catch(() => ({}));
  return cleanDocumentPayload(body.document);
}

async function getAuthorizedStoreContext(request, params) {
  await ensureStoresSchema();
  await ensureDocumentUploadChunksSchema();
  const auth = await requireAuth(request);
  if (auth.error) return { error: auth.error };

  const permissionCheck = requirePermission(auth.user, "MANAGE_STORES");
  if (permissionCheck.error) return { error: permissionCheck.error };

  const resolvedParams = await params;
  const storeId = Number(resolvedParams?.id);
  const key = String(resolvedParams?.key || "").trim();

  if (!Number.isFinite(storeId)) {
    return { error: errorResponse("Invalid store id", 400) };
  }
  if (!REQUIRED_STORE_DOCUMENT_KEYS.includes(key)) {
    return { error: errorResponse("Invalid document type", 400) };
  }

  const storeCheck = requireStore(auth.user, storeId);
  if (storeCheck.error) return { error: storeCheck.error };

  return { storeId, key };
}

async function saveDocument(storeId, key, document) {
  const existing = await query("SELECT meta FROM stores WHERE id = $1 LIMIT 1", [storeId]);
  if (!existing.rows.length) return null;

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

  return updated.rows[0];
}

export async function POST(request, { params }) {
  try {
    const context = await getAuthorizedStoreContext(request, params);
    if (context.error) return context.error;
    const { storeId, key } = context;

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const uploadId = String(body.uploadId || "").trim();
    if (!uploadId) return errorResponse("Missing upload id", 400);

    if (action === "chunk") {
      const chunkIndex = Number(body.chunkIndex);
      const totalChunks = Number(body.totalChunks);
      const chunkData = String(body.chunkData || "");
      const document = body.document || {};
      const name = String(document.name || "").trim();
      const type = String(document.type || "").trim();
      const size = Number(document.size || 0);
      const isValidDocument = cleanDocumentPayload({ name, type, size, dataUrl: "placeholder" });

      if (!isValidDocument) return errorResponse("Invalid document metadata", 422);
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
        return errorResponse("Invalid chunk index", 400);
      }
      if (!Number.isInteger(totalChunks) || totalChunks < 1 || chunkIndex >= totalChunks) {
        return errorResponse("Invalid chunk count", 400);
      }
      if (!chunkData || chunkData.length > MAX_CHUNK_CHARS) {
        return errorResponse("Invalid chunk size", 413);
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(chunkData)) {
        return errorResponse("Invalid chunk data", 422);
      }

      await query(
        `INSERT INTO store_document_upload_chunks (
           store_id, document_key, upload_id, chunk_index, total_chunks,
           file_name, file_type, file_size, chunk_data
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (store_id, document_key, upload_id, chunk_index)
         DO UPDATE SET
           total_chunks = EXCLUDED.total_chunks,
           file_name = EXCLUDED.file_name,
           file_type = EXCLUDED.file_type,
           file_size = EXCLUDED.file_size,
           chunk_data = EXCLUDED.chunk_data,
           created_at = NOW()`,
        [storeId, key, uploadId, chunkIndex, totalChunks, name, type, size, chunkData],
      );

      return successResponse({ chunkIndex }, "Chunk uploaded");
    }

    if (action === "finalize") {
      const chunks = await query(
        `SELECT chunk_index, total_chunks, file_name, file_type, file_size, chunk_data
         FROM store_document_upload_chunks
         WHERE store_id = $1 AND document_key = $2 AND upload_id = $3
         ORDER BY chunk_index ASC`,
        [storeId, key, uploadId],
      );
      if (!chunks.rows.length) return errorResponse("Upload not found", 404);

      const totalChunks = Number(chunks.rows[0].total_chunks);
      if (chunks.rows.length !== totalChunks) {
        return errorResponse("Upload is incomplete", 409);
      }
      for (let i = 0; i < totalChunks; i += 1) {
        if (Number(chunks.rows[i].chunk_index) !== i) {
          return errorResponse("Upload chunks are incomplete", 409);
        }
      }

      const first = chunks.rows[0];
      const type = first.file_type || "";
      const base64 = chunks.rows.map((row) => row.chunk_data).join("");
      const document = cleanDocumentPayload({
        name: first.file_name,
        type,
        size: first.file_size,
        dataUrl: `data:${type || "application/octet-stream"};base64,${base64}`,
      });
      if (!document) return errorResponse("Invalid document payload", 422);

      const store = await saveDocument(storeId, key, document);
      if (!store) return errorResponse("Store not found", 404);

      await query(
        `DELETE FROM store_document_upload_chunks
         WHERE store_id = $1 AND document_key = $2 AND upload_id = $3`,
        [storeId, key, uploadId],
      );

      return successResponse({ store }, "Document uploaded");
    }

    return errorResponse("Invalid upload action", 400);
  } catch (err) {
    console.error("[store document POST]", err);
    return errorResponse(err.message || "Unable to upload store document");
  }
}

export async function GET(request, { params }) {
  try {
    const context = await getAuthorizedStoreContext(request, params);
    if (context.error) return context.error;
    const { storeId, key } = context;

    const existing = await query("SELECT meta FROM stores WHERE id = $1 LIMIT 1", [storeId]);
    if (!existing.rows.length) return errorResponse("Store not found", 404);

    const meta = existing.rows[0].meta && typeof existing.rows[0].meta === "object"
      ? existing.rows[0].meta
      : {};
    const document = meta.documents?.[key] || null;
    if (!document?.dataUrl) {
      return errorResponse("Document preview is not available. Please re-upload this document.", 404);
    }

    return successResponse({ document }, "Document fetched");
  } catch (err) {
    console.error("[store document GET]", err);
    return errorResponse(err.message || "Unable to fetch store document");
  }
}

export async function PUT(request, { params }) {
  try {
    const context = await getAuthorizedStoreContext(request, params);
    if (context.error) return context.error;
    const { storeId, key } = context;

    const document = await getDocumentFromRequest(request);
    if (!document) return errorResponse("Invalid document payload", 422);

    const store = await saveDocument(storeId, key, document);
    if (!store) return errorResponse("Store not found", 404);

    return successResponse({ store }, "Document uploaded");
  } catch (err) {
    console.error("[store document PUT]", err);
    return errorResponse(err.message || "Unable to upload store document");
  }
}
