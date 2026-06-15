"use client";

import MainLayout from '@/components/MainLayout';
import { useEffect, useMemo, useRef, useState } from 'react';
import CustomerSearchModal from '@/components/CustomerSearchModal';
import { formatIndianDate } from '@/lib/dateUtils';

function formatDisplayDate(iso) {
  return formatIndianDate(iso, '');
}

const columns = [
  { key: 'storeId', label: 'Store ID' },
  { key: 'storeName', label: 'Store Name' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerAccountId', label: 'Customer Account ID' },
  { key: 'date', label: 'Date' },
  { key: 'transactionId', label: 'Transaction ID' },
  { key: 'posDate', label: 'POS Date' },
  { key: 'transactionType', label: 'Transaction Type' },
  { key: 'openingBalance', label: 'Opening Balance' },
  { key: 'transactionAmount', label: 'Transaction Amount' },
  { key: 'closingBalance', label: 'Closing Balance' },
  { key: 'transactionActivity', label: 'Transaction Activity' },
  { key: 'phone', label: 'Phone' },
  { key: 'paymentType', label: 'Payment Type' },
  { key: 'store', label: 'Store' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'settlementStatus', label: 'Settlement Status' },
];

export default function CustomerLedgerPage() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dateFrom, setDateFrom] = useState(todayIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [draftFrom, setDraftFrom] = useState(todayIso);
  const [draftTo, setDraftTo] = useState(todayIso);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const datePickerRef = useRef(null);
  const dateRange = `${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`;
  const [regions, setRegions] = useState('0 Regions & 0 Stores');
  const [customer, setCustomer] = useState('');
  const [customerId, setCustomerId] = useState(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [rows, setRows] = useState([]);
  const [regionOptions, setRegionOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalTransactions: 0, totalDebit: '0.00', totalCredit: '0.00' });

  useEffect(() => {
    let cancelled = false;

    async function loadRegions() {
      try {
        const res = await fetch('/api/regions', { cache: 'no-store', credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        const records = Array.isArray(json?.data?.records) ? json.data.records : [];
        if (!cancelled) setRegionOptions(records);
      } catch (err) {
        console.error(err);
        if (!cancelled) setRegionOptions([]);
      }
    }

    loadRegions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showDatePicker) return;
    const handleClickOutside = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) {
        setShowDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDatePicker]);

  const openDatePicker = () => {
    setDraftFrom(dateFrom);
    setDraftTo(dateTo);
    setShowDatePicker(true);
  };

  const applyDateRange = () => {
    setDateFrom(draftFrom);
    setDateTo(draftTo > draftFrom ? draftTo : draftFrom);
    setShowDatePicker(false);
  };

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/customer-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo, regions, customerId, customer }),
      });
      const data = await res.json();
      const payload = data.success ? data.data : data;
      setRows(payload.rows || []);
      setSummary(payload.summary || { totalTransactions: 0, totalDebit: '0.00', totalCredit: '0.00' });
    } catch (err) {
      console.error(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen">
        <nav className="flex items-center gap-1.5 text-[12.5px] text-gray-500 mb-4 flex-wrap">
          <span className="flex items-center gap-1.5">
            <a href="/customer/dashboard" className="hover:text-blue-600 transition-colors">Customer</a>
            <i className="ti ti-chevron-right text-[11px] text-gray-400" />
            <span className="text-gray-900 font-semibold">Customer Ledger</span>
          </span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[20px] md:text-[22px] font-bold text-gray-900">Customer Ledger</h1>
            <p className="text-[12.5px] text-gray-500 mt-1">Descriptive text for customer ledger report. <span className="text-blue-600 cursor-pointer hover:underline font-medium">Need Help?</span></p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500">Transactions</p>
            <p className="mt-1 text-2xl font-black text-gray-950">{summary.totalTransactions || 0}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500">Debit</p>
            <p className="mt-1 text-2xl font-black text-rose-700">Rs.{summary.totalDebit || '0.00'}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500">Credit</p>
            <p className="mt-1 text-2xl font-black text-emerald-700">Rs.{summary.totalCredit || '0.00'}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Filters row */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
              <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[260px_220px_minmax(240px,1fr)_auto]">
                <div className="w-full md:w-[260px]" ref={datePickerRef}>
                  <label className="text-[12px] text-gray-700 mb-1 block">Date Range</label>
                  <div className="relative">
                    <input
                      readOnly
                      value={dateRange}
                      onClick={openDatePicker}
                      className="w-full border border-gray-200 rounded-lg pl-3 pr-10 py-2 text-[13px] text-gray-700 bg-white cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={openDatePicker}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-gray-100"
                      aria-label="Open date range calendar"
                    >
                      <i className="ti ti-calendar text-[16px] text-gray-500" />
                    </button>
                    {showDatePicker && (
                      <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                        <p className="text-[11.5px] font-medium text-gray-600 mb-2">Select date range</p>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[11px] text-gray-500 mb-1 block">From</label>
                            <input
                              type="date"
                              value={draftFrom}
                              onChange={(e) => setDraftFrom(e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12.5px] text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 mb-1 block">To</label>
                            <input
                              type="date"
                              value={draftTo}
                              min={draftFrom}
                              onChange={(e) => setDraftTo(e.target.value)}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12.5px] text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowDatePicker(false)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={applyDateRange}
                            className="px-3 py-1.5 rounded-lg bg-blue-700 text-[12px] text-white hover:bg-blue-800"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full md:w-[220px]">
                  <label className="text-[12px] text-gray-700 mb-1 block">Regions & Stores</label>
                  <select value={regions} onChange={(e) => setRegions(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 bg-white">
                    <option>0 Regions & 0 Stores</option>
                    {regionOptions.map((regionOption) => (
                      <option key={regionOption.id} value={regionOption.name}>
                        {regionOption.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end gap-2">
                  <div className="w-full">
                    <label className="text-[12px] text-gray-700 mb-1 block">Customer</label>
                    <div className="relative">
                      <input value={customer} readOnly onClick={() => setShowCustomerModal(true)} placeholder="Select customer" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-700 bg-white placeholder:text-gray-400 cursor-pointer" />
                      <button onClick={() => setShowCustomerModal(true)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-gray-100">
                        <i className="ti ti-search text-gray-500" />
                      </button>
                    </div>
                  </div>
                </div>
                <button onClick={fetchLedger} className="h-10 rounded-lg bg-blue-700 px-5 text-[13px] font-bold text-white hover:bg-blue-800 disabled:opacity-60" disabled={loading}>
                  {loading ? 'Loading...' : 'Fetch'}
                </button>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button className="p-2 rounded-lg hover:bg-gray-100">
                  <i className="ti ti-download text-[16px] text-gray-600" />
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="block md:hidden">
            {loading ? (
              <p className="px-4 py-6 text-sm text-gray-500">Loading...</p>
            ) : rows.length === 0 ? (
              <div className="py-14 text-center text-gray-400">
                <i className="ti ti-database-off text-[32px] mb-2 block" />
                <p className="text-[13px]">No Records Found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <div key={row.transactionId} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-gray-950">{row.customerName}</p>
                        <p className="text-xs text-gray-500">{row.transactionId} - {row.date}</p>
                      </div>
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{row.transactionType}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-500">Amount</span><p className="font-bold text-gray-900">Rs.{row.transactionAmount}</p></div>
                      <div><span className="text-gray-500">Closing</span><p className="font-bold text-gray-900">Rs.{row.closingBalance}</p></div>
                      <div><span className="text-gray-500">Payment</span><p className="font-semibold text-gray-800">{row.paymentType || '-'}</p></div>
                      <div><span className="text-gray-500">Status</span><p className="font-semibold text-gray-800">{row.settlementStatus || '-'}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {columns.map((col) => (
                    <th key={col.key} className="px-4 py-3 text-left text-[12px] font-semibold text-gray-600 whitespace-nowrap">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns.length} className="px-4 py-6 text-gray-500">Loading...</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="text-center py-16 text-gray-400">
                      <i className="ti ti-database-off text-[32px] mb-2 block" />
                      <p className="text-[13px]">No Records Found</p>
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.transactionId} className="border-b border-gray-50 hover:bg-gray-50/60">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-[13px] text-gray-700 whitespace-nowrap">{row[col.key] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <div className="text-[12.5px] text-gray-500">Showing {rows.length ? 1 : 0} to {rows.length} of {rows.length} Results</div>
            <div />
          </div>

        </div>
        {showCustomerModal && (
          <CustomerSearchModal
            open={showCustomerModal}
            onClose={() => setShowCustomerModal(false)}
            onSelect={(c) => { setCustomer(c.name); setCustomerId(c.id); }}
          />
        )}
      </div>
    </MainLayout>
  );
}
