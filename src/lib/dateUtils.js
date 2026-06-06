export function toDateInputValue(value) {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatDateParts(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      "yyyy-mm-dd",
    );
  }

  const raw = String(value).trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return formatDateParts(isoMatch[1], isoMatch[2], isoMatch[3], "yyyy-mm-dd");
  }

  const indianMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (indianMatch) {
    const year = expandYear(indianMatch[3]);
    return isValidDateParts(year, indianMatch[2], indianMatch[1])
      ? formatDateParts(year, indianMatch[2], indianMatch[1], "yyyy-mm-dd")
      : "";
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatDateParts(
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate(),
    "yyyy-mm-dd",
  );
}

export function formatIndianDate(value, fallback = "-") {
  const normalized = toDateInputValue(value);
  if (!normalized) return fallback;
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${String(year).slice(-2)}`;
}

export function formatIndianDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const datePart = formatIndianDate(date, fallback);
  const timePart = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}

function expandYear(value) {
  const year = Number(value);
  if (String(value).length === 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function formatDateParts(year, month, day, mode) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!isValidDateParts(y, m, d)) return "";
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return mode === "yyyy-mm-dd" ? `${y}-${mm}-${dd}` : `${dd}/${mm}/${String(y).slice(-2)}`;
}

function isValidDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
