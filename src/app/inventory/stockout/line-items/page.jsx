"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Topbar from '@/components/Topbar';
import { fetchInventoryProducts } from '@/lib/inventoryProducts';

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const [vendors, setVendors] = useState([]);
  const [cart, setCart] = useState([]);
  const [form, setForm] = useState({
    vendor: '',
    invoice_date: '',
    invoice_number: '',
    purchase_order_id: '',
    other_charges: '',
    remarks: '',
  });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      fetch(`/api/inventory/stockout/${encodeURIComponent(id)}`).then((r) => r.json()),
      fetch('/api/vendors').then((r) => r.json()).catch(() => []),
    ])
      .then(([d, v]) => {
        setDraft(d);
        setVendors(Array.isArray(v) ? v : []);
        if (d && !d.error) {
          setForm({
            vendor: d.vendor_name || '',
            invoice_date: d.invoice_date || '',
            invoice_number: d.invoice_number || '',
            purchase_order_id: d.purchase_order_id || '',
            other_charges: d.other_charges ?? '',
            remarks: d.remarks || '',
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();

    const loadProducts = async () => {
      setLoadingProducts(true);
      try {
        const records = await fetchInventoryProducts({
          storeId: draft?.destination,
          search: searchTerm,
          signal: controller.signal,
        });
        setProducts(records);
      } catch (error) {
        if (error?.name !== 'AbortError') setProducts([]);
      } finally {
        if (!controller.signal.aborted) setLoadingProducts(false);
      }
    };

    const timer = setTimeout(loadProducts, searchTerm.trim() ? 250 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [draft?.destination, searchTerm]);

  const filteredCart = useMemo(() => {
    if (!cartFilter.trim()) return cart;
    const q = cartFilter.toLowerCase();
    return cart.filter((item) => (item.name || '').toLowerCase().includes(q));
  }, [cart, cartFilter]);

  const totals = useMemo(() => {
    let totalItems = 0;
    let totalCost = Number(form.other_charges || 0);
    let totalTax = 0;

    for (const item of cart) {
      const qty = Number(item.qty || 0);
      const cost = Number(item.cost_price || 0);
      totalItems += qty;
      totalCost += qty * cost;
      totalTax += Number(item.tax_value || 0) * qty;
    }

    return { totalItems, totalCost, totalTax };
  }, [cart, form.other_charges]);

  const addToCart = (product) => {
    const pid = product.id ?? product.product_id;
    const availableStock = Number(product.availableStock ?? product.available_stock ?? 0);
    if (availableStock <= 0) return;

    setCart((current) => {
      const existing = current.find((item) => String(item.product_id) === String(pid));
      if (existing) {
        const nextQty = Math.min(Number(existing.qty || 0) + 1, availableStock);
        return current.map((item) =>
          String(item.product_id) === String(pid)
            ? { ...item, qty: nextQty }
            : item
        );
      }

      const taxRate = Number(product.tax_rate || 0);
      const cost = Number(product.cost_price || 0);
      return [
        ...current,
        {
          product_id: pid,
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
      if (available > 0 && qty > available) {
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
    if (!id) return alert('Missing stock out id');
    if (cart.length === 0) return alert('Add at least one product');
    if (!validateCart()) return;

    setConfirming(true);
    try {
      const res = await fetch(`/api/inventory/stockout/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items: cart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      router.push('/inventory/stockout');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to confirm');
    } finally {
      setConfirming(false);
    }
  };

  if (!id) {
    return (
      <StockOutFrame>
        <div className="px-6 py-5 text-sm text-gray-600">
          Missing stock out id. Go back and start a new stock out.
        </div>
      </StockOutFrame>
    );
  }

  const destinationLabel = draft?.destinationName || '—';

  return (
    <StockOutFrame>
      <div className="px-[22px] pb-[116px] pt-[16px]">
        <div className="mb-[44px] flex items-center gap-2 text-[14px] text-[#6f7785]">
          <span>Inventory</span>
          <i className="ti ti-chevron-right text-[13px] text-[#9aa0aa]" />
          <span className="font-semibold text-[#1f2937]">Stock out</span>
        </div>

        <div className="grid grid-cols-[394px_minmax(600px,1080px)] gap-[clamp(64px,13vw,248px)] pl-[54px] pr-[58px] max-xl:grid-cols-[394px_minmax(520px,1fr)] max-xl:gap-10 max-lg:grid-cols-1 max-lg:pl-0 max-lg:pr-0">
          <aside className="h-[713px] overflow-auto border border-[#9d9d9d] bg-white">
            <div className="sticky top-0 bg-[#fbfbfb] px-[13px] py-[18px]">
              <h3 className="text-[15px] font-semibold text-[#B00000]">Stock Information</h3>
            </div>

            <div className="px-3 pt-[14px]">
              <div className="mb-[25px]">
                <label className="mb-2 block text-[16px] text-[#8a8f98]">Destination</label>
                <p className="text-[14px] text-black">{loading ? '...' : destinationLabel}</p>
              </div>

              <div className="mb-[16px]">
                <label className="mb-[10px] block text-[16px] text-[#8a8f98]">Vendor Name</label>
                <div className="relative">
                  <input
                    list="stockout-vendor-list"
                    value={form.vendor}
                    onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    className="h-[42px] w-full rounded-[4px] border border-[#c8ccd2] bg-white px-3 pr-12 text-[14px] text-black outline-none"
                  />
                  <datalist id="stockout-vendor-list">
                    {vendors.map((vendor) => (
                      <option key={vendor.name} value={vendor.name} />
                    ))}
                  </datalist>
                  <span className="absolute right-10 top-[9px] h-6 border-l border-[#d5d8de]" />
                  <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-[#c4c8cf]" />
                </div>
              </div>

              <div className="mb-[18px] grid grid-cols-2 gap-[13px]">
                <div>
                  <label className="mb-[11px] block text-[16px] text-[#8a8f98]">Invoice Date</label>
                  <input
                    type="date"
                    value={form.invoice_date}
                    onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                    className="h-[40px] w-full rounded-[4px] border border-[#c8ccd2] bg-white px-2 text-[14px] text-black outline-none"
                  />
                </div>
                <div>
                  <label className="mb-[11px] block text-[16px] text-[#8a8f98]">Invoice Number</label>
                  <input
                    value={form.invoice_number}
                    onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                    placeholder="10"
                    className="h-[40px] w-full rounded-[4px] border border-[#c8ccd2] bg-white px-3 text-[14px] text-black outline-none placeholder:text-[#9ca3af]"
                  />
                </div>
              </div>

              <div className="mb-[17px]">
                <label className="mb-[11px] block text-[16px] text-[#8a8f98]">Other Charges</label>
                <input
                  value={form.other_charges}
                  onChange={(e) => setForm({ ...form, other_charges: e.target.value })}
                  placeholder="Other Charges"
                  className="h-[42px] w-full rounded-[4px] border border-[#c8ccd2] bg-white px-3 text-[14px] text-black outline-none placeholder:text-[#9ca3af]"
                />
              </div>

              <div>
                <label className="mb-[11px] block text-[16px] text-[#8a8f98]">Remarks</label>
                <input
                  value={form.remarks}
                  onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  placeholder="Remarks"
                  className="h-[40px] w-full rounded-[4px] border border-[#c8ccd2] bg-white px-3 text-[14px] text-black outline-none placeholder:text-[#9ca3af]"
                />
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-[22px] flex h-[50px] items-center gap-3 rounded-[3px] border border-[#9d9d9d] bg-white px-3">
              <i className="ti ti-search text-[25px] text-[#c6c8cf]" />
              <input
                type="text"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-full flex-1 bg-transparent text-[16px] text-black outline-none placeholder:text-[#8f96a3]"
              />
            </div>

            <section className="flex h-[641px] flex-col overflow-hidden rounded-[3px] border border-[#9d9d9d] bg-white">
              <div className="flex min-h-[61px] items-center justify-between gap-4 border-b border-[#c7c7c7] px-[14px] py-[10px]">
                <div>
                  <h2 className="text-[16px] font-semibold leading-[20px] text-black">Inventory - Stock Out</h2>
                  <p className="text-[15px] leading-[18px] text-[#616871]">Select desired products & proceed</p>
                </div>
                <div className="flex h-[31px] w-[263px] items-center gap-2 rounded-[3px] border border-[#aeb3ba] bg-white px-2 max-sm:hidden">
                  <i className="ti ti-search text-[19px] text-[#c6c8cf]" />
                  <input
                    type="text"
                    placeholder="Search items in your cart"
                    value={cartFilter}
                    onChange={(e) => setCartFilter(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-black outline-none placeholder:text-[#8f96a3]"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {products.length > 0 && (
                  <div className="mb-4 divide-y divide-[#e6e6e6] rounded-[3px] border border-[#c7c7c7]">
                    {products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product)}
                        disabled={Number(product.availableStock || 0) <= 0}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[#f3f7ff] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div>
                          <div className="text-[14px] font-medium text-black">{product.name}</div>
                          <div className="text-[12px] text-[#616871]">SKU: {product.sku || '-'}</div>
                          <div className="text-[12px] text-[#616871]">Stock: {Number(product.availableStock || 0)}</div>
                        </div>
                        <span className="text-[13px] font-medium text-[#B00000]">Add</span>
                      </button>
                    ))}
                  </div>
                )}

                {!loadingProducts && products.length === 0 && (
                  <p className="py-8 text-center text-[14px] text-[#616871]">No products found</p>
                )}

                {filteredCart.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#e6e6e6]">
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#616871]">Product</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#616871]">Qty</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#616871]">Cost</th>
                        <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#616871]">Tax</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCart.map((item) => (
                        <tr key={item.product_id} className="border-b border-[#f0f0f0] hover:bg-[#f7f7f7]">
                          <td className="px-2 py-3">
                            <div className="text-[13px] font-medium text-black">{item.name}</div>
                            <div className="text-[11px] text-[#616871]">{item.sku}</div>
                          </td>
                          <td className="px-2 py-3">
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) => updateQty(item.product_id, e.target.value)}
                              className="w-20 rounded-[3px] border border-[#c8ccd2] px-2 py-1 text-[13px] text-black"
                            />
                          </td>
                          <td className="px-2 py-3 text-[13px] text-black">{formatCurrency(item.cost_price)}</td>
                          <td className="px-2 py-3 text-[13px] text-black">{formatCurrency(item.tax_value)}</td>
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
                  !searchTerm.trim() && <div className="min-h-[400px]" />
                )}
              </div>
            </section>
          </main>
        </div>
      </div>

      <button
        type="button"
        onClick={() => router.push('/inventory/stockout')}
        className="fixed bottom-[115px] left-[27px] z-40 flex h-[29px] w-[29px] items-center justify-center rounded-[8px] border-2 border-[#B00000] bg-white text-[#B00000]"
        title="Back to stock out"
      >
        <i className="ti ti-home text-[18px]" />
      </button>

      <footer className="fixed bottom-0 left-0 right-0 z-30 h-[91px] bg-white shadow-[0_-1px_0_rgba(0,0,0,0.03)]">
        <div className="flex h-full items-center justify-between pl-[181px] pr-[188px] max-xl:px-10 max-md:px-5">
          <div className="flex flex-wrap items-center gap-[92px] max-xl:gap-10">
            <span className="text-[20px] font-semibold text-black">
              Total Items:<strong className="font-semibold text-[#B00000]">{totals.totalItems}</strong>
            </span>
            <span className="text-[20px] font-semibold text-black">
              Total Cost:<strong className="font-semibold text-[#B00000]">{formatCurrency(totals.totalCost)}</strong>
            </span>
            <span className="text-[20px] font-semibold text-black">
              Total Tax Value:<strong className="font-semibold text-[#B00000]">{formatCurrency(totals.totalTax)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={confirm}
              disabled={confirming || cart.length === 0}
              className="h-[51px] rounded-[4px] bg-[#B00000] px-[14px] text-[16px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? 'Confirming...' : 'Confirm Transaction'}
            </button>
            <button
              type="button"
              onClick={() => setCart([])}
              className="flex h-[52px] w-[52px] items-center justify-center rounded-[3px] border border-[#B00000] bg-white text-[#B00000]"
              title="Clear cart"
            >
              <i className="ti ti-trash text-[24px]" />
            </button>
          </div>
        </div>
      </footer>
    </StockOutFrame>
  );
}

function StockOutFrame({ children }) {
  return (
    <div className="min-h-screen bg-[#f1f2f5] font-sans text-black">
      <Topbar onMenuOpen={() => {}} />
      <main className="pt-[52px]">{children}</main>
    </div>
  );
}

export default function StockOutLineItemsPage() {
  return (
    <Suspense fallback={<StockOutFrame><div className="p-6 text-gray-500">Loading...</div></StockOutFrame>}>
      <LineItemsContent />
    </Suspense>
  );
}
