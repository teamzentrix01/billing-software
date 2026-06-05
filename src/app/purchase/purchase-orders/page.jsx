'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { fetchLookup, normalizeStores, normalizeVendors } from '@/lib/purchaseLookups';
import { formatIndianDate } from '@/lib/dateUtils';

const tableHeaders = [
  'Purchase Order ID',
  'Destination Name',
  'Vendor Name',
  'Invoice Number',
  'Invoice Date',
  'Expected Delivery Date',
  'Shipment Mode',
  'Total Items',
  'Status',
];

function formatDate(value) {
  return formatIndianDate(value, '—');
}

function mapRecordsToTable(records) {
  return (records || []).map((row) => ({
    'Purchase Order ID': row.transactionId ? `#${row.transactionId}` : `#PO-${String(row.id).padStart(4, '0')}`,
    'Destination Name': row.destinationName || '—',
    'Vendor Name': row.vendorName || '—',
    'Invoice Number': row.invoiceNumber || '—',
    'Invoice Date': formatDate(row.invoiceDate),
    'Expected Delivery Date': formatDate(row.expectedDeliveryDate),
    'Shipment Mode': row.shipmentMode || '—',
    'Total Items': row.totalItems ?? 0,
    'Status': row.status || 'draft',
  }));
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getDateWindow(range) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === 'last-7-days') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (range === 'last-30-days') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  return { start: null, end: null };
}

function isWithinRange(value, range) {
  const date = parseDateInput(value);
  if (!date || range === 'all') return true;

  if (range.type === 'custom') {
    if (range.start && date < range.start) return false;
    if (range.end && date > range.end) return false;
    return true;
  }

  if (range.type === 'preset') {
    if (!range.start || !range.end) return true;
    return date >= range.start && date <= range.end;
  }

  return true;
}

async function fetchPurchaseOrders() {
  const res = await fetch('/api/purchase-orders');
  if (!res.ok) throw new Error('Failed to fetch purchase orders');
  return res.json();
}

async function createPurchaseOrder(payload) {
  const res = await fetch('/api/purchase-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create purchase order');
  return data;
}

export default function PurchaseOrdersPage() {
  const [showModal, setShowModal] = useState(false);
  const [showReqModal, setShowReqModal] = useState(false);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [requisitions, setRequisitions] = useState([]);
  const [draftFilters, setDraftFilters] = useState({
    dateRange: 'all',
    customStart: '',
    customEnd: '',
    destination: 'all',
    status: 'all',
    vendor: 'all',
  });
  const [filters, setFilters] = useState({
    dateRange: 'all',
    customStart: '',
    customEnd: '',
    destination: 'all',
    status: 'all',
    vendor: 'all',
  });
  const [form, setForm] = useState({
    destination: '',
    vendor: '',
    invoice_date: '',
    expected_delivery_date: '',
    shipment_mode: '',
    invoice_number: '',
    cc_emails: '',
  });
  const [reqForm, setReqForm] = useState({ requisitionId: '', vendorId: '' });
  const router = useRouter();

  useEffect(() => {
    setLoadingList(true);
    fetchPurchaseOrders()
      .then((data) => setRecords(Array.isArray(data) ? data : []))
      .catch(() => setRecords([]))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    setLoadingLookups(true);
    Promise.allSettled([fetchLookup('/api/stores'), fetchLookup('/api/vendors')])
      .then(([storeResult, vendorResult]) => {
        setStores(storeResult.status === 'fulfilled' ? normalizeStores(storeResult.value) : []);
        setVendors(vendorResult.status === 'fulfilled' ? normalizeVendors(vendorResult.value) : []);
      })
      .finally(() => setLoadingLookups(false));
  }, []);

  useEffect(() => {
    if (!showModal) return;
    if (stores.length > 0 || vendors.length > 0 || loadingLookups) return;
    setLoadingLookups(true);
    Promise.allSettled([fetchLookup('/api/stores'), fetchLookup('/api/vendors')])
      .then(([storeResult, vendorResult]) => {
        setStores(storeResult.status === 'fulfilled' ? normalizeStores(storeResult.value) : []);
        setVendors(vendorResult.status === 'fulfilled' ? normalizeVendors(vendorResult.value) : []);
      })
      .finally(() => setLoadingLookups(false));
  }, [showModal, stores.length, vendors.length, loadingLookups]);

  const handleOpen = () => setShowModal(true);
  const handleClose = () => setShowModal(false);
  const handleOpenReqModal = async () => {
    setShowReqModal(true);
    try {
      const res = await fetch('/api/inventory/stockrequisition?for_po=true', { cache: 'no-store', credentials: 'include' });
      const data = await res.json();
      setRequisitions(Array.isArray(data?.records) ? data.records : []);
    } catch {
      setRequisitions([]);
    }
  };

  const handleApplyFilters = () => {
    setFilters(draftFilters);
  };

  const filteredRecords = useMemo(() => {
    const range = (() => {
      if (filters.dateRange === 'custom') {
        return {
          type: 'custom',
          start: parseDateInput(filters.customStart),
          end: parseDateInput(filters.customEnd),
        };
      }

      if (filters.dateRange === 'last-7-days') {
        const { start, end } = getDateWindow('last-7-days');
        return { type: 'preset', start, end };
      }

      if (filters.dateRange === 'last-30-days') {
        const { start, end } = getDateWindow('last-30-days');
        return { type: 'preset', start, end };
      }

      return 'all';
    })();

    return records.filter((row) => {
      const q = search.trim().toLowerCase();
      const searchMatch = !q || [
        row.id,
        row.transactionId,
        row.destinationName,
        row.vendorName,
        row.invoiceNumber,
        row.shipmentMode,
        row.status,
      ].some((value) => String(value ?? '').toLowerCase().includes(q));
      const destinationMatch = filters.destination === 'all' || String(row.destinationId) === String(filters.destination);
      const vendorMatch = filters.vendor === 'all' || String(row.vendorId) === String(filters.vendor);
      const statusMatch = filters.status === 'all' || String(row.status || '').toLowerCase() === String(filters.status).toLowerCase();
      const dateMatch = isWithinRange(row.confirmedAt || row.createdAt || row.invoiceDate, range);

      return searchMatch && destinationMatch && vendorMatch && statusMatch && dateMatch;
    });
  }, [filters, records, search]);

  const tableData = useMemo(() => mapRecordsToTable(filteredRecords), [filteredRecords]);

  const handleNext = async () => {
    if (!form.destination) return alert('Please select a destination');
    if (!form.vendor) return alert('Please select a vendor');

    setSaving(true);
    try {
      const created = await createPurchaseOrder(form);
      setShowModal(false);
      router.push(`/purchase/purchase-orders/line-items?id=${encodeURIComponent(created.id)}`);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFromRequisition = async () => {
    if (!reqForm.requisitionId) return alert('Please select a requisition');
    if (!reqForm.vendorId) return alert('Please select a vendor');

    setReqSaving(true);
    try {
      const res = await fetch('/api/purchase-orders/from-requisition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(reqForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create PO from requisition');
      setShowReqModal(false);
      router.push(`/purchase/purchase-orders/line-items?id=${encodeURIComponent(data.id)}`);
    } catch (err) {
      alert(err.message || 'Failed to create PO from requisition');
    } finally {
      setReqSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Purchase Orders</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Purchase Order</h1>
          <p className="text-[12.5px] text-gray-400 mt-1">Purchase orders created from the database.</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={handleOpenReqModal} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-300 text-[13px] font-medium text-blue-600 hover:bg-blue-50 transition-colors">
            <i className="ti ti-file-document text-[16px]" />
            Create PO Using Requisition
          </button>
          <button onClick={() => router.push('/purchase/grn/create')} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-green-300 text-[13px] font-medium text-green-600 hover:bg-green-50 transition-colors">
            <i className="ti ti-box text-[16px]" />
            Create GRN
          </button>
          <button onClick={handleOpen} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-[13px] font-medium text-white hover:bg-blue-700 transition-colors">
            <i className="ti ti-plus text-[16px]" />
            Create Purchase Order
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Date Range:</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              value={draftFilters.dateRange}
              onChange={(e) => setDraftFilters({ ...draftFilters, dateRange: e.target.value })}
            >
              <option value="all">All Records</option>
              <option value="last-7-days">Last 7 Days</option>
              <option value="last-30-days">Last 30 Days</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {draftFilters.dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={draftFilters.customStart}
                onChange={(e) => setDraftFilters({ ...draftFilters, customStart: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              />
              <span className="text-gray-700 text-[12px] font-medium">to</span>
              <input
                type="date"
                value={draftFilters.customEnd}
                onChange={(e) => setDraftFilters({ ...draftFilters, customEnd: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Destination:</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              value={draftFilters.destination}
              onChange={(e) => setDraftFilters({ ...draftFilters, destination: e.target.value })}
            >
              <option value="all">ALL</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Status:</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              value={draftFilters.status}
              onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
            >
              <option value="all">All</option>
              <option value="draft">draft</option>
              <option value="confirmed">confirmed</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Vendor:</label>
            <select
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
              value={draftFilters.vendor}
              onChange={(e) => setDraftFilters({ ...draftFilters, vendor: e.target.value })}
            >
              <option value="all">ALL</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleApplyFilters} className="px-4 py-2 rounded-lg bg-blue-600 text-[12px] font-medium text-white hover:bg-blue-700 transition-colors">
            Apply
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-100">
                {tableHeaders.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-gray-500">
                    Loading records...
                  </td>
                </tr>
              ) : tableData.length > 0 ? (
                tableData.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                    {tableHeaders.map((header, colIdx) => (
                      <td key={colIdx} className="px-4 py-3 text-[13px] text-gray-700">
                        {row[header] || '-'}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-blue-700 font-medium">
                    No Records Found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-400">
          <select className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-600">
            <option>10</option>
            <option>20</option>
            <option>50</option>
          </select>
          <span>Showing {tableData.length} Results</span>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
          <div className="relative w-full max-w-[1100px] bg-white rounded-lg border border-gray-300 shadow-lg overflow-auto max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Create Purchase Order</h3>
              <button className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100" onClick={handleClose}>
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <section className="border border-gray-300 rounded p-4 bg-white">
                <h4 className="text-sm text-blue-700 font-semibold mb-3">Basic Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[12px] text-gray-700">Destination *</label>
                    <select
                      value={form.destination}
                      onChange={(e) => setForm({ ...form, destination: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select Destination</option>
                      {loadingLookups ? (
                        <option>Loading...</option>
                      ) : (
                        stores.map((store) => (
                          <option key={store.id} value={store.id}>
                            {store.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Vendor *</label>
                    <select
                      value={form.vendor}
                      onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select Vendor</option>
                      {loadingLookups ? (
                        <option>Loading...</option>
                      ) : (
                        vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendor.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Invoice Date</label>
                    <input
                      type="date"
                      value={form.invoice_date}
                      onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Expected Delivery Date</label>
                    <input
                      type="date"
                      value={form.expected_delivery_date}
                      onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Shipment Mode</label>
                    <input
                      value={form.shipment_mode}
                      onChange={(e) => setForm({ ...form, shipment_mode: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                      placeholder="Enter shipment mode"
                    />
                  </div>

                  <div>
                    <label className="text-[12px] text-gray-700">Invoice Number</label>
                    <input
                      value={form.invoice_number}
                      onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500"
                      placeholder="Invoice number"
                    />
                  </div>
                </div>
              </section>

              <section className="border border-gray-300 rounded p-4 bg-white">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="text-[12px] text-gray-700">CC Email</label>
                    <textarea
                      value={form.cc_emails}
                      onChange={(e) => setForm({ ...form, cc_emails: e.target.value })}
                      className="mt-1 w-full min-h-[120px] rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-blue-500 resize-none"
                      placeholder="Press enter to add multiple emails"
                    />
                  </div>
                </div>
              </section>

              <div className="flex items-center justify-end gap-3">
                <button className="px-4 py-2 rounded-lg border border-gray-200 bg-white" onClick={handleClose}>
                  Cancel
                </button>
                <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={handleNext} disabled={saving}>
                  {saving ? 'Creating...' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReqModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowReqModal(false)} />
          <div className="relative w-full max-w-2xl rounded-lg border border-gray-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Create PO Using Requisition</h3>
              <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => setShowReqModal(false)}>
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <label className="block">
                <span className="mb-1 block text-[12px] text-gray-700">Approved Requisition <span className="text-red-500">*</span></span>
                <select
                  value={reqForm.requisitionId}
                  onChange={(event) => setReqForm({ ...reqForm, requisitionId: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800"
                >
                  <option value="">Select requisition</option>
                  {requisitions.map((req) => (
                    <option key={req.id} value={req.id}>
                      {req.transactionId} - {req.destinationName} - {req.totalItems} items
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-gray-700">Vendor <span className="text-red-500">*</span></span>
                <select
                  value={reqForm.vendorId}
                  onChange={(event) => setReqForm({ ...reqForm, vendorId: event.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800"
                >
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
              </label>
              {requisitions.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  No approved requisitions available. Create and approve a stock requisition first.
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowReqModal(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">Cancel</button>
                <button onClick={handleCreateFromRequisition} disabled={reqSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {reqSaving ? 'Creating...' : 'Create PO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
