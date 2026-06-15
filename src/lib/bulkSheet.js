export async function pickSpreadsheetFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

export async function parseBulkSheet(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const headerRow =
    XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    })[0] || [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows
    .map((row, rowIndex) => normalizeRow(row, headerRow, rowIndex, sheet, XLSX))
    .filter((row) => !isBlankRow(row));
}

export function getBulkField(row, keys, fallback = "") {
  for (const key of keys) {
    const k = normalizeKey(key);
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] !== "") {
      return row[k];
    }
  }
  return fallback;
}

export function toBoolean(value, fallback = false) {
  if (value === "" || value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return fallback;
}

function normalizeRow(
  row,
  headerRow = [],
  rowIndex = 0,
  sheet = null,
  XLSX = null,
) {
  const out = { __row_index: rowIndex };
  for (const [key, value] of Object.entries(row || {})) {
    const columnIndex = Array.isArray(headerRow)
      ? headerRow.findIndex((header) => String(header) === String(key))
      : -1;
    const cell =
      sheet && XLSX && columnIndex >= 0
        ? sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })]
        : null;
    out[normalizeKey(key)] = normalizeCellValue(value, cell, XLSX);
  }
  return out;
}

function normalizeCellValue(value, cell = null, XLSX = null) {
  const displayed = String(cell?.w || "").trim();
  if (
    displayed &&
    /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(displayed)
  ) {
    return displayed;
  }

  const dateValue = getExcelDateValue(value, cell, XLSX);
  if (dateValue) return dateValue;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const normalized =
    trimmed.startsWith("'") && trimmed.length > 1 ? trimmed.slice(1) : trimmed;
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(normalized)) {
    const raw = cell?.v;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Number.isInteger(raw) ? String(raw) : String(raw);
    }
  }
  return normalized;
}

function getExcelDateValue(value, cell = null, XLSX = null) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (cell?.v instanceof Date) {
    return Number.isNaN(cell.v.getTime()) ? null : cell.v;
  }

  if (
    XLSX &&
    cell &&
    typeof cell.v === "number" &&
    Number.isFinite(cell.v) &&
    looksLikeExcelDateFormat(cell.z)
  ) {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (!parsed) return null;
    const date = new Date(parsed.y, parsed.m - 1, parsed.d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function looksLikeExcelDateFormat(format) {
  if (!format) return false;
  const normalized = String(format)
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "")
    .toLowerCase();
  return /(^|[^a-z])[dmy]{1,4}([^a-z]|$)/.test(normalized);
}

function isBlankRow(row) {
  return Object.entries(row || {}).every(
    ([key, value]) =>
      key === "__row_index" || String(value ?? "").trim() === "",
  );
}

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
