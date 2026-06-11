'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { fetchLookup, normalizeStores } from '@/lib/purchaseLookups';
import { useUser } from '@/hooks/useUser';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toQty(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function formatQty(value) {
  return String(toQty(value));
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function lineCost(item) {
  return toQty(item.qty) * toNumber(item.mrp);
}

function lineTax(item) {
  const rate = toNumber(item.tax_rate ?? item.taxRate);
  if (rate > 0) return (lineCost(item) * rate) / 100;
  return toNumber(item.tax_value);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function dateInputValue(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function loadStores() {
  return normalizeStores(await fetchLookup('/api/stores'));
}

function emptyForm() {
  return {
    destinationId: '',
    vendorName: '',
    invoiceNumber: '',
    invoiceDate: today(),
    otherCharges: '',
    remarks: '',
  };
}

function makeRow(product, scanCode) {
  return {
    rowId: `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    product_id: product.id,
    productName: product.name,
    barcode: product.barcode || '',
    sku: product.sku || '',
    category: product.category || '',
    brand: product.brand || '',
    unit: product.unit || 'Piece',
    scanCode,
    qty: '1',
    mrp: product.mrp || '',
    cost_price: product.mrp || '',
    selling_price: product.mrp || '',
    tax_rate: product.taxRate ?? product.taxValue ?? 0,
    tax_value: 0,
    batchNo: '',
    expiryDate: '',
    serialNumber: scanCode || '',
  };
}

export default function RemoteGrnPage() {
  const { user } = useUser();
  const scanInputRef = useRef(null);
  const [stores, setStores] = useState([]);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState([]);
  const [scanCode, setScanCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [recordActionId, setRecordActionId] = useState(null);
  const [toast, setToast] = useState(null);
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const canApproveRemoteGrn =
    user?.role === 'super_admin' ||
    user?.system_role === 'super_admin' ||
    userPermissions.includes('*') ||
    userPermissions.includes('APPROVE_REMOTE_GRN') ||
    userPermissions.includes('MANAGE_PURCHASE_ORDERS');
  const canViewCosting =
    canApproveRemoteGrn ||
    userPermissions.includes('VIEW_REMOTE_GRN_COSTING');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const refreshRecords = async () => {
    try {
      const res = await fetch('/api/purchase/remote-grns', { cache: 'no-store' });
      const json = await res.json();
      setRecords(Array.isArray(json.records) ? json.records : []);
    } catch {
      setRecords([]);
    }
  };

  useEffect(() => {
    Promise.allSettled([loadStores(), refreshRecords()])
      .then(([storeResult]) => {
        if (storeResult.status === 'fulfilled') setStores(storeResult.value || []);
        if (storeResult.status === 'rejected') showToast('Failed to load stores', 'error');
      })
      .finally(() => {
        setLoading(false);
        setTimeout(() => scanInputRef.current?.focus(), 50);
      });
  }, []);

  const totals = useMemo(() => {
    const itemQty = items.reduce((sum, item) => sum + toQty(item.qty), 0);
    const itemCost = items.reduce((sum, item) => sum + lineCost(item), 0);
    const tax = items.reduce((sum, item) => sum + lineTax(item), 0);
    const other = toNumber(form.otherCharges);
    return {
      itemQty,
      itemCost,
      tax,
    };
  }, [form.otherCharges, items]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const updateItem = (rowId, key, value) => {
    const nextValue = key === 'qty' ? String(toQty(value) || '') : value;
    setItems((current) =>
      current.map((item) => (item.rowId === rowId ? { ...item, [key]: nextValue } : item))
    );
  };

  const removeItem = (rowId) => {
    setItems((current) => current.filter((item) => item.rowId !== rowId));
    setTimeout(() => scanInputRef.current?.focus(), 50);
  };

  const scanProduct = async (event) => {
    event?.preventDefault();
    const code = scanCode.trim();
    if (!code) return;
    if (!form.destinationId) {
      showToast('Select store before scanning', 'error');
      return;
    }

    setScanning(true);
    try {
      const res = await fetch(
        `/api/purchase/remote-grns?scan=${encodeURIComponent(code)}&store_id=${encodeURIComponent(form.destinationId)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      if (!res.ok || !json.product) {
        showToast(json.error || 'Product not found in master', 'error');
        return;
      }

      setItems((current) => {
        const existing = current.find((item) => Number(item.product_id) === Number(json.product.id));
        if (!existing) return [makeRow(json.product, code), ...current];
        return current.map((item) =>
          item.rowId === existing.rowId
            ? { ...item, qty: String(toQty(item.qty) + 1 || 1), scanCode: code }
            : item
        );
      });
      setScanCode('');
      showToast('Product fetched from master');
    } catch {
      showToast('Failed to fetch product', 'error');
    } finally {
      setScanning(false);
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  };

  const validate = () => {
    if (!form.destinationId) return 'Select store';
    if (!items.length) return 'Scan at least one product';
    const invalid = items.find((item) =>
      !item.product_id ||
      toQty(item.qty) <= 0 ||
      toNumber(item.mrp) < 0 ||
      toNumber(item.mrp) < 0
    );
    if (invalid) return `Check qty and MRP for ${invalid.productName}`;
    return '';
  };

  const payloadItems = (sourceItems = items) =>
    sourceItems.map((item) => ({
      product_id: item.product_id,
      productName: item.productName,
      qty: toQty(item.qty),
      mrp: toNumber(item.mrp),
      cost_price: canViewCosting ? toNumber(item.cost_price) : toNumber(item.mrp),
      selling_price: canViewCosting ? toNumber(item.selling_price) : toNumber(item.mrp),
      tax_value: lineTax(item),
      tax_rate: toNumber(item.tax_rate ?? item.taxRate),
      batchNo: item.batchNo,
      expiryDate: item.expiryDate || null,
      serialNumber: item.serialNumber,
      scanCode: item.scanCode,
      source: 'remote_grn',
      remoteGrn: true,
    }));

  const buildConfirmBody = (formData = form, sourceItems = items) => ({
    form: {
      vendor: formData.vendorName,
      invoice_number: formData.invoiceNumber,
      invoice_date: formData.invoiceDate,
      other_charges: toNumber(formData.otherCharges),
      remarks: formData.remarks,
      sourceType: 'vendor',
      source: 'remote_grn',
    },
    items: payloadItems(sourceItems).map((item) => ({
      ...item,
      name: item.productName,
      batches: [{
        qty: item.qty,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
      }],
    })),
  });

  const saveDraft = async () => {
    const error = validate();
    if (error) {
      showToast(error, 'error');
      return null;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/purchase/remote-grns', {
        method: activeDraftId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeDraftId,
          ...form,
          items: payloadItems(),
          otherCharges: toNumber(form.otherCharges),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save Remote GRN');
      if (canApproveRemoteGrn) {
        if (!activeDraftId && json.id) setActiveDraftId(json.id);
        showToast(`Draft saved${json.transactionId ? `: ${json.transactionId}` : ''}`);
      } else {
        setForm(emptyForm());
        setItems([]);
        setScanCode('');
        setActiveDraftId(null);
        showToast(`Remote GRN submitted for approval${json.transactionId ? `: ${json.transactionId}` : ''}`);
      }
      await refreshRecords();
      return json;
    } catch (err) {
      showToast(err.message || 'Failed to save Remote GRN', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const confirmGrn = async () => {
    if (!canApproveRemoteGrn) {
      showToast('Only Remote GRN approvers can confirm stock', 'error');
      return;
    }
    const draft = await saveDraft();
    const draftId = draft?.id || activeDraftId;
    if (!draftId) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stockin/${encodeURIComponent(draftId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConfirmBody()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to confirm Remote GRN');
      setForm(emptyForm());
      setItems([]);
      setScanCode('');
      setActiveDraftId(null);
      showToast(
        json.marginApprovalCount > 0
          ? `Stock updated. ${json.marginApprovalCount} price change(s) sent for admin approval.`
          : 'Remote GRN confirmed and stock updated'
      );
      await refreshRecords();
    } catch (err) {
      showToast(err.message || 'Failed to confirm Remote GRN', 'error');
    } finally {
      setConfirming(false);
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  };

  const openDraft = async (record) => {
    if (record.status === 'confirmed') return;
    setRecordActionId(record.id);
    try {
      const res = await fetch(`/api/purchase/remote-grns?id=${encodeURIComponent(record.id)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to open draft');
      setActiveDraftId(json.id);
      setForm({
        destinationId: json.destinationId ? String(json.destinationId) : '',
        vendorName: json.vendorName || '',
        invoiceNumber: json.invoiceNumber || '',
        invoiceDate: json.invoiceDate || today(),
        otherCharges: json.otherCharges || '',
        remarks: json.remarks || '',
      });
      setItems((json.items || []).map((item) => ({
        rowId: `${item.productId}-${item.id}-${Date.now()}`,
        product_id: item.productId,
        productName: item.productName,
        barcode: item.barcode || '',
        sku: item.sku || '',
        scanCode: item.scanCode || item.barcode || item.sku || '',
        qty: formatQty(item.qty),
        mrp: item.mrp || '',
        cost_price: item.costPrice ?? item.cost_price ?? item.mrp ?? '',
        selling_price: item.sellingPrice ?? item.selling_price ?? item.mrp ?? '',
        tax_value: item.taxValue || 0,
        tax_rate: item.meta?.taxRate ?? item.taxRate ?? 0,
        batchNo: item.batchNo || item.batch_no || item.meta?.batchNo || '',
        expiryDate: dateInputValue(item.expiryDate || item.expiry_date || item.meta?.expiryDate),
        serialNumber: item.serialNumber || '',
      })));
      showToast(`${json.transactionId || 'Draft'} opened`);
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (err) {
      showToast(err.message || 'Failed to open draft', 'error');
    } finally {
      setRecordActionId(null);
    }
  };

  const confirmDraftRecord = async (record) => {
    if (record.status === 'confirmed') return;
    setRecordActionId(record.id);
    setConfirming(true);
    try {
      const res = await fetch(`/api/purchase/remote-grns?id=${encodeURIComponent(record.id)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load draft');
      const formData = {
        vendorName: json.vendorName || '',
        invoiceNumber: json.invoiceNumber || '',
        invoiceDate: json.invoiceDate || today(),
        otherCharges: json.otherCharges || '',
        remarks: json.remarks || '',
      };
      const sourceItems = (json.items || []).map((item) => ({
        product_id: item.productId,
        productName: item.productName,
        qty: toQty(item.qty),
        mrp: item.mrp,
        cost_price: item.costPrice ?? item.cost_price ?? item.mrp,
        selling_price: item.sellingPrice ?? item.selling_price ?? item.mrp,
        tax_value: item.taxValue,
        tax_rate: item.meta?.taxRate ?? item.taxRate ?? 0,
        batchNo: item.batchNo || item.batch_no || item.meta?.batchNo || '',
        expiryDate: dateInputValue(item.expiryDate || item.expiry_date || item.meta?.expiryDate),
        serialNumber: item.serialNumber,
        scanCode: item.scanCode,
      }));

      const confirmRes = await fetch(`/api/inventory/stockin/${encodeURIComponent(record.id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConfirmBody(formData, sourceItems)),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmJson.error || 'Failed to confirm draft');
      if (activeDraftId === record.id) {
        setForm(emptyForm());
        setItems([]);
        setActiveDraftId(null);
      }
      showToast(
        confirmJson.marginApprovalCount > 0
          ? `Stock updated. ${confirmJson.marginApprovalCount} price change(s) sent for admin approval.`
          : `${record.transactionId || 'Remote GRN'} confirmed`
      );
      await refreshRecords();
    } catch (err) {
      showToast(err.message || 'Failed to confirm draft', 'error');
    } finally {
      setRecordActionId(null);
      setConfirming(false);
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-slate-50 px-3 py-4 sm:px-5 lg:px-7">
        {toast && (
          <div className={`fixed right-4 top-16 z-[1000] max-w-sm rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${
            toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
          }`}>
            {toast.message}
          </div>
        )}

        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="text-blue-600">Purchase</span>
                <i className="ti ti-chevron-right text-[11px]" />
                <span className="text-slate-900">Remote GRN</span>
              </div>
              <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">Remote GRN</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {activeDraftId
                  ? `Editing draft RGRN-${String(activeDraftId).padStart(4, '0')}`
                  : 'Scan barcode or S.No, fetch product master data, then enter received qty and MRP store-wise.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={saveDraft}
                disabled={saving || confirming}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {saving ? 'Saving...' : canApproveRemoteGrn ? 'Save Draft' : 'Submit for Approval'}
              </button>
              {canApproveRemoteGrn && (
                <button
                  type="button"
                  onClick={confirmGrn}
                  disabled={saving || confirming}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {confirming ? 'Posting...' : 'Confirm GRN'}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Store</span>
                    <select
                      value={form.destinationId}
                      onChange={(event) => updateForm('destinationId', event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">{loading ? 'Loading stores...' : 'Select store'}</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>{store.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Vendor</span>
                    <input
                      value={form.vendorName}
                      onChange={(event) => updateForm('vendorName', event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                      placeholder="Vendor name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Invoice No.</span>
                    <input
                      value={form.invoiceNumber}
                      onChange={(event) => updateForm('invoiceNumber', event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                      placeholder="Bill / invoice"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-slate-600">Invoice Date</span>
                    <input
                      type="date"
                      value={form.invoiceDate}
                      onChange={(event) => updateForm('invoiceDate', event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>

              <form onSubmit={scanProduct} className="rounded-lg border border-red-200 bg-red-50 p-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-widest text-red-700">Scan Barcode / S.No</span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      ref={scanInputRef}
                      value={scanCode}
                      onChange={(event) => setScanCode(event.target.value)}
                      className="h-11 flex-1 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-red-500"
                      placeholder="Scan or type barcode, SKU, S.No"
                    />
                    <button
                      type="submit"
                      disabled={scanning}
                      className="h-11 rounded-lg bg-red-700 px-5 text-sm font-black text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {scanning ? 'Fetching...' : 'Add'}
                    </button>
                  </div>
                </label>
              </form>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-black text-slate-950">Summary</h2>
                    <p className="text-xs font-medium text-slate-500">Review totals before saving or confirming GRN.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total Qty</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{formatQty(totals.itemQty)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Item MRP</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{money(totals.itemCost)}</p>
                  </div>
                  <label className="block rounded-lg bg-slate-50 p-3">
                    <span className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-400">Other Charges</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.otherCharges}
                      onChange={(event) => updateForm('otherCharges', event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">Remarks</span>
                  <textarea
                    rows="2"
                    value={form.remarks}
                    onChange={(event) => updateForm('remarks', event.target.value)}
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-black text-slate-950">Received Items</h2>
                    <p className="text-xs font-medium text-slate-500">Qty and MRP are manual for every scanned product.</p>
                  </div>
                  <span className="text-xs font-bold text-slate-500">{items.length} products</span>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Product</th>
                        <th className="px-3 py-3">Scan</th>
                        <th className="px-3 py-3">Qty</th>
                        <th className="px-3 py-3">MRP</th>
                        {canViewCosting && <th className="px-3 py-3">CP</th>}
                        {canViewCosting && <th className="px-3 py-3">SP</th>}
                        <th className="px-3 py-3">Batch</th>
                        <th className="px-3 py-3">Expiry</th>
                        <th className="px-3 py-3">Total</th>
                        <th className="px-3 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item) => (
                        <tr key={item.rowId} className="text-slate-700">
                          <td className="min-w-[220px] px-3 py-3">
                            <p className="font-bold text-slate-900">{item.productName}</p>
                            <p className="text-xs text-slate-500">{item.sku || item.barcode || '-'}</p>
                          </td>
                          <td className="px-3 py-3 text-xs">{item.scanCode || '-'}</td>
                          {[
                            ['qty', true],
                            ['mrp', true],
                            ['cost_price', canViewCosting],
                            ['selling_price', canViewCosting],
                          ].filter(([, visible]) => visible).map(([key]) => (
                            <td key={key} className="px-3 py-3">
                              <input
                                type="number"
                                min="0"
                                step={key === 'qty' ? '1' : '0.01'}
                                value={item[key]}
                                onChange={(event) => updateItem(item.rowId, key, event.target.value)}
                                onBlur={(event) => key === 'qty' && updateItem(item.rowId, key, event.target.value)}
                                className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                              />
                            </td>
                          ))}
                          <td className="px-3 py-3">
                            <input
                              value={item.batchNo}
                              onChange={(event) => updateItem(item.rowId, 'batchNo', event.target.value)}
                              className="h-9 w-28 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="date"
                              value={item.expiryDate}
                              onChange={(event) => updateItem(item.rowId, 'expiryDate', event.target.value)}
                              className="h-9 w-36 rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-bold">{money(lineCost(item))}</td>
                          <td className="px-3 py-3">
                            <button type="button" onClick={() => removeItem(item.rowId)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50">
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!items.length && (
                        <tr>
                          <td colSpan={canViewCosting ? 10 : 8} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">
                            Scan a product to start Remote GRN.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-3 lg:hidden">
                  {items.map((item) => (
                    <div key={item.rowId} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-slate-900">{item.productName}</p>
                          <p className="text-xs text-slate-500">{item.sku || item.barcode || item.scanCode || '-'}</p>
                        </div>
                        <button type="button" onClick={() => removeItem(item.rowId)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50">
                          <i className="ti ti-trash text-[16px]" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          ['qty', 'Qty'],
                          ['mrp', 'MRP'],
                          ...(canViewCosting ? [['cost_price', 'CP'], ['selling_price', 'SP']] : []),
                        ].map(([key, label]) => (
                          <label key={key} className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
                            <input
                              type="number"
                              min="0"
                              step={key === 'qty' ? '1' : '0.01'}
                              value={item[key]}
                              onChange={(event) => updateItem(item.rowId, key, event.target.value)}
                              onBlur={(event) => key === 'qty' && updateItem(item.rowId, key, event.target.value)}
                              className="h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                            />
                          </label>
                        ))}
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-600">Batch</span>
                          <input
                            value={item.batchNo}
                            onChange={(event) => updateItem(item.rowId, 'batchNo', event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-600">Expiry</span>
                          <input
                            type="date"
                            value={item.expiryDate}
                            onChange={(event) => updateItem(item.rowId, 'expiryDate', event.target.value)}
                            className="h-10 w-full rounded-lg border border-slate-300 px-2 text-sm outline-none focus:border-blue-500"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  {!items.length && (
                    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm font-semibold text-slate-400">
                      Scan a product to start Remote GRN.
                    </div>
                  )}
                </div>
              </div>
              {canApproveRemoteGrn && (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h2 className="text-base font-black text-slate-950">Recent Remote GRNs</h2>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-2">
                {records.slice(0, 8).map((record) => (
                    <div key={record.id} className="rounded-lg px-3 py-3 hover:bg-slate-50">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-900">{record.transactionId || `RGRN-${record.id}`}</p>
                          <p className="text-xs text-slate-500">{record.destination || '-'} - {formatDate(record.invoiceDate || record.createdAt)}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                          record.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {record.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{formatQty(record.totalItems)} qty - {money(record.totalCost)}</p>
                      {record.status !== 'confirmed' && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => openDraft(record)}
                            disabled={recordActionId === record.id || confirming}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {recordActionId === record.id ? '...' : 'Open'}
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmDraftRecord(record)}
                            disabled={recordActionId === record.id || confirming}
                            className="rounded-lg bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!records.length && (
                    <div className="px-3 py-8 text-center text-sm font-semibold text-slate-400">No Remote GRNs yet.</div>
                  )}
                </div>
              </div>
              )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
