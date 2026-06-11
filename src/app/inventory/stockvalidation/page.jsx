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

async function fetchValidations() {
  const res = await fetch('/api/inventory/stockvalidation');
  if (!res.ok) throw new Error('Failed to fetch stock validations');
  return res.json();
}

async function postValidation(payload) {
  const res = await fetch('/api/inventory/stockvalidation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create stock validation');
  return data;
}

const tableHeaders = [
  'Transaction ID',
  'Invoice Number',
  'Source Name',
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

function getValidationItemKey(item) {
  return String(item.variantKey || item.variant_key || item.batch_id || item.batchId || item.product_id);
}

function mapValidationsToTable(records) {
  return (records || []).map((row) => ({
    'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#AUD-${row.id}`,
    'Invoice Number': row.invoiceNumber || '-',
    'Source Name': row.sourceName || 'None',
    'Invoice Date': formatDate(row.invoiceDate),
    'Total Item Number': row.totalItems ?? 0,
    Cost: formatCost(row.cost),
    _invoiceDate: row.invoiceDate || '',
    _source: row.sourceName || 'None',
  }));
}

export default function StockValidationPage() {
  const [showModal, setShowModal] = useState(false);
  const [stores, setStores] = useState([]);
  const [destination, setDestination] = useState('none');
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
    fetchValidations()
      .then((records) => setTableData(mapValidationsToTable(records)))
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
    setDestination('none');
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
        try {
          const draft = await postValidation({
            destination: String(getBulkField(row, ['destination_id', 'destination'], 'none')),
            applyTaxes: toBoolean(getBulkField(row, ['apply_taxes']), true),
          });
          created.push(draft);
        } catch {
          failed += 1;
        }
      }

      if (!created.length) {
        alert('Could not import any row. Check destination_id column.');
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
    setSubmitting(true);
    try {
      const created = await postValidation({ destination, applyTaxes });
      setShowModal(false);
      setDraftId(created.id);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create stock validation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: 'Inventory' }, { label: 'Stock Validation' }]}
        title="Stock Validation"
        subtitle="Stock Validation transaction history of last 7 days. Need Help?"
        actions={[{ label: 'Audit In Bulk (Excel)', onClick: handleBulkImport }, { label: 'Audit', primary: true, onClick: openModal }]}
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
          <div className="w-full max-w-[570px] overflow-hidden rounded bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-[22px] py-6">
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

            <div className="px-[22px] py-[38px]">
              <div className="mb-6">
                <label className="mb-2 block text-[15px] text-gray-700">
                  Destination <span className="font-semibold text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="h-10 w-full appearance-none rounded border border-gray-300 bg-white px-3 pr-12 text-[15px] text-gray-700 outline-none focus:border-blue-400"
                  >
                    <option value="none">None</option>
                    {loadingStores ? (
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
        <ValidationLineItemsWindow
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

function ValidationLineItemsWindow({ id, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    invoice_date: '',
    invoice_number: '',
    other_charges: '',
    remarks: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetch(`/api/inventory/stockvalidation/${encodeURIComponent(id)}`)
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
    const destinationId = draft?.destination;
    if (!destinationId || destinationId === 'none') {
      setProducts([]);
      setLoadingProducts(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoadingProducts(true);
      const params = new URLSearchParams({
        search: searchTerm.trim(),
        pageSize: searchTerm.trim() ? '50' : '500',
        batch_variants: 'true',
        store_id: String(destinationId),
      });
      fetch(`/api/inventory/products?${params.toString()}`)
        .then((res) => res.json())
        .then((res) => {
          const records = res?.data?.records ?? res?.records ?? [];
          setProducts(records);
        })
        .catch(() => setProducts([]))
        .finally(() => setLoadingProducts(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, draft?.destination]);

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
    const variantKey = product.variantKey || `${productId}:batch:${product.batchId || product.batch_id || 'stock'}`;
    setCart((current) => {
      const existing = current.find((item) => getValidationItemKey(item) === String(variantKey));
      if (existing) {
        return current.map((item) =>
          getValidationItemKey(item) === String(variantKey)
            ? { ...item, qty: String(Number(item.qty || 0) + 1) }
            : item
        );
      }
      const cost = Number(product.cost_price || 0);
      const mrp = Number(product.mrp || 0);
      const sellingPrice = Number(
        product.selling_price || product.sellingPrice || product.mrp || 0
      );
      const taxRate = Number(product.tax_rate || 0);
      const existingQty = Number(product.existingQty ?? product.availableStock ?? 0);
      return [
        ...current,
        {
          variantKey,
          product_id: productId,
          batch_id: product.batchId || product.batch_id || null,
          batch_no: product.batchNo || product.batch_no || '',
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          existing_qty: existingQty,
          cost_price: cost,
          mrp,
          selling_price: sellingPrice,
          tax_value: draft?.applyTaxes ? (cost * taxRate) / 100 : 0,
          qty: String(existingQty),
        },
      ];
    });
    setSearchTerm('');
  };

  const updateQty = (itemKey, qty) => {
    const nextQty = qty === '' ? '' : Math.max(0, Number(qty) || 0);
    setCart((current) =>
      current.map((item) =>
        getValidationItemKey(item) === String(itemKey)
          ? { ...item, qty: nextQty }
          : item
      )
    );
  };

  const incrementQty = (itemKey, delta) => {
    setCart((current) =>
      current.map((item) => {
        if (getValidationItemKey(item) !== String(itemKey)) return item;
        const currentQty = Number(item.qty || 0);
        return { ...item, qty: String(Math.max(0, currentQty + delta)) };
      })
    );
  };

  const removeCartItem = (itemKey) => {
    setCart((current) => current.filter((item) => getValidationItemKey(item) !== String(itemKey)));
  };

  const confirm = async () => {
    if (cart.length === 0) return alert('Add at least one product');

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stockvalidation/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm stock validation');
      onConfirmed();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm stock validation');
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
            <span className="font-semibold text-gray-900">Stock Validation</span>
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
              <label className="mb-1 block text-[12px] text-gray-500">Destination</label>
              <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : draft?.destinationName || 'None'}</p>
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
                  <h2 className="text-[14px] font-semibold text-gray-900">Inventory - Stock Validation</h2>
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
                {loadingProducts && (
                  <p className="py-8 text-center text-[13px] text-gray-500">Loading products...</p>
                )}

                {!loadingProducts && products.length > 0 && (
                  <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {products.map((product) => (
                      <button
                        key={product.variantKey || `${product.id}-${product.batchId || product.batch_id || ''}`}
                        type="button"
                        onClick={() => addToCart(product)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-blue-50/60"
                      >
                        <div>
                          <div className="text-[13px] font-medium text-gray-900">{product.name}</div>
                          <div className="text-[12px] text-gray-500">
                            SKU: {product.sku || '-'} · Existing: {Number(product.existingQty ?? product.availableStock ?? 0)}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            MRP: {formatCurrency(product.mrp)} · Selling: {formatCurrency(product.selling_price || product.sellingPrice || product.mrp)} · Cost: {formatCurrency(product.cost_price)}{product.batchNo || product.batch_no ? ` · Batch: ${product.batchNo || product.batch_no}` : ''}
                          </div>
                        </div>
                        <span className="text-[12px] font-medium text-blue-600">Add</span>
                      </button>
                    ))}
                  </div>
                )}

                {!loadingProducts && products.length === 0 && !loading && draft?.destination && draft.destination !== 'none' && (
                  <p className="py-8 text-center text-[13px] text-gray-500">No products found</p>
                )}

                {filteredCart.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Product</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Existing</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Qty</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">MRP</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Selling</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Cost</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">Tax</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCart.map((item) => {
                        const itemKey = getValidationItemKey(item);
                        return (
                        <tr key={itemKey} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-2 py-3">
                            <div className="text-[13px] font-medium text-gray-900">{item.name}</div>
                            <div className="text-[11px] text-gray-500">{item.sku || item.barcode || '-'}</div>
                            {item.batch_no && <div className="text-[11px] text-gray-400">Batch: {item.batch_no}</div>}
                          </td>
                          <td className="px-2 py-3 text-[13px] font-semibold text-gray-700">
                            {Number(item.existing_qty || 0)}
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex w-32 items-center overflow-hidden rounded border border-gray-200 bg-white">
                              <button
                                type="button"
                                onClick={() => incrementQty(itemKey, -1)}
                                className="h-8 w-8 text-[15px] font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={0}
                                value={item.qty}
                                onChange={(e) => updateQty(itemKey, e.target.value)}
                                className="h-8 w-16 border-x border-gray-200 text-center text-[13px] text-gray-700 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => incrementQty(itemKey, 1)}
                                className="h-8 w-8 text-[15px] font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.mrp)}</td>
                          <td className="px-2 py-3 text-[13px] font-semibold text-red-700">{formatCurrency(item.selling_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.cost_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.tax_value)}</td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => removeCartItem(itemKey)}
                              className="rounded p-1.5 text-red-500 hover:bg-red-50"
                            >
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  products.length === 0 && !loadingProducts && <div className="min-h-[240px]" />
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
