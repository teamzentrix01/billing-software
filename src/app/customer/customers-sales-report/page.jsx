'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';
import { extractStores } from '@/lib/clientResponse';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'customerId', label: 'Customer ID' },
  { key: 'name', label: 'Name' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'orders', label: 'Orders' },
  { key: 'sales', label: 'Sales' },
  { key: 'pointsEarned', label: 'Points Earned' },
  { key: 'pointsBurned', label: 'Points Burned' },
  { key: 'customerSince', label: 'Customer Since' },
];

function formatDateInput(value) {
  return value.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  return formatIndianDate(value, value || '—');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toCsv(rows) {
  const header = columns.map((column) => column.label);
  const dataRows = rows.map((row) =>
    columns.map((column) => {
      const raw = column.key === 'sales'
        ? formatMoney(row[column.key])
        : column.key === 'customerSince'
          ? formatDisplayDate(row[column.key])
          : String(row[column.key] ?? '');
      return `"${raw.replaceAll('"', '""')}"`;
    })
  );

  return [header.join(','), ...dataRows.map((row) => row.join(','))].join('\n');
}

export default function CustomersSalesReportPage() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  }, []);

  const [dateFrom, setDateFrom] = useState(formatDateInput(defaultFrom));
  const [dateTo, setDateTo] = useState(formatDateInput(today));
  const [store, setStore] = useState('all');
  const [stores, setStores] = useState([]);
  const [search, setSearch] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const initialLoadRef = useRef(false);

  const dateRangeLabel = `${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`;

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch('/api/stores');
      if (!res.ok) throw new Error('Failed to fetch stores');
      const data = await res.json();
      setStores(extractStores(data));
    } catch (err) {
      console.error(err);
      setStores([]);
    }
  }, []);

  const fetchRows = useCallback(async ({ nextPage = 1, nextPageSize = pageSize } = {}) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize),
        dateFrom,
        dateTo,
      });

      if (store && store !== 'all') qs.set('store', store);
      if (search.trim()) qs.set('search', search.trim());

      const res = await fetch(`/api/customers-sales-report?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch customers sales report');

      const data = await res.json();
      const reportRows = Array.isArray(data.rows) ? data.rows : [];
      const pagination = data.pagination || {};

      setRows(reportRows);
      setTotal(Number(pagination.total || 0));
      setTotalPages(Number(pagination.totalPages || 1));
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
    } catch (err) {
      console.error(err);
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, pageSize, search, store]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    fetchRows({ nextPage: 1 });
  }, [fetchRows]);

  useEffect(() => {
    if (!initialLoadRef.current) return;

    const timer = window.setTimeout(() => {
      setPage(1);
      fetchRows({ nextPage: 1 });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [search, fetchRows]);

  const handleApply = () => {
    setPage(1);
    fetchRows({ nextPage: 1 });
  };

  const handleDownload = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `customers-sales-report-${dateFrom}-to-${dateTo}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-4 flex-wrap">
          <Link href="/customer/dashboard" className="hover:text-blue-600 transition-colors">Customer</Link>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-gray-900 font-semibold">Customers Sales Report</span>
        </nav>

        <div className="mb-6">
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Customer Sales Report</h1>
          <p className="text-[12.5px] text-gray-500 mt-1">
            Descriptive text for Customer Sales <span className="text-blue-600 cursor-pointer hover:underline">Need Help?</span>
          </p>
        </div>

        <div className="flex justify-end mb-4">
          <div className="w-full max-w-[360px]">
            <div className="relative">
              <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setPage(1);
                    fetchRows({ nextPage: 1 });
                  }
                }}
                placeholder="Search"
                className="h-11 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 text-[13px] text-gray-700 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_240px_110px_44px] xl:items-start">
              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Date Range</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-11 w-full border border-gray-200 rounded-lg px-3 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
                  />
                  <input
                    type="date"
                    min={dateFrom}
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-11 w-full border border-gray-200 rounded-lg px-3 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Select Store</label>
                <div className="relative">
                  <select
                    value={store}
                    onChange={(event) => setStore(event.target.value)}
                    className="h-11 w-full appearance-none border border-gray-200 rounded-lg px-3 pr-9 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
                  >
                    <option value="all">All</option>
                    {stores.map((storeOption) => (
                      <option key={storeOption.id} value={String(storeOption.id)}>
                        {storeOption.name}
                      </option>
                    ))}
                  </select>
                  <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]" />
                </div>
              </div>

              <div className="xl:pt-[30px]">
                <button
                  type="button"
                  onClick={handleApply}
                  className="h-11 px-6 inline-flex items-center justify-center bg-blue-700 text-white rounded-lg text-[13px] font-medium hover:bg-blue-800"
                >
                  Apply
                </button>
              </div>

              <div className="xl:pt-[30px] xl:justify-self-end">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                  title="Download CSV"
                >
                  <i className="ti ti-download text-[16px]" />
                </button>
              </div>
            </div>

            <p className="mt-3 text-[12px] text-gray-500">{dateRangeLabel}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-3 text-left text-[12px] font-semibold text-gray-600 whitespace-nowrap"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-8 text-[13px] text-gray-500 text-center">
                      Loading records...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-10 text-[13px] text-center text-gray-500">
                      No Records Found
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={`${row.customerId}-${row.customerSince}`} className="border-b border-gray-50 hover:bg-gray-50/70">
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.customerId}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.name}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.mobile}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.email}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.orders}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatMoney(row.sales)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatMoney(row.pointsEarned)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatMoney(row.pointsBurned)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatDisplayDate(row.customerSince)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-500">
            <select
              value={pageSize}
              onChange={(event) => {
                const nextPageSize = Number(event.target.value);
                setPage(1);
                fetchRows({ nextPage: 1, nextPageSize });
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-700"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>

            <span>Showing {showingFrom} to {showingTo} of {total} Results</span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => fetchRows({ nextPage: page - 1 })}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Prev
              </button>
              <span className="text-[12px] text-gray-600">Page {page} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => fetchRows({ nextPage: page + 1 })}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
