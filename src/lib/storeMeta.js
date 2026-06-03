function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }
  return { ...meta };
}

export function normalizeStoreCode(body = {}) {
  return String(body.storeCode || body.shortCode || '').trim();
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
  return {
    locationType: body.locationType || 'Store',
    latitude: body.latitude || '',
    longitude: body.longitude || '',
    panNumber: body.panNumber || '',
    defaultCustomerGroup: body.defaultCustomerGroup || '',
    storeCode: normalizeStoreCode(body),
    storeArea: body.storeArea || '',
    enableVoucherValidation: !!body.enableVoucherValidation,
    automaticPrint: !!body.automaticPrint,
    enableStoreStockAlert: !!body.enableStoreStockAlert,
    enableStoreOnlineBillingOnly: !!body.enableStoreOnlineBillingOnly,
    cin: body.cin || '',
    tin: body.tin || '',
    serviceTaxNumber: body.serviceTaxNumber || '',
    gstNumber: body.gstNumber || '',
    customerGstOrderPrefix: body.customerGstOrderPrefix || '',
    fssaiLicenseNumber: body.fssaiLicenseNumber || '',
    taxInformation: body.taxInformation || '',
    customStoreOrderPrefix: body.customStoreOrderPrefix || '',
    refundCustomStoreOrderPrefix: body.refundCustomStoreOrderPrefix || '',
    ncCustomStoreOrderPrefix: body.ncCustomStoreOrderPrefix || '',
    ncRefundCustomStoreOrderPrefix: body.ncRefundCustomStoreOrderPrefix || '',
    rwiCustomStoreOrderPrefix: body.rwiCustomStoreOrderPrefix || '',
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
    Object.prototype.hasOwnProperty.call(body, 'storeCode')
    || Object.prototype.hasOwnProperty.call(body, 'shortCode')
  ) {
    merged.storeCode = incoming.storeCode;
  }

  if (!merged.storeCode && merged.shortCode) {
    merged.storeCode = String(merged.shortCode).trim();
  }
  delete merged.shortCode;
  delete merged.storeGuid;
  return merged;
}

export function getStoreCode(meta) {
  const parsed = parseMeta(meta);
  return parsed.storeCode || parsed.shortCode || '';
}
