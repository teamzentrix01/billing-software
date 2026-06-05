'use client';

import { useEffect, useMemo, useState } from 'react';
import InventoryShell from '@/components/inventory/InventoryShell';
import { formatIndianDateTime } from '@/lib/dateUtils';

const tableHeaders = [
  'Fulfillment Center',
  'Destination',
  'Requisition ID',
  'Requisition Time',
  'Total Item Number',
  'User',
  'Mail To',
  'Remarks',
  'Status',
  'Fulfillment Status',
  'Approval Status',
  'Action',
];

function normalizeStores(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data?.stores)) return data.data.stores;
  if (Array.isArray(data?.stores)) return data.stores;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function normalizeProducts(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function formatDate(value) {
  return formatIndianDateTime(value, '-');
}

function emptyLine() {
  return { productId: '', qty: 1 };
}

export default function StockRequisitionPage() {
  const [records, setRecords] = useState([]);
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [fulfillmentSources, setFulfillmentSources] = useState({});
  const [form, setForm] = useState({
    sourceId: '',
    destinationId: '',
    requestedBy: '',
    mailTo: '',
    remarks: '',
    items: [emptyLine()],
  });

  const loadRecords = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory/stockrequisition', { cache: 'no-store', credentials: 'include' });
      const data = await res.json();
      setRecords(Array.isArray(data?.records) ? data.records : []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
    Promise.all([
      fetch('/api/stores', { credentials: 'include' }).then((res) => res.json()),
      fetch('/api/catalog/products?pageSize=500', { credentials: 'include' }).then((res) => res.json()),
    ])
      .then(([storeData, productData]) => {
        setStores(normalizeStores(storeData));
        setProducts(normalizeProducts(productData));
      })
      .catch(() => {
        setStores([]);
        setProducts([]);
      });
  }, []);

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records;
    const term = search.toLowerCase();
    return records.filter((row) =>
      [
        row.transactionId,
        row.sourceName,
        row.destinationName,
        row.requestedBy,
        row.mailTo,
        row.status,
        row.approvalStatus,
      ].some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [records, search]);

  const updateLine = (index, updates) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...updates } : item)),
    }));
  };

  const removeLine = (index) => {
    setForm((current) => ({
      ...current,
      items: current.items.length <= 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const submit = async () => {
    if (!form.destinationId) return alert('Please select destination');
    const items = form.items
      .map((item) => ({ productId: item.productId, qty: Number(item.qty || 0) }))
      .filter((item) => item.productId && item.qty > 0);
    if (!items.length) return alert('Add at least one product');

    setSaving(true);
    try {
      const res = await fetch('/api/inventory/stockrequisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...form, items }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to create requisition');
      setShowModal(false);
      setForm({ sourceId: '', destinationId: '', requestedBy: '', mailTo: '', remarks: '', items: [emptyLine()] });
      await loadRecords();
    } catch (err) {
      alert(err.message || 'Failed to create requisition');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id, action) => {
    try {
      const res = await fetch(`/api/inventory/stockrequisition/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Update failed');
      await loadRecords();
    } catch (err) {
      alert(err.message || 'Update failed');
    }
  };

  const fulfillByTransfer = async (row) => {
    const sourceId = fulfillmentSources[row.id] || row.sourceId;
    if (!sourceId) return alert('Select fulfillment source first');
    try {
      const res = await fetch('/api/inventory/stocktransfer/from-requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ requisitionId: row.id, sourceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Fulfillment failed');
      alert(`Stock transfer ${data.transactionId} created and stock moved.`);
      await loadRecords();
    } catch (err) {
      alert(err.message || 'Fulfillment failed');
    }
  };

  const tableData = filteredRecords.map((row) => ({
    'Fulfillment Center': row.sourceName || '-',
    'Destination': row.destinationName || '-',
    'Requisition ID': row.transactionId,
    'Requisition Time': formatDate(row.createdAt),
    'Total Item Number': row.totalItems,
    'User': row.requestedBy || '-',
    'Mail To': row.mailTo || '-',
    'Remarks': row.remarks || '-',
    'Status': row.status,
    'Fulfillment Status': row.fulfillmentStatus,
    'Approval Status': row.approvalStatus,
    'Action': (
      <div className="flex items-center gap-2">
        {row.approvalStatus === 'pending' && (
          <>
            <button onClick={() => updateStatus(row.id, 'approve')} className="rounded border border-green-200 px-2 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-50">Approve</button>
            <button onClick={() => updateStatus(row.id, 'reject')} className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50">Reject</button>
          </>
        )}
        {row.approvalStatus === 'approved' && row.fulfillmentStatus !== 'completed' && (
          <>
            <select
              value={fulfillmentSources[row.id] || row.sourceId || ''}
              onChange={(e) => setFulfillmentSources((current) => ({ ...current, [row.id]: e.target.value }))}
              className="rounded border border-gray-200 px-2 py-1 text-[11px] text-gray-700"
            >
              <option value="">Source</option>
              {stores
                .filter((store) => String(store.id) !== String(row.destinationId))
                .map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
            <button onClick={() => fulfillByTransfer(row)} className="rounded border border-blue-200 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50">Fulfill Transfer</button>
          </>
        )}
        {row.fulfillmentStatus === 'completed' && row.stockTransferId ? (
          <span className="text-[11px] font-semibold text-green-700">Transfer #{row.stockTransferId}</span>
        ) : null}
      </div>
    ),
  }));

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: 'Inventory' }, { label: 'Stock Requisition' }]}
        title="Stock Requisition"
        subtitle="Store replenishment requests saved in the database."
        actions={[{ label: 'Request Stocks', primary: true, onClick: () => setShowModal(true) }]}
        searchPlaceholder="Search"
        tableHeaders={tableHeaders}
        tableData={loading ? [] : tableData}
        searchValue={search}
        onSearchChange={setSearch}
        emptyMessage={loading ? 'Loading records...' : 'No Records Found'}
      />

      {showModal && (
        <div className="fixed inset-0 z-[999] flex items-start justify-center bg-black/40 p-6">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">Request Stocks</h2>
              <button onClick={() => setShowModal(false)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>

            <div className="max-h-[78vh] overflow-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Fulfillment Center</span>
                  <select value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="">Select source</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Destination <span className="text-red-500">*</span></span>
                  <select value={form.destinationId} onChange={(event) => setForm({ ...form, destinationId: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="">Select destination</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Requested By</span>
                  <input value={form.requestedBy} onChange={(event) => setForm({ ...form, requestedBy: event.target.value })} placeholder="Auto-filled from logged-in user if blank" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Mail To</span>
                  <input value={form.mailTo} onChange={(event) => setForm({ ...form, mailTo: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
              </div>

              <div className="mt-5 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                  <h3 className="text-sm font-semibold text-gray-900">Products</h3>
                  <button onClick={() => setForm((current) => ({ ...current, items: [...current.items, emptyLine()] }))} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                    Add Product
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {form.items.map((item, index) => (
                    <div key={index} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_120px_40px]">
                      <select value={item.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="">Select product</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name} {product.sku ? `(${product.sku})` : ''}</option>)}
                      </select>
                      <input type="number" min={1} value={item.qty} onChange={(event) => updateLine(index, { qty: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <button onClick={() => removeLine(index)} className="rounded-lg text-red-500 hover:bg-red-50">
                        <i className="ti ti-trash text-[17px]" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <label className="mt-5 block">
                <span className="mb-1 block text-xs font-semibold text-gray-600">Remarks</span>
                <textarea rows={3} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>

              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Cancel</button>
                <button onClick={submit} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {saving ? 'Saving...' : 'Save Requisition'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
