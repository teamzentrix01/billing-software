"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  applyTextFormatToColumns,
  excelText,
  sheetToJsonRows,
} from "@/lib/xlsxDropdowns";

const TEMPLATE_HEADERS = ["store_id", "group_id", "group_name"];
const TEMPLATE_ROW_LIMIT = 5001;
const TEXT_TEMPLATE_HEADERS = ["store_id", "group_id"];

export default function AssignGroupsBulk() {
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedStores, setSelectedStores] = useState([]);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const fileRef = useRef();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const canProceed = !!(rows && rows.length);
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
        const [storesRes, catRes, whRes] = await Promise.all([
          fetch("/api/stores"),
          fetch("/api/catalog/categories?pageSize=200"),
          fetch("/api/warehouses"),
        ]);
        const [storesJson, catJson, whJson] = await Promise.all([
          storesRes.json(),
          catRes.json(),
          whRes.json(),
        ]);
        if (storesJson?.success)
          setStores(storesJson.data?.stores || storesJson.data?.records || []);
        if (catJson?.success) setCategories(catJson.data?.records || []);
        if (whJson?.success) setWarehouses(whJson.data?.records || []);
      } catch (e) {}
    })();
  }, []);

  const downloadTemplate = async () => {
    if (!selectedStores.length) return alert("Select at least one store first");
    const rows = [TEMPLATE_HEADERS];
    for (const storeId of selectedStores) {
      try {
        const res = await fetch(
          `/api/catalog/assign-product-groups-store?storeId=${storeId}`,
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
              ]),
            );
        }
      } catch {}
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    applyTextFormatToColumns(
      ws,
      TEMPLATE_HEADERS,
      TEXT_TEMPLATE_HEADERS,
      TEMPLATE_ROW_LIMIT,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `assign-product-groups-template.xlsx`);
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

  const handleNext = () => {
    if (!selectedStores.length) return alert("Select at least one store");
    if (!rows.length) return alert("Upload template first");
    sessionStorage.setItem("assignGroups_preview_rows", JSON.stringify(rows));
    sessionStorage.setItem(
      "assignGroups_preview_stores",
      JSON.stringify(selectedStores),
    );
    router.push("/catalog/pricing/assign-groups-store/assignbulk/preview");
  };

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
                  <div className="p-2">
                    {stores.map((s) => (
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
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-4">
            <label className="text-sm text-gray-600 mb-1 block">
              Warehouse
            </label>
            <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
              <option value="">select</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-3">
            <label className="text-sm text-gray-600 mb-1 block">Category</label>
            <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
              <option value="">select</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
            Upload the product group assignment sheet to continue to the preview
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
