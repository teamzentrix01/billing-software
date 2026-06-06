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
    out[normalizeKey(key)] = normalizeCellValue(value, cell);
  }
  return out;
}

function normalizeCellValue(value, cell = null) {
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
