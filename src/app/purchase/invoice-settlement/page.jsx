'use client';

import { useEffect, useMemo, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import { fetchLookup, normalizeVendors } from '@/lib/purchaseLookups';
import { formatIndianDate } from '@/lib/dateUtils';

const tableHeaders = [
  'Invoice ID',
  'Vendor Name',
  'Invoice Number',
  'Amount Due',
  'Amount Paid',
  'Amount Left',
  'Invoice Creation Date',
  'Invoice Due Date',
  'Invoice Status',
  'Settle',
  'View Payment Details',
];

function formatDate(value) {
  return formatIndianDate(value, '—');
}

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function mapRecordsToTable(records) {
  return (records || []).map((row) => ({
    'Invoice ID': row.transactionId ? `#${row.transactionId}` : `#INV-${String(row.id).padStart(4, '0')}`,
    'Vendor Name': row.vendorName || '—',
    'Invoice Number': row.invoiceNumber || '—',
    'Amount Due': formatCurrency(row.totalAmount),
    'Amount Paid': formatCurrency(row.amountPaid),
    'Amount Left': formatCurrency(row.amountLeft),
    'Invoice Creation Date': formatDate(row.invoiceDate || row.createdAt),
    'Invoice Due Date': formatDate(row.dueDate),
    'Invoice Status': row.status || 'Pending',
    'View Payment Details': 'View',
  }));
}

async function fetchVendorInvoices() {
  const res = await fetch('/api/vendor-invoices', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch vendor invoices');
  return res.json();
}

async function settleVendorInvoice(payload) {
  const res = await fetch('/api/vendor-invoices', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to settle invoice');
  return data;
}

function exportCsv(rows) {
  const headers = tableHeaders.filter((header) => !['Settle', 'View Payment Details'].includes(header));
  const csv = [
    headers.join(','),
    ...mapRecordsToTable(rows).map((row) => headers.map((header) => `"${String(row[header] || '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `invoice-settlement-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function InvoiceSettlementPage() {
  const [records, setRecords] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draftFilters, setDraftFilters] = useState({
    vendor: 'all',
    status: 'all',
  });
  const [filters, setFilters] = useState({
    vendor: 'all',
    status: 'all',
  });
  const [error, setError] = useState('');
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [detailsInvoice, setDetailsInvoice] = useState(null);
  const [settlement, setSettlement] = useState({
    amount: '',
    paymentMode: 'Cash',
    referenceNo: '',
    settlementDate: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [savingSettlement, setSavingSettlement] = useState(false);

  const loadData = () => {
    setLoading(true);
    setError('');
    Promise.allSettled([fetchVendorInvoices(), fetchLookup('/api/vendors')])
      .then(([invoiceResult, vendorResult]) => {
        if (invoiceResult.status === 'fulfilled') {
          setRecords(Array.isArray(invoiceResult.value) ? invoiceResult.value : []);
        } else {
          setError(invoiceResult.reason?.message || 'Failed to load invoice settlements');
          setRecords([]);
        }

        if (vendorResult.status === 'fulfilled') {
          setVendors(normalizeVendors(vendorResult.value));
        } else {
          setError((current) => current || vendorResult.reason?.message || 'Failed to load vendors');
          setVendors([]);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApplyFilters = () => {
    setFilters(draftFilters);
  };

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((row) => {
      const vendorMatch = filters.vendor === 'all' || String(row.vendorId) === String(filters.vendor);
      const statusMatch = filters.status === 'all' || String(row.status || '').toLowerCase() === filters.status.toLowerCase();
      const searchMatch = !q || [row.transactionId, row.vendorName, row.invoiceNumber, row.status, row.remarks]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
      return vendorMatch && statusMatch && searchMatch;
    });
  }, [records, search, filters]);

  const tableData = useMemo(() => mapRecordsToTable(filteredRecords), [filteredRecords]);

  const openSettlement = (invoice) => {
    setActiveInvoice(invoice);
    setSettlement({
      amount: invoice.amountLeft ? String(invoice.amountLeft) : '',
      paymentMode: 'Cash',
      referenceNo: '',
      settlementDate: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
  };

  const submitSettlement = async () => {
    if (!activeInvoice) return;
    const amount = Number(settlement.amount || 0);
    if (!amount || amount <= 0) return alert('Enter settlement amount');
    setSavingSettlement(true);
    try {
      await settleVendorInvoice({ invoiceId: activeInvoice.id, ...settlement, amount });
      setActiveInvoice(null);
      loadData();
    } catch (err) {
      alert(err.message || 'Failed to settle invoice');
    } finally {
      setSavingSettlement(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-2 text-[12px] text-gray-500 mb-4">
        <span className="text-blue-600">Purchase</span>
        <i className="ti ti-chevron-right text-[11px] text-gray-400" />
        <span className="font-semibold text-gray-900">Invoice Settlement</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900 leading-tight">Vendor Invoice Credit Settlement</h1>
          <p className="text-[12.5px] text-gray-400 mt-1">Detail report for the vendor invoice credit settlement according to vendor and invoice status. Need Help?</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Vendor:</label>
            <select
              value={draftFilters.vendor}
              onChange={(e) => setDraftFilters({ ...draftFilters, vendor: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
            >
              <option value="all">ALL</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-gray-800">Invoice Status:</label>
            <select
              value={draftFilters.status}
              onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-[12px] bg-white text-gray-800"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <button onClick={handleApplyFilters} className="px-4 py-2 rounded-lg bg-blue-600 text-[12px] font-medium text-white hover:bg-blue-700 transition-colors">
            Apply
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 justify-between flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-[340px] bg-gray-50 rounded-lg px-3 py-2">
            <i className="ti ti-search text-gray-400 text-[16px]" />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
          <button onClick={() => exportCsv(filteredRecords)} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors" title="Download CSV">
            <i className="ti ti-download text-gray-500 text-[16px]" />
          </button>
        </div>
        {error && (
          <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-[12px] font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-100">
                {tableHeaders.map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-[11px] font-bold text-gray-500 tracking-wide uppercase">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-gray-500">
                    Loading records...
                  </td>
                </tr>
              ) : tableData.length > 0 ? (
                tableData.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-gray-100 hover:bg-blue-50/50 transition-colors">
                    {tableHeaders.map((header, colIdx) => (
                      <td key={colIdx} className="px-4 py-3 text-[13px] text-gray-700">
                        {header === 'View Payment Details' ? (
                          <button onClick={() => setDetailsInvoice(filteredRecords[rowIdx])} className="text-blue-600 font-medium hover:underline">View</button>
                        ) : header === 'Settle' ? (
                          <button
                            onClick={() => openSettlement(filteredRecords[rowIdx])}
                            disabled={Number(filteredRecords[rowIdx]?.amountLeft || 0) <= 0}
                            className="rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-600 hover:bg-blue-50 disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
                          >
                            Pay
                          </button>
                        ) : header === 'Invoice Status' ? (
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                            String(row[header]).toLowerCase() === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : String(row[header]).toLowerCase() === 'partial'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {row[header] || '-'}
                          </span>
                        ) : (
                          row[header] || '-'
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={tableHeaders.length} className="px-4 py-14 text-center text-[14px] text-blue-700 font-medium">
                    No Records Found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 text-[12px] text-gray-400">
          <select className="border border-gray-200 rounded-lg px-3 py-2 bg-white text-[12px] text-gray-600">
            <option>10</option>
            <option>20</option>
            <option>50</option>
          </select>
          <span>Showing {tableData.length} Results</span>
        </div>
      </div>

      {activeInvoice && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900">Record Vendor Payment</h3>
                <p className="mt-1 text-[12px] text-gray-500">{activeInvoice.invoiceNumber} · Balance {formatCurrency(activeInvoice.amountLeft)}</p>
              </div>
              <button onClick={() => setActiveInvoice(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600">Close</button>
            </div>
            <div className="grid grid-cols-2 gap-4 p-5">
              <div>
                <label className="text-[12px] font-medium text-gray-700">Amount *</label>
                <input type="number" min="0" step="0.01" value={settlement.amount} onChange={(e) => setSettlement({ ...settlement, amount: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Payment Mode</label>
                <select value={settlement.paymentMode} onChange={(e) => setSettlement({ ...settlement, paymentMode: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800 bg-white">
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                  <option>Bank Transfer</option>
                  <option>Cheque</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Reference No.</label>
                <input value={settlement.referenceNo} onChange={(e) => setSettlement({ ...settlement, referenceNo: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Payment Date</label>
                <input type="date" value={settlement.settlementDate} onChange={(e) => setSettlement({ ...settlement, settlementDate: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
              <div className="col-span-2">
                <label className="text-[12px] font-medium text-gray-700">Remarks</label>
                <textarea rows={3} value={settlement.remarks} onChange={(e) => setSettlement({ ...settlement, remarks: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] text-gray-800" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button onClick={() => setActiveInvoice(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700">Cancel</button>
              <button onClick={submitSettlement} disabled={savingSettlement} className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {savingSettlement ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsInvoice && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900">Payment Details</h3>
                <p className="mt-1 text-[12px] text-gray-500">{detailsInvoice.invoiceNumber} · {detailsInvoice.vendorName}</p>
              </div>
              <button onClick={() => setDetailsInvoice(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-600">Close</button>
            </div>
            <div className="p-5">
              <div className="mb-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Amount Due</p><p className="font-bold text-gray-900">{formatCurrency(detailsInvoice.totalAmount)}</p></div>
                <div className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Paid</p><p className="font-bold text-gray-900">{formatCurrency(detailsInvoice.amountPaid)}</p></div>
                <div className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Left</p><p className="font-bold text-gray-900">{formatCurrency(detailsInvoice.amountLeft)}</p></div>
              </div>
              {detailsInvoice.payments?.length ? (
                <div className="rounded-lg border border-gray-200">
                  <div className="grid grid-cols-4 border-b border-gray-100 px-3 py-2 text-[11px] font-bold uppercase text-gray-500">
                    <span>Date</span><span>Mode</span><span>Reference</span><span className="text-right">Amount</span>
                  </div>
                  <div className="max-h-72 overflow-auto divide-y divide-gray-100">
                    {detailsInvoice.payments.map((payment) => (
                      <div key={payment.id} className="grid grid-cols-4 px-3 py-2 text-[12px] text-gray-700">
                        <span>{formatDate(payment.settlementDate)}</span>
                        <span>{payment.paymentMode}</span>
                        <span>{payment.referenceNo || '-'}</span>
                        <strong className="text-right text-gray-900">{formatCurrency(payment.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-[13px] font-semibold text-gray-500">No payments recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
