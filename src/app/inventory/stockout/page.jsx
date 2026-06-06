"use client";

import { useEffect, useMemo, useState } from 'react';
import InventoryShell from '@/components/inventory/InventoryShell';
import SearchableSelect from '@/components/SearchableSelect';
import { getBulkField, parseBulkSheet, pickSpreadsheetFile, toBoolean } from '@/lib/bulkSheet';
import { formatIndianDate } from '@/lib/dateUtils';

async function fetchStores() {
  const res = await fetch('/api/stores');
  if (!res.ok) throw new Error('Failed to fetch stores');
  const json = await res.json();
  return json.data?.records || json.data?.stores || json.stores || [];
}

async function fetchStockOutList() {
  const res = await fetch('/api/inventory/stockout');
  if (!res.ok) throw new Error('Failed to fetch stock out records');
  return res.json();
}

async function fetchInventoryProducts(storeId, searchTerm, filters = {}) {
  if (!storeId) return [];
  const params = new URLSearchParams({
    store_id: String(storeId),
    search: searchTerm,
    pageSize: '50',
  });
  if (filters.brandId) params.set('brand_id', filters.brandId);
  if (filters.vendor) params.set('vendor', filters.vendor);
  const res = await fetch(`/api/inventory/products?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch inventory products');
  const json = await res.json();
  return json.data?.records || json.records || [];
}

async function postStockOut(payload) {
  const res = await fetch('/api/inventory/stockout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create stock out');
  return data;
}

const tableHeaders = [
  'Transaction ID',
  'Invoice Number',
  'Destination',
  'Invoice Date',
  'Total Item Number',
  'Cost',
  'Reference Transaction Type',
  'Reference ID',
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

function mapRecordsToTable(records) {
  return (records || []).map((row) => ({
    'Transaction ID': row.transactionId ? `#${row.transactionId}` : `#STKO-${row.id}`,
    'Invoice Number': row.invoiceNumber || '-',
    Destination: row.destination || 'All',
    'Invoice Date': formatDate(row.invoiceDate),
    'Total Item Number': row.totalItems ?? 0,
    Cost: formatCost(row.cost),
    'Reference Transaction Type': row.referenceType || '-',
    'Reference ID': row.referenceId || '-',
    _invoiceDate: row.invoiceDate || '',
    _source: row.referenceType || '',
  }));
}

export default function StockOutPage() {
  const [showModal, setShowModal] = useState(false);
  const [lineItemsDraftId, setLineItemsDraftId] = useState(null);
  const [stores, setStores] = useState([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [activeTab, setActiveTab] = useState('stock_out');
  const [destination, setDestination] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [grnId, setGrnId] = useState('');
  const [reason, setReason] = useState('');
  const [applyTaxes, setApplyTaxes] = useState(true);
  const [addProductsPrefill, setAddProductsPrefill] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tableData, setTableData] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
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
    fetchStockOutList()
      .then((data) => setTableData(mapRecordsToTable(data)))
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
      .then((data) => {
        const nextStores = Array.isArray(data) ? data : [];
        setStores(nextStores);
        setDestination((current) => current || String(nextStores[0]?.id || ''));
      })
      .catch(() => setStores([]))
      .finally(() => setLoadingStores(false));
  }, [showModal]);

  const handleOpen = () => {
    setActiveTab('stock_out');
    setDestination('');
    setPurchaseOrderId('');
    setInvoiceNumber('');
    setGrnId('');
    setReason('');
    setApplyTaxes(true);
    setAddProductsPrefill(true);
    setShowModal(true);
  };

  const handleClose = () => setShowModal(false);

  const handleBulkImport = async () => {
    try {
      const file = await pickSpreadsheetFile();
      if (!file) return;

      const rows = await parseBulkSheet(file);
      if (!rows.length) {
        alert('No rows found in selected file.');
        return;
      }
      const storeOptions = stores.length ? stores : await fetchStores().catch(() => []);

      const created = [];
      let failed = 0;

      for (const row of rows) {
        try {
          const methodRaw = String(getBulkField(row, ['method', 'mode'], 'stock_out')).toLowerCase();
          const method = methodRaw.includes('return') ? 'po_return' : 'stock_out';
          const payload = {
            method,
            destination: method === 'stock_out'
              ? String(getBulkField(row, ['destination_id', 'destination', 'store_id', 'store'], storeOptions[0]?.id || ''))
              : 'all',
            applyTaxes: toBoolean(getBulkField(row, ['apply_taxes']), true),
            addProductsPrefill: toBoolean(getBulkField(row, ['add_products_prefill']), true),
            purchaseOrderId: getBulkField(row, ['purchase_order_id', 'po_id'], null),
            invoiceNumber: getBulkField(row, ['invoice_number'], null),
          };
          const draft = await postStockOut(payload);
          created.push(draft);
        } catch {
          failed += 1;
        }
      }

      if (!created.length) {
        alert('Could not import any row. Check columns like destination_id, method, invoice_number.');
        return;
      }

      alert(`Bulk import complete: ${created.length} draft(s) created${failed ? `, ${failed} failed` : ''}. Opening the first draft.`);
      setLineItemsDraftId(created[0].id);
    } catch (err) {
      console.error(err);
      alert('Bulk import failed. Please use a valid Excel/CSV file.');
    }
  };

  const handleNext = async () => {
    if (!destination) {
      return alert('Please select a destination');
    }
    if ((activeTab === 'return_vendor' || activeTab === 'return_warehouse') && !grnId.trim()) {
      return alert('Enter GRN ID');
    }
    if ((activeTab === 'damage_dump' || activeTab === 'return_vendor' || activeTab === 'return_warehouse') && !reason.trim()) {
      return alert('Enter reason');
    }

    setSubmitting(true);
    try {
      const payload = {
        method: activeTab,
        destination,
        applyTaxes,
        addProductsPrefill,
        purchaseOrderId: purchaseOrderId.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        grnId: grnId.trim() || null,
        reason: reason.trim() || null,
      };
      const created = await postStockOut(payload);
      setShowModal(false);
      setLineItemsDraftId(created.id);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create stock out');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <InventoryShell
        breadcrumb={[{ label: 'Inventory' }, { label: 'Stock Out' }]}
        title="Stock Out"
        subtitle="Stock Out transaction history of last 7 days. Need Help?"
        actions={[
          { label: 'Remove In Bulk (Excel)', onClick: handleBulkImport },
          { label: 'Remove Stock', primary: true, onClick: handleOpen },
        ]}
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
          <div className="relative flex min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)]">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Step 1: Fill Details</h3>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100"
                aria-label="Close"
              >
                <i className="ti ti-x text-[20px]" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('stock_out')}
                  className={`rounded-md border px-4 py-2.5 text-[14px] font-medium transition-colors ${
                    activeTab === 'stock_out'
                      ? 'border-blue-300 bg-blue-50 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Stock Out
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('damage_dump')}
                  className={`rounded-md border px-4 py-2.5 text-[14px] font-medium transition-colors ${
                    activeTab === 'damage_dump'
                      ? 'border-blue-300 bg-blue-50 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Damage/Dump
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('return_vendor')}
                  className={`rounded-md border px-4 py-2.5 text-[14px] font-medium transition-colors ${
                    activeTab === 'return_vendor'
                      ? 'border-blue-300 bg-blue-50 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Return Vendor
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('return_warehouse')}
                  className={`rounded-md border px-4 py-2.5 text-[14px] font-medium transition-colors ${
                    activeTab === 'return_warehouse'
                      ? 'border-blue-300 bg-blue-50 text-gray-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Return Warehouse
                </button>
              </div>

              {activeTab === 'stock_out' || activeTab === 'damage_dump' ? (
                <div>
                  <div className="mb-5">
                    <label className="mb-2 block text-sm text-gray-800">
                      Destination<span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <select
                      className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-700"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    >
                      <option value="">Select Destination</option>
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
                  </div>
                  {activeTab === 'damage_dump' && (
                    <div className="mb-5">
                      <label className="mb-2 block text-sm text-gray-800">Reason<span className="ml-0.5 text-red-500">*</span></label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-700" placeholder="Damage, dump, expiry..." value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                  )}

                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={applyTaxes}
                      onChange={(e) => setApplyTaxes(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm font-semibold text-gray-800">Apply Taxes On This Transaction</span>
                  </label>
                </div>
              ) : (
                <div>
                  <div className="mb-4">
                    <label className="mb-2 block text-sm text-gray-800">
                      Source Store<span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <select
                      className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-700"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    >
                      <option value="">Select Store</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>{store.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-4">
                    <label className="mb-2 block text-sm text-gray-800">GRN ID</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-700"
                      placeholder="Enter GRN ID"
                      value={grnId}
                      onChange={(e) => setGrnId(e.target.value)}
                    />
                  </div>
                  <div className="mb-2">
                    <label className="mb-2 block text-sm text-gray-800">Invoice Number</label>
                    <input
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-700"
                      placeholder="Enter Invoice Number"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                    />
                  </div>
                  <p className="mb-5 text-[12px] italic text-gray-500">
                    *Stock will be removed from the selected destination on the next screen.
                  </p>
                  <div className="mb-5">
                    <label className="mb-2 block text-sm text-gray-800">Reason<span className="ml-0.5 text-red-500">*</span></label>
                    <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-700" placeholder={activeTab === 'return_warehouse' ? 'Return to warehouse reason' : 'Return to vendor reason'} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>

                  <div className="space-y-4">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyTaxes}
                        onChange={(e) => setApplyTaxes(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-sm font-semibold text-gray-800">Apply Taxes On This Transaction</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={addProductsPrefill}
                        onChange={(e) => setAddProductsPrefill(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                      />
                      <span className="text-sm font-semibold text-gray-800">
                        Add products to cart by default with prefilled quantity.
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button
                type="button"
                className="rounded-lg border border-blue-500 px-5 py-2 text-[13px] font-medium text-blue-600 transition-colors hover:bg-blue-50"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                onClick={handleNext}
                disabled={submitting}
              >
                {submitting ? '...' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lineItemsDraftId && (
        <StockOutLineItemsWindow
          id={lineItemsDraftId}
          onClose={() => setLineItemsDraftId(null)}
          onConfirmed={() => {
            setLineItemsDraftId(null);
            loadList();
          }}
        />
      )}
    </>
  );
}

function StockOutLineItemsWindow({ id, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState('');
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    vendor: '',
    invoice_date: '',
    invoice_number: '',
    purchase_order_id: '',
    grn_id: '',
    other_charges: '',
    remarks: '',
    reason: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/inventory/stockout/${encodeURIComponent(id)}`).then((res) => res.json()),
      fetch('/api/vendors').then((res) => res.json()).catch(() => []),
      fetch('/api/catalog/brands?pageSize=300').then((res) => res.json()).catch(() => null),
    ])
      .then(([draftData, vendorData, brandData]) => {
        setDraft(draftData);
        setVendors(Array.isArray(vendorData) ? vendorData : []);
        setBrands(brandData?.success ? (brandData.data?.records || []) : []);
        if (draftData && !draftData.error) {
          setForm({
            vendor: draftData.vendor_name || '',
            invoice_date: draftData.invoice_date || '',
            invoice_number: draftData.invoice_number || '',
            purchase_order_id: draftData.purchase_order_id || '',
            grn_id: draftData.grn_id || '',
            other_charges: draftData.other_charges ?? '',
            remarks: draftData.remarks || '',
            reason: draftData.reason || '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const storeId = draft?.destination || draft?.destination_id || draft?.destinationId;
      if (!storeId) {
        setProducts([]);
        return;
      }
      fetchInventoryProducts(storeId, searchTerm, { brandId, vendor: form.vendor })
        .then((records) => setProducts((records || []).filter((product) => Number(product.availableStock ?? product.available_stock ?? 0) > 0)))
        .catch(() => setProducts([]));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, draft?.destination, draft?.destination_id, draft?.destinationId, brandId, form.vendor]);

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

  const destinationLabel = draft?.destinationName || '—';

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
      const taxRate = Number(product.tax_rate || 0);
      return [
        ...current,
        {
          product_id: productId,
          name: product.name,
          sku: product.sku,
          cost_price: cost,
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
        alert(`${item.name} only has ${available} available in this store.`);
        return false;
      }
    }
    return true;
  };

  const removeItem = (productId) => {
    setCart((current) => current.filter((item) => String(item.product_id) !== String(productId)));
  };

  const confirm = async () => {
    if (cart.length === 0) return alert('Add at least one product');
    if ((draft?.method === 'damage_dump' || draft?.method === 'return_vendor' || draft?.method === 'return_warehouse') && !form.reason.trim()) {
      return alert('Enter reason');
    }
    if (!validateCart()) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stockout/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm stock out');
      onConfirmed();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm stock out');
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
            <span className="font-semibold text-gray-900">Stock out</span>
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

            <div>
              <div className="mb-4">
                <label className="mb-1 block text-[12px] text-gray-500">Destination</label>
                <p className="text-[13px] font-medium text-gray-900">{loading ? '...' : destinationLabel}</p>
              </div>

              <Field label="Vendor Name">
                <div className="relative">
                  <input
                    list="stockout-window-vendor-list"
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    placeholder="Select vendor"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-8 text-[13px] text-gray-700 outline-none focus:border-blue-400"
                  />
                  <datalist id="stockout-window-vendor-list">
                    {vendors.map((vendor) => (
                      <option key={vendor.name} value={vendor.name} />
                    ))}
                  </datalist>
                  <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-gray-400" />
                </div>
              </Field>

              <Field label="Brand Filter">
                <SearchableSelect
                  value={brandId}
                  onChange={setBrandId}
                  placeholder="All brands"
                  searchPlaceholder="Search brand..."
                  options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
                />
              </Field>

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

              {(draft?.method === 'damage_dump' || draft?.method === 'return_vendor' || draft?.method === 'return_warehouse') && (
                <>
                  <Field label="GRN ID">
                    <input
                      value={form.grn_id}
                      onChange={(e) => setForm({ ...form, grn_id: e.target.value })}
                      placeholder="GRN ID"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
                    />
                  </Field>
                  <Field label="Reason">
                    <input
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      placeholder="Reason"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
                    />
                  </Field>
                </>
              )}

              <Field label="Remarks">
                <textarea
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  placeholder="Remarks"
                  rows={5}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-blue-400"
                />
              </Field>
            </div>
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
                  <h2 className="text-[14px] font-semibold text-gray-900">Inventory - Stock Out</h2>
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
                          <div className="text-[12px] text-gray-500">Available in store: {Number(product.availableStock || product.available_stock || 0)}</div>
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
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.cost_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-gray-700">{formatCurrency(item.tax_value)}</td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => removeItem(item.product_id)}
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
