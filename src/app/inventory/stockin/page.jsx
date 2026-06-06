"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import InventoryShell from "@/components/inventory/InventoryShell";
import SearchableSelect from "@/components/SearchableSelect";
import { formatIndianDate, toDateInputValue } from "@/lib/dateUtils";
import {
  getBulkField,
  parseBulkSheet,
  pickSpreadsheetFile,
} from "@/lib/bulkSheet";
import {
  OPTIONS_SHEET_NAME,
  addOptionNamedRanges,
  applyTextFormatToColumns,
  excelText,
  hideOptionsSheet,
  optionFormula,
  prefixMatchOptionFormula,
  saveWorkbookWithValidations,
  sortOptions,
  uniqueOptions,
} from "@/lib/xlsxDropdowns";

async function fetchStores() {
  const res = await fetch("/api/stores");
  if (!res.ok) throw new Error("Failed to fetch stores");
  const json = await res.json();
  return json.data?.records || json.data?.stores || json.stores || [];
}

function getLocationType(store) {
  return String(store?.meta?.locationType || store?.locationType || "")
    .trim()
    .toLowerCase();
}

function isWarehouseLocation(store) {
  return getLocationType(store) === "warehouse";
}

async function fetchStockInList(filters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.source) params.set("source", filters.source);
  const qs = params.toString();
  const res = await fetch(`/api/inventory/stockin${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch stock in records");
  return res.json();
}

async function postStockIn(payload) {
  const res = await fetch("/api/inventory/stockin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Failed to create stock in");
  return json;
}

async function fetchCatalogOptions(endpoint) {
  const res = await fetch(endpoint);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  const records = json.data?.records || json.records || [];
  return Array.isArray(records) ? records : [];
}

const tableHeaders = [
  "Transaction ID",
  "Invoice Number",
  "Destination",
  "Invoice Date",
  "Total Item Number",
  "Cost",
  "Reference Transaction Type",
  "Reference ID",
];

function formatDate(value) {
  return formatIndianDate(value, "—");
}

function formatCost(value) {
  const n = Number(value || 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function mapRecordsToTable(records) {
  return (records || []).map((row) => ({
    "Transaction ID": row.transactionId
      ? `#${row.transactionId}`
      : `#STK-${row.id}`,
    "Invoice Number": row.invoiceNumber || "—",
    Destination: row.destination || "—",
    "Invoice Date": formatDate(row.invoiceDate),
    "Total Item Number": row.totalItems ?? 0,
    Cost: formatCost(row.cost),
    "Reference Transaction Type": row.referenceType || "—",
    "Reference ID": row.referenceId || "—",
  }));
}

function downloadCsv(rows) {
  const headers = tableHeaders;
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-in-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const MAX_INVOICE_UPLOAD_BYTES = 5 * 1024 * 1024;
const STOCK_IN_TEMPLATE_HEADERS = [
  "Product ID",
  "Product Name",
  "Size ID",
  "Size Name",
  "Category",
  "Brand",
  "Barcode",
  "SKU",
  "Unit",
  "Stock Items Type",
  "Quantity",
  "Cost/Unit",
  "MRP",
  "Selling Price",
  "Expiry Date",
  "Serial Number (serialNumber)",
  "serialNumber",
  "Remarks",
];
const PENDING_STOCK_IN_BULK_KEY = "pendingStockInBulkRows";
const STOCK_IN_TEMPLATE_ROW_LIMIT = 5001;
const STOCK_IN_TEXT_TEMPLATE_HEADERS = [
  "Product ID",
  "Size ID",
  "Barcode",
  "SKU",
  "Serial Number (serialNumber)",
  "serialNumber",
];
const STOCK_IN_LOOKUP_HEADERS = [
  "Product ID",
  "SKU",
  "Product Name",
  "Size ID",
  "Size Name",
  "Category",
  "Brand",
  "Barcode",
  "Unit",
  "Stock Items Type",
  "Cost/Unit",
  "MRP",
  "Selling Price",
];

const STOCK_IN_VLOOKUP_COLUMNS = {
  "Product ID": 1,
  SKU: 2,
  "Product Name": 3,
  "Size ID": 4,
  "Size Name": 5,
  Category: 6,
  Brand: 7,
  Barcode: 8,
  Unit: 9,
  "Stock Items Type": 10,
  "Cost/Unit": 11,
  MRP: 12,
  "Selling Price": 13,
};

const STOCK_IN_SKU_LOOKUP_COLUMNS = {
  SKU: 1,
  "Product ID": 2,
  "Product Name": 3,
  "Size ID": 4,
  "Size Name": 5,
  Category: 6,
  Brand: 7,
  Barcode: 8,
  Unit: 9,
  "Stock Items Type": 10,
  "Cost/Unit": 11,
  MRP: 12,
  "Selling Price": 13,
};

const STOCK_IN_BARCODE_LOOKUP_COLUMNS = {
  Barcode: 1,
  "Product ID": 2,
  SKU: 3,
  "Product Name": 4,
  "Size ID": 5,
  "Size Name": 6,
  Category: 7,
  Brand: 8,
  Unit: 9,
  "Stock Items Type": 10,
  "Cost/Unit": 11,
  MRP: 12,
  "Selling Price": 13,
};

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function normalizeImportDate(value) {
  return toDateInputValue(value);
}

function parseBulkNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/[₹$]/g, "");
  if (!cleaned) return fallback;
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stockTemplateValue(row, keys, fallback = "") {
  return getBulkField(row, keys, fallback);
}

function stockInLookupRow(product) {
  return [
    excelText(product.id),
    excelText(product.sku),
    product.productName || "",
    excelText(product.sizeId),
    product.sizeName || "",
    product.category || "",
    product.brand || "",
    excelText(product.barcode),
    product.unit || "Piece",
    product.stockItemsType || "BATCHED",
    product.costPerUnit ?? "",
    product.mrp ?? "",
    product.sellingPrice ?? "",
  ];
}

function buildStockInOptionsSheet(XLSX, optionGroups, records) {
  const lookupRows = records.map(stockInLookupRow);
  const lookupRowsForSheet = lookupRows.length
    ? lookupRows
    : [Array.from({ length: STOCK_IN_LOOKUP_HEADERS.length }, () => "")];
  const idLookupStart = optionGroups.length + 1;
  const skuLookupStart = idLookupStart + STOCK_IN_LOOKUP_HEADERS.length + 1;
  const barcodeLookupStart =
    skuLookupStart + STOCK_IN_LOOKUP_HEADERS.length + 1;
  const maxRows = Math.max(
    1,
    ...optionGroups.map((group) => group.values.length + 1),
    lookupRowsForSheet.length + 1,
  );
  const rows = Array.from({ length: maxRows }, () => []);

  optionGroups.forEach((group, col) => {
    rows[0][col] = group.key;
    group.values.forEach((value, row) => {
      rows[row + 1][col] = excelText(value);
    });
  });

  STOCK_IN_LOOKUP_HEADERS.forEach((header, index) => {
    rows[0][idLookupStart + index] = header;
  });
  lookupRowsForSheet.forEach((lookupRow, rowIndex) => {
    lookupRow.forEach((value, colIndex) => {
      rows[rowIndex + 1][idLookupStart + colIndex] = excelText(value);
    });
  });

  const skuLookupHeaders = [
    "SKU",
    "Product ID",
    ...STOCK_IN_LOOKUP_HEADERS.slice(2),
  ];
  skuLookupHeaders.forEach((header, index) => {
    rows[0][skuLookupStart + index] = header;
  });
  lookupRowsForSheet.forEach((lookupRow, rowIndex) => {
    const skuRow = [lookupRow[1], lookupRow[0], ...lookupRow.slice(2)];
    skuRow.forEach((value, colIndex) => {
      rows[rowIndex + 1][skuLookupStart + colIndex] = excelText(value);
    });
  });

  const barcodeLookupHeaders = [
    "Barcode",
    "Product ID",
    "SKU",
    "Product Name",
    "Size ID",
    "Size Name",
    "Category",
    "Brand",
    "Unit",
    "Stock Items Type",
    "Cost/Unit",
    "MRP",
    "Selling Price",
  ];
  barcodeLookupHeaders.forEach((header, index) => {
    rows[0][barcodeLookupStart + index] = header;
  });
  lookupRowsForSheet.forEach((lookupRow, rowIndex) => {
    const barcodeRow = [
      lookupRow[7],
      lookupRow[0],
      lookupRow[1],
      ...lookupRow.slice(2, 7),
      ...lookupRow.slice(8),
    ];
    barcodeRow.forEach((value, colIndex) => {
      rows[rowIndex + 1][barcodeLookupStart + colIndex] = excelText(value);
    });
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
  for (let columnIndex = 0; columnIndex <= range.e.c; columnIndex++) {
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex++) {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (!worksheet[ref]) continue;
      worksheet[ref].t = "s";
      worksheet[ref].z = "@";
    }
  }

  return {
    worksheet,
    idLookupRange: `'${OPTIONS_SHEET_NAME}'!$${XLSX.utils.encode_col(
      idLookupStart,
    )}$2:$${XLSX.utils.encode_col(
      idLookupStart + STOCK_IN_LOOKUP_HEADERS.length - 1,
    )}$${lookupRowsForSheet.length + 1}`,
    skuLookupRange: `'${OPTIONS_SHEET_NAME}'!$${XLSX.utils.encode_col(
      skuLookupStart,
    )}$2:$${XLSX.utils.encode_col(
      skuLookupStart + STOCK_IN_LOOKUP_HEADERS.length - 1,
    )}$${lookupRowsForSheet.length + 1}`,
    barcodeLookupRange: `'${OPTIONS_SHEET_NAME}'!$${XLSX.utils.encode_col(
      barcodeLookupStart,
    )}$2:$${XLSX.utils.encode_col(
      barcodeLookupStart + barcodeLookupHeaders.length - 1,
    )}$${lookupRowsForSheet.length + 1}`,
  };
}

function stockInLookupFormula(
  header,
  rowNumber,
  idLookupRange,
  skuLookupRange,
  barcodeLookupRange,
) {
  const productIdCell = `$A${rowNumber}`;
  const barcodeCell = `$G${rowNumber}`;
  const skuCell = `$H${rowNumber}`;
  const textValue = (cell) => `""&${cell}`;
  const barcodeTextValue = `IF(LEFT(${textValue(
    barcodeCell,
  )},1)="'",MID(${textValue(barcodeCell)},2,32767),${textValue(barcodeCell)})`;
  const lookup = (cell, range, column) =>
    `IFERROR(VLOOKUP(${textValue(cell)},${range},${column},FALSE),"")`;
  const barcodeLookup = (column) =>
    `IFERROR(VLOOKUP(${barcodeTextValue},${barcodeLookupRange},${column},FALSE),"")`;

  if (header === "Product ID") {
    return `IF(LEN(TRIM(${skuCell}))>0,${lookup(
      skuCell,
      skuLookupRange,
      STOCK_IN_SKU_LOOKUP_COLUMNS[header],
    )},IF(LEN(TRIM(${barcodeCell}))>0,${barcodeLookup(
      STOCK_IN_BARCODE_LOOKUP_COLUMNS[header],
    )},""))`;
  }

  if (header === "SKU") {
    return `IF(LEN(TRIM(${productIdCell}))>0,${lookup(
      productIdCell,
      idLookupRange,
      STOCK_IN_VLOOKUP_COLUMNS[header],
    )},IF(LEN(TRIM(${barcodeCell}))>0,${barcodeLookup(
      STOCK_IN_BARCODE_LOOKUP_COLUMNS[header],
    )},""))`;
  }

  if (header === "Barcode") {
    return `IF(LEN(TRIM(${productIdCell}))>0,${lookup(
      productIdCell,
      idLookupRange,
      STOCK_IN_VLOOKUP_COLUMNS[header],
    )},IF(LEN(TRIM(${skuCell}))>0,${lookup(
      skuCell,
      skuLookupRange,
      STOCK_IN_SKU_LOOKUP_COLUMNS[header],
    )},""))`;
  }

  const lookupColumn = STOCK_IN_VLOOKUP_COLUMNS[header];
  if (!lookupColumn) return "";
  return `IF(LEN(TRIM(${productIdCell}))>0,${lookup(
    productIdCell,
    idLookupRange,
    lookupColumn,
  )},IF(LEN(TRIM(${skuCell}))>0,${lookup(
    skuCell,
    skuLookupRange,
    STOCK_IN_SKU_LOOKUP_COLUMNS[header],
  )},IF(LEN(TRIM(${barcodeCell}))>0,${barcodeLookup(
    STOCK_IN_BARCODE_LOOKUP_COLUMNS[header],
  )},"")))`;
}

function applyStockInVlookupFormulas(
  XLSX,
  worksheet,
  idLookupRange,
  skuLookupRange,
  barcodeLookupRange,
) {
  const formulaHeaders = new Set(
    Object.keys(STOCK_IN_VLOOKUP_COLUMNS).filter(
      (header) => !["Product ID", "SKU", "Barcode"].includes(header),
    ),
  );
  const numericFormulaHeaders = new Set(["Cost/Unit", "MRP", "Selling Price"]);
  for (
    let rowNumber = 2;
    rowNumber <= STOCK_IN_TEMPLATE_ROW_LIMIT;
    rowNumber++
  ) {
    STOCK_IN_TEMPLATE_HEADERS.forEach((header, columnIndex) => {
      if (!formulaHeaders.has(header)) return;
      const formula = stockInLookupFormula(
        header,
        rowNumber,
        idLookupRange,
        skuLookupRange,
        barcodeLookupRange,
      );
      if (!formula) return;
      const ref = XLSX.utils.encode_cell({
        r: rowNumber - 1,
        c: columnIndex,
      });
      const existingValue = worksheet[ref]?.v ?? "";
      worksheet[ref] = {
        t: numericFormulaHeaders.has(header) ? "n" : "str",
        f: formula,
        v: existingValue,
      };
    });
  }
}

function clearStockInQuantityColumn(XLSX, worksheet) {
  const columnIndex = STOCK_IN_TEMPLATE_HEADERS.indexOf("Quantity");
  if (columnIndex < 0) return;
  for (
    let rowNumber = 2;
    rowNumber <= STOCK_IN_TEMPLATE_ROW_LIMIT;
    rowNumber++
  ) {
    const ref = XLSX.utils.encode_cell({
      r: rowNumber - 1,
      c: columnIndex,
    });
    delete worksheet[ref];
  }
}

function applyStockInBarcodeTextWarningCells(XLSX, worksheet, filledRowCount) {
  const columnIndex = STOCK_IN_TEMPLATE_HEADERS.indexOf("Barcode");
  if (columnIndex < 0) return;
  const column = XLSX.utils.encode_col(columnIndex);
  for (let rowNumber = 2; rowNumber <= filledRowCount + 1; rowNumber++) {
    const ref = `${column}${rowNumber}`;
    const cell = worksheet[ref];
    if (!cell || String(cell.v ?? "").trim() === "") continue;
    const value = excelText(cell.v).replace(/^'/, "");
    cell.t = "s";
    cell.v = value;
    cell.w = value;
    delete cell.z;
  }
}

function applyStockInExpiryDateFormat(XLSX, worksheet, rowLimit) {
  const columnIndex = STOCK_IN_TEMPLATE_HEADERS.indexOf("Expiry Date");
  if (columnIndex < 0) return;
  const column = XLSX.utils.encode_col(columnIndex);
  for (let rowNumber = 2; rowNumber <= rowLimit; rowNumber++) {
    const ref = `${column}${rowNumber}`;
    if (worksheet[ref]) worksheet[ref].z = "dd/mm/yyyy";
  }
}

function buildCreateProductUrl(row) {
  const params = new URLSearchParams();
  params.set("returnTo", "/inventory/stockin?resumeStockInBulk=1");
  params.set("source", "stock-in-bulk");
  const mappings = [
    ["name", ["product_name", "name"]],
    ["product_id", ["product_id"]],
    ["barcode", ["barcode"]],
    ["sku", ["sku"]],
    ["unit", ["unit"]],
    ["category_name", ["category"]],
    ["brand_name", ["brand"]],
    ["mrp", ["mrp"]],
    ["selling_price", ["selling_price"]],
    ["cost_price", ["cost_unit", "cost_per_unit", "cost"]],
    ["stock_item_type", ["stock_items_type"]],
    ["expiry_date", ["expiry_date"]],
  ];

  for (const [target, keys] of mappings) {
    const value = stockTemplateValue(row, keys);
    if (value !== "") params.set(target, String(value));
  }

  return `/catalog/products/create?${params.toString()}`;
}

function normalizeProductLookupValue(value) {
  return String(value || "")
    .trim()
    .replace(/^'+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function compactProductLookupValue(value) {
  return normalizeProductLookupValue(value).replace(/[^a-z0-9]/g, "");
}

function findStockInTemplateProductMatch(
  products,
  { productId, productName, barcode, sku },
) {
  const lookups = [
    normalizeProductLookupValue(productId),
    normalizeProductLookupValue(barcode),
    normalizeProductLookupValue(sku),
    normalizeProductLookupValue(productName),
  ].filter(Boolean);
  const compactLookups = lookups.map(compactProductLookupValue).filter(Boolean);

  for (const product of products || []) {
    const identifiers = [
      product.id,
      product.productId,
      product.barcode,
      product.sku,
      product.productName,
    ];
    const normalizedIdentifiers = identifiers
      .map(normalizeProductLookupValue)
      .filter(Boolean);
    if (lookups.some((lookup) => normalizedIdentifiers.includes(lookup))) {
      return product;
    }

    const compactIdentifiers = identifiers
      .map(compactProductLookupValue)
      .filter(Boolean);
    if (
      compactLookups.some((lookup) => compactIdentifiers.includes(lookup))
    ) {
      return product;
    }
  }

  return null;
}

// ─── Destination Picker Modal ────────────────────────────────────────────────
function DestinationPickerModal({ stores, onConfirm, onCancel }) {
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");

  const filteredStores = stores.filter((store) =>
    `${store.name || ""} ${store.id || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-[17px] font-bold text-gray-900">
            Select Destination
          </h2>
          <p className="mt-1 text-[13px] text-gray-500">
            Choose the store or warehouse for this bulk stock in.
          </p>
        </div>

        <div className="px-6 pt-4 pb-2">
          <input
            autoFocus
            type="text"
            placeholder="Search store or warehouse..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
          />
        </div>

        <div className="px-6 pb-2 max-h-60 overflow-y-auto">
          {filteredStores.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">
              No stores found.
            </p>
          ) : (
            <div className="space-y-1 py-1">
              {filteredStores.map((store) => {
                const locationType = getLocationType(store);
                const isWarehouse = locationType === "warehouse";
                const isSelected = String(store.id) === String(selectedId);
                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedId(String(store.id))}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50 border border-blue-300"
                        : "border border-transparent hover:bg-gray-50"
                    }`}
                  >
                    <div>
                      <span className="block text-sm font-medium text-gray-800">
                        {store.name}
                      </span>
                      <span className="block text-[11px] text-gray-400">
                        ID: {store.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {locationType && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            isWarehouse
                              ? "bg-purple-100 text-purple-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {isWarehouse ? "Warehouse" : locationType || "Store"}
                        </span>
                      )}
                      {isSelected && (
                        <svg
                          className="h-4 w-4 text-blue-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => onConfirm(selectedId)}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function StockInPage() {
  const [showModal, setShowModal] = useState(false);
  const [stores, setStores] = useState([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [activeTab, setActiveTab] = useState("new");
  const [sourceType, setSourceType] = useState("warehouse");
  const [destination, setDestination] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [vendors, setVendors] = useState([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [applyTaxes, setApplyTaxes] = useState(true);
  const [addProductsPrefill, setAddProductsPrefill] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [tableData, setTableData] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [showTemplateFilters, setShowTemplateFilters] = useState(false);
  const [templateBrands, setTemplateBrands] = useState([]);
  const [templateCategories, setTemplateCategories] = useState([]);
  const [loadingTemplateOptions, setLoadingTemplateOptions] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [templateFilters, setTemplateFilters] = useState({
    vendorId: "",
    brandIds: [],
    categoryId: "",
  });
  const [filters, setFilters] = useState({
    search: "",
    dateFrom: "",
    dateTo: "",
    source: "",
  });
  const [pendingMissingProduct, setPendingMissingProduct] = useState(null);
  const [bulkPreviewRows, setBulkPreviewRows] = useState([]);
  const [bulkPreviewSelected, setBulkPreviewSelected] = useState({});

  // ── NEW: state for destination picker modal (bulk import flow) ──
  const [destinationPickerRows, setDestinationPickerRows] = useState(null);
  const [destinationPickerStores, setDestinationPickerStores] = useState([]);
  const [showDestinationPicker, setShowDestinationPicker] = useState(false);

  const fileInputRef = useRef(null);
  const router = useRouter();
  const destinationStores =
    sourceType === "vendor"
      ? stores
      : stores.filter((store) => !isWarehouseLocation(store));
  const filteredVendors = vendors.filter((vendor) =>
    `${vendor.name || ""} ${vendor.company || ""}`
      .toLowerCase()
      .includes(vendorQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    if (sourceType === "vendor") return;
    if (!destination) return;
    const selectedStore = stores.find(
      (store) => String(store.id) === String(destination),
    );
    if (selectedStore && isWarehouseLocation(selectedStore)) {
      setDestination("");
    }
  }, [destination, sourceType, stores]);

  useEffect(() => {
    setLoadingList(true);
    fetchStockInList(filters)
      .then((data) => setTableData(mapRecordsToTable(data)))
      .catch(() => setTableData([]))
      .finally(() => setLoadingList(false));
  }, [filters]);

  useEffect(() => {
    if (!showModal) return;
    setLoadingStores(true);
    Promise.all([
      fetchStores().catch(() => []),
      fetch("/api/vendors?pageSize=500")
        .then((r) => r.json())
        .catch(() => []),
    ])
      .then(([storeData, vendorData]) => {
        setStores(Array.isArray(storeData) ? storeData : []);
        setVendors(Array.isArray(vendorData) ? vendorData : []);
      })
      .catch(() => {
        setStores([]);
        setVendors([]);
      })
      .finally(() => setLoadingStores(false));
  }, [showModal]);

  useEffect(() => {
    if (!showTemplateFilters) return;
    setLoadingTemplateOptions(true);
    Promise.all([
      fetch("/api/vendors?pageSize=1000")
        .then((r) => r.json())
        .catch(() => []),
      fetchCatalogOptions("/api/catalog/brands?pageSize=1000").catch(
        () => [],
      ),
      fetchCatalogOptions("/api/catalog/categories?pageSize=1000").catch(
        () => [],
      ),
    ])
      .then(([vendorData, brands, categories]) => {
        setVendors(Array.isArray(vendorData) ? vendorData : []);
        setTemplateBrands(
          brands
            .filter((brand) => brand?.is_active !== false)
            .map((brand) => ({
              id: String(brand.id || "").trim(),
              name: String(brand.name || "").trim(),
            }))
            .filter((brand) => brand.id && brand.name)
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
            ),
        );
        setTemplateCategories(categories);
      })
      .catch(() => {
        setVendors([]);
        setTemplateBrands([]);
        setTemplateCategories([]);
      })
      .finally(() => setLoadingTemplateOptions(false));
  }, [showTemplateFilters]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("resumeStockInBulk") !== "1") return;

    const savedRows = window.sessionStorage.getItem(PENDING_STOCK_IN_BULK_KEY);
    if (!savedRows) return;

    window.sessionStorage.removeItem(PENDING_STOCK_IN_BULK_KEY);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("resumeStockInBulk");
    window.history.replaceState({}, "", nextUrl.toString());

    try {
      const rows = JSON.parse(savedRows);
      if (Array.isArray(rows) && rows.length) {
        handleParsedBulkRows(rows, { persistOnMissing: true });
      }
    } catch {
      alert(
        "Unable to resume the previous bulk upload. Please upload the template again.",
      );
    }
  }, []);

  const handleOpen = () => setShowModal(true);
  const handleClose = () => {
    setShowModal(false);
    setSelectedFile(null);
    setPurchaseOrderId("");
    setInvoiceNumber("");
  };

  const openBulkPreview = (rows) => {
    const selectedMap = Object.fromEntries(
      rows.map((row) => [row.preview_id, true]),
    );
    setBulkPreviewRows(rows);
    setBulkPreviewSelected(selectedMap);
  };

  const closeBulkPreview = () => {
    window.sessionStorage.removeItem(PENDING_STOCK_IN_BULK_KEY);
    setBulkPreviewRows([]);
    setBulkPreviewSelected({});
  };

  const confirmBulkPreview = async () => {
    const selectedRows = bulkPreviewRows.filter(
      (row) => bulkPreviewSelected[row.preview_id],
    );
    if (!selectedRows.length) {
      alert("Please select at least one product to add.");
      return;
    }
    closeBulkPreview();
    await processBulkRows(selectedRows);
  };

  // ── UPDATED: replaced window.prompt with modal ──
  const processBulkRows = async (selectedRows, destinationId) => {
    if (!selectedRows.length) {
      alert(
        "Please enter a quantity for the products you want to add, then upload the template again.",
      );
      return;
    }

    // If no destinationId yet, load stores and open the picker modal
    if (!destinationId) {
      const storeData = stores.length
        ? stores
        : await fetchStores().catch(() => []);
      setDestinationPickerStores(Array.isArray(storeData) ? storeData : []);
      setDestinationPickerRows(selectedRows);
      setShowDestinationPicker(true);
      return;
    }

    // Proceed with confirmed destinationId
    const draft = await postStockIn({
      method: "new",
      destination: String(destinationId).trim(),
      sourceType: "vendor",
      applyTaxes: true,
      addProductsPrefill: true,
    });

    const updateRes = await fetch(
      `/api/inventory/stockin/${encodeURIComponent(draft.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: {
            remarks: "Created from bulk stock in template",
          },
          items: selectedRows,
        }),
      },
    );
    const updateJson = await updateRes.json().catch(() => ({}));
    if (!updateRes.ok) {
      alert(updateJson.error || "Unable to create the bulk stock draft.");
      return;
    }

    setLoadingList(true);
    fetchStockInList(filters)
      .then((data) => setTableData(mapRecordsToTable(data)))
      .catch(() => setTableData([]))
      .finally(() => setLoadingList(false));

    window.sessionStorage.removeItem(PENDING_STOCK_IN_BULK_KEY);
    router.push(
      `/inventory/stockin/line-items?id=${encodeURIComponent(draft.id)}`,
    );
  };

  // Handler when user confirms destination in the picker modal
  const handleDestinationPickerConfirm = async (destinationId) => {
    setShowDestinationPicker(false);
    const rows = destinationPickerRows;
    setDestinationPickerRows(null);
    await processBulkRows(rows, destinationId);
  };

  const handleDestinationPickerCancel = () => {
    setShowDestinationPicker(false);
    setDestinationPickerRows(null);
  };

  const handleParsedBulkRows = async (
    rows,
    { persistOnMissing = false } = {},
  ) => {
    if (!Array.isArray(rows) || !rows.length) {
      alert("No rows found in selected file.");
      return;
    }

    const templateRes = await fetch(
      "/api/inventory/stockin?template=products",
      { cache: "no-store" },
    );
    const templateJson = await templateRes.json().catch(() => ({}));
    let existingProducts = Array.isArray(templateJson.records)
      ? templateJson.records
      : [];
    try {
      const catalogRes = await fetch("/api/catalog/products?pageSize=10000", {
        cache: "no-store",
      });
      const catalogJson = await catalogRes.json().catch(() => ({}));
      const catalogProducts =
        catalogJson.data?.records || catalogJson.records || [];
      if (Array.isArray(catalogProducts) && catalogProducts.length) {
        const byId = new Map(
          existingProducts.map((product) => [String(product.id), product]),
        );
        catalogProducts.forEach((product) => {
          const id = String(product.id || "");
          if (!id || byId.has(id)) return;
          byId.set(id, {
            id: product.id,
            productId: product.product_id || product.productId || product.id,
            productName: product.name || product.productName || "",
            barcode: product.barcode || "",
            sku: product.sku || "",
            costPerUnit: Number(product.cost_price || product.costPerUnit || 0),
            mrp: Number(product.mrp || 0),
            sellingPrice: Number(
              product.selling_price || product.sellingPrice || 0,
            ),
          });
        });
        existingProducts = Array.from(byId.values());
      }
    } catch {
      // Stock-in template records are enough for normal uploads.
    }

    const selectedRows = rows
      .map((row, index) => {
        const productId = getBulkField(row, [
          "product_id",
          "product_code",
          "item_code",
          "code",
        ]);
        const productName = getBulkField(row, [
          "product_name",
          "item_name",
          "product",
          "name",
        ]);
        const barcode = getBulkField(row, [
          "barcode",
          "bar_code",
          "ean",
          "upc",
        ]);
        const sku = getBulkField(row, ["sku", "sku_code", "barcode_value"]);
        const qty = parseBulkNumber(
          getBulkField(
            row,
            [
              "quantity",
              "qty",
              "total_qty",
              "total_quantity",
              "stock_qty",
              "stock_in_qty",
              "stock_in_quantity",
              "qty_in",
            ],
            0,
          ),
        );
        if (!Number.isFinite(qty) || qty <= 0) return null;
        const templateRowProduct =
          Number.isInteger(row.__row_index) && row.__row_index >= 0
            ? existingProducts[row.__row_index]
            : existingProducts[index];
        const matchedProduct = findStockInTemplateProductMatch(
          existingProducts,
          {
            productId,
            productName,
            barcode,
            sku,
          },
        ) || templateRowProduct;
        if (!matchedProduct) {
          return {
            missing: true,
            originalRow: row,
            productName: productName || productId || barcode || sku || "Row " + (index + 2),
          };
        }
        const expiryDate = normalizeImportDate(
          getBulkField(row, ["expiry_date"]),
        );
        const batchNo =
          getBulkField(row, [
            "serial_number_serialnumber",
            "serialnumber",
            "serial_number",
          ]) || "";

        return {
          preview_id: `${matchedProduct.id}-${index}`,
          product_id: matchedProduct.id,
          product_name: matchedProduct.productName || productName || "",
          sku: matchedProduct.sku || sku || matchedProduct.barcode || "",
          qty,
          cost_price:
            parseBulkNumber(
              getBulkField(
                row,
                ["cost_unit", "cost_per_unit", "cost_price", "cost"],
                0,
              ),
            ) || 0,
          tax_value: 0,
          batch_no: batchNo,
          expiry_date: expiryDate,
          batches: [
            {
              batch_no: batchNo,
              qty,
              expiry_date: expiryDate,
            },
          ],
          remarks: getBulkField(row, ["remarks"]),
        };
      })
      .filter(Boolean);

    const missingProduct = selectedRows.find((row) => row.missing);
    if (missingProduct) {
      if (persistOnMissing) {
        window.sessionStorage.setItem(
          PENDING_STOCK_IN_BULK_KEY,
          JSON.stringify(rows),
        );
      }
      setPendingMissingProduct({
        ...missingProduct,
        originalRows: rows,
        existingRows: selectedRows.filter((row) => !row.missing),
      });
      return;
    }

    openBulkPreview(selectedRows);
  };

  const handleBulkImport = async () => {
    try {
      const file = await pickSpreadsheetFile();
      if (!file) return;

      const rows = await parseBulkSheet(file);
      window.sessionStorage.setItem(
        PENDING_STOCK_IN_BULK_KEY,
        JSON.stringify(rows),
      );
      await handleParsedBulkRows(rows, { persistOnMissing: true });
    } catch (err) {
      console.error(err);
      alert("Bulk import failed. Please use a valid Excel/CSV file.");
    }
  };

  const handleOpenTemplateFilters = () => setShowTemplateFilters(true);

  const handleCloseTemplateFilters = () => {
    if (downloadingTemplate) return;
    setShowTemplateFilters(false);
  };

  const handleDownloadBulkTemplate = async () => {
    if (!templateFilters.vendorId) {
      alert("Please select a vendor first.");
      return;
    }
    if (!templateFilters.brandIds.length) {
      alert("Please select at least one brand.");
      return;
    }
    setDownloadingTemplate(true);
    try {
      const params = new URLSearchParams({ template: "products" });
      if (templateFilters.brandIds.length) {
        params.set("brand_ids", templateFilters.brandIds.join(","));
      }
      if (templateFilters.categoryId) {
        params.set("category_id", templateFilters.categoryId);
      }
      const res = await fetch(`/api/inventory/stockin?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      const records = Array.isArray(json.records) ? json.records : [];
      if (!records.length) {
        alert("No products found for the selected brand or category.");
        return;
      }
      const productRows = records.map((product) => ({
        "Product ID": excelText(product.id),
        "Product Name": product.productName,
        "Size ID": excelText(product.sizeId),
        "Size Name": product.sizeName,
        Category: product.category,
        Brand: product.brand,
        Barcode: excelText(product.barcode),
        SKU: excelText(product.sku),
        Unit: product.unit || "Piece",
        "Stock Items Type": product.stockItemsType || "BATCHED",
        Quantity: "",
        "Cost/Unit": product.costPerUnit,
        MRP: product.mrp,
        "Selling Price": product.sellingPrice,
        "Expiry Date": "",
        "Serial Number (serialNumber)": "",
        serialNumber: "",
        Remarks: "",
      }));
      const rows = productRows;

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows, {
        header: STOCK_IN_TEMPLATE_HEADERS,
      });
      worksheet["!cols"] = STOCK_IN_TEMPLATE_HEADERS.map((header) => ({
        wch:
          header === "Barcode"
            ? 20
            : ["Product ID", "Size ID", "SKU"].includes(header)
              ? 16
              : Math.max(12, Math.min(28, header.length + 2)),
      }));
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      applyTextFormatToColumns(
        worksheet,
        STOCK_IN_TEMPLATE_HEADERS,
        STOCK_IN_TEXT_TEMPLATE_HEADERS,
        Math.max(2, productRows.length + 1),
      );
      applyStockInBarcodeTextWarningCells(XLSX, worksheet, productRows.length);
      applyStockInExpiryDateFormat(
        XLSX,
        worksheet,
        Math.max(2, productRows.length + 1),
      );

      const optionGroups = [
        {
          key: "product_ids",
          name: "StockInProductIds",
          values: sortOptions(
            uniqueOptions(records.map((product) => excelText(product.id))),
          ),
        },
        {
          key: "product_names",
          name: "StockInProductNames",
          values: sortOptions(
            uniqueOptions(records.map((product) => product.productName)),
          ),
        },
        {
          key: "size_ids",
          name: "StockInSizeIds",
          values: sortOptions(
            uniqueOptions(records.map((product) => excelText(product.sizeId))),
          ),
        },
        {
          key: "size_names",
          name: "StockInSizeNames",
          values: sortOptions(
            uniqueOptions(records.map((product) => product.sizeName)),
          ),
        },
        {
          key: "categories",
          name: "StockInCategories",
          values: sortOptions(
            uniqueOptions(records.map((product) => product.category)),
          ),
        },
        {
          key: "brands",
          name: "StockInBrands",
          values: sortOptions(
            uniqueOptions(records.map((product) => product.brand)),
          ),
        },
        {
          key: "barcodes",
          name: "StockInBarcodes",
          values: sortOptions(
            uniqueOptions(records.map((product) => excelText(product.barcode))),
          ),
        },
        {
          key: "skus",
          name: "StockInSkus",
          values: sortOptions(
            uniqueOptions(records.map((product) => product.sku)),
          ),
        },
        {
          key: "units",
          name: "StockInUnits",
          values: uniqueOptions([
            "Piece",
            "PCS",
            "KG",
            "LTR",
            ...records.map((product) => product.unit),
          ]),
        },
        {
          key: "stock_item_types",
          name: "StockInItemTypes",
          values: ["BATCHED", "UNBATCHED"],
        },
      ];

      const validations = [
        ["Product ID", "product_ids"],
        ["Product Name", "product_names"],
        ["Size ID", "size_ids"],
        ["Size Name", "size_names"],
        ["Category", "categories"],
        ["Brand", "brands"],
        ["SKU", "skus"],
        ["Unit", "units"],
        ["Stock Items Type", "stock_item_types"],
      ]
        .map(([header, optionKey]) => {
          const columnIndex = STOCK_IN_TEMPLATE_HEADERS.indexOf(header);
          if (columnIndex < 0) return null;
          const column = XLSX.utils.encode_col(columnIndex);
          const formula =
            optionKey === "stock_item_types" || optionKey === "units"
              ? optionFormula(optionGroups, optionKey)
              : prefixMatchOptionFormula(optionGroups, optionKey, `${column}2`);
          if (!formula) return null;
          return {
            range: `${column}2:${column}${Math.max(2, productRows.length + 1)}`,
            formula,
          };
        })
        .filter(Boolean);

      const workbook = XLSX.utils.book_new();
      const {
        worksheet: optionsWorksheet,
        idLookupRange,
        skuLookupRange,
        barcodeLookupRange,
      } = buildStockInOptionsSheet(XLSX, optionGroups, records);
      clearStockInQuantityColumn(XLSX, worksheet);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Bulk Stock In");
      XLSX.utils.book_append_sheet(
        workbook,
        optionsWorksheet,
        OPTIONS_SHEET_NAME,
      );
      addOptionNamedRanges(workbook, optionGroups);
      workbook.Workbook = workbook.Workbook || {};
      workbook.Workbook.CalcPr = {
        ...(workbook.Workbook.CalcPr || {}),
        fullCalcOnLoad: true,
        forceFullCalc: true,
      };
      hideOptionsSheet(workbook);
      await saveWorkbookWithValidations(
        workbook,
        `Stock In Template ${new Date().toISOString().slice(0, 10)}.xlsx`,
        validations,
        "xl/worksheets/sheet1.xml",
        {
          quotePrefixRanges: [`G2:G${Math.max(2, productRows.length + 1)}`],
        },
      );
      setShowTemplateFilters(false);
    } catch (err) {
      console.error(err);
      alert("Stock In template download failed.");
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleNext = async () => {
    if (!destination) return alert("Please select a destination");
    if (sourceType === "vendor" && selectedVendorIds.length === 0) {
      return alert("Please select at least one vendor");
    }
    if (activeTab === "po" && !purchaseOrderId.trim()) {
      return alert("Please enter Purchase Order ID");
    }
    setSubmitting(true);
    try {
      const payload = {
        method: activeTab === "new" ? "new" : "purchase_order",
        destination,
        sourceType,
        vendorIds: sourceType === "vendor" ? selectedVendorIds : [],
        vendorNames:
          sourceType === "vendor"
            ? vendors
                .filter((vendor) =>
                  selectedVendorIds.includes(String(vendor.id)),
                )
                .map((vendor) => vendor.name)
            : [],
        applyTaxes,
        addProductsPrefill,
        purchaseOrderId: activeTab === "po" ? purchaseOrderId.trim() : null,
        invoiceNumber: activeTab === "po" ? invoiceNumber.trim() || null : null,
      };
      const created = await postStockIn(payload);
      const stockId = created.id;
      setShowModal(false);
      router.push(
        `/inventory/stockin/line-items?id=${encodeURIComponent(stockId)}`,
      );
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to create stock in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: "Inventory" }, { label: "Stock In" }]}
        title="Stock In"
        subtitle="Stock In transaction history of last 7 days. Need Help?"
        actions={[
          {
            label: "Download Bulk Template",
            onClick: handleOpenTemplateFilters,
          },
          { label: "Upload Filled Template", onClick: handleBulkImport },
          { label: "Add Stock", primary: true, onClick: handleOpen },
        ]}
        searchPlaceholder="Search"
        searchValue={filters.search}
        onSearchChange={(value) =>
          setFilters((current) => ({ ...current, search: value }))
        }
        filters={
          <>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters((current) => ({
                  ...current,
                  dateFrom: e.target.value,
                }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-700"
              title="From date"
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters((current) => ({
                  ...current,
                  dateTo: e.target.value,
                }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-700"
              title="To date"
            />
            <select
              value={filters.source}
              onChange={(e) =>
                setFilters((current) => ({
                  ...current,
                  source: e.target.value,
                }))
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-700"
            >
              <option value="">All Sources</option>
              <option value="product">Product</option>
              <option value="purchase_order">GRN / Purchase Order</option>
            </select>
            <button
              type="button"
              onClick={() =>
                setFilters({ search: "", dateFrom: "", dateTo: "", source: "" })
              }
              className="rounded-lg border border-gray-200 px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          </>
        }
        onDownload={() => downloadCsv(tableData)}
        tableHeaders={tableHeaders}
        tableData={loadingList ? [] : tableData}
        emptyMessage={loadingList ? "Loading records…" : "No Records Found"}
      />

      {/* ── Destination Picker Modal (bulk import flow) ── */}
      {showDestinationPicker && (
        <DestinationPickerModal
          stores={destinationPickerStores}
          onConfirm={handleDestinationPickerConfirm}
          onCancel={handleDestinationPickerCancel}
        />
      )}

      {bulkPreviewRows.length > 0 && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 px-4">
          <div className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Review Products To Add
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Select only the products that should be added to this stock in.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBulkPreview}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                title="Cancel"
              >
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="w-16 px-4 py-3 text-left">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            bulkPreviewRows.length > 0 &&
                            bulkPreviewRows.every(
                              (row) => bulkPreviewSelected[row.preview_id],
                            )
                          }
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setBulkPreviewSelected(
                              Object.fromEntries(
                                bulkPreviewRows.map((row) => [
                                  row.preview_id,
                                  checked,
                                ]),
                              ),
                            );
                          }}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <span>S.No</span>
                      </label>
                    </th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">SKU</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-left">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bulkPreviewRows.map((row, index) => (
                    <tr
                      key={row.preview_id}
                      className={
                        bulkPreviewSelected[row.preview_id]
                          ? "bg-white"
                          : "bg-gray-50 text-gray-400"
                      }
                    >
                      <td className="px-4 py-3">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!bulkPreviewSelected[row.preview_id]}
                            onChange={(event) =>
                              setBulkPreviewSelected((current) => ({
                                ...current,
                                [row.preview_id]: event.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span>{index + 1}</span>
                        </label>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {row.product_name || row.name || `Product ${row.product_id}`}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {row.sku || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">{row.qty}</td>
                      <td className="px-4 py-3 text-right">
                        {formatCost(row.cost_price)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(row.expiry_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
              <span className="text-sm text-gray-600">
                {bulkPreviewRows.filter((row) => bulkPreviewSelected[row.preview_id]).length} of {bulkPreviewRows.length} selected
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeBulkPreview}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBulkPreview}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTemplateFilters && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={handleCloseTemplateFilters}
          />
          <div className="relative mt-16 w-full max-w-lg rounded-md bg-white shadow-lg">
            <div className="border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Download Bulk Template
              </h3>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-800">
                  Vendor
                </label>
                <select
                  value={templateFilters.vendorId}
                  onChange={(event) =>
                    setTemplateFilters((current) => ({
                      ...current,
                      vendorId: event.target.value,
                      brandIds: [],
                    }))
                  }
                  disabled={loadingTemplateOptions || downloadingTemplate}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-200"
                >
                  <option value="">Select Vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={String(vendor.id)}>
                      {vendor.name}
                      {vendor.company ? ` - ${vendor.company}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-800">
                    Brands
                  </label>
                  {templateBrands.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setTemplateFilters((current) => ({
                          ...current,
                          brandIds:
                            current.brandIds.length === templateBrands.length
                              ? []
                              : templateBrands.map((brand) => String(brand.id)),
                        }))
                      }
                      className="text-xs font-semibold text-red-600 hover:underline"
                    >
                      {templateFilters.brandIds.length === templateBrands.length
                        ? "Clear all"
                        : "Select all"}
                    </button>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-3">
                  {!templateFilters.vendorId ? (
                    <p className="text-sm text-gray-500">
                      Select vendor first.
                    </p>
                  ) : loadingTemplateOptions ? (
                    <p className="text-sm text-gray-500">Loading brands...</p>
                  ) : templateBrands.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {templateBrands.map((brand) => (
                        <label
                          key={brand.id}
                          className="inline-flex items-center gap-2 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={templateFilters.brandIds.includes(
                              String(brand.id),
                            )}
                            onChange={(event) =>
                              setTemplateFilters((current) => ({
                                ...current,
                                brandIds: event.target.checked
                                  ? [...current.brandIds, String(brand.id)]
                                  : current.brandIds.filter(
                                      (id) => id !== String(brand.id),
                                    ),
                              }))
                            }
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <span>{brand.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No brands found.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-800">
                  Category
                </label>
                <select
                  value={templateFilters.categoryId}
                  onChange={(event) =>
                    setTemplateFilters((current) => ({
                      ...current,
                      categoryId: event.target.value,
                    }))
                  }
                  disabled={loadingTemplateOptions || downloadingTemplate}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-200"
                >
                  <option value="">All Categories</option>
                  {templateCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                onClick={handleCloseTemplateFilters}
                disabled={downloadingTemplate}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDownloadBulkTemplate}
                disabled={loadingTemplateOptions || downloadingTemplate}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {downloadingTemplate
                  ? "Downloading..."
                  : loadingTemplateOptions
                    ? "Loading..."
                    : "Download"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
          <div className="relative bg-white w-full max-w-2xl rounded-md shadow-lg overflow-hidden max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex min-h-0 flex-col">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                Step 1 : Stock In Method
              </h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              <div className="flex items-center gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setActiveTab("new")}
                  className={`px-4 py-2 rounded-md border ${activeTab === "new" ? "bg-blue-50 border-blue-200 text-gray-900" : "bg-white border-gray-200 text-gray-700"}`}
                >
                  New Stock Received
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("po")}
                  className={`px-4 py-2 rounded-md border ${activeTab === "po" ? "bg-blue-50 border-blue-200 text-gray-900" : "bg-white border-gray-200 text-gray-700"}`}
                >
                  Purchase Order
                </button>
              </div>

              {activeTab === "new" ? (
                <div>
                  <div className="mb-5">
                    <label className="block text-sm text-gray-800 mb-2">
                      Stock Source*
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSourceType("warehouse")}
                        className={`rounded-lg border px-4 py-3 text-left ${sourceType === "warehouse" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 bg-white text-gray-700"}`}
                      >
                        <span className="block text-sm font-bold">
                          Warehouse
                        </span>
                        <span className="block text-xs text-gray-500">
                          Show available warehouse stock
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSourceType("vendor")}
                        className={`rounded-lg border px-4 py-3 text-left ${sourceType === "vendor" ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 bg-white text-gray-700"}`}
                      >
                        <span className="block text-sm font-bold">
                          Direct Vendor
                        </span>
                        <span className="block text-xs text-gray-500">
                          Show products supplied by vendor
                        </span>
                      </button>
                    </div>
                  </div>

                  {sourceType === "vendor" && (
                    <div className="mb-5">
                      <label className="block text-sm text-gray-800 mb-2">
                        Vendors*
                      </label>
                      <input
                        value={vendorQuery}
                        onChange={(e) => setVendorQuery(e.target.value)}
                        placeholder="Search vendor..."
                        className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
                      />
                      <select
                        multiple
                        value={selectedVendorIds}
                        onChange={(e) =>
                          setSelectedVendorIds(
                            Array.from(e.target.selectedOptions).map(
                              (option) => option.value,
                            ),
                          )
                        }
                        className="h-32 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-700"
                      >
                        {filteredVendors.map((vendor) => (
                          <option key={vendor.id} value={String(vendor.id)}>
                            {vendor.name}
                            {vendor.company ? ` - ${vendor.company}` : ""}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Use Ctrl or Shift to select multiple vendors.
                      </p>
                    </div>
                  )}

                  <div className="mb-6">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        if (f && f.size > MAX_INVOICE_UPLOAD_BYTES) {
                          alert(
                            `Invoice file must be ${formatFileSize(MAX_INVOICE_UPLOAD_BYTES)} or smaller.`,
                          );
                          e.target.value = "";
                          setSelectedFile(null);
                          return;
                        }
                        setSelectedFile(f);
                      }}
                    />

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") fileInputRef.current?.click();
                      }}
                      className="rounded-lg border-dashed border-2 border-gray-300 p-6 text-center text-gray-700 cursor-pointer"
                    >
                      <div className="mb-2 font-medium text-gray-800">
                        {selectedFile ? selectedFile.name : "Upload invoice"}
                      </div>
                      <div className="text-sm text-gray-600">
                        Drop a PDF or image to pre-fill line items
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        Max size: {formatFileSize(MAX_INVOICE_UPLOAD_BYTES)}
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm text-gray-800 mb-2">
                      Destination*
                    </label>
                    <SearchableSelect
                      value={destination}
                      onChange={setDestination}
                      placeholder={
                        loadingStores ? "Loading..." : "Select Destination"
                      }
                      searchPlaceholder="Search destination..."
                      options={destinationStores.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      disabled={loadingStores}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyTaxes}
                        onChange={(e) => setApplyTaxes(e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-gray-800">
                        Apply Taxes On This Transaction
                      </span>
                    </label>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-800 mb-2">
                      Purchase order ID
                    </label>
                    <input
                      className="w-full border border-gray-300 rounded px-3 py-2 text-gray-700"
                      placeholder="Enter Purchase order ID"
                      value={purchaseOrderId}
                      onChange={(e) => setPurchaseOrderId(e.target.value)}
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-800 mb-2">
                      Invoice Number
                    </label>
                    <input
                      className="w-full border border-gray-300 rounded px-3 py-2 text-gray-700"
                      placeholder="Enter Invoice Number"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyTaxes}
                        onChange={(e) => setApplyTaxes(e.target.checked)}
                      />
                      <span className="text-sm font-semibold text-gray-800">
                        Apply Taxes On This Transaction
                      </span>
                    </label>
                  </div>
                  <div className="mt-4">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={addProductsPrefill}
                        onChange={(e) =>
                          setAddProductsPrefill(e.target.checked)
                        }
                      />
                      <span className="text-sm font-semibold text-gray-800">
                        Add products to cart by default with prefilled quantity.
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                className="px-4 py-2 rounded border border-gray-200"
                onClick={handleClose}
              >
                Close
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-blue-600 text-white"
                onClick={handleNext}
                disabled={submitting}
              >
                {submitting ? "..." : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMissingProduct && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-[17px] font-bold text-gray-900">
              Product not found
            </h2>
            <p className="mt-2 text-[13px] leading-6 text-gray-600">
              "{pendingMissingProduct.productName}" does not exist. Do you want
              to create a new product?
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const remainingRows =
                    pendingMissingProduct.existingRows || [];
                  window.sessionStorage.removeItem(PENDING_STOCK_IN_BULK_KEY);
                  setPendingMissingProduct(null);
                  await processBulkRows(remainingRows);
                }}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  if (Array.isArray(pendingMissingProduct.originalRows)) {
                    window.sessionStorage.setItem(
                      PENDING_STOCK_IN_BULK_KEY,
                      JSON.stringify(pendingMissingProduct.originalRows),
                    );
                  }
                  window.location.assign(
                    buildCreateProductUrl(pendingMissingProduct.originalRow),
                  );
                }}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
