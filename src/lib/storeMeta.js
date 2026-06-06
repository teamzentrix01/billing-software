function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }
  return { ...meta };
}

export const MIN_STORE_COST_PER_SQ_FT = 1400;
export const FRANCHISE_TYPES = ["FOCM", "FOCO", "COCO"];
export const REQUIRED_STORE_DOCUMENT_KEYS = [
  "agreement",
  "aadhaar",
  "panCard",
  "rentAgreement",
];
export const OPTIONAL_STORE_DOCUMENT_KEYS = [];
export const ALLOWED_STORE_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];
export const ALLOWED_STORE_DOCUMENT_EXTENSIONS = [".pdf", ".jpg", ".png"];
export const MAX_STORE_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const INTERIOR_ITEM_KEYS = [
  "ac",
  "refrigerator",
  "deepFreezer",
  "racks",
  "sealingMachine",
  "weighingMachine",
  "palletBoard",
  "bloombellBundle",
  "bumbWell",
  "fireExtinguisher",
  "ledBoard",
  "posMachine",
  "billingThermalPrinterScanner",
  "billingCounter",
  "shoppingBasket",
  "cart",
];

export function classifyStoreFormat(areaSqFt) {
  const area = Number(areaSqFt);
  if (!Number.isFinite(area) || area <= 0) return "";
  if (area >= 600 && area < 1000) return "Mini Mart";
  if (area >= 1000 && area < 3000) return "Super Mart";
  if (area >= 3000) return "Hyper Mart";
  return "";
}

function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function cleanDocumentPayload(doc) {
  if (!doc || typeof doc !== "object") return null;
  const name = String(doc.name || "").trim();
  const dataUrl = String(doc.dataUrl || "").trim();
  if (!name || !dataUrl) return null;
  const lowerName = name.toLowerCase();
  const type = String(doc.type || "").trim().toLowerCase();
  const hasAllowedExtension = ALLOWED_STORE_DOCUMENT_EXTENSIONS.some((ext) =>
    lowerName.endsWith(ext),
  );
  const hasAllowedType = !type || ALLOWED_STORE_DOCUMENT_TYPES.includes(type);
  const size = Number(doc.size || 0);
  if (!hasAllowedExtension || !hasAllowedType || size > MAX_STORE_DOCUMENT_BYTES) {
    return null;
  }
  return {
    name,
    type,
    size,
    dataUrl,
  };
}

export function buildStoreCommercials(body = {}) {
  const storeAreaSqFt = toAmount(body.storeAreaSqFt ?? body.storeArea);
  const costPerSqFt = toAmount(body.costPerSqFt);
  const totalStoreAmount =
    storeAreaSqFt > 0 && costPerSqFt > 0
      ? Math.round(storeAreaSqFt * costPerSqFt * 100) / 100
      : 0;

  return {
    storeAreaSqFt: storeAreaSqFt || "",
    storeFormat: classifyStoreFormat(storeAreaSqFt),
    costPerSqFt: costPerSqFt || "",
    totalStoreAmount: totalStoreAmount || "",
    franchiseType: String(body.franchiseType || "")
      .trim()
      .toUpperCase(),
  };
}

export function buildStoreDocuments(body = {}) {
  const documents =
    body.documents && typeof body.documents === "object" ? body.documents : {};
  const out = {};
  for (const key of [
    ...REQUIRED_STORE_DOCUMENT_KEYS,
    ...OPTIONAL_STORE_DOCUMENT_KEYS,
    "registryCopy",
  ]) {
    out[key] = cleanDocumentPayload(documents[key]);
  }
  delete out.registryCopy;
  return out;
}

function cleanInteriorItems(items) {
  const source = items && typeof items === "object" ? items : {};
  const out = {};
  let grandTotal = 0;

  for (const key of INTERIOR_ITEM_KEYS) {
    const item = source[key] || {};
    const enabled = !!item.enabled;
    const amount = enabled ? toAmount(item.amount) : 0;
    const units = enabled ? toAmount(item.units) : 0;
    const total = enabled ? Math.round(amount * units * 100) / 100 : 0;
    out[key] = { enabled, amount, units, total };
    grandTotal += total;
  }

  return {
    items: out,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

export function validateStoreCommercialPayload(
  body = {},
  { requireDocuments = true } = {},
) {
  const errors = [];
  const ownerName = String(body.managerName || "").trim();
  if (!ownerName) {
    errors.push({
      field: "managerName",
      message: "Franchise owner name is required",
    });
  }

  const mobile = String(body.managerMobile || "").replace(/\D/g, "");
  if (!mobile) {
    errors.push({
      field: "managerMobile",
      message: "Mobile number is required",
    });
  } else if (!/^\d{10}$/.test(mobile)) {
    errors.push({
      field: "managerMobile",
      message: "Mobile number must be exactly 10 digits",
    });
  }

  if (!String(body.gstNumber || "").trim()) {
    errors.push({
      field: "gstNumber",
      message: "GST number is required",
    });
  }

  const area = toAmount(body.storeAreaSqFt ?? body.storeArea);
  if (!area || area <= 0) {
    errors.push({
      field: "storeAreaSqFt",
      message: "Store area in sq ft is required",
    });
  } else if (area < 600) {
    errors.push({
      field: "storeAreaSqFt",
      message: "Store area must be at least 600 sq ft",
    });
  }

  const cost = toAmount(body.costPerSqFt);
  if (!cost || cost <= 0) {
    errors.push({
      field: "costPerSqFt",
      message: "Cost per sq ft is required",
    });
  } else if (cost < MIN_STORE_COST_PER_SQ_FT) {
    errors.push({
      field: "costPerSqFt",
      message: "Cost per sq ft cannot be less than Rs. 1400",
    });
  }

  const franchiseType = String(body.franchiseType || "")
    .trim()
    .toUpperCase();
  if (!FRANCHISE_TYPES.includes(franchiseType)) {
    errors.push({
      field: "franchiseType",
      message: "Select a valid franchise type",
    });
  }

  if (requireDocuments) {
    const documents = buildStoreDocuments(body);
    for (const key of REQUIRED_STORE_DOCUMENT_KEYS) {
      if (!documents[key]) {
        errors.push({
          field: `documents.${key}`,
          message: `${getStoreDocumentLabel(key)} is required`,
        });
      }
    }
  }

  return errors;
}

export function normalizeStoreCode(body = {}) {
  return String(body.storeCode || body.shortCode || "").trim();
}

export function buildStoreCodeDuplicateQuery(storeCode, excludeId = null) {
  const params = [storeCode];
  let sql = `SELECT id FROM stores
    WHERE LOWER(TRIM(COALESCE(meta->>'storeCode', meta->>'shortCode', ''))) = LOWER($1)`;
  if (excludeId != null) {
    params.push(Number(excludeId));
    sql += ` AND id <> $${params.length}`;
  }
  return { sql: `${sql} LIMIT 1`, params };
}

export function buildStoreMeta(body = {}) {
  const commercials = buildStoreCommercials(body);
  const interior = cleanInteriorItems(body.interiorItems);
  return {
    locationType: body.locationType || "Store",
    panNumber: body.panNumber || "",
    defaultCustomerGroup: body.defaultCustomerGroup || "",
    storeCode: normalizeStoreCode(body),
    storeArea: commercials.storeAreaSqFt || "",
    storeAreaSqFt: commercials.storeAreaSqFt,
    storeFormat: commercials.storeFormat,
    costPerSqFt: commercials.costPerSqFt,
    totalStoreAmount: commercials.totalStoreAmount,
    franchiseType: commercials.franchiseType,
    documents: buildStoreDocuments(body),
    interiorItems: interior.items,
    interiorGrandTotal: interior.grandTotal,
    enableVoucherValidation: !!body.enableVoucherValidation,
    automaticPrint: !!body.automaticPrint,
    enableStoreStockAlert: !!body.enableStoreStockAlert,
    enableStoreOnlineBillingOnly: !!body.enableStoreOnlineBillingOnly,
    cin: body.cin || "",
    tin: body.tin || "",
    serviceTaxNumber: body.serviceTaxNumber || "",
    gstNumber: body.gstNumber || "",
    customerGstOrderPrefix: body.customerGstOrderPrefix || "",
    fssaiLicenseNumber: body.fssaiLicenseNumber || "",
    taxInformation: body.taxInformation || "",
    customStoreOrderPrefix: body.customStoreOrderPrefix || "",
    refundCustomStoreOrderPrefix: body.refundCustomStoreOrderPrefix || "",
    ncCustomStoreOrderPrefix: body.ncCustomStoreOrderPrefix || "",
    ncRefundCustomStoreOrderPrefix: body.ncRefundCustomStoreOrderPrefix || "",
    rwiCustomStoreOrderPrefix: body.rwiCustomStoreOrderPrefix || "",
  };
}

/** Merge form meta onto existing DB meta; only keys present in `body` are updated. */
export function mergeStoreMeta(existingMeta, body = {}) {
  const prev = parseMeta(existingMeta);
  const incoming = buildStoreMeta(body);
  const merged = { ...prev };

  for (const [key, value] of Object.entries(incoming)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      merged[key] = value;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "storeCode") ||
    Object.prototype.hasOwnProperty.call(body, "shortCode")
  ) {
    merged.storeCode = incoming.storeCode;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "storeArea") ||
    Object.prototype.hasOwnProperty.call(body, "storeAreaSqFt") ||
    Object.prototype.hasOwnProperty.call(body, "costPerSqFt")
  ) {
    merged.storeArea = incoming.storeAreaSqFt || "";
    merged.storeAreaSqFt = incoming.storeAreaSqFt;
    merged.storeFormat = incoming.storeFormat;
    merged.costPerSqFt = incoming.costPerSqFt;
    merged.totalStoreAmount = incoming.totalStoreAmount;
  }

  if (Object.prototype.hasOwnProperty.call(body, "franchiseType")) {
    merged.franchiseType = incoming.franchiseType;
  }

  if (Object.prototype.hasOwnProperty.call(body, "documents")) {
    merged.documents = {
      ...(prev.documents && typeof prev.documents === "object"
        ? prev.documents
        : {}),
      ...incoming.documents,
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, "interiorItems")) {
    merged.interiorItems = incoming.interiorItems;
    merged.interiorGrandTotal = incoming.interiorGrandTotal;
  }

  if (!merged.storeCode && merged.shortCode) {
    merged.storeCode = String(merged.shortCode).trim();
  }
  delete merged.shortCode;
  delete merged.storeGuid;
  delete merged.latitude;
  delete merged.longitude;
  return merged;
}

export function getStoreCode(meta) {
  const parsed = parseMeta(meta);
  return parsed.storeCode || parsed.shortCode || "";
}

export function getStoreDocumentLabel(key) {
  return {
    agreement: "Agreement",
    aadhaar: "Aadhaar",
    panCard: "PAN Card",
    rentAgreement: "Electricity Bill / Rent Agreement",
  }[key] || key;
}
