'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';
import { formatIndianDate, formatIndianDateTime } from '@/lib/dateUtils';

const PAGE_SIZES = [10, 25, 50, 100];

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'storeName', label: 'Store Name' },
  { key: 'userName', label: 'User Name' },
  { key: 'counterName', label: 'Counter Name' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'sessionStartAt', label: 'Opened At' },
  { key: 'sessionEndAt', label: 'Closed At' },
  { key: 'isActive', label: 'Active' },
  { key: 'openingCash', label: 'Opening Cash' },
  { key: 'grossSales', label: 'Total Sale' },
  { key: 'cashSales', label: 'Cash Sale' },
  { key: 'cardSales', label: 'Card Sale' },
  { key: 'upiSales', label: 'UPI Sale' },
  { key: 'paidTotal', label: 'Paid Total' },
  { key: 'expectedCash', label: 'Expected Cash' },
  { key: 'actualCash', label: 'Actual Cash' },
  { key: 'variance', label: 'Variance' },
  { key: 'closingRemarks', label: 'Remarks' },
];

const moneyKeys = new Set([
  'openingCash',
  'grossSales',
  'cashSales',
  'cardSales',
  'upiSales',
  'paidTotal',
  'expectedCash',
  'actualCash',
  'variance',
]);

function formatDisplayDate(iso) {
  return formatIndianDate(iso, '');
}

function formatCellValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'sessionStartAt' || key === 'sessionEndAt') {
    return formatIndianDateTime(value, '—');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (moneyKeys.has(key)) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }
  return value;
}

export default function UserCounterSessionPage() {
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const [dateFrom, setDateFrom] = useState(todayIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rangeLabel = `${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`;

  useEffect(() => {
    handleFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFetch = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`/api/employee/user-counter-session?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch user counter sessions');
      setRows(Array.isArray(data) ? data : []);
      setPage(1);
    } catch (err) {
      console.error(err);
      setRows([]);
      setError(err.message || 'Failed to fetch user counter sessions');
    } finally {
      setLoading(false);
    }
  };

  const filtered = rows.filter((row) =>
    Object.values(row).some((v) => String(v).toLowerCase().includes(search.toLowerCase()))
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalCount = filtered.length;
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, totalCount);

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] mb-4">
          <Link href="/employee" className="text-blue-600 hover:underline font-medium">
            Employee
          </Link>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-blue-600 font-semibold">User Counter Session</span>
        </nav>

        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-gray-900">User Counter Session</h1>
          <p className="text-[12.5px] text-gray-500 mt-1">
            Detailed report of user counter session{' '}
            <button type="button" className="text-blue-600 hover:underline font-medium">
              Need Help?
            </button>
          </p>
        </div>

        <div className="flex justify-end mb-3">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 w-full sm:w-[280px] shadow-sm">
            <i className="ti ti-search text-gray-400 text-[15px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-[13px] text-gray-700 outline-none flex-1 placeholder-gray-400 min-w-0"
            />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4 justify-between">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <p className="text-[11.5px] font-semibold text-gray-600 mb-1.5">Date Range</p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="border border-gray-300 rounded-lg pl-3 pr-9 py-2 text-[12.5px] text-gray-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[160px]"
                    />
                    <i className="ti ti-calendar pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]" />
                  </div>
                  <span className="text-gray-400 text-[12px]">—</span>
                  <div className="relative">
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="border border-gray-300 rounded-lg pl-3 pr-9 py-2 text-[12.5px] text-gray-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[160px]"
                    />
                    <i className="ti ti-calendar pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]" />
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5 md:hidden">{rangeLabel}</p>
              </div>
              <button
                type="button"
                onClick={handleFetch}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-[12.5px] font-semibold hover:bg-blue-700 transition-colors shadow-sm"
              >
                Fetch
              </button>
            </div>
            <button
              type="button"
              className="p-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors self-end"
              title="Export"
            >
              <i className="ti ti-download text-[18px]" />
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-[12.5px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-3 py-3 text-left font-semibold text-gray-700 whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="text-center text-gray-400 py-16 text-[13px]"
                    >
                      Loading user counter sessions...
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="text-center text-gray-400 py-16 text-[13px]"
                    >
                      {error || 'No matching record found'}
                    </td>
                  </tr>
                ) : (
                  paginated.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-gray-100 hover:bg-gray-50/80 transition-colors"
                    >
                      {columns.map((col) => (
                        <td key={col.key} className="px-3 py-3 text-gray-700 whitespace-nowrap">
                          {formatCellValue(col.key, row[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="appearance-none border border-gray-300 rounded-lg px-3 py-1.5 pr-7 bg-white text-[12.5px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 shadow-sm"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
              <i className="ti ti-chevron-down text-[11px]" />
            </span>
          </div>
          <span className="text-[12.5px] text-gray-500">
            Showing {startIndex} to {endIndex} of {totalCount} Results
          </span>
        </div>
      </div>
    </MainLayout>
  );
}
