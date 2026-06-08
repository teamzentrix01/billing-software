'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import MainLayout from '@/components/MainLayout';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysRemaining(value) {
  const expires = new Date(value).getTime();
  if (!Number.isFinite(expires)) return '-';
  const diff = Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000));
  return diff > 0 ? `${diff} day${diff === 1 ? '' : 's'}` : 'Expired';
}

export default function RecycleBinPage() {
  const [records, setRecords] = useState([]);
  const [tableCounts, setTableCounts] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [tableName, setTableName] = useState('');
  const [status, setStatus] = useState('deleted');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      });
      if (tableName) params.set('table', tableName);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/admin/recycle-bin?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Failed to load recycle bin');
      }
      setRecords(json.data?.records || []);
      setTableCounts(json.data?.tableCounts || []);
      setTotal(Number(json.data?.total || 0));
    } catch (err) {
      setError(err.message || 'Failed to load recycle bin');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, status, tableName]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setCurrentUser(json?.data?.user || null);
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!confirmAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmAction]);

  async function runAction(id, type) {
    setActionLoading(`${type}-${id}`);
    setError('');
    try {
      const res = await fetch(
        type === 'restore' ? `/api/admin/recycle-bin/${id}/restore` : `/api/admin/recycle-bin/${id}`,
        { method: type === 'restore' ? 'POST' : 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Action failed');
      }
      await loadRecords();
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setActionLoading('');
      setConfirmAction(null);
    }
  }

  async function purgeExpired() {
    setActionLoading('purge-expired');
    setError('');
    try {
      const res = await fetch('/api/admin/recycle-bin', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Failed to purge expired items');
      }
      await loadRecords();
    } catch (err) {
      setError(err.message || 'Failed to delete expired items');
    } finally {
      setActionLoading('');
      setConfirmAction(null);
    }
  }

  function openConfirm(action) {
    setConfirmAction(action);
  }

  const confirmationDialog =
    confirmAction && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 p-4">
            <button
              type="button"
              aria-label="Close confirmation"
              className="absolute inset-0 cursor-default"
              onClick={() => setConfirmAction(null)}
            />
            <div className="relative z-10 max-h-[calc(100vh-32px)] w-full max-w-[536px] overflow-hidden rounded-[18px] bg-white text-left shadow-2xl">
              <div className="flex gap-4 px-7 py-6">
                <div
                  className={
                    confirmAction.type === 'restore'
                      ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-lg font-bold text-emerald-600'
                      : 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-lg font-bold text-rose-600'
                  }
                >
                  {confirmAction.type === 'restore' ? 'R' : '!'}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-slate-950">
                    {confirmAction.type === 'restore'
                      ? 'Restore record?'
                      : confirmAction.type === 'purge-expired'
                        ? 'Delete expired records?'
                        : 'Delete permanently?'}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {confirmAction.type === 'restore' ? (
                      <>
                        <span className="font-medium text-slate-700">{confirmAction.label}</span> will be
                        restored. Related rows from the same delete operation may also be restored.
                      </>
                    ) : confirmAction.type === 'purge-expired' ? (
                      <>All recycle-bin records older than 15 days will be permanently deleted.</>
                    ) : (
                      <>
                        <span className="font-medium text-slate-700">{confirmAction.label}</span> will be
                        permanently deleted from recycle bin.
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div
                className={
                  confirmAction.type === 'restore'
                    ? 'mx-7 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800'
                    : 'mx-7 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-700'
                }
              >
                {confirmAction.type === 'restore'
                  ? 'Before restoring, make sure linked records such as product, store, and batch data still exist.'
                  : 'This action cannot be undone. The deleted snapshot will not be available for restore.'}
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 px-7 py-5">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  disabled={!!actionLoading}
                  className="rounded-lg border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirmAction.type === 'purge-expired') {
                      purgeExpired();
                    } else {
                      runAction(confirmAction.id, confirmAction.type);
                    }
                  }}
                  disabled={!!actionLoading}
                  className={
                    confirmAction.type === 'restore'
                      ? 'rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60'
                      : 'rounded-lg bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60'
                  }
                >
                  {actionLoading ? 'Working...' : confirmAction.type === 'restore' ? 'Restore' : 'Delete'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <MainLayout>
      <div className="min-h-[calc(100vh-110px)] bg-slate-50 px-3 py-4 sm:px-5">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-end">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Super Admin</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">Recycle Bin</h1>
              <p className="mt-1 text-sm text-slate-500">
                Deleted records are retained for 15 days with restore and delete audit history.
              </p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => openConfirm({ type: 'purge-expired' })}
                disabled={actionLoading === 'purge-expired'}
                className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete expired
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
              <input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="Search name, id, or table"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
              <select
                value={tableName}
                onChange={(event) => {
                  setPage(1);
                  setTableName(event.target.value);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300"
              >
                <option value="">All tables</option>
                {tableCounts.map((item) => (
                  <option key={item.table_name} value={item.table_name}>
                    {item.table_name} ({item.total})
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300"
              >
                <option value="deleted">Deleted</option>
                <option value="restored">Restored</option>
                <option value="purged">Deleted permanently</option>
                <option value="all">All statuses</option>
              </select>
              <button
                type="button"
                onClick={loadRecords}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Refresh
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Item</th>
                    <th className="px-4 py-3 font-semibold">Table</th>
                    <th className="px-4 py-3 font-semibold">Deleted By</th>
                    <th className="px-4 py-3 font-semibold">Deleted At</th>
                    <th className="px-4 py-3 font-semibold">Expires</th>
                    <th className="px-4 py-3 font-semibold">Group</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                        Loading recycle bin...
                      </td>
                    </tr>
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                        No recycle bin records found.
                      </td>
                    </tr>
                  ) : (
                    records.map((item) => (
                      <tr key={item.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{item.display_name || item.resource_id || `#${item.id}`}</div>
                          <div className="mt-1 text-xs text-slate-500">ID: {item.resource_id || '-'} | Fields: {item.field_count}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">{item.table_name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {item.deleted_by_name || currentUser?.name || currentUser?.email || item.deleted_by || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(item.deleted_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{daysRemaining(item.expires_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{Number(item.operation_count || 1)} row(s)</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {item.status === 'deleted' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openConfirm({ type: 'restore', id: item.id, label: item.display_name || item.resource_id || `#${item.id}` })}
                                  disabled={!!actionLoading}
                                  className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  {actionLoading === `restore-${item.id}` ? 'Restoring...' : 'Restore'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openConfirm({ type: 'purge', id: item.id, label: item.display_name || item.resource_id || `#${item.id}` })}
                                  disabled={!!actionLoading}
                                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                                >
                                  {actionLoading === `purge-${item.id}` ? 'Deleting...' : 'Delete'}
                                </button>
                              </>
                            ) : (
                              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                                {item.status}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span>
                Page {page} of {totalPages} | {total} record(s)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {confirmationDialog}
      {false && confirmAction ? (
        <>
          <button
            type="button"
            aria-label="Close confirmation"
            className="fixed inset-0 z-[80] cursor-default bg-slate-950/45"
            onClick={() => setConfirmAction(null)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-[90] max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[536px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[18px] bg-white text-left shadow-2xl"
          >
            <div className="flex gap-4 px-7 py-6">
              <div className={confirmAction.type === 'restore' ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-lg font-bold text-emerald-600' : 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-50 text-lg font-bold text-rose-600'}>
                {confirmAction.type === 'restore' ? '↺' : '!'}
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-slate-950">
                  {confirmAction.type === 'restore'
                    ? 'Restore record?'
                    : confirmAction.type === 'purge-expired'
                      ? 'Delete expired records?'
                      : 'Delete permanently?'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {confirmAction.type === 'restore' ? (
                    <>
                      <span className="font-medium text-slate-700">{confirmAction.label}</span> will be restored. Related rows from the same delete operation may also be restored.
                    </>
                  ) : confirmAction.type === 'purge-expired' ? (
                    <>All recycle-bin records older than 15 days will be permanently deleted.</>
                  ) : (
                    <>
                      <span className="font-medium text-slate-700">{confirmAction.label}</span> will be permanently deleted from recycle bin.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className={confirmAction.type === 'restore' ? 'mx-7 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-800' : 'mx-7 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-700'}>
              {confirmAction.type === 'restore'
                ? 'Before restoring, make sure linked records such as product, store, and batch data still exist.'
                : 'This action cannot be undone. The deleted snapshot will not be available for restore.'}
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 px-7 py-5">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={!!actionLoading}
                className="rounded-lg border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction.type === 'purge-expired') {
                    purgeExpired();
                  } else {
                    runAction(confirmAction.id, confirmAction.type);
                  }
                }}
                disabled={!!actionLoading}
                className={
                  confirmAction.type === 'restore'
                    ? 'rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60'
                    : 'rounded-lg bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60'
                }
              >
                {actionLoading ? 'Working...' : confirmAction.type === 'restore' ? 'Restore' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </MainLayout>
  );
}
