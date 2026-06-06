"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { formatIndianDate } from '@/lib/dateUtils';

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatIndianDate(value, '-');
}

function generateBatchNo() {
  return `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function createBatchRow(qty = 1) {
  return {
    batch_id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    batch_no: generateBatchNo(),
    qty,
    expiry_date: '',
  };
}

function sumBatchQty(batches = []) {
  return batches.reduce((sum, batch) => sum + Number(batch.qty || 0), 0);
}

function getProductSku(product) {
  return product?.sku || product?.barcode || product?.product_id || product?.productId || '';
}

function LineItemsContent() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get('id');

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [cartFilter, setCartFilter] = useState('');
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [brandProducts, setBrandProducts] = useState([]);
  const [loadingBrandProducts, setLoadingBrandProducts] = useState(false);
  const [selectedBrandProducts, setSelectedBrandProducts] = useState({});
  const [vendors, setVendors] = useState([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState([]);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    vendor: '',
    invoice_date: '',
    invoice_number: '',
    other_charges: '',
    remarks: '',
  });
  const [confirming, setConfirming] = useState(false);
  const isStoreDestination = String(draft?.destinationLocationType || '').toLowerCase() === 'store';
  const isWarehouseDestination = String(draft?.destinationLocationType || 'Warehouse').toLowerCase() === 'warehouse';
  const sourceType = String(draft?.meta?.sourceType || 'warehouse').toLowerCase();

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/inventory/stockin/${encodeURIComponent(id)}`).then((r) => r.json()),
      fetch('/api/vendors').then((r) => r.json()),
    ])
      .then(([d, v]) => {
        setDraft(d);
        setVendors(Array.isArray(v) ? v : []);
        if (d && !d.error) {
          setForm({
            vendor: d.vendor_name || (Array.isArray(d.meta?.vendorNames) ? d.meta.vendorNames.join(', ') : ''),
            invoice_date: d.invoice_date || '',
            invoice_number: d.invoice_number || '',
            other_charges: d.other_charges ?? '',
            remarks: d.remarks || '',
          });
          setSelectedVendorIds((Array.isArray(d.meta?.vendorIds) ? d.meta.vendorIds : []).map(String));
          if (Array.isArray(d.items) && d.items.length) {
            const warehouseDestination = String(d.destinationLocationType || 'Warehouse').toLowerCase() === 'warehouse';
            setCart(d.items.map((item) => ({
              line_id: `${item.product_id}-${item.id || Date.now()}`,
              product_id: item.product_id,
              name: item.name,
              sku: getProductSku(item),
              cost_price: Number(item.cost_price || 0),
              tax_value: Number(item.tax_value || 0),
              qty: Number(item.qty || 1),
              max_qty: null,
              batches: warehouseDestination
                ? [{
                    ...createBatchRow(Number(item.qty || 1)),
                    batch_no: item.batch_no || generateBatchNo(),
                    expiry_date: item.expiry_date || '',
                  }]
                : [],
              batch_no: item.batch_no || generateBatchNo(),
              expiry_date: item.expiry_date || '',
            })));
          }
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const loadSourceProducts = async ({ searchValue = '', brandId = '', brandName = '', pageSize = 30, catalogOnly = false, signal } = {}) => {
    if (!draft) return [];
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (searchValue.trim()) params.set('search', searchValue.trim());
    if (brandId) params.set('brandId', brandId);
    if (brandName.trim()) params.set('brandName', brandName.trim());
    if (catalogOnly) params.set('catalogOnly', '1');
    const activeSourceType = String(draft?.meta?.sourceType || 'warehouse').toLowerCase();
    params.set('source', activeSourceType === 'vendor' ? 'vendor' : 'warehouse');
    params.set('destinationType', String(draft?.destinationLocationType || '').toLowerCase());
    if (activeSourceType === 'vendor') {
      params.set('vendorIds', selectedVendorIds.join(','));
    }

    const response = await fetch(`/api/inventory/stockin/source-products?${params.toString()}`, { signal });
    const res = await response.json();
    const records = res?.data?.records ?? res?.records ?? [];
    return Array.isArray(records) ? records : [];
  };

  const mapCatalogProductForStockIn = (product) => ({
    id: product.id,
    product_id: product.product_id || product.id,
    name: product.name,
    sku: product.sku || product.barcode || product.product_id || '',
    barcode: product.barcode || '',
    cost_price: Number(product.cost_price ?? product.costPrice ?? product.selling_price ?? product.mrp ?? 0),
    mrp: Number(product.mrp || 0),
    selling_price: Number(product.selling_price || 0),
    taxRate: Number(product.tax_rate || product.taxRate || 0),
    availableStock: Number(product.actual_stock || product.availableStock || 0),
    brandName: product.brand_name || product.brandName || '',
  });

  const loadCatalogBrandProducts = async ({ brandId, brandName, signal }) => {
    const params = new URLSearchParams({ pageSize: '500' });
    if (brandId) params.set('brand_id', brandId);
    const response = await fetch(`/api/catalog/products?${params.toString()}`, { signal });
    const json = await response.json();
    const records = json?.data?.records || json?.records || [];
    if (Array.isArray(records) && records.length) {
      return records.map(mapCatalogProductForStockIn);
    }

    const fallbackParams = new URLSearchParams({ pageSize: '1000' });
    const fallbackResponse = await fetch(`/api/catalog/products?${fallbackParams.toString()}`, { signal });
    const fallbackJson = await fallbackResponse.json();
    const fallbackRecords = fallbackJson?.data?.records || fallbackJson?.records || [];
    const cleanBrandName = String(brandName || '').trim().toLowerCase();
    return (Array.isArray(fallbackRecords) ? fallbackRecords : [])
      .filter((product) => String(product.brand_name || product.brandName || '').trim().toLowerCase() === cleanBrandName)
      .map(mapCatalogProductForStockIn);
  };

  useEffect(() => {
    const query = searchTerm.trim();
    if (!query || !draft) {
      setProducts([]);
      setLoadingProducts(false);
      return;
    }

    const controller = new AbortController();
    setLoadingProducts(true);
    const t = setTimeout(() => {
      loadSourceProducts({ searchValue: query, signal: controller.signal })
        .then(setProducts)
        .catch((error) => {
          if (error?.name !== 'AbortError') setProducts([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingProducts(false);
        });
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [searchTerm, draft, selectedVendorIds]);

  useEffect(() => {
    if (!showBrandPicker) return;
    fetch('/api/catalog/brands?pageSize=500')
      .then((response) => response.json())
      .then((json) => setBrands(json?.data?.records || json?.records || []))
      .catch(() => setBrands([]));
  }, [showBrandPicker]);

  useEffect(() => {
    const isBrandShortcut = (event) => {
      const key = String(event.key || '').toLowerCase();
      const code = String(event.code || '').toLowerCase();
      const isF2 =
        key === 'f2' ||
        code === 'f2' ||
        event.keyCode === 113 ||
        event.which === 113;
      const isAltBrand = event.altKey && key === 'b';
      return isF2 || isAltBrand;
    };

    const handleKeyDown = (event) => {
      if (!isBrandShortcut(event)) return;
      event.preventDefault();
      setShowBrandPicker(true);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!showBrandPicker || !selectedBrandId || !draft) {
      setBrandProducts([]);
      return;
    }

    const controller = new AbortController();
    const selectedBrand = brands.find((brand) => String(brand.id) === String(selectedBrandId));
    setLoadingBrandProducts(true);
    loadCatalogBrandProducts({
      brandId: selectedBrandId,
      brandName: selectedBrand?.name || '',
      signal: controller.signal,
    })
      .then(setBrandProducts)
      .catch((error) => {
        if (error?.name !== 'AbortError') setBrandProducts([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingBrandProducts(false);
      });

    return () => controller.abort();
  }, [showBrandPicker, selectedBrandId, draft, selectedVendorIds, brands]);

  const filteredCart = useMemo(() => {
    if (!cartFilter.trim()) return cart;
    const q = cartFilter.toLowerCase();
    return cart.filter((it) => (it.name || '').toLowerCase().includes(q));
  }, [cart, cartFilter]);

  const totals = useMemo(() => {
    let totalItems = 0;
    let totalCost = Number(form.other_charges || 0);
    let totalTax = 0;
    for (const it of cart) {
      const qty = Number(it.qty || 0);
      const cost = Number(it.cost_price || 0);
      totalItems += qty;
      totalCost += qty * cost;
      totalTax += Number(it.tax_value || 0) * qty;
    }
    return { totalItems, totalCost, totalTax };
  }, [cart, form.other_charges]);

  const addToCart = (p, options = {}) => {
    const pid = p.id ?? p.product_id;
    const availableStock = Number(p.availableStock ?? p.available_stock ?? 0);
    const requestedQty = Math.max(1, Number(options.qty || 1) || 1);
    const selectedQty = cart
      .filter((item) => String(item.product_id) === String(pid))
      .reduce((sum, item) => sum + Number(item.qty || 0), 0);

    const sourceType = String(draft?.meta?.sourceType || 'warehouse').toLowerCase();
    if (sourceType === 'warehouse' && isStoreDestination && selectedQty + requestedQty > availableStock) {
      alert(`${p.name} has only ${availableStock} quantity available in warehouse`);
      return;
    }

    setCart((c) => {
      const taxRate = Number(p.tax_rate ?? p.taxRate ?? 0);
      const cost = Number(options.cost_price ?? p.cost_price ?? 0);
      const expiryDate = options.expiry_date || '';
      return [
        ...c,
        {
          line_id: `${pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          product_id: pid,
          name: p.name,
          sku: getProductSku(p),
          cost_price: cost,
          tax_value: draft?.applyTaxes ? (cost * taxRate) / 100 : 0,
          qty: requestedQty,
          max_qty: sourceType === 'warehouse' && isStoreDestination ? availableStock : null,
          batches: sourceType === 'warehouse' && isStoreDestination ? [] : [{ ...createBatchRow(requestedQty), expiry_date: expiryDate }],
          batch_no: generateBatchNo(),
          expiry_date: expiryDate,
        },
      ];
    });
    setSearchTerm('');
    setProducts([]);
  };

  const closeBrandPicker = () => {
    setShowBrandPicker(false);
    setSelectedBrandId('');
    setBrandProducts([]);
    setSelectedBrandProducts({});
  };

  const toggleBrandProduct = (product) => {
    const key = String(product.id ?? product.product_id);
    setSelectedBrandProducts((current) => {
      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return {
        ...current,
        [key]: {
          product,
          qty: '1',
          cost_price: String(Number(product.cost_price || 0)),
          expiry_date: '',
        },
      };
    });
  };

  const updateSelectedBrandProduct = (key, updates) => {
    setSelectedBrandProducts((current) => ({
      ...current,
      [key]: { ...current[key], ...updates },
    }));
  };

  const submitSelectedBrandProducts = () => {
    const selectedRows = Object.values(selectedBrandProducts);
    if (!selectedRows.length) {
      alert('Select at least one product');
      return;
    }

    const invalid = selectedRows.find((row) => {
      const qty = Number(row.qty || 0);
      return !Number.isFinite(qty) || qty <= 0;
    });
    if (invalid) {
      alert(`Enter quantity greater than zero for ${invalid.product.name}`);
      return;
    }

    selectedRows.forEach((row) => {
      addToCart(row.product, {
        qty: Number(row.qty || 1),
        cost_price: Number(row.cost_price || 0),
        expiry_date: row.expiry_date || '',
      });
    });
    closeBrandPicker();
  };

  const openCreateProduct = () => {
    const params = new URLSearchParams({
      returnTo: `/inventory/stockin/line-items?id=${encodeURIComponent(id)}`,
    });
    if (searchTerm.trim()) params.set('name', searchTerm.trim());
    router.push(`/catalog/products/create?${params.toString()}`);
  };

  const updateCartItem = (lineId, updates) => {
    setCart((c) => c.map((it) => (it.line_id === lineId ? { ...it, ...updates } : it)));
  };

  const updateBatchRow = (lineId, batchId, updates) => {
    setCart((c) =>
      c.map((it) => {
        if (it.line_id !== lineId) return it;
        const batches = (it.batches || []).map((batch) =>
          batch.batch_id === batchId ? { ...batch, ...updates } : batch
        );
        return { ...it, batches, qty: Math.max(0, sumBatchQty(batches)) };
      })
    );
  };

  const addBatchRow = (lineId) => {
    setCart((c) =>
      c.map((it) => {
        if (it.line_id !== lineId) return it;
        const batches = [...(it.batches || []), createBatchRow(1)];
        return { ...it, batches, qty: Math.max(0, sumBatchQty(batches)) };
      })
    );
  };

  const removeBatchRow = (lineId, batchId) => {
    setCart((c) =>
      c.map((it) => {
        if (it.line_id !== lineId) return it;
        const batches = (it.batches || []).filter((batch) => batch.batch_id !== batchId);
        return { ...it, batches, qty: Math.max(0, sumBatchQty(batches)) };
      })
    );
  };

  const updateQty = (lineId, qty) => {
    setCart((c) =>
      c.map((it) => {
        if (it.line_id !== lineId) return it;
        const requestedQty = Math.max(1, Number(qty) || 1);
        if (isWarehouseDestination) {
          const batches = it.batches?.length ? it.batches : [createBatchRow(requestedQty)];
          const nextBatches = batches.map((batch, index) => index === 0 ? { ...batch, qty: requestedQty } : batch);
          return { ...it, batches: nextBatches, qty: Math.max(0, sumBatchQty(nextBatches)) };
        }
        if (String(draft?.meta?.sourceType || 'warehouse').toLowerCase() !== 'warehouse' || !isStoreDestination || !it.max_qty) return { ...it, qty: requestedQty };

        const otherSelectedQty = c
          .filter((item) => item.line_id !== lineId && String(item.product_id) === String(it.product_id))
          .reduce((sum, item) => sum + Number(item.qty || 0), 0);
        const allowedQty = Math.max(1, Number(it.max_qty || 0) - otherSelectedQty);
        if (requestedQty > allowedQty) {
          alert(`${it.name} has only ${it.max_qty} quantity available in warehouse`);
        }
        return { ...it, qty: Math.min(requestedQty, allowedQty) };
      })
    );
  };

  const removeItem = (lineId) => {
    setCart((c) => c.filter((it) => it.line_id !== lineId));
  };

  const confirm = async () => {
    if (!id) return alert('Missing stock in id');
    if (cart.length === 0) return alert('Add at least one product');
    if (isWarehouseDestination) {
      const invalidItem = cart.find((item) => !item.batches?.length || sumBatchQty(item.batches) <= 0);
      if (invalidItem) return alert(`Add batch quantity for ${invalidItem.name}`);
    }
    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stockin/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: { ...form, vendorIds: selectedVendorIds, sourceType }, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      router.push('/inventory/stockin');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm');
    } finally {
      setConfirming(false);
    }
  };

  if (!id) {
    return (
      <MainLayout>
        <div className="text-gray-600">Missing stock in id. Go back and start a new stock in.</div>
      </MainLayout>
    );
  }

  const destinationLabel = draft?.destinationName || '—';

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Inventory</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Stock in – line items</span>
      </div>

      <div className="flex h-[calc(100vh-132px)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-5 overflow-hidden pb-4">
        <div className="h-full w-[280px] flex-shrink-0 overflow-y-auto bg-white rounded-lg border border-gray-200 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <h3 className="text-[15px] font-semibold text-blue-600 mb-5">Stock Information</h3>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Destination</label>
            <p className="text-[13px] font-medium text-gray-900">{loading ? '…' : destinationLabel}</p>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Stock Source</label>
            <p className="text-[13px] font-semibold text-gray-900">{sourceType === 'vendor' ? 'Direct Vendor' : 'Warehouse'}</p>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Reference Transaction Type</label>
            <p className="text-[13px] font-semibold text-gray-900">{draft?.referenceType || 'stock_in'}</p>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Reference ID</label>
            <p className="text-[13px] font-semibold text-gray-900">{draft?.referenceId || draft?.transactionId || (id ? `STK-${String(id).padStart(4, '0')}` : '—')}</p>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Vendor Name</label>
            {sourceType === 'vendor' ? (
              <select
                multiple
                value={selectedVendorIds}
                onChange={(e) => {
                  const ids = Array.from(e.target.selectedOptions).map((option) => option.value);
                  setSelectedVendorIds(ids);
                  const names = vendors.filter((vendor) => ids.includes(String(vendor.id))).map((vendor) => vendor.name);
                  setForm({ ...form, vendor: names.join(', ') });
                }}
                className="h-28 w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
              >
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={String(vendor.id)}>
                    {vendor.name}{vendor.company ? ` - ${vendor.company}` : ''}
                  </option>
                ))}
              </select>
            ) : (
            <div className="relative">
              <input
                list="vendor-list"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="Select vendor"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-8 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
              />
              <datalist id="vendor-list">
                {vendors.map((v) => (
                  <option key={v.name} value={v.name} />
                ))}
              </datalist>
              <i className="ti ti-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px] pointer-events-none" />
            </div>
            )}
          </div>

          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-[12px] text-gray-500 mb-1">Invoice Date</label>
              <input
                type="date"
                value={form.invoice_date}
                onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[12px] text-gray-500 mb-1">Invoice Number</label>
              <input
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                placeholder="10"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[12px] text-gray-500 mb-1">Other Charges</label>
            <input
              value={form.other_charges}
              onChange={(e) => setForm({ ...form, other_charges: e.target.value })}
              placeholder="Other Charges"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-[12px] text-gray-500 mb-1">Remarks</label>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              placeholder="Remarks"
              rows={5}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 min-w-0 flex-col">
          <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2.5 mb-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search product to add"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
            <button
              type="button"
              onClick={() => setShowBrandPicker(true)}
              className="rounded-md border border-red-100 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
              title="Add products by brand"
            >
              Add Product
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)] min-h-0 flex-1 flex flex-col">
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-[14px] font-semibold text-gray-900">Inventory - Stock In</h2>
                <p className="text-[12px] text-gray-500 mt-0.5">Select desired products & proceed</p>
              </div>
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 min-w-[200px]">
                <input
                  type="text"
                  placeholder="Search"
                  value={cartFilter}
                  onChange={(e) => setCartFilter(e.target.value)}
                  className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
                />
                <i className="ti ti-search text-gray-400 text-[15px]" />
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto">
              {products.length > 0 && (
                <div className="mb-4 border border-gray-100 rounded-lg divide-y divide-gray-100">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50/60 transition-colors"
                    >
                      <div>
                        <div className="text-[13px] font-medium text-gray-900">{p.name}</div>
                        {sourceType === 'warehouse' && isStoreDestination && (
                          <div className="text-[11px] text-emerald-600 mt-0.5">
                            Warehouse qty: {Number(p.availableStock || 0)}
                          </div>
                        )}
                        {sourceType === 'vendor' && p.vendor_names && (
                          <div className="text-[11px] text-blue-600 mt-0.5">
                            Vendor: {p.vendor_names}
                          </div>
                        )}
                        <div className="text-[12px] text-gray-500">SKU: {getProductSku(p) || '—'}</div>
                      </div>
                      <span className="text-[12px] font-medium text-blue-600">Add</span>
                    </button>
                  ))}
                </div>
              )}

              {searchTerm.trim() && !loadingProducts && products.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-[13px] text-gray-500">No products found</p>
                  <button
                    type="button"
                    onClick={openCreateProduct}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <i className="ti ti-plus text-[14px]" />
                    Create product
                  </button>
                </div>
              )}

              {filteredCart.length > 0 ? (
                isWarehouseDestination ? (
                  <div className="space-y-3">
                    {filteredCart.map((it) => (
                      <div key={it.line_id} className="rounded-lg border border-gray-200 bg-white">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-3">
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold text-gray-900">{it.name}</div>
                            <div className="mt-0.5 text-[12px] text-gray-500">SKU: {it.sku || '—'}</div>
                          </div>
                          <div className="flex items-center gap-6 text-right">
                            <div>
                              <div className="text-[11px] font-semibold uppercase text-gray-400">Total Qty</div>
                              <div className="text-[15px] font-semibold text-gray-900">{Number(it.qty || 0)}</div>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold uppercase text-gray-400">Cost</div>
                              <div className="text-[13px] font-medium text-gray-700">{formatCurrency(it.cost_price)}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeItem(it.line_id)}
                              className="p-2 text-red-500 hover:bg-red-50 rounded"
                              title="Remove product"
                            >
                              <i className="ti ti-trash text-[17px]" />
                            </button>
                          </div>
                        </div>

                        <div className="px-4 py-3">
                          <div className="grid grid-cols-[1.1fr_110px_150px_40px] gap-3 px-1 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                            <span>Batch No</span>
                            <span>Qty</span>
                            <span>Expiry Date</span>
                            <span />
                          </div>

                          <div className="space-y-2">
                            {(it.batches || []).map((batch, index) => (
                                <div key={batch.batch_id} className="grid grid-cols-[1.1fr_110px_150px_40px] gap-3 items-center">
                                  <div className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] font-medium text-gray-700 flex items-center">
                                    {batch.batch_no || `Batch ${index + 1}`}
                                  </div>
                                <input
                                  type="number"
                                  min={0}
                                  value={batch.qty}
                                  onChange={(e) => updateBatchRow(it.line_id, batch.batch_id, { qty: e.target.value })}
                                  placeholder="Qty"
                                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] text-gray-800 outline-none focus:border-blue-400"
                                />
                                <input
                                  type="date"
                                  value={batch.expiry_date}
                                  onChange={(e) => updateBatchRow(it.line_id, batch.batch_id, { expiry_date: e.target.value })}
                                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] text-gray-800 outline-none focus:border-blue-400"
                                  title="Expiry date"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeBatchRow(it.line_id, batch.batch_id)}
                                  disabled={(it.batches || []).length <= 1}
                                  className="h-10 w-10 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="Remove batch"
                                >
                                  <i className="ti ti-x text-[16px]" />
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                            <button
                              type="button"
                              onClick={() => addBatchRow(it.line_id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              <i className="ti ti-plus text-[14px]" />
                              Add batch
                            </button>
                            <div className="text-[12px] text-gray-500">
                              {it.batches?.length || 0} batch{it.batches?.length === 1 ? '' : 'es'} added
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Product</th>
                        <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Qty</th>
                        <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Batch</th>
                        <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Expiry</th>
                        <th className="text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide py-2 px-2">Cost</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCart.map((it) => (
                        <tr key={it.line_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-3 px-2">
                            <div className="text-[13px] font-medium text-gray-900">{it.name}</div>
                            <div className="text-[11px] text-gray-500">{it.sku}</div>
                          </td>
                          <td className="py-3 px-2">
                            <input
                              type="number"
                              min={1}
                              max={it.max_qty || undefined}
                              value={it.qty}
                              onChange={(e) => updateQty(it.line_id, e.target.value)}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-[13px] text-gray-700"
                            />
                            {sourceType === 'warehouse' && isStoreDestination && it.max_qty ? (
                              <div className="mt-1 text-[10px] text-gray-500">Max {it.max_qty}</div>
                            ) : null}
                          </td>
                          <td className="py-3 px-2 text-[12px] text-gray-500">{sourceType === 'vendor' ? 'Vendor batch' : 'Auto from warehouse'}</td>
                          <td className="py-3 px-2 text-[12px] text-gray-500">
                            {it.expiry_date ? formatDate(it.expiry_date) : sourceType === 'vendor' ? '-' : 'FEFO'}
                          </td>
                          <td className="py-3 px-2 text-[13px] text-gray-700">{formatCurrency(it.cost_price)}</td>
                          <td className="py-3 px-2">
                            <button
                              type="button"
                              onClick={() => removeItem(it.line_id)}
                              className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                            >
                              <i className="ti ti-trash text-[16px]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                !searchTerm.trim() && <div className="min-h-[400px]" />
              )}
            </div>
          </div>
        </div>
      </div>

      {showBrandPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900">Add Products By Brand</h3>
                <p className="mt-0.5 text-[12px] text-gray-500">Shortcut: Alt+B or F2</p>
              </div>
              <button
                type="button"
                onClick={closeBrandPicker}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
                title="Close"
              >
                <i className="ti ti-x text-[18px]" />
              </button>
            </div>

            <div className="border-b border-gray-100 p-5">
              <label className="mb-2 block text-[12px] font-semibold text-gray-600">Brand</label>
              <select
                value={selectedBrandId}
                onChange={(event) => setSelectedBrandId(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-red-300"
              >
                <option value="">Select brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={String(brand.id)}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {!selectedBrandId ? (
                <div className="py-10 text-center text-[13px] text-gray-500">Select a brand to view products.</div>
              ) : loadingBrandProducts ? (
                <div className="py-10 text-center text-[13px] text-gray-500">Loading products...</div>
              ) : brandProducts.length ? (
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {brandProducts.map((product) => {
                    const key = String(product.id ?? product.product_id);
                    const selected = selectedBrandProducts[key];
                    return (
                    <div key={key} className={`px-4 py-3 ${selected ? 'bg-red-50/50' : ''}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-gray-900">{product.name}</div>
                          <div className="text-[12px] text-gray-500">SKU: {getProductSku(product) || '-'} · Stock: {Number(product.availableStock || 0)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleBrandProduct(product)}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                            selected ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-700 hover:bg-red-50'
                          }`}
                        >
                          {selected ? 'Selected' : 'Select'}
                        </button>
                      </div>
                      {selected && (
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-gray-600">Quantity</label>
                            <input
                              type="number"
                              min="1"
                              value={selected.qty}
                              onChange={(event) => updateSelectedBrandProduct(key, { qty: event.target.value })}
                              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] text-gray-800 outline-none focus:border-red-300"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-gray-600">Cost</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={selected.cost_price}
                              onChange={(event) => updateSelectedBrandProduct(key, { cost_price: event.target.value })}
                              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] text-gray-800 outline-none focus:border-red-300"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold text-gray-600">Expiry Date</label>
                            <input
                              type="date"
                              value={selected.expiry_date}
                              onChange={(event) => updateSelectedBrandProduct(key, { expiry_date: event.target.value })}
                              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] text-gray-800 outline-none focus:border-red-300"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              ) : (
                <div className="py-10 text-center text-[13px] text-gray-500">No products found for this brand.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
              <span className="text-[12px] font-medium text-gray-600">
                {Object.keys(selectedBrandProducts).length} selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedBrandProducts({})}
                  disabled={!Object.keys(selectedBrandProducts).length}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={submitSelectedBrandProducts}
                  disabled={!Object.keys(selectedBrandProducts).length}
                  className="rounded-lg bg-red-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 bg-white border-t border-gray-200 shadow-[0_-2px_8px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-10 flex-wrap">
            <span className="text-[13px] text-gray-600">
              Total Items: <strong className="text-gray-900 font-semibold">{totals.totalItems}</strong>
            </span>
            <span className="text-[13px] text-gray-600">
              Total Cost: <strong className="text-gray-900 font-semibold">{formatCurrency(totals.totalCost)}</strong>
            </span>
            <span className="text-[13px] text-gray-600">
              Total Tax Value: <strong className="text-gray-900 font-semibold">{formatCurrency(totals.totalTax)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCart([])}
              className="p-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              title="Clear cart"
            >
              <i className="ti ti-trash text-[18px]" />
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={confirming || cart.length === 0}
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {confirming ? 'Confirming…' : 'Confirm Transaction'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </MainLayout>
  );
}

export default function StockInLineItemsPage() {
  return (
    <Suspense fallback={<MainLayout><div className="text-gray-500 p-4">Loading…</div></MainLayout>}>
      <LineItemsContent />
    </Suspense>
  );
}
