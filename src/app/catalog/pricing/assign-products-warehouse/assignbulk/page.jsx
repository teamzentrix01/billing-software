"use client";

import { useState, useEffect, useRef } from "react";
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
  "warehouse_id",
  "product_id",
  "product_name",
  "sku",
  "quantity",
  "location",
];
const TEMPLATE_ROW_LIMIT = 5001;
const TEXT_TEMPLATE_HEADERS = ["warehouse_id", "product_id", "sku"];

async function fetchTemplateProducts() {
  const res = await fetch(
    "/api/catalog/products?pageSize=10000&is_active=true",
    { cache: "no-store" },
  );
  const json = await res.json().catch(() => ({}));
  return json?.success ? json.data?.records || [] : [];
}

export default function AssignBulkPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [warehouseQuery, setWarehouseQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const dropdownRef = useRef(null);
  const canProceed = !!(rows && rows.length);
  const filteredWarehouses = warehouses.filter((warehouse) =>
    String(warehouse.name || "")
      .toLowerCase()
      .includes(warehouseQuery.trim().toLowerCase()),
  );
  const nextButtonClass = canProceed
    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-500/35"
    : "bg-slate-400 text-white/90 shadow-sm cursor-not-allowed";

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
      try {
        const [whRes, catRes] = await Promise.all([
          fetch("/api/warehouses"),
          fetch("/api/catalog/categories?pageSize=200"),
        ]);
        const [whJson, catJson] = await Promise.all([
          whRes.json(),
          catRes.json(),
        ]);
        if (whJson?.success) setWarehouses(whJson.data?.records || []);
        if (catJson?.success) setCategoryList(catJson.data?.records || []);
      } catch (e) {}
    })();
  }, []);

  const downloadTemplate = async () => {
    if (!selectedWarehouseIds.length)
      return alert("Select at least one warehouse first");
    const rows = [TEMPLATE_HEADERS];
    for (const warehouseId of selectedWarehouseIds) {
      try {
        const res = await fetch(
          `/api/catalog/assign-products-warehouse?warehouseId=${warehouseId}`,
        );
        const json = await res.json();
        if (json.success) {
          (json.data?.records || [])
            .filter((record) => record.is_assigned)
            .forEach((record) =>
              rows.push([
                excelText(warehouseId),
                excelText(record.id),
                record.name || "",
                excelText(record.sku),
                "",
                "",
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

    const products = await fetchTemplateProducts();
    const optionGroups = [
      {
        key: "product_ids",
        name: "WarehouseAssignProductIds",
        values: sortOptions(
          uniqueOptions(products.map((product) => excelText(product.id))),
        ),
      },
      {
        key: "product_names",
        name: "WarehouseAssignProductNames",
        values: sortOptions(
          uniqueOptions(products.map((product) => product.name)),
        ),
      },
      {
        key: "skus",
        name: "WarehouseAssignProductSkus",
        values: sortOptions(
          uniqueOptions(products.map((product) => excelText(product.sku))),
        ),
      },
    ];
    const validations = [
      ["product_id", "product_ids"],
      ["product_name", "product_names"],
      ["sku", "skus"],
    ]
      .map(([header, optionKey]) => {
        const columnIndex = TEMPLATE_HEADERS.indexOf(header);
        if (columnIndex < 0) return null;
        const column = XLSX.utils.encode_col(columnIndex);
        const formula = prefixMatchOptionFormula(
          optionGroups,
          optionKey,
          `${column}2`,
        );
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
      `assign-products-warehouse-template.xlsx`,
      validations,
    );
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name || "");
    const data = await f.arrayBuffer();
    const wb = XLSX.read(data, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const parsed = sheetToJsonRows(ws);
    setRows(parsed);
  };

  const startPreview = () => {
    if (!selectedWarehouseIds.length)
      return alert("Select at least one warehouse");
    if (!rows || !rows.length)
      return alert("Please upload a template file first");
    sessionStorage.setItem(
      "assignBulkWarehouse_preview_rows",
      JSON.stringify(rows),
    );
    sessionStorage.setItem(
      "assignBulkWarehouse_preview_warehouses",
      JSON.stringify(selectedWarehouseIds),
    );
    router.push(
      "/catalog/pricing/assign-products-warehouse/assignbulk/preview",
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-xl font-semibold">
          Assign Products to Warehouse — Bulk
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.history.back()}
            className="px-3 py-2 border rounded-md text-sm"
          >
            Back
          </button>
          <button
            onClick={startPreview}
            disabled={!(selectedWarehouseIds.length && rows && rows.length)}
            className={`px-3 py-2 rounded-md text-sm text-white ${selectedWarehouseIds.length && rows && rows.length ? "bg-blue-600" : "bg-slate-300"}`}
          >
            Next
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg mb-6 shadow-sm">
        <h3 className="font-semibold mb-3 text-gray-700">
          Please Select Warehouses
        </h3>
        <div className="grid grid-cols-12 gap-4 items-end">
          <div ref={dropdownRef} className="col-span-6 relative">
            <label className="text-sm text-gray-600 mb-1 block">
              Warehouses
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen((o) => !o)}
                className="w-full text-left border border-slate-200 rounded-md px-3 py-2 bg-white flex items-center justify-between"
              >
                <span className="text-sm text-gray-700">
                  {selectedWarehouseIds.length
                    ? `${selectedWarehouseIds.length} warehouse(s) selected`
                    : "Select warehouses"}
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
                      value={warehouseQuery}
                      onChange={(e) => setWarehouseQuery(e.target.value)}
                      placeholder="Search warehouse..."
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="p-2 pt-0">
                    {filteredWarehouses.map((w) => (
                      <label
                        key={w.id}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={selectedWarehouseIds.includes(String(w.id))}
                          onChange={(e) => {
                            const id = String(w.id);
                            setSelectedWarehouseIds((prev) =>
                              e.target.checked
                                ? [...prev.filter((x) => x !== id), id]
                                : prev.filter((x) => x !== id),
                            );
                          }}
                        />
                        <span className="text-sm text-gray-700">{w.name}</span>
                      </label>
                    ))}
                    {!filteredWarehouses.length && (
                      <div className="px-2 py-3 text-center text-xs text-gray-400">
                        No matching warehouses
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-6">
            <label className="text-sm text-gray-600 mb-1 block">
              Category (optional)
            </label>
            <SearchableSelect
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Any"
              searchPlaceholder="Search category..."
              options={categoryList.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
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
            Upload the warehouse assignment sheet to continue to the preview
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
            Rows parsed: {rows.length}
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
          onClick={startPreview}
          className={`px-4 py-2 rounded-md font-semibold transition-all duration-200 ${nextButtonClass}`}
          disabled={!canProceed}
        >
          Next
        </button>
      </div>
    </div>
  );
}
