'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CatalogListPage from '@/components/CatalogListPage';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'sno',           label: 'S. No.',            sortable: true  },
  { key: 'name',          label: 'Sub Category Name', sortable: true  },
  { key: 'category_name', label: 'Category Name',     sortable: true  },
  { key: 'sort_sequence', label: 'Sort Sequence',     sortable: true  },
  { key: 'is_active',     label: 'Status',            sortable: true  },
];

export default function SubCategoryPage() {
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
      const res  = await fetch(`/api/catalog/sub-categories?${params}`);
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
      const res  = await fetch(`/api/catalog/sub-categories/${deleteId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { showToast('Sub Category deleted'); fetchData(); }
      else showToast(json.message, 'error');
    } catch { showToast('Delete failed', 'error'); }
    setDeleteId(null);
  };

  const rows = records.map((r, i) => ({
    id:            r.id,
    sno:           (page - 1) * pageSize + i + 1,
    name:          r.name,
    category_name: r.category_name || '—',
    sort_sequence: r.sort_sequence ?? '—',
    is_active:     r.is_active,
    created_at:    formatIndianDate(r.created_at, '—'),
  }));

  return (
    <>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium
          ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 relative z-[1000]">
            <h3 className="text-base font-bold text-gray-800 mb-2">Delete Sub Category?</h3>
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
          { label: 'Catalog',                 href: '/catalog' },
          { label: 'Product Classification',  href: '/catalog/category' },
          { label: 'Sub Category' },
        ]}
        title="Sub Category"
        description="Organize products under the same category as subcategories."
        createLabel="Create Sub Category"
        onCreateClick={() => router.push('/catalog/sub-category/create')}
        bulkOperations={true}
        columns={columns}
        rows={rows}
        loading={loading}
        totalLabel="Sub Category(s)"
        emptyMessage="No sub categories found"
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        search={search}
        onSearchChange={setSearch}
        showRowActions={true}
        onEdit={(row) => router.push(`/catalog/sub-category/${row.id}/edit`)}
        onDelete={(row) => setDeleteId(row.id)}
       bulkImportType="sub-categories"      // ← add this
       onImportSuccess={() => fetchData()} 
      />
    </>
  );
}
