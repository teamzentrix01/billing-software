export function ean13CheckDigit(payload12) {
  const digits = String(payload12 || "")
    .replace(/\D/g, "")
    .slice(0, 12);
  if (digits.length !== 12) {
    throw new Error("EAN-13 payload must be 12 digits");
  }
  const sum = digits
    .split("")
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0,
    );
  return String((10 - (sum % 10)) % 10);
}

export function generateProductBarcode(productId) {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Product id is required to generate barcode");
  }
  const payload = `29${String(Math.trunc(id)).padStart(10, "0").slice(-10)}`;
  return `${payload}${ean13CheckDigit(payload)}`;
}

export function normalizeBarcode(value) {
  return String(value || "").trim();
}
