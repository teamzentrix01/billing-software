"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import InventoryShell from "@/components/inventory/InventoryShell";
import SearchableSelect from "@/components/SearchableSelect";
import {
  getBulkField,
  parseBulkSheet,
  pickSpreadsheetFile,
} from "@/lib/bulkSheet";
import {
  OPTIONS_SHEET_NAME,
  addOptionNamedRanges,
  buildOptionsSheet,
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
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function normalizeImportDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function stockTemplateValue(row, keys, fallback = "") {
  return getBulkField(row, keys, fallback);
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

function findStockInTemplateProductMatch(
  products,
  { productId, productName, barcode, sku },
) {
  const byProductId = String(productId || "")
    .trim()
    .toLowerCase();
  const byBarcode = String(barcode || "")
    .trim()
    .toLowerCase();
  const bySku = String(sku || "")
    .trim()
    .toLowerCase();
  const byName = String(productName || "")
    .trim()
    .toLowerCase();

  if (byProductId) {
    return (
      products.find(
        (product) =>
          String(product.id || "")
            .trim()
            .toLowerCase() === byProductId ||
          String(product.productId || "")
            .trim()
            .toLowerCase() === byProductId,
      ) || null
    );
  }

  if (byBarcode) {
    return (
      products.find(
        (product) =>
          String(product.barcode || "")
            .trim()
            .toLowerCase() === byBarcode,
      ) || null
    );
  }

  if (bySku) {
    return (
      products.find(
        (product) =>
          String(product.sku || "")
            .trim()
            .toLowerCase() === bySku,
      ) || null
    );
  }

  if (byName) {
    return (
      products.find(
        (product) =>
          String(product.productName || "")
            .trim()
            .toLowerCase() === byName,
      ) || null
    );
  }

  return null;
}

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
  const [filters, setFilters] = useState({
    search: "",
    dateFrom: "",
    dateTo: "",
    source: "",
  });
  const [pendingMissingProduct, setPendingMissingProduct] = useState(null);
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

  const processBulkRows = async (selectedRows) => {
    if (!selectedRows.length) {
      alert(
        "Please enter a quantity for the products you want to add, then upload the template again.",
      );
      return;
    }

    const storeData = stores.length
      ? stores
      : await fetchStores().catch(() => []);
    const destinationId = window.prompt(
      `Enter destination Store/Warehouse ID for this Stock In:\n${storeData
        .slice(0, 20)
        .map((store) => `${store.id} - ${store.name}`)
        .join("\n")}`,
    );
    if (!destinationId) return;

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
    alert(
      `Bulk stock draft ready: ${selectedRows.length} product(s) added. Please review and confirm.`,
    );
    router.push(
      `/inventory/stockin/line-items?id=${encodeURIComponent(draft.id)}`,
    );
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
    const existingProducts = Array.isArray(templateJson.records)
      ? templateJson.records
      : [];

    const selectedRows = rows
      .map((row) => {
        const productId = getBulkField(row, ["product_id"]);
        const productName = getBulkField(row, ["product_name", "name"]);
        const barcode = getBulkField(row, ["barcode"]);
        const sku = getBulkField(row, ["sku"]);
        const qty = Number(getBulkField(row, ["quantity", "qty"], 0));
        if (!Number.isFinite(qty) || qty <= 0) return null;
        if (
          ![productId, productName, barcode, sku].some((value) =>
            String(value || "").trim(),
          )
        )
          return null;
        const matchedProduct = findStockInTemplateProductMatch(
          existingProducts,
          {
            productId,
            productName,
            barcode,
            sku,
          },
        );
        if (!matchedProduct) {
          return {
            missing: true,
            originalRow: row,
            productName: productName || productId || barcode || sku,
          };
        }
        return {
          product_id: matchedProduct.id,
          qty,
          cost_price:
            Number(
              getBulkField(row, ["cost_unit", "cost_per_unit", "cost"], 0),
            ) || 0,
          tax_value: 0,
          batch_no:
            getBulkField(row, [
              "serial_number_serialnumber",
              "serialnumber",
              "serial_number",
            ]) || "",
          expiry_date: normalizeImportDate(getBulkField(row, ["expiry_date"])),
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

    await processBulkRows(selectedRows);
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

  const handleDownloadBulkTemplate = async () => {
    try {
      const res = await fetch("/api/inventory/stockin?template=products", {
        cache: "no-store",
      });
      const json = await res.json();
      const records = Array.isArray(json.records) ? json.records : [];
      const rows = records.map((product) => ({
        "Product ID": product.id,
        "Product Name": product.productName,
        "Size ID": product.sizeId,
        "Size Name": product.sizeName,
        Category: product.category,
        Brand: product.brand,
        Barcode: product.barcode,
        SKU: product.sku,
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

      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows, {
        header: STOCK_IN_TEMPLATE_HEADERS,
      });
      worksheet["!cols"] = STOCK_IN_TEMPLATE_HEADERS.map((header) => ({
        wch: Math.max(12, Math.min(28, header.length + 2)),
      }));
      worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

      const optionGroups = [
        {
          key: "product_ids",
          name: "StockInProductIds",
          values: sortOptions(uniqueOptions(records.map((product) => product.id))),
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
          values: sortOptions(uniqueOptions(records.map((product) => product.sizeId))),
        },
        {
          key: "size_names",
          name: "StockInSizeNames",
          values: sortOptions(uniqueOptions(records.map((product) => product.sizeName))),
        },
        {
          key: "categories",
          name: "StockInCategories",
          values: sortOptions(uniqueOptions(records.map((product) => product.category))),
        },
        {
          key: "brands",
          name: "StockInBrands",
          values: sortOptions(uniqueOptions(records.map((product) => product.brand))),
        },
        {
          key: "barcodes",
          name: "StockInBarcodes",
          values: sortOptions(uniqueOptions(records.map((product) => product.barcode))),
        },
        {
          key: "skus",
          name: "StockInSkus",
          values: sortOptions(uniqueOptions(records.map((product) => product.sku))),
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
        ["Barcode", "barcodes"],
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
            range: `${column}2:${column}${STOCK_IN_TEMPLATE_ROW_LIMIT}`,
            formula,
          };
        })
        .filter(Boolean);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Bulk Stock In");
      XLSX.utils.book_append_sheet(
        workbook,
        buildOptionsSheet(optionGroups),
        OPTIONS_SHEET_NAME,
      );
      addOptionNamedRanges(workbook, optionGroups);
      hideOptionsSheet(workbook);
      await saveWorkbookWithValidations(
        workbook,
        `Stock In Template ${new Date().toISOString().slice(0, 10)}.xlsx`,
        validations,
      );
    } catch (err) {
      console.error(err);
      alert("Stock In template download failed.");
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
            onClick: handleDownloadBulkTemplate,
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
                      placeholder={loadingStores ? "Loading..." : "Select Destination"}
                      searchPlaceholder="Search destination..."
                      options={destinationStores.map((s) => ({ value: s.id, label: s.name }))}
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
