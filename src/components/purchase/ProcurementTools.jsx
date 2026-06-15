'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MainLayout from '@/components/MainLayout';
import { formatIndianDate } from '@/lib/dateUtils';

function money(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function dateText(value) {
  return formatIndianDate(value, String(value || '-'));
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.stores)) return payload.stores;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.stores)) return payload.data.stores;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buildQuery(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.map(csvEscape).join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function PageShell({ title, description, children }) {
  return (
    <MainLayout>
      <div className="mb-4 flex items-center gap-2 text-[12px] text-gray-500">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">{title}</span>
      </div>
      <div className="mb-5">
        <h1 className="text-[28px] font-semibold leading-tight text-gray-900">{title}</h1>
        <p className="mt-1 text-[12.5px] text-gray-400">{description}</p>
      </div>
      {children}
    </MainLayout>
  );
}

function Toolbar({ search, setSearch, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-[260px] max-w-[360px] flex-1 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
        <i className="ti ti-search text-[16px] text-gray-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          className="w-full bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
        />
      </div>
      {children}
    </div>
  );
}

function DataTable({ headers, rows, renderRow, empty = 'No Records Found' }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="border-b border-gray-100">
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(renderRow) : (
              <tr>
                <td colSpan={headers.length} className="px-4 py-14 text-center text-[14px] font-medium text-blue-700">{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100 px-4 py-3 text-[12px] text-gray-400">Showing {rows.length} Results</div>
    </div>
  );
}

function Row({ children }) {
  return <tr className="border-b border-gray-100 hover:bg-blue-50/50">{children}</tr>;
}

function Cell({ children }) {
  return <td className="px-4 py-3 text-[13px] text-gray-700">{children}</td>;
}

function ActionButton({ children, onClick, tone = 'blue' }) {
  const styles = tone === 'red'
    ? 'border-red-200 text-red-600 hover:bg-red-50'
    : tone === 'green'
      ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
      : 'border-blue-200 text-blue-600 hover:bg-blue-50';
  return <button onClick={onClick} className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${styles}`}>{children}</button>;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props) {
  return <input {...props} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" />;
}

function SelectInput(props) {
  return <select {...props} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-blue-500" />;
}

function FilterBar({ filters, setFilters, stores = [], vendors = [], statuses = [], onFetch, showStore = true, showVendor = true, showStatus = true }) {
  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-6">
      <Field label="From Date"><TextInput type="date" value={filters.dateFrom || ''} onChange={(e) => set('dateFrom', e.target.value)} /></Field>
      <Field label="To Date"><TextInput type="date" value={filters.dateTo || ''} onChange={(e) => set('dateTo', e.target.value)} /></Field>
      {showVendor && (
        <Field label="Vendor">
          <SelectInput value={filters.vendorId || ''} onChange={(e) => set('vendorId', e.target.value)}>
            <option value="">All Vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </SelectInput>
        </Field>
      )}
      {showStore && (
        <Field label="Store">
          <SelectInput value={filters.storeId || ''} onChange={(e) => set('storeId', e.target.value)}>
            <option value="">All Stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </Field>
      )}
      {showStatus && (
        <Field label="Status">
          <SelectInput value={filters.status || ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">All Status</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </SelectInput>
        </Field>
      )}
      <div className="flex items-end">
        <button onClick={onFetch} className="w-full rounded-lg border border-blue-200 px-4 py-2 text-[13px] font-semibold text-blue-600">Fetch</button>
      </div>
    </div>
  );
}

function useLookups() {
  const [stores, setStores] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);

  const loadLookup = useCallback(async (url) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return [];
    return payload;
  }, []);

  useEffect(() => {
    Promise.all([
      loadLookup('/api/stores'),
      loadLookup('/api/vendors'),
      loadLookup('/api/catalog/products?pageSize=500'),
    ]).then(([s, v, p]) => {
      setStores(normalizeList(s));
      setVendors(normalizeList(v));
      setProducts(normalizeList(p));
    }).catch(() => {
      setStores([]);
      setVendors([]);
      setProducts([]);
    });
  }, [loadLookup]);

  return { stores, vendors, products };
}

export function VendorQuotationsPage() {
  const { stores, vendors, products } = useLookups();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', vendorId: '', storeId: '', status: '' });
  const [form, setForm] = useState({ vendorId: '', storeId: '', quotationNo: '', productId: '', qty: 1, quotedPrice: 0, deliveryDays: 0, freightAmount: 0 });

  const load = useCallback(() => fetch(`/api/purchase/quotations${buildQuery({ search, ...filters })}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).then((data) => setRows(normalizeList(data))).catch(() => setRows([])), [search, filters]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => rows, [rows]);

  const save = async () => {
    if (!form.vendorId) return alert('Select a vendor');
    if (!form.storeId) return alert('Select a store');
    if (!form.productId) return alert('Select a product');
    if (!Number(form.qty) || Number(form.qty) <= 0) return alert('Qty must be greater than 0');
    if (Number(form.quotedPrice) < 0) return alert('Quoted price cannot be negative');

    const product = products.find((p) => String(p.id) === String(form.productId));
    const res = await fetch('/api/purchase/quotations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        items: [{ productId: form.productId, productName: product?.name, qty: form.qty, quotedPrice: form.quotedPrice }],
      }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save quotation');
    setForm({ vendorId: '', storeId: '', quotationNo: '', productId: '', qty: 1, quotedPrice: 0, deliveryDays: 0, freightAmount: 0 });
    load();
  };

  const updateStatus = async (id, status) => {
    const res = await fetch('/api/purchase/quotations', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || 'Failed to update quotation');
    load();
  };

  return (
    <PageShell title="Vendor Quotation Comparison" description="Capture vendor quotes and compare landed price, lead time and score.">
      <Toolbar search={search} setSearch={setSearch}>
        <button onClick={() => downloadCsv('vendor-quotations.csv', filtered)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Export CSV</button>
      </Toolbar>
      <FilterBar filters={filters} setFilters={setFilters} stores={stores} vendors={vendors} statuses={['Draft', 'Submitted', 'Approved', 'Rejected']} onFetch={load} />
      <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
        <Field label="Vendor"><SelectInput value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">Select Vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectInput></Field>
        <Field label="Store"><SelectInput value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}><option value="">Select Store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></Field>
        <Field label="Quotation No"><TextInput value={form.quotationNo} onChange={(e) => setForm({ ...form, quotationNo: e.target.value })} /></Field>
        <Field label="Product"><SelectInput value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}><option value="">Select Product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput></Field>
        <Field label="Qty"><TextInput type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
        <Field label="Quoted Price"><TextInput type="number" value={form.quotedPrice} onChange={(e) => setForm({ ...form, quotedPrice: e.target.value })} /></Field>
        <Field label="Delivery Days"><TextInput type="number" value={form.deliveryDays} onChange={(e) => setForm({ ...form, deliveryDays: e.target.value })} /></Field>
        <Field label="Freight"><TextInput type="number" value={form.freightAmount} onChange={(e) => setForm({ ...form, freightAmount: e.target.value })} /></Field>
        <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white md:col-span-4">Save Quotation</button>
      </div>
      <DataTable headers={['Quote', 'Vendor', 'Store', 'Items', 'Amount', 'Lead', 'Freight', 'Score', 'Status', 'Actions']} rows={filtered} renderRow={(row) => (
        <Row key={row.id}><Cell>{row.transactionId}</Cell><Cell>{row.vendorName}</Cell><Cell>{row.storeName}</Cell><Cell>{row.totalItems}</Cell><Cell>{money(row.totalAmount)}</Cell><Cell>{row.deliveryDays} days</Cell><Cell>{money(row.freightAmount)}</Cell><Cell>{Math.round(row.score)}</Cell><Cell>{row.status}</Cell><Cell><div className="flex gap-2">{row.status === 'Draft' && <ActionButton onClick={() => updateStatus(row.id, 'Submitted')}>Submit</ActionButton>}{['Draft', 'Submitted'].includes(row.status) && <ActionButton tone="green" onClick={() => updateStatus(row.id, 'Approved')}>Approve</ActionButton>}{['Draft', 'Submitted'].includes(row.status) && <ActionButton tone="red" onClick={() => updateStatus(row.id, 'Rejected')}>Reject</ActionButton>}</div></Cell></Row>
      )} />
    </PageShell>
  );
}

export function PurchaseReturnsPage() {
  const { stores, vendors, products } = useLookups();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', vendorId: '', storeId: '', status: '' });
  const [form, setForm] = useState({ vendorId: '', storeId: '', productId: '', qty: 1, costPrice: 0, reason: '', status: 'Draft' });

  const load = useCallback(() => fetch(`/api/purchase/returns${buildQuery({ search, ...filters })}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).then((data) => setRows(normalizeList(data))).catch(() => setRows([])), [search, filters]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  const filtered = rows;
  const save = async () => {
    const product = products.find((p) => String(p.id) === String(form.productId));
    const res = await fetch('/api/purchase/returns', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, items: [{ productId: form.productId, productName: product?.name, qty: form.qty, costPrice: form.costPrice, reason: form.reason }] }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save purchase return');
    setForm({ vendorId: '', storeId: '', productId: '', qty: 1, costPrice: 0, reason: '', status: 'Draft' });
    load();
  };

  const updateStatus = async (id, status) => {
    const res = await fetch('/api/purchase/returns', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || 'Failed to update purchase return');
    load();
  };

  return (
    <PageShell title="Purchase Returns" description="Record stock returned to vendors and track return value.">
      <Toolbar search={search} setSearch={setSearch}>
        <button onClick={() => downloadCsv('purchase-returns.csv', filtered)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Export CSV</button>
      </Toolbar>
      <FilterBar filters={filters} setFilters={setFilters} stores={stores} vendors={vendors} statuses={['Draft', 'Confirmed', 'Cancelled']} onFetch={load} />
      <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
        <Field label="Vendor"><SelectInput value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">Select Vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectInput></Field>
        <Field label="Store"><SelectInput value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}><option value="">Select Store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></Field>
        <Field label="Product"><SelectInput value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}><option value="">Select Product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput></Field>
        <Field label="Status"><SelectInput value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Draft</option><option>Confirmed</option></SelectInput></Field>
        <Field label="Qty"><TextInput type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
        <Field label="Cost Price"><TextInput type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></Field>
        <Field label="Reason"><TextInput value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        <button onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white">Save Return</button>
      </div>
      <DataTable headers={['Return ID', 'Vendor', 'Store', 'Date', 'Qty', 'Amount', 'Status', 'Reason', 'Actions']} rows={filtered} renderRow={(row) => (
        <Row key={row.id}><Cell>{row.transactionId}</Cell><Cell>{row.vendorName}</Cell><Cell>{row.storeName}</Cell><Cell>{dateText(row.returnDate)}</Cell><Cell>{row.totalQty}</Cell><Cell>{money(row.totalAmount)}</Cell><Cell>{row.status}</Cell><Cell>{row.reason}</Cell><Cell><div className="flex gap-2">{row.status === 'Draft' && <ActionButton onClick={() => updateStatus(row.id, 'Submitted')}>Submit</ActionButton>}{['Draft', 'Submitted'].includes(row.status) && <ActionButton tone="green" onClick={() => updateStatus(row.id, 'Confirmed')}>Confirm</ActionButton>}{['Draft', 'Submitted'].includes(row.status) && <ActionButton tone="red" onClick={() => updateStatus(row.id, 'Rejected')}>Reject</ActionButton>}</div></Cell></Row>
      )} />
    </PageShell>
  );
}

export function VendorLedgerPage() {
  const { vendors } = useLookups();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', vendorId: '' });
  const load = useCallback(() => fetch(`/api/purchase/vendor-ledger${buildQuery({ search, ...filters })}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).then((data) => setRows(normalizeList(data))).catch(() => setRows([])), [search, filters]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  const filtered = rows;
  return (
    <PageShell title="Vendor Ledger" description="Invoice, payment and purchase return ledger by vendor.">
      <Toolbar search={search} setSearch={setSearch}>
        <button onClick={() => downloadCsv('vendor-ledger.csv', filtered)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Export CSV</button>
      </Toolbar>
      <FilterBar filters={filters} setFilters={setFilters} vendors={vendors} onFetch={load} showStore={false} showStatus={false} />
      <DataTable headers={['Date', 'Vendor', 'Type', 'Transaction', 'Reference', 'Debit', 'Credit', 'Balance', 'Remarks']} rows={filtered} renderRow={(row, index) => (
        <Row key={`${row.transactionId}-${index}`}><Cell>{dateText(row.entryAt)}</Cell><Cell>{row.vendorName}</Cell><Cell>{row.entryType}</Cell><Cell>{row.transactionId}</Cell><Cell>{row.referenceNo}</Cell><Cell>{money(row.debit)}</Cell><Cell>{money(row.credit)}</Cell><Cell>{money(row.balance)}</Cell><Cell>{row.remarks}</Cell></Row>
      )} />
    </PageShell>
  );
}

export function VendorPerformancePage() {
  const { stores } = useLookups();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', storeId: '' });
  const load = useCallback(() => fetch(`/api/purchase/vendor-performance${buildQuery({ search, ...filters })}`, { credentials: 'include', cache: 'no-store' }).then((r) => r.json()).then((data) => setRows(normalizeList(data))).catch(() => setRows([])), [search, filters]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);
  const filtered = rows;
  return (
    <PageShell title="Vendor Performance" description="Vendor score based on purchase volume, returns, lead time and outstanding risk.">
      <Toolbar search={search} setSearch={setSearch}>
        <button onClick={() => downloadCsv('vendor-performance.csv', filtered)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Export CSV</button>
      </Toolbar>
      <FilterBar filters={filters} setFilters={setFilters} stores={stores} onFetch={load} showVendor={false} showStatus={false} />
      <DataTable headers={['Vendor', 'Score', 'Grade', 'POs', 'Purchase Value', 'Lead Days', 'Returns', 'Outstanding']} rows={filtered} renderRow={(row) => (
        <Row key={row.vendorId}><Cell>{row.vendorName}</Cell><Cell>{row.score}</Cell><Cell>{row.grade}</Cell><Cell>{row.poCount}</Cell><Cell>{money(row.purchaseValue)}</Cell><Cell>{row.avgLeadDays}</Cell><Cell>{row.returnCount}</Cell><Cell>{money(row.outstanding)}</Cell></Row>
      )} />
    </PageShell>
  );
}

export function AutoReorderPage() {
  const router = useRouter();
  const { stores, vendors } = useLookups();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [storeId, setStoreId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [selected, setSelected] = useState([]);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    if (search) params.set('search', search);
    fetch(`/api/purchase/reorder?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setRows(normalizeList(data)))
      .catch(() => setRows([]));
  }, [storeId, search]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const toggle = (row) => setSelected((current) => current.some((item) => item.productId === row.productId && item.storeId === row.storeId)
    ? current.filter((item) => !(item.productId === row.productId && item.storeId === row.storeId))
    : [...current, row]);

  const generatePo = async () => {
    if (!storeId) return alert('Select a store');
    if (!vendorId) return alert('Select a vendor');
    if (!selected.length) return alert('Select at least one product');
    const res = await fetch('/api/purchase/reorder', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, vendorId, items: selected.map((item) => ({ productId: item.productId, qty: item.suggestedQty, costPrice: item.costPrice })) }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to generate PO');
    router.push(`/purchase/purchase-orders/line-items?id=${encodeURIComponent(data.id)}`);
  };

  const visible = rows.filter((row) => !search || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(search.toLowerCase())));
  return (
    <PageShell title="Auto Reorder Generation" description="Find low-stock products and generate purchase orders from reorder suggestions.">
      <Toolbar search={search} setSearch={setSearch}>
        <SelectInput value={storeId} onChange={(e) => { setStoreId(e.target.value); setSelected([]); }}><option value="">Select Store</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput>
        <SelectInput value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Select Vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectInput>
        <button onClick={load} className="rounded-lg border border-blue-200 px-4 py-2 text-[13px] font-semibold text-blue-600">Fetch</button>
        <button onClick={() => downloadCsv('auto-reorder.csv', visible)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Export CSV</button>
        <button onClick={generatePo} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white">Generate PO</button>
      </Toolbar>
      <DataTable headers={['Select', 'Product', 'Store', 'Current', 'Reorder Level', 'Suggested Qty', 'Last Vendor', 'Cost']} rows={visible} renderRow={(row) => {
        const checked = selected.some((item) => item.productId === row.productId && item.storeId === row.storeId);
        return (
          <Row key={`${row.storeId}-${row.productId}`}><Cell><input type="checkbox" checked={checked} onChange={() => toggle(row)} /></Cell><Cell>{row.productName}</Cell><Cell>{row.storeName}</Cell><Cell>{row.currentStock}</Cell><Cell>{row.reorderLevel}</Cell><Cell>{row.suggestedQty}</Cell><Cell>{row.vendorName || '-'}</Cell><Cell>{money(row.costPrice)}</Cell></Row>
        );
      }} />
    </PageShell>
  );
}
