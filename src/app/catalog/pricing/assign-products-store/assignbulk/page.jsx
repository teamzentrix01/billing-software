"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import SearchableSelect from "@/components/SearchableSelect";
import {
  OPTIONS_SHEET_NAME,
  addOptionNamedRanges,
  applyTextFormatToColumns,
  buildOptionsSheet,
  excelText,
  hideOptionsSheet,
  optionFormula,
  prefixMatchOptionFormula,
  saveWorkbookWithValidations,
  sheetToJsonRows,
  sortOptions,
  uniqueOptions,
} from "@/lib/xlsxDropdowns";

const TEMPLATE_HEADERS = [
  "store_id",
  "product_id",
  "product_name",
  "barcode",
  "sku",
  "selling_price",
  "sell_on_store",
];
const TEMPLATE_ROW_LIMIT = 5001;
const TEXT_TEMPLATE_HEADERS = ["store_id", "product_id", "barcode", "sku"];

async function fetchTemplateProducts(categoryId = "") {
  const params = new URLSearchParams({ pageSize: "10000", is_active: "true" });
  if (categoryId) params.set("category_id", categoryId);
  const res = await fetch(`/api/catalog/products?${params.toString()}`, {
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return json?.success ? json.data?.records || [] : [];
}

export default function AssignBulkStep1() {
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [selectedStores, setSelectedStores] = useState([]);
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const fileRef = useRef();
  const [uploadRows, setUploadRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loadingStores, setLoadingStores] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [storeQuery, setStoreQuery] = useState("");
  const dropdownRef = useRef(null);
  const canProceed = !!(uploadRows && uploadRows.length);
  const filteredStores = stores.filter((store) =>
    String(store.name || "")
      .toLowerCase()
      .includes(storeQuery.trim().toLowerCase()),
  );
  const nextButtonClass = canProceed
    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-500/35"
    : "bg-slate-400 text-white/90 shadow-sm cursor-not-allowed";

  const downloadTemplate = async () => {
    if (!selectedStores.length) return alert("Select at least one store first");
    const rows = [TEMPLATE_HEADERS];
    for (const storeId of selectedStores) {
      try {
        const res = await fetch(
          `/api/catalog/assign-products-store?storeId=${storeId}`,
        );
        const json = await res.json();
        if (json.success) {
          (json.data?.records || [])
            .filter((record) => record.is_assigned)
            .forEach((record) =>
              rows.push([
                excelText(storeId),
                excelText(record.id),
                record.name || "",
                excelText(record.barcode),
                excelText(record.sku),
                record.store_selling_price ?? record.selling_price ?? "",
                "Yes",
              ]),
            );
        }
      } catch {}
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = TEMPLATE_HEADERS.map((header) => ({
      wch: Math.max(12, header.length + 4),
    }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    applyTextFormatToColumns(
      ws,
      TEMPLATE_HEADERS,
      TEXT_TEMPLATE_HEADERS,
      TEMPLATE_ROW_LIMIT,
    );

    const products = await fetchTemplateProducts(category);
    const optionGroups = [
      {
        key: "product_ids",
        name: "StoreAssignProductIds",
        values: sortOptions(
          uniqueOptions(products.map((product) => excelText(product.id))),
        ),
      },
      {
        key: "product_names",
        name: "StoreAssignProductNames",
        values: sortOptions(
          uniqueOptions(products.map((product) => product.name)),
        ),
      },
      {
        key: "barcodes",
        name: "StoreAssignProductBarcodes",
        values: sortOptions(
          uniqueOptions(products.map((product) => excelText(product.barcode))),
        ),
      },
      {
        key: "skus",
        name: "StoreAssignProductSkus",
        values: sortOptions(
          uniqueOptions(products.map((product) => excelText(product.sku))),
        ),
      },
      {
        key: "sell_on_store",
        name: "StoreAssignSellOnStore",
        values: ["Yes", "No"],
      },
    ];
    const validations = [
      ["product_id", "product_ids"],
      ["product_name", "product_names"],
      ["barcode", "barcodes"],
      ["sku", "skus"],
      ["sell_on_store", "sell_on_store"],
    ]
      .map(([header, optionKey]) => {
        const columnIndex = TEMPLATE_HEADERS.indexOf(header);
        if (columnIndex < 0) return null;
        const column = XLSX.utils.encode_col(columnIndex);
        const formula =
          optionKey === "sell_on_store"
            ? optionFormula(optionGroups, optionKey)
            : prefixMatchOptionFormula(optionGroups, optionKey, `${column}2`);
        if (!formula) return null;
        return { range: `${column}2:${column}${TEMPLATE_ROW_LIMIT}`, formula };
      })
      .filter(Boolean);

    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.utils.book_append_sheet(
      wb,
      buildOptionsSheet(optionGroups),
      OPTIONS_SHEET_NAME,
    );
    addOptionNamedRanges(wb, optionGroups);
    hideOptionsSheet(wb);
    await saveWorkbookWithValidations(
      wb,
      `assign-products-store-template.xlsx`,
      validations,
    );
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name || "");
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const parsed = sheetToJsonRows(ws);
    setUploadRows(parsed);
  };

  const handleNext = async () => {
    if (!selectedStores.length) return alert("Select at least one store");
    if (!uploadRows || !uploadRows.length)
      return alert("Please upload a template file first");
    // Save preview data to sessionStorage and navigate to preview
    sessionStorage.setItem(
      "assignBulk_preview_rows",
      JSON.stringify(uploadRows || []),
    );
    sessionStorage.setItem(
      "assignBulk_preview_stores",
      JSON.stringify(selectedStores),
    );
    router.push("/catalog/pricing/assign-products-store/assignbulk/preview");
  };

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingStores(true);
      try {
        const [storesRes, catRes] = await Promise.all([
          fetch("/api/stores"),
          fetch("/api/catalog/categories?pageSize=200"),
        ]);

        const [storesJson, catJson] = await Promise.all([
          storesRes.json(),
          catRes.json(),
        ]);

        // stores endpoint returns { success, data: { records: [...] } }
        if (storesJson?.success)
          setStores(storesJson.data?.stores || storesJson.data?.records || []);
        // categories endpoint uses data.records as well
        if (catJson?.success) setCategories(catJson.data?.records || []);
      } catch (e) {
        // ignore
      } finally {
        setLoadingStores(false);
      }
    })();
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Bulk Operation</h2>
      <div className="bg-white p-6 rounded-lg mb-6 shadow-sm">
        <h3 className="font-semibold mb-3 text-gray-700">
          Please Select Up to 50 Stores
        </h3>
        <div className="grid grid-cols-12 gap-4 items-end">
          <div ref={dropdownRef} className="col-span-5 relative">
            <label className="text-sm text-gray-600 mb-1 block">Stores</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="w-full text-left border border-slate-200 rounded-md px-3 py-2 bg-white flex items-center justify-between"
              >
                <span className="text-sm text-gray-700">
                  {selectedStores.length
                    ? `${selectedStores.length} store(s) selected`
                    : loadingStores
                      ? "Loading stores..."
                      : "Select stores"}
                </span>
                <svg
                  className="w-4 h-4 text-gray-400"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <path
                    d="M4 6l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-auto">
                  <div className="sticky top-0 bg-white p-2">
                    <input
                      value={storeQuery}
                      onChange={(e) => setStoreQuery(e.target.value)}
                      placeholder="Search store..."
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="p-2 pt-0">
                    {filteredStores.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStores.includes(String(s.id))}
                          onChange={(e) => {
                            const id = String(s.id);
                            setSelectedStores((prev) =>
                              e.target.checked
                                ? [...prev.filter((x) => x !== id), id]
                                : prev.filter((x) => x !== id),
                            );
                          }}
                        />
                        <span className="text-sm text-gray-700">{s.name}</span>
                      </label>
                    ))}
                    {!filteredStores.length && (
                      <div className="px-2 py-3 text-center text-xs text-gray-400">
                        No matching stores
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-span-5">
            <label className="text-sm text-gray-600 mb-1 block">Category</label>
            <SearchableSelect
              value={category}
              onChange={setCategory}
              placeholder="select"
              searchPlaceholder="Search category..."
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={downloadTemplate}
            className="px-4 py-2 bg-blue-600 text-white rounded-md"
          >
            Download Template
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="font-semibold mb-3 text-gray-700">Upload Template</h3>
        <div className="group rounded-2xl border border-dashed border-amber-200 bg-gradient-to-br from-amber-50 via-white to-blue-50 p-8 text-center shadow-sm transition hover:border-amber-300 hover:shadow-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-amber-100">
            <i className="ti ti-file-spreadsheet text-[22px] text-amber-600" />
          </div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            Excel Upload
          </div>
          <div className="mb-2 text-sm font-semibold text-slate-800">
            {fileName || "Choose File"}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Upload your product assignment sheet to continue to the preview
            step.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-700 hover:shadow-blue-500/35">
            <i className="ti ti-upload text-[16px]" />
            <span>Choose Excel File</span>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="hidden"
            />
          </label>
          <div className="mt-3 text-xs text-slate-500">
            Accepted formats: .xlsx, .xls, .csv
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 border rounded-md"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className={`px-4 py-2 rounded-md font-semibold transition-all duration-200 ${nextButtonClass}`}
          disabled={!canProceed}
        >
          Next
        </button>
      </div>
    </div>
  );
}
