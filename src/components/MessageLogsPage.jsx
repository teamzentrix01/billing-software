'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';
import { extractStores } from '@/lib/clientResponse';
import { formatIndianDate } from '@/lib/dateUtils';

function formatDate(value) {
  return formatIndianDate(value, '—');
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getStoreOptions(rows) {
  const seen = new Map();
  rows.forEach((row) => {
    if (!row.storeId || row.storeId === '—') return;
    if (!seen.has(String(row.storeId))) {
      seen.set(String(row.storeId), {
        id: String(row.storeId),
        name: row.store || String(row.storeId),
      });
    }
  });
  return Array.from(seen.values());
}

function FilterPill({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-gray-600">
      <span className="font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

function getFileName(title) {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'message-logs'}-export.csv`;
}

export default function MessageLogsPage({
  breadcrumbs,
  title,
  description,
  apiBase,
  columns,
  defaultMessageType = '',
  showMessageTypeFilter = true,
}) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stores, setStores] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [store, setStore] = useState('All');
  const [messageType, setMessageType] = useState(defaultMessageType || 'All');
  const [draftSearch, setDraftSearch] = useState('');
  const [draftDateFrom, setDraftDateFrom] = useState('');
  const [draftDateTo, setDraftDateTo] = useState('');
  const [draftStore, setDraftStore] = useState('All');
  const [draftMessageType, setDraftMessageType] = useState(defaultMessageType || 'All');

  useEffect(() => {
    setDraftMessageType(defaultMessageType || 'All');
    setMessageType(defaultMessageType || 'All');
  }, [defaultMessageType]);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const res = await fetch('/api/stores');
        const data = await res.json();
        setStores(extractStores(data));
      } catch (err) {
        console.error(err);
      }
    };

    loadStores();
  }, []);

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });

        if (search.trim()) params.set('search', search.trim());
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (store && store !== 'All') params.set('store', store);
        if (messageType && messageType !== 'All') params.set('messageType', messageType);

        const res = await fetch(`${apiBase}?${params.toString()}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to load message logs');
        }

        setRows(Array.isArray(data.rows) ? data.rows : []);
        setPagination(data.pagination || { page: 1, pageSize, total: 0, totalPages: 1 });
      } catch (err) {
        console.error(err);
        setRows([]);
        setPagination({ page: 1, pageSize, total: 0, totalPages: 1 });
        setError(err.message || 'Failed to load message logs');
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [apiBase, dateFrom, dateTo, messageType, page, pageSize, search, store]);

  useEffect(() => {
    setDraftSearch(search);
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);
    setDraftStore(store);
  }, [search, dateFrom, dateTo, store]);

  const storeOptions = useMemo(() => {
    const merged = [...getStoreOptions(rows), ...(stores || []).map((storeOption) => ({
      id: String(storeOption.id),
      name: storeOption.name,
    }))];
    const unique = new Map();
    merged.forEach((storeOption) => {
      if (!unique.has(storeOption.id)) {
        unique.set(storeOption.id, storeOption);
      }
    });
    return Array.from(unique.values());
  }, [rows, stores]);

  const total = pagination.total || 0;
  const fromCount = total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const toCount = total === 0 ? 0 : Math.min(pagination.page * pagination.pageSize, total);

  const applyFilters = () => {
    setSearch(draftSearch.trim());
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setStore(draftStore || 'All');
    if (showMessageTypeFilter) {
      setMessageType(draftMessageType || 'All');
    }
    setPage(1);
    setFilterOpen(false);
  };

  const clearFilters = () => {
    setDraftSearch('');
    setDraftDateFrom('');
    setDraftDateTo('');
    setDraftStore('All');
    setDraftMessageType(defaultMessageType || 'All');
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setStore('All');
    setMessageType(defaultMessageType || 'All');
    setPage(1);
    setFilterOpen(false);
  };

  const exportCsv = async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '1000' });
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (store && store !== 'All') params.set('store', store);
    if (messageType && messageType !== 'All') params.set('messageType', messageType);

    const res = await fetch(`${apiBase}?${params.toString()}`);
    const data = await res.json();
    const exportRows = Array.isArray(data.rows) ? data.rows : [];
    const header = columns.map((column) => column.label);
    const body = exportRows.map((row) => columns.map((column) => csvEscape(row[column.key] ?? '')));
    const csv = [header.map(csvEscape).join(','), ...body.map((record) => record.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = getFileName(title);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-[#f5f7fb]">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-2 flex-wrap">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-gray-400">›</span> : null}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-blue-600 transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-blue-600 font-medium">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
            <h1 className="text-[18px] font-semibold text-gray-900">{title}</h1>
            <p className="text-[12px] text-gray-500 mt-1">
              {description} <span className="text-blue-600 cursor-pointer hover:underline">Need Help?</span>
            </p>
          </div>
        </div>

        <section className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
          <div className="flex items-start justify-between gap-3 p-4 flex-wrap">
            <div className="min-w-[260px]">
              <p className="text-[12px] font-medium text-gray-700 mb-1">Date Range</p>
              <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 w-fit min-w-[280px] max-w-full">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="border-0 outline-none text-[12.5px] text-gray-700 bg-transparent"
                />
                <span className="text-gray-400 text-[12px]">-</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="border-0 outline-none text-[12.5px] text-gray-700 bg-transparent"
                />
              </div>
            </div>

            <div className="relative flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setFilterOpen((prev) => !prev)}
                className="h-8 w-8 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center justify-center"
                aria-label="Filter logs"
              >
                ☰
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="h-8 w-8 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center justify-center"
                aria-label="Download logs"
              >
                ↓
              </button>

              {filterOpen ? (
                <div className="absolute right-0 top-11 z-20 w-[320px] rounded-lg border border-gray-200 bg-white shadow-lg p-4">
                  <div className="space-y-3">
                    <FilterPill label="Search">
                      <input
                        type="text"
                        value={draftSearch}
                        onChange={(e) => setDraftSearch(e.target.value)}
                        placeholder="Store, order, mobile or message"
                        className="h-9 w-full rounded border border-gray-300 px-3 text-[13px] text-gray-700 outline-none"
                      />
                    </FilterPill>
                    <FilterPill label="Store">
                      <select
                        value={draftStore}
                        onChange={(e) => setDraftStore(e.target.value)}
                        className="h-9 w-full rounded border border-gray-300 px-3 text-[13px] text-gray-700 outline-none bg-white"
                      >
                        <option value="All">All Stores</option>
                        {storeOptions.map((storeOption) => (
                          <option key={storeOption.id} value={storeOption.id}>
                            {storeOption.name}
                          </option>
                        ))}
                      </select>
                    </FilterPill>
                    {showMessageTypeFilter ? (
                      <FilterPill label="Message Type">
                        <select
                          value={draftMessageType}
                          onChange={(e) => setDraftMessageType(e.target.value)}
                          className="h-9 w-full rounded border border-gray-300 px-3 text-[13px] text-gray-700 outline-none bg-white"
                        >
                          <option value="All">All Types</option>
                          <option value="WhatsApp">WhatsApp</option>
                          <option value="SMS">SMS</option>
                        </select>
                      </FilterPill>
                    ) : null}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="h-8 px-3 rounded border border-gray-300 text-[12px] text-gray-700 hover:bg-gray-50"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={applyFilters}
                        className="h-8 px-3 rounded bg-blue-700 text-white text-[12px] hover:bg-blue-800"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          {error ? (
            <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-red-700 text-[12.5px]">{error}</div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px] text-gray-700 min-w-[1180px]">
              <thead className="bg-white border-b border-gray-200">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-10 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : rows.length > 0 ? (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/70 align-top">
                      {columns.map((column) => {
                        let value = row[column.key];
                        if (column.key === 'sentAt') value = formatDate(row.sentAt);
                        if (column.key === 'deliveryDate') value = row.deliveryDate || formatDate(row.sentAt);
                        if (column.key === 'deliveryTime') value = row.deliveryTime || formatTime(row.sentAt);
                        if (column.key === 'creditsUsed') value = Number(row.creditsUsed || 0).toFixed(2);
                        return (
                          <td key={`${row.id}-${column.key}`} className="px-4 py-3 whitespace-nowrap text-gray-700">
                            {value || '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-14 text-center text-gray-500">
                      No Records Found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-4 border-t border-gray-200">
            <div className="flex items-center gap-3 text-[12px] text-gray-600">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 rounded border border-gray-300 bg-white px-2 text-[12px] text-gray-700"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span>
                Showing {fromCount} to {toCount} of {total} Results
              </span>
            </div>

            <div className="flex items-center gap-2 text-[12px]">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className="h-8 px-3 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-2 text-gray-500">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
                className="h-8 px-3 rounded border border-gray-300 bg-white text-gray-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
