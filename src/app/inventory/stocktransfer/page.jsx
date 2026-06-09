"use client";

import { useEffect, useMemo, useState } from 'react';
import InventoryShell from '@/components/inventory/InventoryShell';
import { getBulkField, parseBulkSheet, pickSpreadsheetFile, toBoolean } from '@/lib/bulkSheet';
import { formatIndianDate } from '@/lib/dateUtils';

async function fetchStores() {
  const res = await fetch('/api/stores');
  if (!res.ok) throw new Error('Failed to fetch stores');
  const json = await res.json();
  return json.data?.records || json.data?.stores || json.stores || [];
}

async function fetchTransfers() {
  const res = await fetch('/api/inventory/stocktransfer');
  if (!res.ok) throw new Error('Failed to fetch stock transfers');
  return res.json();
}

async function fetchInventoryProducts(storeId, searchTerm) {
  if (!storeId) return [];
  const params = new URLSearchParams({
    store_id: String(storeId),
    search: searchTerm,
    pageSize: '50',
  });
  const res = await fetch(`/api/inventory/products?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch inventory products');
  const json = await res.json();
  return json.data?.records || json.records || [];
}

async function postTransfer(payload) {
  const res = await fetch('/api/inventory/stocktransfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create stock transfer');
  return data;
}

const tableHeaders = [
  'Transaction ID',
  'Invoice Number',
  'Source Name',
  'Destination Name',
  'Invoice Date',
  'Total Item Number',
  'Cost',
];

function formatDate(value) {
  return formatIndianDate(value, '-');
}

function formatCost(value) {
  const n = Number(value || 0);
  return `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mapTransfersToTable(records) {
  return (records || []).map((row) => ({
    'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#TRN-${row.id}`,
    'Invoice Number': row.invoiceNumber || '-',
    'Source Name': row.sourceName || '-',
    'Destination Name': row.destinationName || '-',
    'Invoice Date': formatDate(row.invoiceDate),
    'Total Item Number': row.totalItems ?? 0,
    Cost: formatCost(row.cost),
    _invoiceDate: row.invoiceDate || '',
    _source: row.sourceName || '',
  }));
}

export default function StockTransferPage() {
  const [showModal, setShowModal] = useState(false);
  const [stores, setStores] = useState([]);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [applyTaxes, setApplyTaxes] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [tableData, setTableData] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [listFilters, setListFilters] = useState({ dateFrom: '', dateTo: '', source: '' });

  const visibleTableData = useMemo(() => {
    return tableData.filter((row) => {
      const invoiceTime = row._invoiceDate ? new Date(row._invoiceDate).getTime() : null;
      if (listFilters.dateFrom && invoiceTime && invoiceTime < new Date(listFilters.dateFrom).getTime()) return false;
      if (listFilters.dateTo && invoiceTime && invoiceTime > new Date(`${listFilters.dateTo}T23:59:59`).getTime()) return false;
      if (listFilters.source && String(row._source || '') !== listFilters.source) return false;
      return true;
    });
  }, [tableData, listFilters]);

  const sourceOptions = useMemo(
    () => Array.from(new Set(tableData.map((row) => row._source).filter(Boolean))).sort(),
    [tableData]
  );

  const loadList = () => {
    setLoadingList(true);
    fetchTransfers()
      .then((records) => setTableData(mapTransfersToTable(records)))
      .catch(() => setTableData([]))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!showModal) return;
    setLoadingStores(true);
    fetchStores()
      .then((data) => setStores(Array.isArray(data) ? data : []))
      .catch(() => setStores([]))
      .finally(() => setLoadingStores(false));
  }, [showModal]);

  const openModal = () => {
    setSource('');
    setDestination('');
    setApplyTaxes(true);
    setShowModal(true);
  };

  const handleBulkImport = async () => {
    try {
      const file = await pickSpreadsheetFile();
      if (!file) return;

      const rows = await parseBulkSheet(file);
      if (!rows.length) {
        alert('No rows found in selected file.');
        return;
      }

      const created = [];
      let failed = 0;

      for (const row of rows) {
        const sourceId = getBulkField(row, ['source_id', 'source']);
        const destinationId = getBulkField(row, ['destination_id', 'destination']);
        if (!sourceId || !destinationId || String(sourceId) === String(destinationId)) {
          failed += 1;
          continue;
        }
        try {
          const draft = await postTransfer({
            source: String(sourceId),
            destination: String(destinationId),
            applyTaxes: toBoolean(getBulkField(row, ['apply_taxes']), true),
          });
          created.push(draft);
        } catch {
          failed += 1;
        }
      }

      if (!created.length) {
        alert('Could not import any row. Check columns like source_id and destination_id.');
        return;
      }

      alert(`Bulk import complete: ${created.length} draft(s) created${failed ? `, ${failed} failed` : ''}. Opening the first draft.`);
      setDraftId(created[0].id);
    } catch (err) {
      console.error(err);
      alert('Bulk import failed. Please use a valid Excel/CSV file.');
    }
  };

  const next = async () => {
    if (!source) return alert('Please select a source');
    if (!destination) return alert('Please select a destination');
    if (String(source) === String(destination)) return alert('Source and destination cannot be the same');

    setSubmitting(true);
    try {
      const created = await postTransfer({ source, destination, applyTaxes });
      setShowModal(false);
      setDraftId(created.id);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create stock transfer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: 'Inventory' }, { label: 'Stock Transfer' }]}
        title="Stock Transfer"
        subtitle="Stock Transfer transaction history of last 7 days. Need Help?"
        actions={[{ label: 'Bulk Operations', onClick: handleBulkImport }, { label: 'Stock Transfer', primary: true, onClick: openModal }]}
        searchPlaceholder="Search"
        filters={(
          <>
            <input
              type="date"
              value={listFilters.dateFrom}
              onChange={(e) => setListFilters((current) => ({ ...current, dateFrom: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
              title="From date"
            />
            <input
              type="date"
              value={listFilters.dateTo}
              onChange={(e) => setListFilters((current) => ({ ...current, dateTo: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
              title="To date"
            />
            <select
              value={listFilters.source}
              onChange={(e) => setListFilters((current) => ({ ...current, source: e.target.value }))}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
            >
              <option value="">All sources</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setListFilters({ dateFrom: '', dateTo: '', source: '' })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600 hover:bg-slate-50"
            >
              Reset
            </button>
          </>
        )}
        tableHeaders={tableHeaders}
        tableData={loadingList ? [] : visibleTableData}
        emptyMessage={loadingList ? 'Loading records...' : 'No Records Found'}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-[668px] overflow-hidden rounded bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-[22px] py-5">
              <h3 className="text-[24px] font-semibold leading-none text-gray-900">Step 1: Fill Details</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <i className="ti ti-x text-[24px]" />
              </button>
            </div>

            <div className="px-[22px] py-[34px]">
              <button
                type="button"
                className="mb-9 h-[45px] w-[294px] rounded border border-blue-500 bg-cyan-100 text-[15px] font-semibold text-gray-800"
              >
                Stock Transfer
              </button>

              <div className="mb-6">
                <label className="mb-2 block text-[15px] text-gray-700">
                  Source <span className="font-semibold text-red-500">*</span>
                </label>
                <SelectBox
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Please Select a Source."
                  stores={stores}
                  loading={loadingStores}
                />
              </div>

              <div className="mb-6">
                <label className="mb-2 block text-[15px] text-gray-700">
                  Destination <span className="font-semibold text-red-500">*</span>
                </label>
                <SelectBox
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Please select a destination."
                  stores={stores}
                  loading={loadingStores}
                />
              </div>

              <label className="inline-flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={applyTaxes}
                  onChange={(e) => setApplyTaxes(e.target.checked)}
                  className="h-5 w-5 accent-amber-400"
                />
                <span className="text-[16px] font-semibold text-gray-900">Apply Taxes On This Transaction</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-5 border-t border-gray-200 px-4 py-4">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded border border-blue-600 px-4 py-2 text-[14px] font-medium text-blue-600 hover:bg-blue-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={next}
                disabled={submitting}
                className="rounded bg-blue-600 px-5 py-2 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? '...' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftId && (
        <TransferLineItemsWindow
          id={draftId}
          onClose={() => setDraftId(null)}
          onConfirmed={() => {
            setDraftId(null);
            loadList();
          }}
        />
      )}
    </>
  );
}

function SelectBox({ value, onChange, placeholder, stores, loading }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        className="h-10 w-full appearance-none rounded border border-gray-300 bg-white px-3 pr-12 text-[16px] text-gray-700 outline-none focus:border-blue-400"
      >
        <option value="">{placeholder}</option>
        {loading ? (
          <option disabled>Loading...</option>
        ) : (
          stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))
        )}
      </select>
      <span className="absolute right-10 top-2 h-6 border-l border-gray-300" />
      <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-gray-400" />
    </div>
  );
}

function TransferLineItemsWindow({ id, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    invoice_date: '',
    invoice_number: '',
    other_charges: '',
    remarks: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        setDraft(data);
        if (data && !data.error) {
          setForm({
            invoice_date: data.invoice_date || '',
            invoice_number: data.invoice_number || '',
            other_charges: data.other_charges ?? '',
            remarks: data.remarks || '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const storeId = draft?.source || draft?.source_id || draft?.sourceId;
      if (!storeId) {
        setProducts([]);
        return;
      }
      fetchInventoryProducts(storeId, searchTerm)
        .then((records) => setProducts((records || []).filter((product) => Number(product.availableStock ?? product.available_stock ?? 0) > 0)))
        .catch(() => setProducts([]));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, draft?.source, draft?.source_id, draft?.sourceId]);

  const filteredCart = cartFilter.trim()
    ? cart.filter((item) => (item.name || '').toLowerCase().includes(cartFilter.toLowerCase()))
    : cart;

  const totals = cart.reduce(
    (acc, item) => {
      const qty = Number(item.qty || 0);
      const cost = Number(item.cost_price || 0);
      acc.totalItems += qty;
      acc.totalCost += qty * cost;
      acc.totalTax += Number(item.tax_value || 0) * qty;
      return acc;
    },
    { totalItems: 0, totalCost: Number(form.other_charges || 0), totalTax: 0 }
  );

  const addToCart = (product) => {
    const productId = product.id ?? product.product_id;
    const availableStock = Number(product.availableStock ?? product.available_stock ?? 0);
    if (availableStock <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => String(item.product_id) === String(productId));
      if (existing) {
        const nextQty = Math.min(Number(existing.qty) + 1, availableStock);
        return current.map((item) =>
          String(item.product_id) === String(productId)
            ? { ...item, qty: nextQty }
            : item
        );
      }
      const cost = Number(product.cost_price || 0);
      const mrp = Number(product.mrp || 0);
      const sellingPrice = Number(
        product.selling_price || product.sellingPrice || product.mrp || 0
      );
      const taxRate = Number(product.tax_rate || 0);
      return [
        ...current,
        {
          product_id: productId,
          name: product.name,
          sku: product.sku,
          cost_price: cost,
          mrp,
          selling_price: sellingPrice,
          tax_value: draft?.applyTaxes ? (cost * taxRate) / 100 : 0,
          available_stock: availableStock,
          qty: 1,
        },
      ];
    });
    setSearchTerm('');
    setProducts([]);
  };

  const updateQty = (productId, qty) => {
    setCart((current) =>
      current.map((item) =>
        String(item.product_id) === String(productId)
          ? { ...item, qty: Math.min(Math.max(1, Number(qty) || 1), Number(item.available_stock || 1)) }
          : item
      )
    );
  };

  const validateCart = () => {
    for (const item of cart) {
      const qty = Number(item.qty || 0);
      const available = Number(item.available_stock || 0);
      if (qty > available) {
        alert(`${item.name} only has ${available} available in the source store.`);
        return false;
      }
    }
    return true;
  };

  const confirm = async () => {
    if (cart.length === 0) return alert('Add at least one product');
    if (!validateCart()) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stocktransfer/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm stock transfer');
      onConfirmed();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm stock transfer');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed bottom-0 right-0 top-[104px] z-[35] bg-[#f1f2f5] md:left-[418px] max-md:left-0">
      <div className="relative h-full overflow-hidden border-t border-gray-200 bg-[#f1f2f5] shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="flex h-12 items-center justify-between border-b border-gray-200 bg-[#f1f2f5] px-9">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-gray-500">Inventory</span>
            <i className="ti ti-chevron-right text-[11px] text-gray-400" />
            <span className="font-semibold text-gray-900">Stock Transfer</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="Close line items"
          >
            <i className="ti ti-x text-[18px]" />
          </button>
        </div>

        <div className="absolute bottom-[88px] left-0 right-0 top-12 grid grid-cols-[350px_minmax(520px,1fr)] gap-6 overflow-auto px-9 py-6 max-lg:grid-cols-1 max-lg:px-4">
          <aside className="h-full min-h-0 overflow-auto rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h3 className="mb-5 text-[15px] font-semibold text-blue-600">Stock Information</h3>

            <div className="mb-4">
              <label className="mb-1 block text-[12px] text-gray-500">Source</label>
              <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : draft?.sourceName || '-'}</p>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-[12px] text-gray-500">Destination</label>
              <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : draft?.destinationName || '-'}</p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <Field label="Invoice Date">
                <input
                  type="date"
                  value={form.invoice_date}
                  onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400"
                />
              </Field>
              <Field label="Invoice Number">
                <input
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="10"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
                />
              </Field>
            </div>

            <Field label="Other Charges">
              <input
                value={form.other_charges}
                onChange={(e) => setForm({ ...form, other_charges: e.target.value })}
                placeholder="Other Charges"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
              />
            </Field>
            <Field label="Remarks">
              <textarea
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                placeholder="Remarks"
                rows={5}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
              />
            </Field>
          </aside>

          <main className="flex h-full min-w-0 flex-col">
            <div className="mb-4 flex flex-shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <i className="ti ti-search text-[16px] text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
              />
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-gray-900">Inventory - Stock Transfer</h2>
                  <p className="mt-0.5 text-[12px] text-gray-500">Select desired products & proceed</p>
                </div>
                <div className="flex min-w-[200px] items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 max-sm:hidden">
                  <input
                    type="text"
                    placeholder="Search"
                    value={cartFilter}
                    onChange={(e) => setCartFilter(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  <i className="ti ti-search text-[15px] text-gray-400" />
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {products.length > 0 && (
                  <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product)}
                        disabled={Number(product.availableStock || product.available_stock || 0) <= 0}
                        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-blue-50/60"
                      >
                        <div>
                          <div className="text-[13px] font-medium text-gray-900">{product.name}</div>
                          <div className="text-[12px] text-gray-500">SKU: {product.sku || '-'}</div>
                          <div className="text-[12px] text-gray-500">Available in source: {Number(product.availableStock || product.available_stock || 0)}</div>
                        </div>
                        <span className="text-[12px] font-medium text-blue-600">Add</span>
                      </button>
                    ))}
                  </div>
                )}

                {products.length === 0 && !loading && (
                  <p className="py-8 text-center text-[13px] text-gray-500">No products found</p>
                )}

                {filteredCart.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Product</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Qty</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">MRP</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Selling</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Cost</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Tax</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCart.map((item) => (
                        <tr key={item.product_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-2 py-3">
                            <div className="text-[13px] font-medium text-gray-900">{item.name}</div>
                            <div className="text-[11px] text-gray-500">{item.sku}</div>
                          </td>
                          <td className="px-2 py-3">
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) => updateQty(item.product_id, e.target.value)}
                              className="w-20 rounded border border-gray-200 px-2 py-1 text-[13px] text-gray-700"
                            />
                          </td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.mrp)}</td>
                          <td className="px-2 py-3 text-[13px] font-semibold text-red-700">{formatCurrency(item.selling_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.cost_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.tax_value)}</td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => setCart((current) => current.filter((cartItem) => cartItem.product_id !== item.product_id))}
                              className="rounded p-1.5 text-red-500 hover:bg-red-50"
                            >
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  !searchTerm.trim() && <div className="min-h-[240px]" />
                )}
              </div>
            </section>
          </main>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-[88px] border-t border-gray-200 bg-white shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
          <div className="flex h-full items-center justify-between px-6 max-md:px-4">
            <div className="flex flex-wrap items-center gap-10">
              <span className="text-[13px] text-gray-600">
                Total Items: <strong className="font-semibold text-gray-900">{totals.totalItems}</strong>
              </span>
              <span className="text-[13px] text-gray-600">
                Total Cost: <strong className="font-semibold text-gray-900">{formatCurrency(totals.totalCost)}</strong>
              </span>
              <span className="text-[13px] text-gray-600">
                Total Tax Value: <strong className="font-semibold text-gray-900">{formatCurrency(totals.totalTax)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={confirming || cart.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming ? 'Confirming...' : 'Confirm Transaction'}
              </button>
              <button
                type="button"
                onClick={() => setCart([])}
                className="rounded-lg border border-gray-200 p-2.5 text-gray-600 transition-colors hover:bg-gray-50"
                title="Clear cart"
              >
                <i className="ti ti-trash text-[18px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-[12px] text-gray-500">{label}</label>
      {children}
    </div>
  );
}
