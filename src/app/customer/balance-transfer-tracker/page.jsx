'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MainLayout from '@/components/MainLayout';
import CustomerSearchModal from '@/components/CustomerSearchModal';
import { extractStores } from '@/lib/clientResponse';
import { formatIndianDate } from '@/lib/dateUtils';

const columns = [
  { key: 'id', label: 'Transfer ID' },
  { key: 'fromCustomerName', label: 'Source Party Name' },
  { key: 'fromCustomerPhone', label: 'Source Party Phone' },
  { key: 'fromAccountType', label: 'Source Account Type' },
  { key: 'toCustomerName', label: 'Destination Party Name' },
  { key: 'toCustomerPhone', label: 'Destination Party Phone' },
  { key: 'toAccountType', label: 'Destination Account Type' },
  { key: 'amount', label: 'Transfer Amount' },
  { key: 'date', label: 'Date' },
  { key: 'reference', label: 'Reference' },
];

function formatDateInput(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  return formatIndianDate(value, value || '');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TransferModal({
  open,
  sourceCustomer,
  destinationCustomer,
  onClose,
  onSubmit,
  submitting,
  onPickSource,
  onPickDestination,
}) {
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmount('');
  }, [open]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    onSubmit({ amount: Number(amount || 0) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-6 overflow-y-auto">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[760px] bg-white rounded-xl border border-gray-300 shadow-xl overflow-hidden my-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-[18px] font-semibold text-gray-900">Transfer Balance</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <i className="ti ti-x text-[20px]" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-gray-700 mb-1">From Customer</label>
              <div className="flex gap-2">
                <input
                  value={sourceCustomer?.name || ''}
                  readOnly
                  placeholder="Select source customer"
                  className="h-10 flex-1 border border-gray-200 rounded px-3 text-[13px] text-gray-700 bg-white cursor-pointer"
                  onClick={onPickSource}
                />
                <button
                  type="button"
                  onClick={onPickSource}
                  className="h-10 px-4 rounded bg-blue-700 text-white text-[13px] font-medium hover:bg-blue-800"
                >
                  Search
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[12px] text-gray-700 mb-1">To Customer</label>
              <div className="flex gap-2">
                <input
                  value={destinationCustomer?.name || ''}
                  readOnly
                  placeholder="Select destination customer"
                  className="h-10 flex-1 border border-gray-200 rounded px-3 text-[13px] text-gray-700 bg-white cursor-pointer"
                  onClick={onPickDestination}
                />
                <button
                  type="button"
                  onClick={onPickDestination}
                  className="h-10 px-4 rounded bg-blue-700 text-white text-[13px] font-medium hover:bg-blue-800"
                >
                  Search
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-gray-700 mb-1">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-10 w-full border border-gray-200 rounded px-3 text-[13px] text-gray-700 bg-white"
                required
              />
            </div>
            <div className="rounded border border-gray-200 p-3 bg-gray-50">
              <p className="text-[12px] text-gray-500">Transfer Date</p>
              <p className="text-[16px] font-semibold text-gray-900">{formatDisplayDate(formatDateInput())}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded border border-gray-200 text-[13px] text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !sourceCustomer?.id || !destinationCustomer?.id}
              className="h-10 px-4 rounded bg-blue-700 text-white text-[13px] font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-blue-800"
            >
              {submitting ? 'Transferring...' : 'Transfer Balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BalanceTransferTrackerPage() {
  const today = useMemo(() => new Date(), []);

  const [stores, setStores] = useState([]);
  const [store, setStore] = useState('all');
  const [dateFrom, setDateFrom] = useState(formatDateInput(today));
  const [dateTo, setDateTo] = useState(formatDateInput(today));
  const [search, setSearch] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerPickMode, setCustomerPickMode] = useState('from');
  const [sourceCustomer, setSourceCustomer] = useState(null);
  const [destinationCustomer, setDestinationCustomer] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const initialLoadRef = useRef(false);

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch('/api/stores');
      const data = await res.json();
      setStores(extractStores(data));
    } catch (err) {
      console.error(err);
      setStores([]);
    }
  }, []);

  const fetchRows = useCallback(async ({ nextPage = 1, nextPageSize = pageSize } = {}) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const qs = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize),
        dateFrom,
        dateTo,
      });

      if (store && store !== 'all') qs.set('store', store);
      if (search.trim()) qs.set('search', search.trim());

      const res = await fetch(`/api/customer-balance-transfers?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch balance transfer tracker');

      const listRows = Array.isArray(data.rows) ? data.rows : [];
      const pagination = data.pagination || {};

      setRows(listRows);
      setPage(Number(pagination.page || nextPage));
      setPageSize(Number(pagination.pageSize || nextPageSize));
      setTotal(Number(pagination.total || 0));
      setTotalPages(Number(pagination.totalPages || 1));
    } catch (err) {
      console.error(err);
      setRows([]);
      setTotal(0);
      setTotalPages(1);
      setErrorMessage(err.message || 'Failed to fetch balance transfer tracker');
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

  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = total === 0 ? 0 : Math.min(page * pageSize, total);

  const exportCsv = () => {
    const header = columns.map((col) => col.label);
    const dataRows = rows.map((row) => [
      row.id,
      row.fromCustomerName,
      row.fromCustomerPhone,
      row.fromAccountType,
      row.toCustomerName,
      row.toCustomerPhone,
      row.toAccountType,
      formatMoney(row.amount),
      formatDisplayDate(row.date),
      row.reference,
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`));

    const blob = new Blob([[header.join(','), ...dataRows.map((r) => r.join(','))].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `balance-transfer-tracker-${dateFrom}-to-${dateTo}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openTransfer = () => {
    setShowTransferModal(true);
  };

  const handleSaveTransfer = async ({ amount }) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/customer-balance-transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromCustomerId: sourceCustomer?.id,
          toCustomerId: destinationCustomer?.id,
          amount,
          createdBy: 'System',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to transfer balance');

      setShowTransferModal(false);
      await fetchRows({ nextPage: 1 });
    } catch (err) {
      console.error(err);
      window.alert(err.message || 'Unable to transfer balance');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-4 flex-wrap">
          <Link href="/customer/dashboard" className="hover:text-blue-600 transition-colors">Customer</Link>
          <i className="ti ti-chevron-right text-[11px] text-gray-400" />
          <span className="text-blue-600 font-medium">Customer Balance Transfer</span>
        </nav>

        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Customer Balance Transfer Tracker</h1>
            <p className="text-[12.5px] text-gray-500 mt-1">
              This is a list of account balance history. <span className="text-blue-600 cursor-pointer hover:underline">Need Help?</span>
            </p>
          </div>

          <button
            type="button"
            onClick={openTransfer}
            className="h-10 px-5 inline-flex items-center justify-center bg-blue-700 text-white rounded text-[13px] font-medium hover:bg-blue-800"
          >
            Transfer Balance
          </button>
        </div>

        <div className="flex justify-end mb-4">
          <div className="w-full max-w-[340px]">
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
                className="h-10 w-full rounded border border-gray-300 bg-white pl-10 pr-3 text-[13px] text-gray-700"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded border border-gray-200 overflow-hidden">
          <div className="px-5 pt-4 pb-4 border-b border-gray-100">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_220px_120px_44px] xl:items-start">
              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Date Range</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-10 w-full border border-gray-200 rounded px-3 text-[13px] text-gray-700 bg-white"
                  />
                  <input
                    type="date"
                    min={dateFrom}
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-10 w-full border border-gray-200 rounded px-3 text-[13px] text-gray-700 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] text-gray-800 mb-2">Region</label>
                <div className="relative">
                  <select
                    value={store}
                    onChange={(event) => setStore(event.target.value)}
                    className="h-10 w-full appearance-none border border-gray-200 rounded px-3 pr-9 text-[13px] text-gray-700 bg-white"
                  >
                    <option value="all">All Regions</option>
                    {stores.map((storeOption) => (
                      <option key={storeOption.id} value={String(storeOption.id)}>{storeOption.name}</option>
                    ))}
                  </select>
                  <i className="ti ti-chevron-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]" />
                </div>
              </div>

              <div className="xl:pt-[28px]">
                <button
                  type="button"
                  onClick={() => { setPage(1); fetchRows({ nextPage: 1 }); }}
                  className="h-10 px-5 inline-flex items-center justify-center bg-blue-700 text-white rounded text-[13px] font-medium hover:bg-blue-800"
                >
                  Apply
                </button>
              </div>

              <div className="xl:pt-[28px] xl:justify-self-end">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="h-10 w-10 inline-flex items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                  title="Download CSV"
                >
                  <i className="ti ti-download text-[15px]" />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 text-left text-[12px] font-semibold text-gray-700 whitespace-nowrap">
                      {column.label} <span className="text-gray-400">↑↓</span>
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
                      {errorMessage || 'No Records Found'}
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/70">
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.id}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.fromCustomerName}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.fromCustomerPhone}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.fromAccountType}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.toCustomerName}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.toCustomerPhone}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.toAccountType}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatMoney(row.amount)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{formatDisplayDate(row.date)}</td>
                    <td className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row.reference}</td>
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
              className="border border-gray-200 rounded px-3 py-2 bg-white text-[12px] text-gray-700"
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
                className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Prev
              </button>
              <span className="text-[12px] text-gray-600">Page {page} of {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => fetchRows({ nextPage: page + 1 })}
                className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {showCustomerModal ? (
          <CustomerSearchModal
            open={showCustomerModal}
            onClose={() => setShowCustomerModal(false)}
            onSelect={(customer) => {
              if (customerPickMode === 'from') {
                setSourceCustomer(customer ? { id: customer.id, name: customer.name } : null);
              } else {
                setDestinationCustomer(customer ? { id: customer.id, name: customer.name } : null);
              }
              setShowCustomerModal(false);
            }}
          />
        ) : null}

        <TransferModal
          open={showTransferModal}
          sourceCustomer={sourceCustomer}
          destinationCustomer={destinationCustomer}
          onClose={() => setShowTransferModal(false)}
          onPickSource={() => {
            setCustomerPickMode('from');
            setShowCustomerModal(true);
          }}
          onPickDestination={() => {
            setCustomerPickMode('to');
            setShowCustomerModal(true);
          }}
          onSubmit={handleSaveTransfer}
          submitting={submitting}
        />
      </div>
    </MainLayout>
  );
}
