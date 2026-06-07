"use client";

import { useCallback, useEffect, useState } from "react";
import CatalogListPage from "@/components/CatalogListPage";

export default function CatalogDataPage({
  endpoint,
  breadcrumbs = [],
  title = "",
  description = "",
  columns = [],
  mapRecord = (record, index) => ({ id: record.id ?? index, ...record }),
  totalLabel = "Record(s)",
  emptyMessage = "No records found",
  onCreateClick,
  createLabel = null,
  bulkOperations = true,
  bulkImportType = null,
  customBulkActions = [],
  showRowActions = false,
  onEdit,
  onDelete,
  filters = null,
  extraQueryParams = null,
}) {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });

      if (search) {
        params.set("search", search);
      }

      Object.entries(extraQueryParams || {}).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          params.set(key, String(value));
        }
      });

      const res = await fetch(`${endpoint}?${params.toString()}`);
      const json = await res.json();

      if (json.success) {
        setRecords(json.data.records || []);
        setTotal(json.data.total || 0);
        setTotalPages(json.data.totalPages || 1);
      } else {
        showToast(
          json.message || `Failed to load ${title.toLowerCase()}`,
          "error",
        );
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, pageSize, search, showToast, title, extraQueryParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [JSON.stringify(extraQueryParams)]);

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const res = await fetch(`${endpoint}/${deleteId}`, { method: "DELETE" });
      const json = await res.json();

      if (json.success) {
        showToast(`${title} deleted`);
        fetchData();
      } else {
        showToast(json.message || "Delete failed", "error");
      }
    } catch {
      showToast("Delete failed", "error");
    }

    setDeleteId(null);
  };

  const rows = records.map((record, index) =>
    mapRecord(record, index, page, pageSize),
  );

  return (
    <>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${
            toast.type === "success" ? "bg-green-500" : "bg-red-500"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 relative z-[1000]">
            <h3 className="text-base font-bold text-gray-800 mb-2">
              Delete {title}?
            </h3>
            <p className="text-sm text-gray-500 mb-5">
              This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <CatalogListPage
        breadcrumbs={breadcrumbs}
        title={title}
        description={description}
        filters={filters}
        createLabel={createLabel}
        onCreateClick={onCreateClick}
        bulkOperations={bulkOperations}
        bulkImportType={bulkImportType}
        customBulkActions={customBulkActions}
        endpoint={endpoint}
        extraQueryParams={extraQueryParams}
        columns={columns}
        rows={rows}
        loading={loading}
        totalLabel={totalLabel}
        emptyMessage={emptyMessage}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        search={search}
        onSearchChange={setSearch}
        onImportSuccess={fetchData}
        showRowActions={showRowActions}
        onEdit={onEdit ? (row) => onEdit(row) : undefined}
        onDelete={onDelete ? (row) => setDeleteId(row.id) : undefined}
      />
    </>
  );
}
