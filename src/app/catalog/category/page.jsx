'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CatalogListPage from '@/components/CatalogListPage';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'sno',         label: 'S. No.',        sortable: true  },
  { key: 'name',        label: 'Name',           sortable: true  },
  { key: 'description', label: 'Description',    sortable: false },
  { key: 'is_active',   label: 'Status',         sortable: true  },
  { key: 'created_at',  label: 'Created At',     sortable: true  },
];

export default function CategoryPage() {
  const router = useRouter();

  const [records, setRecords]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(10);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [deleteId, setDeleteId]     = useState(null);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page, pageSize, ...(search && { search }),
      });
      const res  = await fetch(`/api/catalog/categories?${params}`);
      const json = await res.json();
      if (json.success) {
        setRecords(json.data.records);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      } else {
        showToast(json.message || 'Failed to load', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res  = await fetch(`/api/catalog/categories/${deleteId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { showToast('Category deleted'); fetchData(); }
      else showToast(json.message, 'error');
    } catch { showToast('Delete failed', 'error'); }
    setDeleteId(null);
  };

  // Map records → rows for CatalogListPage
  const rows = records.map((r, i) => ({
    id:          r.id,
    sno:         (page - 1) * pageSize + i + 1,
    name:        r.name,
    description: r.description || '—',
    is_active:   r.is_active,   // keep boolean — CatalogListPage handles badge
    created_at:  formatIndianDate(r.created_at, '—'),
  }));

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all
          ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Delete Modal */}
      
{deleteId && (
  <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-xl shadow-2xl p-6 w-80 relative z-[1000]">
      <h3 className="text-base font-bold text-gray-800 mb-2">Delete Category?</h3>
      <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setDeleteId(null)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={handleDelete}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
          Delete
        </button>
      </div>
    </div>
  </div>
)}

      <CatalogListPage
        breadcrumbs={[
          { label: 'Catalog',                href: '/catalog' },
          { label: 'Category' },
        ]}
        title="Category"
        description="Manage product categories. Need Help?"
        createLabel="Create Category"
        onCreateClick={() => router.push('/catalog/category/create')}
        bulkOperations={true}
        columns={columns}
        rows={rows}
        loading={loading}
        totalLabel="Category(s)"
        emptyMessage="No records found"
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        search={search}
        onSearchChange={setSearch}
        showRowActions={true}
        onEdit={(row) => router.push(`/catalog/category/${row.id}/edit`)}
        onDelete={(row) => setDeleteId(row.id)}
        bulkImportType="categories"          // ← add this
        onImportSuccess={() => fetchData()}
      />
    </>
  );
}
