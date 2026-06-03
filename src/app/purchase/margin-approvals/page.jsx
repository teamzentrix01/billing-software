'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import MainLayout from '@/components/MainLayout';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusPill({ status }) {
  const normalized = String(status || 'pending').toLowerCase();
  const cls = normalized === 'approved'
    ? 'bg-emerald-100 text-emerald-700'
    : normalized === 'rejected'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-amber-100 text-amber-700';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black capitalize ${cls}`}>{normalized}</span>;
}

function Delta({ current, requested, suffix = '' }) {
  const diff = toNumber(requested) - toNumber(current);
  const color = diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-slate-500';
  return (
    <span className={`text-xs font-bold ${color}`}>
      {diff > 0 ? '+' : ''}{suffix ? `${diff.toFixed(2)}${suffix}` : money(diff)}
    </span>
  );
}

export default function MarginApprovalsPage() {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [canApprove, setCanApprove] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status });
      if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim());
      const res = await fetch(`/api/purchase/margin-approvals?${qs.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load margin approvals');
      setCanApprove(Boolean(json.canApprove));
      setRecords(Array.isArray(json.records) ? json.records : []);
    } catch (err) {
      setRecords([]);
      showToast(err.message || 'Failed to load margin approvals', 'error');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const filteredRecords = useMemo(() => records, [records]);

  const updateApproval = async (row, action) => {
    const reason = action === 'reject' ? window.prompt('Reason for rejection?') || '' : '';
    if (action === 'reject' && !reason.trim()) return;

    setActionId(row.id);
    try {
      const res = await fetch('/api/purchase/margin-approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to update approval');
      showToast(action === 'approve' ? 'Margin change approved and prices updated' : 'Margin change rejected');
      await loadRecords();
    } catch (err) {
      showToast(err.message || 'Unable to update approval', 'error');
    } finally {
      setActionId(null);
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
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span className="text-blue-600">Purchase</span>
                <i className="ti ti-chevron-right text-[11px]" />
                <span className="text-slate-900">Margin Approvals</span>
              </div>
              <h1 className="text-2xl font-black text-slate-950 sm:text-3xl">Margin Approvals</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Review GRN price changes before CP, MRP and SP go live.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex rounded-lg border border-slate-200 bg-white p-1">
                {['pending', 'approved', 'rejected', 'all'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setStatus(option)}
                    className={`rounded-md px-3 py-1.5 text-xs font-black capitalize ${
                      status === option ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setDebouncedSearch(search.trim());
                }}
                className="flex h-10 min-w-0 rounded-lg border border-slate-200 bg-white"
              >
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="min-w-0 flex-1 rounded-l-lg px-3 text-sm outline-none"
                  placeholder="Search product, store, GRN, user, status"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setDebouncedSearch('');
                    }}
                    className="px-2 text-slate-400 hover:text-slate-700"
                    aria-label="Clear search"
                  >
                    <i className="ti ti-x text-[16px]" />
                  </button>
                )}
                <button type="submit" className="px-3 text-slate-500 hover:text-blue-700" aria-label="Search">
                  <i className="ti ti-search text-[18px]" />
                </button>
              </form>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="hidden overflow-x-auto xl:block">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Store / Source</th>
                    <th className="px-4 py-3">CP</th>
                    <th className="px-4 py-3">MRP</th>
                    <th className="px-4 py-3">SP</th>
                    <th className="px-4 py-3">Margin</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan="8" className="px-4 py-12 text-center font-semibold text-slate-400">Loading approvals...</td></tr>
                  ) : filteredRecords.length ? filteredRecords.map((row) => (
                    <tr key={row.id} className="text-slate-700">
                      <td className="min-w-[240px] px-4 py-3">
                        <p className="font-bold text-slate-900">{row.productName}</p>
                        <p className="text-xs text-slate-500">{row.sku || row.barcode || `Product ${row.productId}`}</p>
                      </td>
                      <td className="min-w-[180px] px-4 py-3">
                        <p className="font-semibold">{row.storeName || '-'}</p>
                        <p className="text-xs text-slate-500">{row.sourceReference || row.sourceType || '-'} - {formatDate(row.createdAt)}</p>
                      </td>
                      {[
                        ['currentCostPrice', 'requestedCostPrice'],
                        ['currentMrp', 'requestedMrp'],
                        ['currentSellingPrice', 'requestedSellingPrice'],
                      ].map(([currentKey, requestedKey]) => (
                        <td key={currentKey} className="whitespace-nowrap px-4 py-3">
                          <p>{money(row[currentKey])} <span aria-hidden="true">-&gt;</span> <span className="font-bold text-slate-900">{money(row[requestedKey])}</span></p>
                          <Delta current={row[currentKey]} requested={row[requestedKey]} />
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-4 py-3">
                        <p>{row.currentMarginPercent.toFixed(2)}% <span aria-hidden="true">-&gt;</span> <span className="font-bold text-slate-900">{row.requestedMarginPercent.toFixed(2)}%</span></p>
                        <Delta current={row.currentMarginPercent} requested={row.requestedMarginPercent} suffix="%" />
                      </td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                      <td className="px-4 py-3">
                        {row.status === 'pending' && canApprove ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => updateApproval(row, 'approve')}
                              disabled={actionId === row.id}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => updateApproval(row, 'reject')}
                              disabled={actionId === row.id}
                              className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">No action</span>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="8" className="px-4 py-12 text-center font-semibold text-slate-400">No margin approvals found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 xl:hidden">
              {loading ? (
                <div className="rounded-lg border border-slate-200 px-4 py-10 text-center font-semibold text-slate-400">Loading approvals...</div>
              ) : filteredRecords.length ? filteredRecords.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{row.productName}</p>
                      <p className="text-xs text-slate-500">{row.storeName || '-'} - {row.sourceReference || '-'}</p>
                    </div>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ['CP', 'currentCostPrice', 'requestedCostPrice'],
                      ['MRP', 'currentMrp', 'requestedMrp'],
                      ['SP', 'currentSellingPrice', 'requestedSellingPrice'],
                    ].map(([label, currentKey, requestedKey]) => (
                      <div key={label} className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</p>
                        <p className="mt-1 text-sm font-bold">{money(row[currentKey])} <span aria-hidden="true">-&gt;</span> {money(row[requestedKey])}</p>
                        <Delta current={row[currentKey]} requested={row[requestedKey]} />
                      </div>
                    ))}
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400">Margin</p>
                      <p className="mt-1 text-sm font-bold">{row.currentMarginPercent.toFixed(2)}% <span aria-hidden="true">-&gt;</span> {row.requestedMarginPercent.toFixed(2)}%</p>
                      <Delta current={row.currentMarginPercent} requested={row.requestedMarginPercent} suffix="%" />
                    </div>
                  </div>
                  {row.status === 'pending' && canApprove && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateApproval(row, 'approve')}
                        disabled={actionId === row.id}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => updateApproval(row, 'reject')}
                        disabled={actionId === row.id}
                        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )) : (
                <div className="rounded-lg border border-slate-200 px-4 py-10 text-center font-semibold text-slate-400">No margin approvals found.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
