"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import CatalogListPage from '@/components/CatalogListPage';
import { getStoreCode } from '@/lib/storeMeta';

export default function Page() {
  const router = useRouter();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteId, setDeleteId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/stores?${params.toString()}`);
      const json = await res.json();

      if (res.ok && json.success) {
        const rows = (json.data.stores || []).map((store, index) => ({
          id: store.id,
          rawName: store.name,
          sno: (page - 1) * pageSize + index + 1,
          name: (
            <button
              type="button"
              onClick={() => router.push(`/settings/stores/${store.id}`)}
              className="text-blue-600 hover:underline text-left"
            >
              {store.name}
            </button>
          ),
          store_code: getStoreCode(store.meta) || '—',
          active_license: store.meta?.gstNumber || '—',
          live_since: store.created_at
            ? new Date(store.created_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })
            : '—',
          address_text: [store.city, store.state, store.country].filter(Boolean).join(', ') || '—',
        }));

        setStores(rows);
        setTotal(json.data.total ?? rows.length);
        setTotalPages(json.data.totalPages ?? 1);
      } else {
        showToast(json.message || 'Failed to load stores', 'error');
      }
    } catch {
      showToast('Network error while loading stores', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, router]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const res = await fetch(`/api/stores/${deleteId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        showToast(json.message || 'Delete failed', 'error');
        return;
      }

      showToast('Store deleted');
      setDeleteId(null);
      fetchStores();
    } catch {
      showToast('Delete failed', 'error');
    }
  };

  const columns = useMemo(() => ([
    { key: 'sno', label: 'S. No.', sortable: true },
    { key: 'name', label: 'Store Name', sortable: true },
    { key: 'store_code', label: 'Store Code', sortable: true },
    { key: 'active_license', label: 'Active License', sortable: true },
    { key: 'live_since', label: 'Live Since', sortable: true },
    { key: 'address_text', label: 'Address', sortable: true },
  ]), []);

  return (
    <MainLayout>
      {toast && (
        <div className={`fixed top-4 right-4 z-[999] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 relative z-[1000]">
            <h3 className="text-base font-bold text-gray-800 mb-2">Delete Store?</h3>
            <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <CatalogListPage
        breadcrumbs={[
          { label: 'Home', href: '/home' },
          { label: 'Settings', href: '/settings' },
          { label: 'Stores' },
        ]}
        title="Stores"
        description="Branches, addresses, GST registration per store. Need Help?"
        createLabel="Create"
        onCreateClick={() => router.push('/settings/stores/create')}
        bulkOperations={true}
        columns={columns}
        rows={stores}
        loading={loading}
        totalLabel="Stores(s)"
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
        onEdit={(row) => router.push(`/settings/stores/${row.id}/edit`)}
        onDelete={(row) => setDeleteId(row.id)}
      />
    </MainLayout>
  );
}