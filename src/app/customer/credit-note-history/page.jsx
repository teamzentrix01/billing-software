'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { extractStores } from '@/lib/clientResponse';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'sNo', label: 'S. No.' },
  { key: 'creditNoteId', label: 'Credit Note ID' },
  { key: 'storeId', label: 'Store ID' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerPhone', label: 'Customer Phone' },
  { key: 'amount', label: 'Amount' },
  { key: 'issuedOnOrderId', label: 'Issued on Order ID' },
  { key: 'issueDate', label: 'Issue Date' },
  { key: 'issueTime', label: 'Issue Time' },
  { key: 'redeemedOnOrderId', label: 'Redeemed on Order ID' },
  { key: 'redeemedStoreId', label: 'Redeemed Store ID' },
  { key: 'redeemedStoreName', label: 'Redeemed Store Name' },
  { key: 'redeemDate', label: 'Redeem Date' },
  { key: 'redeemTime', label: 'Redeem Time' },
  { key: 'redeemAmount', label: 'Redeem Amount' },
  { key: 'amountCredited', label: 'Amount Credited' },
  { key: 'taxId', label: 'Tax ID' },
  { key: 'taxName', label: 'Tax Name' },
  { key: 'taxPercentage', label: 'Tax Percentage' },
  { key: 'taxValue', label: 'Tax Value' },
  { key: 'totalTaxValue', label: 'Total Tax Value' },
  { key: 'tdsId', label: 'TDS ID' },
  { key: 'tdsName', label: 'TDS Name' },
  { key: 'tdsPercentage', label: 'TDS Percentage' },
  { key: 'tdsValue', label: 'TDS Value' },
  { key: 'tcsId', label: 'TCS ID' },
  { key: 'tcsName', label: 'TCS Name' },
  { key: 'tcsPercentage', label: 'TCS Percentage' },
  { key: 'tcsValue', label: 'TCS Value' },
  { key: 'refundAmount', label: 'Refund Amount' },
];

function formatInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatRangeDate(value) {
  return formatIndianDate(value, value || '');
}

function formatMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

function toCsv(rows) {
  const header = columns.map((column) => column.label).join(',');
  const body = rows.map((row) => columns.map((column) => {
    const value = row[column.key] ?? '';
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(','));

  return [header, ...body].join('\n');
}

export default function CreditNoteHistoryPage() {
  const today = useMemo(() => new Date(), []);

  const [dateFrom, setDateFrom] = useState(formatInputDate(today));
  const [dateTo, setDateTo] = useState(formatInputDate(today));
  const [store, setStore] = useState('all');
  const [customer, setCustomer] = useState('');
  const [search, setSearch] = useState('');
  const [stores, setStores] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch('/api/stores');
      const data = await res.json();
      const options = extractStores(data);
      setStores(options);
    } catch (err) {
      console.error(err);
      setStores([]);
    }
  }, []);

  const fetchRows = useCallback(async ({ nextPage = 1, nextPageSize = pageSize } = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize),
        dateFrom,
        dateTo,
      });

      if (store && store !== 'all') params.set('store', store);
      if (customer.trim()) params.set('customer', customer.trim());
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/customer-credit-note-history?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch credit note history');
      }

      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.pagination?.total || 0));
      setTotalPages(Number(data.pagination?.totalPages || 1));
      setPage(Number(data.pagination?.page || nextPage));
      setPageSize(Number(data.pagination?.pageSize || nextPageSize));
    } catch (err) {
      console.error(err);
      setRows([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [customer, dateFrom, dateTo, pageSize, search, store]);

  useEffect(() => {
    fetchStores();
    fetchRows();
  }, [fetchStores, fetchRows]);

  const dateRangeLabel = `${formatRangeDate(dateFrom)} - ${formatRangeDate(dateTo)}`;
  const showFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showTo = total === 0 ? 0 : Math.min(page * pageSize, total);

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
    anchor.download = `credit-note-history-${dateFrom}-to-${dateTo}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const pageNumbers = useMemo(() => {
    const maxVisible = 5;
    if (totalPages <= maxVisible) return Array.from({ length: totalPages }, (_, index) => index + 1);

    if (page <= 3) return [1, 2, 3, 4, 5];
    if (page >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [page - 2, page - 1, page, page + 1, page + 2];
  }, [page, totalPages]);

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-4 flex-wrap">
          <a href="/customer/dashboard" className="hover:text-blue-600 transition-colors">Customer</a>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-gray-900 font-semibold">Credit Note History</span>
        </nav>

        <div className="mb-6">
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Credit Note History</h1>
          <p className="text-[12.5px] text-gray-500 mt-1">
            Credit Note History description can be found here{' '}
            <span className="text-blue-600 cursor-pointer hover:underline">Need Help?</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_220px_280px_minmax(0,1fr)_auto] xl:items-end">
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

              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Customer</label>
                <input
                  type="text"
                  value={customer}
                  onChange={(event) => setCustomer(event.target.value)}
                  placeholder="Customer"
                  className="h-11 w-full border border-gray-200 rounded-lg px-3 text-[13px] text-gray-700 bg-white outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleApply();
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

              <div className="xl:col-span-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <p className="text-[12px] text-gray-500">{formatRangeDate(dateFrom)} - {formatRangeDate(dateTo)}</p>
                <button
                  type="button"
                  onClick={handleApply}
                  className="h-11 px-6 inline-flex items-center justify-center bg-blue-700 text-white rounded-lg text-[13px] font-medium hover:bg-blue-800"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[2900px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 text-left text-[12px] font-semibold text-gray-600 whitespace-nowrap">
                      {column.label}
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
                  <tr key={`${row.creditNoteId}-${row.sNo}`} className="border-b border-gray-50 hover:bg-gray-50/70">
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">
                        {column.key === 'amount'
                          || column.key === 'redeemAmount'
                          || column.key === 'amountCredited'
                          || column.key === 'taxValue'
                          || column.key === 'totalTaxValue'
                          || column.key === 'tdsValue'
                          || column.key === 'tcsValue'
                          || column.key === 'refundAmount'
                          ? formatMoney(row[column.key])
                          : (row[column.key] || '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-500 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
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
              <span>Showing {showFrom} to {showTo} of {total} Results</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => fetchRows({ nextPage: page - 1 })}
                className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Prev
              </button>
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  onClick={() => fetchRows({ nextPage: pageNumber })}
                  className={`w-8 h-8 rounded-lg text-[12.5px] font-semibold transition-colors ${
                    page === pageNumber ? 'bg-blue-700 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {pageNumber}
                </button>
              ))}
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
