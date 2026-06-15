'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { extractStores } from '@/lib/clientResponse';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'sNo', label: 'S. No.' },
  { key: 'creditTransactionId', label: 'Credit Transaction ID' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'orderId', label: 'Order ID' },
  { key: 'redeemedStoreId', label: 'Redeemed Store ID' },
  { key: 'redeemedStoreName', label: 'Redeemed Store Name' },
  { key: 'redeemOrderId', label: 'Redeem Order ID' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'transactionType', label: 'Transaction Type' },
  { key: 'amountPaid', label: 'Amount Paid' },
  { key: 'paymentType', label: 'Payment Type' },
  { key: 'referenceId', label: 'Reference ID' },
  { key: 'bankRrn', label: 'Bank RRN' },
  { key: 'approvalCode', label: 'Approval Code' },
  { key: 'acquiringBankCode', label: 'Acquiring Bank Code' },
  { key: 'paymentDate', label: 'Payment Date' },
  { key: 'paymentTime', label: 'Payment Time' },
  { key: 'user', label: 'User' },
  { key: 'transactionId', label: 'Transaction ID' },
];

function formatDateInput(value) {
  return value.toISOString().slice(0, 10);
}

function formatRangeDate(value) {
  return formatIndianDate(value, value || '');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toCsv(rows) {
  const header = columns.map((col) => col.label);
  const dataRows = rows.map((row) => columns.map((col) => {
    const value = row[col.key] ?? '';
    const normalized = String(value).replaceAll('"', '""');
    return `"${normalized}"`;
  }));
  return [header.join(','), ...dataRows.map((line) => line.join(','))].join('\n');
}

export default function CreditSettlementPage() {
  const today = useMemo(() => new Date(), []);

  const [dateFrom, setDateFrom] = useState(formatDateInput(today));
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
  const didInitialLoad = useRef(false);

  const dateRangeLabel = `${formatRangeDate(dateFrom)} - ${formatRangeDate(dateTo)}`;

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

      const res = await fetch(`/api/customer-credit-settlement?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch credit settlement report');

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
  }, [pageSize, dateFrom, dateTo, store, search]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    fetchRows({ nextPage: 1 });
  }, [fetchRows]);

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
    setPage(1);
  };

  const handleApplyFilters = () => {
    setPage(1);
    fetchRows({ nextPage: 1 });
  };

  const handleDownload = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `credit-settlement-${dateFrom}-to-${dateTo}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = total === 0 ? 0 : Math.min(page * pageSize, total);

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-4 flex-wrap">
          <a href="/customer/dashboard" className="hover:text-blue-600 transition-colors">Customer</a>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-gray-900 font-semibold">Credit Settlement</span>
        </nav>

        <div className="mb-6">
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Credit Settlement Report</h1>
          <p className="text-[12.5px] text-gray-500 mt-1">Credit Settlement Report description can be found here <span className="text-blue-600 cursor-pointer hover:underline">Need Help?</span></p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_240px_auto_280px_auto] xl:items-end">
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

              <div className="xl:pb-[2px]">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="h-11 px-6 inline-flex items-center justify-center bg-blue-700 text-white rounded-lg text-[13px] font-medium hover:bg-blue-800"
                >
                  Apply
                </button>
              </div>

              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={search}
                    onChange={handleSearchChange}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        setPage(1);
                        fetchRows({ nextPage: 1 });
                      }
                    }}
                    placeholder="Search"
                    className="h-11 w-full border border-gray-200 rounded-lg pl-9 pr-3 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
                  />
                  <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[15px]" />
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownload}
                className="h-11 w-11 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 justify-self-start xl:justify-self-end"
                title="Download CSV"
              >
                <i className="ti ti-download text-[16px]" />
              </button>
            </div>

            <p className="mt-2 text-[12px] text-gray-500">{dateRangeLabel}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[2100px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {columns.map((col) => (
                    <th key={col.key} className="px-4 py-3 text-left text-[12px] font-semibold text-gray-600 whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-8 text-[13px] text-gray-500 text-center">Loading records...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-10 text-[13px] text-center text-gray-500">No Records Found</td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={`${row.transactionId}-${row.sNo}`} className="border-b border-gray-50 hover:bg-gray-50/70">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">
                        {col.key === 'amountPaid' ? formatMoney(row[col.key]) : (row[col.key] || '—')}
                      </td>
                    ))}
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
